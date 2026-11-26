const axios=require('axios');
const {renderOtpEmail}=require('../templates/transactionalEmail');
function deliveryError(code, message, providerHttpStatus=null) {
 return Object.assign(new Error(message), {status:503, code, providerHttpStatus});
}
module.exports=async function sendBeneficiaryEmail(user,beneficiary,code,{kind='beneficiary',language='fr'}={}){
 if(!process.env.BREVO_API_KEY?.trim()||!process.env.BREVO_SENDER?.trim()){
  throw deliveryError('BENEFICIARY_EMAIL_NOT_CONFIGURED','L’envoi du code par email est indisponible. Contactez le support avec la référence affichée.');
 }
 try{
  await axios.post('https://api.brevo.com/v3/smtp/email',{
   sender:{name:'VoteNow',email:process.env.BREVO_SENDER},to:[{email:user.email,name:user.full_name}],
   ...renderOtpEmail({kind,language,name:user.full_name,code,beneficiary}),
  },{timeout:15000,maxRedirects:0,headers:{'api-key':process.env.BREVO_API_KEY,'Content-Type':'application/json'}});
 }catch(error){
  const status=error.response?.status ?? null;
  const message=String(error.response?.data?.message ?? '');
  const support='Le service email refuse l’envoi du code. Contactez le support avec la référence affichée.';
  if(/\bip\s+addres{1,2}|unauthori[sz]ed ip/i.test(message)&&(status===401||status===403)){
   throw deliveryError('BENEFICIARY_EMAIL_IP_DENIED',support,status);
  }
  if(/\bsender\b/i.test(message)&&(status===400||status===403)){
   throw deliveryError('BENEFICIARY_EMAIL_SENDER_REJECTED',support,status);
  }
  if(status===401||status===403){
   throw deliveryError('BENEFICIARY_EMAIL_ACCESS_DENIED',support,status);
  }
  const reason=status==null?'BENEFICIARY_EMAIL_NETWORK_FAILURE':'BENEFICIARY_EMAIL_PROVIDER_FAILURE';
  throw deliveryError(reason,'L’envoi du code n’a pas été confirmé. Vérifiez votre boîte email ou utilisez le renvoi après le délai indiqué.',status);
 }
};
