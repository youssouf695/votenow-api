const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
function text(v,max,label,required=false){if(v==null)v='';if(typeof v!=='string'||v.length>max||(required&&!v.trim()))throw fail(`${label} invalide`);return v.trim()}
function phone(v){let n=String(v||'').replace(/[\s().-]/g,'').replace(/^\+/,'').replace(/^00/,'');if(/^6\d{8}$/.test(n))n='237'+n;if(!/^[1-9]\d{7,14}$/.test(n))throw fail('Numéro WhatsApp international requis (ex. +237 6XXXXXXXX).');return n;}
function config(input={},complete=false){
 if(!object(input))throw fail('Formulaire invalide');
 const result={enabled:input.enabled!==false,organizer_whatsapp:text(input.organizer_whatsapp,30,'WhatsApp organisateur'),intro:text(input.intro,2000,'Introduction'),deadline:text(input.deadline,50,'Date limite'),fields:[]};
 if(input.enabled!==undefined&&typeof input.enabled!=='boolean')throw fail('Ouverture des inscriptions invalide');
 if(result.organizer_whatsapp)result.organizer_whatsapp=phone(result.organizer_whatsapp);else if(complete)throw fail('Renseignez le WhatsApp de l’organisateur pour les inscriptions.');
 if(result.deadline&&(!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(result.deadline)||!Number.isFinite(Date.parse(result.deadline))))throw fail('Date limite d’inscription invalide');
 if(!Array.isArray(input.fields||[])||(input.fields||[]).length>20)throw fail('Maximum 20 champs personnalisés');
 const ids=new Set();
 result.fields=(input.fields||[]).map(f=>{
  if(!object(f)||!/^f_[a-zA-Z0-9_-]{1,50}$/.test(f.id)||ids.has(f.id))throw fail('Identifiant de champ invalide');ids.add(f.id);
  if(!['text','textarea','number','date','select','checkbox'].includes(f.type))throw fail('Type de champ invalide');
  if(typeof f.required!=='boolean')throw fail('Obligation du champ invalide');
  const options=f.type==='select'?(f.options||[]):[];
  if(!Array.isArray(options)||options.length>30||(complete&&f.type==='select'&&!options.length))throw fail('Choix du champ invalides');
  const values=options.filter(o=>complete||typeof o!=='string'||o.trim()).map(o=>text(o,100,'Choix',true));if(new Set(values).size!==values.length)throw fail('Choix dupliqués');
  return {id:f.id,label:text(f.label,150,'Libellé',complete),type:f.type,required:f.required,options:values};
 });return result;
}
function answers(value,fields){
 if(!object(value))throw fail('Réponses invalides');const out={};
 if(Object.keys(value).some(k=>!fields.some(f=>f.id===k)))throw fail('Le formulaire a changé. Rechargez la page.',409);
 for(const f of fields){const v=value[f.id];if(f.type==='checkbox'){if(v!==undefined&&typeof v!=='boolean')throw fail(`${f.label} invalide`);if(f.required&&v!==true)throw fail(`${f.label} requis`);out[f.id]=v===true;continue;}
 const s=text(v, f.type==='textarea'?2000:300,f.label,f.required);if(s){if(f.type==='select'&&!f.options.includes(s))throw fail(`${f.label} : choix invalide`);if(f.type==='number'&&(!/^-?\d+(\.\d+)?$/.test(s)||!Number.isFinite(Number(s))))throw fail(`${f.label} : nombre invalide`);if(f.type==='date'&&(!/^\d{4}-\d\d-\d\d$/.test(s)||!Number.isFinite(Date.parse(s))||new Date(s).toISOString().slice(0,10)!==s))throw fail(`${f.label} : date invalide`);}out[f.id]=s;
 }return out;
}
function isOpen(e,now=Date.now()){const c=e.registration_config||{};return e.candidate_mode==='registration'&&e.status==='active'&&!e.archived_at&&c.enabled!==false&&(!c.deadline||Date.parse(c.deadline)>now);}
function invitation(e,a){return `Bonjour, je suis ${a.full_name} et je confirme mon inscription au concours ${e.title}. Merci de prendre en considération ma candidature. Je reste disponible au numéro WhatsApp +${a.whatsapp}. Référence : ${a.id}.`;}
const link=(n,message)=>`https://wa.me/${phone(n)}?text=${encodeURIComponent(message)}`;
module.exports={fail,text,phone,config,answers,isOpen,invitation,link};
