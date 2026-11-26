const axios=require('axios');
const {renderOtpEmail}=require('../templates/transactionalEmail');
exports.sendVerificationEmail=async(to,code,fullName,{kind='verification',language='fr'}={})=>{
 if(!process.env.BREVO_API_KEY||!process.env.BREVO_SENDER)throw Object.assign(new Error('Envoi email non configuré'),{status:503});
 try {
  const response=await axios.post('https://api.brevo.com/v3/smtp/email',{
   sender:{name:'VoteNow',email:process.env.BREVO_SENDER},
   to:[{email:to,name:fullName}],
   ...renderOtpEmail({kind,language,name:fullName,code}),
  },{timeout:15000,maxRedirects:0,headers:{'api-key':process.env.BREVO_API_KEY,'Content-Type':'application/json'}});
  return response.data;
 } catch(error) {
  console.error('[email.delivery]',{status:error.response?.status||null});
  throw Object.assign(new Error('Le code n’a pas pu être envoyé. Réessayez plus tard.'),{status:503});
 }
};
