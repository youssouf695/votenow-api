const client=require('./kpayClient');
const {integer}=require('./kpayAmounts');
function netFromGross(value,rate,rounding='exact'){
 const gross=integer(value);
 if(typeof rate!=='number'||!Number.isFinite(rate)||rate<0||rate>=1)throw new Error('Tarif de retrait KPay invalide');
 if(!['exact','ceil_fee','floor_fee','round_fee'].includes(rounding))throw new Error('Arrondi KPay invalide');
 const scale=100000000,units=Math.round(rate*scale);
 if(Math.abs(units/scale-rate)>1e-10)throw new Error('Précision tarifaire non prise en charge');
 const raw=BigInt(gross)*BigInt(units),denominator=BigInt(scale);let fee;
 if(rounding==='exact'){if(raw%denominator!==0n)throw Object.assign(new Error('Ce montant nécessite un arrondi non confirmé. Choisissez un montant rond ou contactez le support.'),{status:422});fee=Number(raw/denominator);}
 else if(rounding==='ceil_fee')fee=Number((raw+denominator-1n)/denominator);
 else if(rounding==='floor_fee')fee=Number(raw/denominator);
 else fee=Number((raw+denominator/2n)/denominator);
 const net=gross-fee;if(net<1)throw Object.assign(new Error('Le montant reçu doit être positif'),{status:422});
 return {gross,fee,net,rate,rounding,policy:'recipient_pays_v2'};
}
async function recipientQuote(withdrawal){
 const operator={mtn_momo:'MTN',orange_money:'Orange'}[withdrawal.method];
 if(!operator)throw Object.assign(new Error('Opérateur de retrait non pris en charge'),{status:422});
 const catalogue=await client.pricelist();
 const country=catalogue.countries?.find(row=>row.code==='CMR'&&row.currency==='XAF');
 const tariff=country?.operators?.find(row=>row.operator===operator);
 return {...netFromGross(withdrawal.amount_fcfa,tariff?.withdrawalRate,process.env.KPAY_PAYOUT_ROUNDING||'exact'),operator,environment:require('../config/kpay').getConfig().mode,retrieved_at:new Date().toISOString()};
}
module.exports={netFromGross,recipientQuote};
