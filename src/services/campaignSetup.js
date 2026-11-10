const crypto=require('node:crypto'),db=require('../config/database'),{QueryTypes,Op}=require('sequelize');
const {Event,Candidate,CampaignCategory,Payment}=require('../models'),validate=require('./campaignSettings');
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const query=(sql,replacements={},transaction)=>db.query(sql,{replacements,type:QueryTypes.SELECT,transaction});
function str(value,max,label){if(value==null)return '';if(typeof value!=='string'||value.length>max)throw fail(`${label} invalide`);return value}
function rows(value,max,label){if(!Array.isArray(value)||value.length>max)throw fail(`${label} : maximum ${max}`);return value}
function object(v){return v&&typeof v==='object'&&!Array.isArray(v)}
function normalize(input){
 if(!object(input)||!object(input.basics)||!object(input.content))throw fail('Informations du parcours invalides');
 const b=input.basics;
 const registration=require('./registrationForm');
 const mode=b.candidate_mode||'manual';if(!['manual','registration'].includes(mode))throw fail('Type de campagne invalide');
 for(const key of ['allow_anonymous','show_results'])if(b[key]!==undefined&&typeof b[key]!=='boolean')throw fail('Option de campagne invalide');
 const price=b.vote_price_fcfa==null||b.vote_price_fcfa===''?null:Number(b.vote_price_fcfa);
 if(price!==null&&(!Number.isSafeInteger(price)||price<0||price>10000))throw fail('Prix du vote invalide');
 const basics={candidate_mode:mode,registration_config:registration.config(b.registration_config||{}),title:str(b.title,200,'Titre'),description:str(b.description,10000,'Description'),vote_price_fcfa:price,cover_image_url:str(b.cover_image_url,2048,'Couverture'),avatar_url:str(b.avatar_url,2048,'Image de profil'),starts_at:str(b.starts_at,50,'Début'),ends_at:str(b.ends_at,50,'Fin'),allow_anonymous:b.allow_anonymous!==false,show_results:b.show_results!==false};
 const categories=rows(input.categories,100,'Catégories').map((g,i)=>{if(!object(g)||!uuid(g.id))throw fail('Identifiant de catégorie invalide');return {id:g.id,name:str(g.name,100,'Catégorie'),cover_image_url:str(g.cover_image_url,2048,'Couverture catégorie'),avatar_url:str(g.avatar_url,2048,'Profil catégorie'),position:i}});
 if(new Set(categories.map(g=>g.id)).size!==categories.length)throw fail('Catégories dupliquées');
 const candidates=rows(input.candidates,500,'Candidats').map((c,i)=>{
  if(!object(c)||!uuid(c.id)||(c.category_id&&!uuid(c.category_id)))throw fail('Identifiant de candidat ou catégorie invalide');
  if(c.is_active!==undefined&&typeof c.is_active!=='boolean')throw fail('État de candidat invalide');
  const number=c.number===''||c.number==null?null:Number(c.number);
  if(number!==null&&(!Number.isInteger(number)||number<1||number>999))throw fail('Numéro candidat invalide (1 à 999)');
  return {id:c.id,name:str(c.name,150,'Nom candidat'),slogan:str(c.slogan,200,'Slogan'),bio:str(c.bio,10000,'Biographie'),photo_url:str(c.photo_url,2048,'Photo candidat'),number,category_id:c.category_id||null,is_active:c.is_active!==false,position:i};
 });
 if(new Set(candidates.map(c=>c.id)).size!==candidates.length)throw fail('Candidats dupliqués');
 const content={header_text:str(input.content.header_text,240,'Message d’accueil'),footer_text:str(input.content.footer_text,500,'Pied de page'),partners:rows(input.content.partners,100,'Partenaires').map(p=>{if(!object(p))throw fail('Partenaire invalide');return {name:str(p.name,150,'Nom partenaire'),logo_url:str(p.logo_url,2048,'Logo'),website:str(p.website,2048,'Site partenaire'),contact:str(p.contact,200,'Contact partenaire')}})};
 const data={basics,categories,candidates,content,presentation:input.presentation?validate.settings(input.presentation):null};
 if(Buffer.byteLength(JSON.stringify(data))>90000)throw fail('La configuration dépasse la taille autorisée (90 Ko)');return data;
}
function validateThrough(data,step,maxCandidates=null,now=Date.now()){
 const b=data.basics;
 if(!b.title.trim()||b.title.trim().length<3)throw fail('Étape 1 : renseignez un nom de campagne (3 caractères minimum).');
 if(!Number.isInteger(b.vote_price_fcfa)||b.vote_price_fcfa<100||b.vote_price_fcfa>10000)throw fail('Étape 1 : le prix d’un vote doit être compris entre 100 et 10 000 FCFA.');
 for(const k of ['cover_image_url','avatar_url'])validate.safeUrl(b[k],'Étape 1 : image');
 for(const key of ['starts_at','ends_at'])if(b[key]&&(!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(b[key])||!Number.isFinite(Date.parse(b[key]))))throw fail('Étape 1 : date invalide.');
 if(b.starts_at&&b.ends_at&&Date.parse(b.ends_at)<=Date.parse(b.starts_at))throw fail('Étape 1 : la fin doit être après le début.');
 if(b.ends_at&&Date.parse(b.ends_at)<=now)throw fail('Étape 1 : la date de fin est déjà passée.');
 if(step>=2)validate.categories(data.categories);
 if(step>=3){
  if(maxCandidates&&data.candidates.length>maxCandidates)throw fail(`Étape 3 : maximum ${maxCandidates} candidats pour cette campagne.`);
  if(b.candidate_mode==='registration')require('./registrationForm').config(b.registration_config,true);
  const numbers=new Set();
  for(const c of data.candidates){
   if(c.name.trim().length<2)throw fail('Étape 3 : chaque candidat doit avoir un nom de 2 caractères minimum.');
   if(c.number!==null){if(numbers.has(c.number))throw fail('Étape 3 : chaque numéro de candidat doit être unique.');numbers.add(c.number)}
   validate.safeUrl(c.photo_url,'Étape 3 : photo du candidat');
   if(data.categories.length&&!data.categories.some(g=>g.id===c.category_id))throw fail(`Étape 3 : choisissez une catégorie pour ${c.name}.`);
   if(!data.categories.length&&c.category_id)throw fail('Étape 3 : catégorie de candidat absente.');
  }
  const active=data.candidates.filter(c=>c.is_active);
  if(b.candidate_mode!=='registration'&&!data.categories.length&&active.length<2)throw fail('Étape 3 : ajoutez au moins deux candidats actifs.');
  for(const g of data.categories)if(b.candidate_mode!=='registration'&&active.filter(c=>c.category_id===g.id).length<2)throw fail(`Étape 3 : ajoutez au moins deux candidats actifs dans « ${g.name} ».`);
 }
 if(step>=4)validate.partners(data.content.partners);
 return data;
}
async function source(id,user,transaction){
 const event=await Event.findOne({where:{id,organizer_id:user.id},transaction,...(transaction?{lock:transaction.LOCK.UPDATE}:{})});
 if(!event)throw fail('Campagne introuvable',404);
 if(event.status!=='draft'||event.archived_at)throw fail('Cette campagne n’est pas en cours de création. Ouvrez sa fiche de gestion.',409);
 const categories=await CampaignCategory.findAll({where:{event_id:id},order:[['id','ASC']],transaction});
 const candidates=await Candidate.findAll({where:{event_id:id},order:[['id','ASC']],transaction});
 const hash=crypto.createHash('sha256').update(JSON.stringify([event.toJSON(),categories.map(r=>r.toJSON()),candidates.map(r=>r.toJSON())])).digest('hex');
 return {event,categories,candidates,hash};
}
function initial(s){const e=s.event.toJSON();return normalize({basics:{...e,starts_at:e.starts_at?.toISOString?.()||e.starts_at||'',ends_at:e.ends_at?.toISOString?.()||e.ends_at||''},categories:s.categories.map(g=>g.toJSON()),candidates:s.candidates.map(c=>c.toJSON()),presentation:e.site_config,content:{header_text:e.site_config?.header_text||'',footer_text:e.site_config?.footer_text||'',partners:e.partners||[]}})}
const selectSetup=(id,transaction,lock=false)=>query(`SELECT * FROM campaign_setups WHERE event_id=:id${lock?' FOR UPDATE':''}`,{id},transaction).then(r=>r[0]);
async function snapshot(s,row){return {event:{id:s.event.id,title:s.event.title,slug:s.event.slug,status:s.event.status,site_config:s.event.site_config,site_version:s.event.site_version,max_candidates:s.event.max_candidates},setup:{step:row.step,completed:row.completed,revision:row.revision,saved_at:row.updated_at,source_changed:row.source_hash!==s.hash},data:row.data}}
async function get(user,id){if(!uuid(id))throw fail('Campagne invalide');return db.transaction(async transaction=>{
 const s=await source(id,user,transaction);let row=await selectSetup(id,transaction,true);
 if(row?.published_at)throw fail('Cette campagne a déjà été publiée. Utilisez sa fiche de gestion.',409);
 if(!row){await query('INSERT INTO campaign_setups(event_id,request_key,data,source_hash) VALUES(:id,:key,CAST(:data AS jsonb),:hash)',{id,key:crypto.randomUUID(),data:JSON.stringify(initial(s)),hash:s.hash},transaction);row=await selectSetup(id,transaction)}
 return snapshot(s,row);
})}
async function create(user,input){
 if(!uuid(input.request_key))throw fail('Identifiant de création invalide');
 const data=normalize(input.data);validateThrough(data,1);
 const target=input.target_step;if(![1,2].includes(target))throw fail('Étape initiale invalide');
 const existing=await query('SELECT event_id FROM campaign_setups WHERE request_key=:key',{key:input.request_key});if(existing[0])return get(user,existing[0].event_id);
 let id;
 try{await db.transaction(async transaction=>{
 const b=data.basics,slug=b.title.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,120)||'campagne';
 const event=await Event.create({...b,title:b.title.trim(),description:b.description||null,cover_image_url:b.cover_image_url||null,avatar_url:b.avatar_url||null,starts_at:b.starts_at||null,ends_at:b.ends_at||null,organizer_id:user.id,slug:`${slug}-${crypto.randomUUID().slice(0,8)}`,status:'draft',commission_rate:15,votes_per_payment:1,site_config:validate.settings({template_id:'editorial',show_categories:true})},{transaction});id=event.id;
 const s=await source(id,user,transaction);await query('INSERT INTO campaign_setups(event_id,request_key,step,completed,data,source_hash) VALUES(:id,:key,:step,:completed,CAST(:data AS jsonb),:hash)',{id,key:input.request_key,step:target,completed:target===2?1:0,data:JSON.stringify(data),hash:s.hash},transaction);
 })}catch(error){if(error.name!=='SequelizeUniqueConstraintError')throw error;const rows=await query('SELECT event_id FROM campaign_setups WHERE request_key=:key',{key:input.request_key});if(!rows[0])throw error;id=rows[0].event_id}
 return get(user,id);
}
function checkRevision(row,input){if(row?.published_at)throw fail('Cette campagne a déjà été publiée. Utilisez sa fiche de gestion.',409);if(!row||!Number.isInteger(input.expected_revision)||input.expected_revision!==row.revision)throw fail('Le parcours a été modifié dans un autre onglet. Rechargez avant de continuer.',409)}
async function save(user,id,input){
 if(!uuid(id))throw fail('Campagne invalide');const data=normalize(input.data);
 return db.transaction(async transaction=>{
  const s=await source(id,user,transaction),row=await selectSetup(id,transaction,true);checkRevision(row,input);
  if(row.source_hash!==s.hash)throw fail('La campagne a changé en dehors de l’assistant. Rechargez ses données avant de poursuivre.',409);
  const {step,target_step:target}=input;
  if(step!==row.step||!Number.isInteger(target)||target<1||target>5||target>step+1)throw fail('Transition d’étape invalide');
  let completed=Math.min(row.completed,step-1);
  if(target>step){validateThrough(data,step,s.event.max_candidates);completed=step}
  const [updated]=await query('UPDATE campaign_setups SET data=CAST(:data AS jsonb),step=:target,completed=:completed,revision=revision+1,updated_at=now() WHERE event_id=:id RETURNING *',{id,data:JSON.stringify(data),target,completed},transaction);
  return snapshot(s,updated);
 });
}
async function restart(user,id,input){if(!uuid(id)||input.confirm_discard!==true)throw fail('Confirmation de rechargement requise');return db.transaction(async transaction=>{const s=await source(id,user,transaction),row=await selectSetup(id,transaction,true);checkRevision(row,input);const [updated]=await query('UPDATE campaign_setups SET data=CAST(:data AS jsonb),source_hash=:hash,step=1,completed=0,revision=revision+1,updated_at=now() WHERE event_id=:id RETURNING *',{id,data:JSON.stringify(initial(s)),hash:s.hash},transaction);return snapshot(s,updated)})}
async function publish(user,id,input){if(!uuid(id))throw fail('Campagne invalide');return db.transaction(async transaction=>{
 const existing=await Event.findOne({where:{id,organizer_id:user.id},transaction,lock:transaction.LOCK.UPDATE});
 if(!existing)throw fail('Campagne introuvable',404);
 const already=await selectSetup(id,transaction,true);
 if(already?.published_at)return {event:existing.toJSON(),message:'Campagne déjà publiée.'};
 const s=await source(id,user,transaction),row=already;checkRevision(row,input);
 if(row.source_hash!==s.hash)throw fail('La campagne a changé en dehors de l’assistant. Rechargez ses données avant de publier.',409);
 if(row.step!==5||row.completed<4)throw fail('Terminez les quatre premières étapes avant de publier.',409);
 const data=normalize(row.data);validateThrough(data,4,s.event.max_candidates);
 for(const group of data.categories){const found=await CampaignCategory.findByPk(group.id,{transaction});if(found&&found.event_id!==id)throw fail('Identifiant de catégorie indisponible');}
 for(const c of data.candidates){const found=await Candidate.findByPk(c.id,{transaction});if(found&&found.event_id!==id)throw fail('Identifiant de candidat indisponible');}
 const removed=s.candidates.filter(c=>!data.candidates.some(next=>next.id===c.id));
 if(removed.length&&await Payment.count({where:{candidate_id:{[Op.in]:removed.map(c=>c.id)}},transaction}))throw fail('Un candidat ayant une tentative de paiement doit être conservé.',409);
 if(removed.some(c=>c.vote_count>0))throw fail('Un candidat ayant des votes doit être conservé.',409);
 for(const group of data.categories)await CampaignCategory.upsert({...group,name:group.name.trim(),event_id:id},{transaction});
 if(removed.length)await Candidate.destroy({where:{id:{[Op.in]:removed.map(c=>c.id)},event_id:id},transaction});
 for(const c of data.candidates){const updates={...c,name:c.name.trim(),photo_url:c.photo_url||null,slogan:c.slogan.trim()||null,bio:c.bio||null,event_id:id};if(s.candidates.some(old=>old.id===c.id))await Candidate.update(updates,{where:{id:c.id,event_id:id},transaction});else await Candidate.create(updates,{transaction});}
 const removedGroups=s.categories.filter(c=>!data.categories.some(next=>next.id===c.id));if(removedGroups.length)await CampaignCategory.destroy({where:{id:{[Op.in]:removedGroups.map(g=>g.id)},event_id:id},transaction});
 const b=data.basics,config=validate.settings({...s.event.site_config,...(data.presentation||{}),template_id:data.presentation?.template_id||s.event.site_config?.template_id||'editorial',header_text:data.content.header_text,footer_text:data.content.footer_text});
 await query('UPDATE campaign_setups SET step=5,completed=5,published_at=now(),revision=revision+1,updated_at=now() WHERE event_id=:id',{id},transaction);
 await s.event.update({...b,title:b.title.trim(),description:b.description||null,cover_image_url:b.cover_image_url||null,avatar_url:b.avatar_url||null,starts_at:b.starts_at||new Date(),ends_at:b.ends_at||null,site_config:config,partners:validate.partners(data.content.partners),status:'active',site_version:s.event.site_version+1},{transaction});
 return {event:s.event.toJSON(),message:'Campagne enregistrée et publiée.'};
})}
module.exports={normalize,validateThrough,get,create,save,publish,restart};
