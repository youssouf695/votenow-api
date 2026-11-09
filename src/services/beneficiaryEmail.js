const axios=require('axios');
const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
module.exports=async function sendBeneficiaryEmail(user,beneficiary,code){
 if(!process.env.BREVO_API_KEY||!process.env.BREVO_SENDER)throw Object.assign(new Error('Envoi email indisponible'),{status:503});
 try{
  await axios.post('https://api.brevo.com/v3/smtp/email',{
   sender:{name:'VoteNow',email:process.env.BREVO_SENDER},to:[{email:user.email,name:user.full_name}],
   subject:'Confirmez votre numéro de retrait VoteNow',
   htmlContent:`<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:32px;color:#17243b"><h1 style="font-size:24px">Confirmer un bénéficiaire de retrait</h1><p>Bonjour ${escape(user.full_name)},</p><p>Vous avez demandé l’enregistrement de ce bénéficiaire :</p><p><strong>${escape(beneficiary.full_name)}</strong><br>${escape(beneficiary.phone)}<br>${beneficiary.method==='orange_money'?'Orange Money':'MTN Mobile Money'}</p><p>Votre code : <strong style="font-size:28px;letter-spacing:5px">${code}</strong></p><p>Ce code expire dans 15 minutes. Saisissez-le uniquement sur VoteNow. Ne le communiquez à personne.</p><p>Si vous n’êtes pas à l’origine de cette demande, ne la confirmez pas et sécurisez votre compte.</p></div>`,
  },{timeout:15000,maxRedirects:0,headers:{'api-key':process.env.BREVO_API_KEY,'Content-Type':'application/json'}});
 }catch{throw Object.assign(new Error('Le code n’a pas pu être envoyé. Réessayez le renvoi après le délai indiqué.'),{status:503});}
};
