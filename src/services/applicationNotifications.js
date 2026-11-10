// Un lien prérempli n'est jamais comptabilisé comme un message envoyé.
const axios=require('axios'),db=require('../config/database');
const {QueryTypes}=require('sequelize');
const q=(sql,replacements={})=>db.query(sql,{replacements,type:QueryTypes.SELECT});
function configured(){return Boolean(process.env.WHATSAPP_ACCESS_TOKEN&&process.env.WHATSAPP_PHONE_NUMBER_ID&&/^v\d+\.\d+$/.test(process.env.WHATSAPP_GRAPH_VERSION||'')&&process.env.WHATSAPP_APPLICATION_TEMPLATE&&process.env.WHATSAPP_TEMPLATE_LANGUAGE);}
async function dispatch(id){
 if(!configured())return;
 const[n]=await q("UPDATE campaign_application_notifications SET state='sending',updated_at=now() WHERE id=:id AND state='manual' RETURNING *",{id});if(!n)return;
 try{
 const r=await axios.post(`https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION}/${encodeURIComponent(process.env.WHATSAPP_PHONE_NUMBER_ID)}/messages`,{messaging_product:'whatsapp',to:n.phone,type:'template',template:{name:process.env.WHATSAPP_APPLICATION_TEMPLATE,language:{code:process.env.WHATSAPP_TEMPLATE_LANGUAGE},components:[{type:'body',parameters:n.parameters.map(text=>({type:'text',text}))}]}},{headers:{Authorization:`Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`},timeout:15000,maxRedirects:0,maxContentLength:1024*1024});
 const providerId=r.data?.messages?.[0]?.id;if(!providerId)throw Error('Missing provider reference');
 await q("UPDATE campaign_application_notifications SET state='accepted',provider_id=:providerId,updated_at=now() WHERE id=:id",{id,providerId});
 }catch(e){const status=e.response?.status;await q("UPDATE campaign_application_notifications SET state=:state,http_status=:http,updated_at=now() WHERE id=:id",{id,state:status&&status>=400&&status<500?'failed':'unknown',http:status||null});}
}
module.exports={dispatch,configured};
