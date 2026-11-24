const db = require('../../config/database');
const {randomUUID} = require('node:crypto');
const kpay = require('./kpay');

const scale = 100000000n;
const active = () => process.env.PAYMENT_PROVIDER_MANAGER_ENABLED === 'true';
const unavailable = () => Object.assign(new Error('Aucun service de paiement disponible'), {status: 503, code: 'NO_PAYMENT_PROVIDER'});
const invalid = message => Object.assign(new Error(message), {status: 400});
const rails = ['mtn_momo', 'orange_money'];
const directions = ['deposit', 'payout'];
const view = `
 SELECT c.*, a.provider_code,a.account_key,a.environment,a.enabled AS account_enabled,p.enabled AS provider_enabled
 FROM provider_capabilities c JOIN provider_accounts a ON a.id=c.account_id JOIN payment_providers p ON p.code=a.provider_code
`;
const query = async (sql,replacements={},transaction) => (await db.query(sql,{replacements,transaction}))[0];
const validInt = (n,min=0,max=2147483647) => Number.isInteger(n) && n>=min && n<=max;
const uuid = id => {
  if(typeof id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) throw invalid('Référence invalide');
  return id;
};
function price(amount, tariff, direction) {
  if (!validInt(amount,1) || !validInt(tariff.rate_units,0,99999999)) throw invalid('Montant ou taux invalide');
  const raw=BigInt(amount)*BigInt(tariff.rate_units);
  let fee=raw/scale+BigInt(tariff.fixed_fee);
  const remainder=raw%scale;
  if (tariff.rounding==='ceil_fee' && remainder) fee++;
  if (tariff.rounding==='round_fee' && remainder*2n>=scale) fee++;
  const floor=BigInt(tariff.min_fee);
  const ceiling=tariff.max_fee===null?null:BigInt(tariff.max_fee);
  if(fee<floor) fee=floor;
  else if(ceiling!==null&&fee>=ceiling) fee=ceiling;
  else if(tariff.rounding==='exact'&&remainder) throw Object.assign(invalid('Ce montant nécessite un arrondi non confirmé.'),{status:422});
  const other=direction==='payout'?BigInt(amount)-fee:BigInt(amount)+fee;
  if(other<1n||other>2147483647n)throw invalid('Montant calculé hors limites');
  return {gross:direction==='payout'?amount:Number(other),fee:Number(fee),net:direction==='payout'?Number(other):amount};
}

function createManager(adapters = {kpay}) {
  function adapter(code) {
    const item=Object.hasOwn(adapters,code)&&adapters[code];
    if(!item)throw unavailable();
    return item;
  }
  async function select({environment,direction,amount,rail=null,phone=null,capabilityId=null,simulation=false,asOf=null}) {
    if(!directions.includes(direction)||!validInt(amount,1)||!['sandbox','production'].includes(environment)||(rail&&!rails.includes(rail)))throw invalid('Devis invalide');
    if(asOf!==null&&(!simulation||typeof asOf!=='string'||!/(Z|[+-]\d\d:\d\d)$/.test(asOf)||!Number.isFinite(Date.parse(asOf))))throw invalid('Date avec fuseau requise');
    const rows=await query(`${view}
      WHERE a.environment=:environment AND c.direction=:direction AND :amount BETWEEN c.min_amount AND c.max_amount
        AND p.enabled AND a.enabled AND c.enabled AND (:rail IS NULL OR c.rail=:rail)
        AND (:capabilityId IS NULL OR c.id=:capabilityId)
      ORDER BY c.priority,a.provider_code,a.account_key,c.rail
    `,{environment,direction,amount,rail,capabilityId});
    for(const route of rows) {
      const driver=Object.hasOwn(adapters,route.provider_code)&&adapters[route.provider_code];
      if(!driver)continue;
      try {
        if(!driver.supports(route,{simulation})||(!simulation&&!await driver.eligible(route,phone)))continue;
      } catch (_) {continue;}
      const [version]=await query(`SELECT * FROM provider_tariff_versions WHERE capability_id=:id
        AND effective_at<=COALESCE(CAST(:asOf AS timestamptz),now())
        ORDER BY effective_at DESC LIMIT 1`,{id:route.id,asOf});
      if(!version)continue;
      let terms=version;
      if(version.source==='adapter'){
        try{terms={...version,...await driver.tariff(route)};}catch(_){continue;}
      }
      if(direction==='payout'&&!validInt(terms.rate_units,0,99999999))continue;
      const total=terms.rate_units===null&&direction==='deposit'
        ? {gross:null,fee:null,net:amount}
        : price(amount,terms,direction);
      return {
        ...total, environment, rail:route.rail, network:driver.network(route.rail),
        provider_selection:{capability_id:route.id,account_id:route.account_id,account_key:route.account_key,
          provider_code:route.provider_code,tariff_id:version.id,direction,amount,rail:route.rail},
        tariff_terms:{source:version.source,rate_units:terms.rate_units,fixed_fee:terms.fixed_fee,min_fee:terms.min_fee,
          max_fee:terms.max_fee,rounding:terms.rounding,effective_at:version.effective_at,
          basis:direction==='payout'?'gross':'principal',fee_mode:direction==='payout'?'deducted':'provider_checkout'}
      };
    }
    throw unavailable();
  }
  function operationAdapter(operation) {
    return adapter(operation.pricing_snapshot?.provider_selection?.provider_code||'kpay');
  }
  async function depositCapabilities(environment,amount) {
    const rows=await query(`${view} WHERE a.environment=:environment AND c.direction='deposit'
      AND (:amount IS NULL OR :amount BETWEEN c.min_amount AND c.max_amount)
      AND p.enabled AND a.enabled AND c.enabled
      AND EXISTS (SELECT 1 FROM provider_tariff_versions t WHERE t.capability_id=c.id AND t.effective_at<=now())
      ORDER BY c.priority`,{environment,amount});
    const eligible=rows.filter(route=>{
      const driver=Object.hasOwn(adapters,route.provider_code)&&adapters[route.provider_code];
      try{return Boolean(driver?.supports(route));}catch{return false;}
    });
    return Promise.all(eligible.map(async route=>{
      let state='unknown';
      try{state=await adapter(route.provider_code).health?.(route)||state;}catch{}
      return {rail:route.rail,state};
    }));
  }
  async function assertDispatch(operation,transaction) {
    const selection=operation.pricing_snapshot?.provider_selection;
    if(!active()&&!selection)return;
    const network=operation.request_payload?.provider;
    const rail=selection?.rail||({MTN_MOMO_CMR:'mtn_momo',ORANGE_CMR:'orange_money'})[network];
    const direction=operation.kind==='PAYOUT'?'payout':'deposit';
    const [route]=await query(`${view}
      WHERE a.environment=:environment AND c.direction=:direction AND c.rail=:rail
        AND a.provider_code=:code AND a.account_key=:accountKey
        AND (:capabilityId IS NULL OR c.id=:capabilityId)
        AND :amount BETWEEN c.min_amount AND c.max_amount FOR SHARE OF c,a,p
    `,{environment:operation.environment,direction,rail:rail||null,code:selection?.provider_code||'kpay',
      accountKey:selection?.account_key||'default',capabilityId:selection?.capability_id||null,amount:operation.expected_amount},transaction);
    const driver=operationAdapter(operation);
    if(!route?.enabled||!route.account_enabled||!route.provider_enabled||!driver.supports(route)||
      (selection&&(route.account_id!==selection.account_id||driver.network(rail)!==network)))throw unavailable();
  }
  return {select,operationAdapter,assertDispatch,depositCapabilities};
}

const list = async () => ({
  providers:await query('SELECT * FROM payment_providers ORDER BY code'),
  accounts:await query('SELECT * FROM provider_accounts ORDER BY provider_code,environment,account_key'),
  capabilities:await query(`${view} ORDER BY a.provider_code,a.environment,c.direction,c.rail`),
  tariffs:await query(`SELECT id,capability_id,effective_at,source,rate_units,fixed_fee,min_fee,max_fee,rounding
    FROM provider_tariff_versions ORDER BY capability_id,effective_at DESC`)
});
async function audit(actor,action,id,details,tx) {
  await query(`INSERT INTO transaction_admin_actions(actor_id,actor_name,action,entity_type,entity_id,reason,details)
    VALUES(:actor,:name,:action,'payment_provider',CAST(:id AS uuid),:reason,CAST(:details AS jsonb))`,
  {actor:actor.id,name:actor.full_name,action,id,reason:details.reason,details:JSON.stringify(details)},tx);
}
function payload(input,fields) {
  if(!input||Object.keys(input).some(key=>!fields.includes(key))||typeof input.reason!=='string'||input.reason.trim().length<10||input.reason.length>500)throw invalid('Paramètres ou motif invalides');
}
async function update(actor,kind,id,input) {
  const tables={provider:'payment_providers',account:'provider_accounts',capability:'provider_capabilities'};
  const table=tables[kind];
  const fields=kind==='capability'?['enabled','priority','min_amount','max_amount']:['enabled'];
  payload(input,[...fields,'reason']);
  const keys=fields.filter(key=>Object.hasOwn(input,key));
  if(!keys.length||keys.some(key=>key==='enabled'?typeof input[key]!=='boolean':!validInt(input[key],key==='priority'?0:1)))throw invalid('Paramètres invalides');
  if(kind!=='provider')uuid(id);
  const key=kind==='provider'?'code':'id';
  return db.transaction(async tx=>{
    const [before]=await query(`SELECT * FROM ${table} WHERE ${key}=:id FOR UPDATE`,{id},tx);
    if(!before)throw Object.assign(invalid('Configuration introuvable'),{status:404});
    if((input.min_amount??before.min_amount)>(input.max_amount??before.max_amount))throw invalid('Limites incohérentes');
    const [after]=await query(`UPDATE ${table} SET ${keys.map(k=>`${k}=:${k}`).join(',')} WHERE ${key}=:id RETURNING *`,{id,...input},tx);
    await audit(actor,'PROVIDER_CONFIG_UPDATED',after.id,{reason:input.reason,before,after},tx);
    return after;
  });
}
async function publish(actor,id,input) {
  uuid(id);
  payload(input,['rate_units','fixed_fee','min_fee','max_fee','rounding','effective_at','reason']);
  const {rate_units,fixed_fee,min_fee,max_fee=null,rounding,effective_at}=input;
  if(!validInt(rate_units,0,99999999)||!validInt(fixed_fee)||!validInt(min_fee)||
    (max_fee!==null&&!validInt(max_fee,min_fee))||!['exact','ceil_fee','floor_fee','round_fee'].includes(rounding))throw invalid('Tarif invalide');
  const effective=new Date(effective_at);
  if(typeof effective_at!=='string'||!Number.isFinite(effective.getTime())||!/(Z|[+-]\d\d:\d\d)$/.test(effective_at))throw invalid('Date avec fuseau requise');
  return db.transaction(async tx=>{
    const [cap]=await query('SELECT id FROM provider_capabilities WHERE id=:id FOR UPDATE',{id},tx);
    if(!cap)throw Object.assign(invalid('Capacité introuvable'),{status:404});
    const [allowed]=await query('SELECT CAST(:effective AS timestamptz)>=clock_timestamp() AS future',{effective:effective.toISOString()},tx);
    if(!allowed.future)throw invalid('La date d’effet doit être future');
    const [conflict]=await query('SELECT id FROM provider_tariff_versions WHERE capability_id=:id AND effective_at=:effective',{id,effective:effective.toISOString()},tx);
    if(conflict)throw Object.assign(invalid('Une version existe déjà à cette date'),{status:409});
    const [version]=await query(`INSERT INTO provider_tariff_versions
      (id,capability_id,effective_at,source,rate_units,fixed_fee,min_fee,max_fee,rounding,published_by)
      VALUES (:version,:id,:effective,'configured',:rate_units,:fixed_fee,:min_fee,:max_fee,:rounding,:actor)
      RETURNING id,capability_id,effective_at,source,rate_units,fixed_fee,min_fee,max_fee,rounding`,
      {version:randomUUID(),id,effective:effective.toISOString(),rate_units,fixed_fee,min_fee,max_fee,rounding,actor:actor.id},tx);
    await audit(actor,'PROVIDER_TARIFF_PUBLISHED',id,{reason:input.reason,version},tx);
    return version;
  });
}

module.exports={...createManager(),createManager,active,price,list,update,publish};
