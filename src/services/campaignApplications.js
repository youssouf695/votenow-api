const crypto=require('node:crypto'),{QueryTypes,Op}=require('sequelize');
const db=require('../config/database'),{Event,CampaignCategory,Candidate}=require('../models');
const form=require('./registrationForm'),images=require('./applicationImages'),notifications=require('./applicationNotifications');
const {fail}=form;
const q=(sql,replacements={},transaction)=>db.query(sql,{replacements,type:QueryTypes.SELECT,transaction});
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
async function publicEvent(slug,transaction,lock=false){const e=await Event.findOne({where:{slug,status:{[Op.in]:['active','closed']},archived_at:null},transaction,...(lock?{lock:transaction.LOCK.UPDATE}:{})});if(!e||e.candidate_mode!=='registration')throw fail('Inscriptions introuvables',404);return e;}
async function owned(user,id,transaction){if(!uuid(id))throw fail('Campagne invalide');const e=await Event.findOne({where:{id,organizer_id:user.id},transaction,...(transaction?{lock:transaction.LOCK.UPDATE}:{})});if(!e)throw fail('Campagne introuvable',404);return e;}
async function publicForm(slug){const e=await publicEvent(slug),groups=await CampaignCategory.findAll({where:{event_id:e.id},order:[['position','ASC']]});const c=form.config(e.registration_config,true);return {event_id:e.id,title:e.title,open:form.isOpen(e),registration_version:e.registration_version,form:{intro:c.intro,deadline:c.deadline,fields:c.fields},categories:groups.map(g=>({id:g.id,name:g.name}))};}
async function ticket(slug){const e=await publicEvent(slug);if(!form.isOpen(e))throw fail('Les inscriptions sont fermées.',409);const id=crypto.randomUUID(),token=crypto.randomBytes(32).toString('hex');await q("INSERT INTO campaign_application_uploads(id,event_id,token_hash,expires_at) VALUES(:id,:event,:hash,now()+interval '1 hour')",{id,event:e.id,hash:hash(token)});return {upload_id:id,upload_token:token};}
async function upload(slug,id,token,buffer,mime){if(!uuid(id)||typeof token!=='string'||token.length!==64)throw fail('Autorisation de photo invalide');const e=await publicEvent(slug);if(!form.isOpen(e))throw fail('Les inscriptions sont fermées.',409);
 // Verrou conservé pendant l'envoi : deux requêtes ne peuvent pas consommer le même ticket.
 return db.transaction(async transaction=>{const[t]=await q('SELECT * FROM campaign_application_uploads WHERE id=:id AND event_id=:event AND token_hash=:hash AND expires_at>now() AND used_at IS NULL FOR UPDATE',{id,event:e.id,hash:hash(token)},transaction);if(!t)throw fail('Autorisation de photo expirée.',409);if(t.image_url)return {image_url:t.image_url};const url=await images.upload(buffer,mime,e.id);await q('UPDATE campaign_application_uploads SET image_url=:url WHERE id=:id',{id,url},transaction);return {image_url:url};});}
async function submit(slug,input){
 if(!uuid(input.request_key)||!uuid(input.upload_id)||typeof input.upload_token!=='string'||input.upload_token.length!==64)throw fail('Identifiant de candidature invalide');
 if(input.website)throw fail('Soumission invalide');
 const fingerprint=hash(JSON.stringify([input.full_name,input.whatsapp,input.upload_id,input.category_id||null,input.slogan||'',input.bio||'',input.answers,input.registration_version,input.consent]));
 return db.transaction(async transaction=>{
 const e=await publicEvent(slug,transaction,true);
 const[old]=await q('SELECT * FROM campaign_applications WHERE event_id=:event AND request_key=:key',{event:e.id,key:input.request_key},transaction);
 const response=a=>({application_id:a.id,status:a.status,whatsapp_url:form.link(e.registration_config.organizer_whatsapp,form.invitation(e,a)),message:'Candidature enregistrée. Confirmez-la sur WhatsApp.'});
 if(old){if(old.fingerprint!==fingerprint)throw fail('Cette référence correspond à une autre candidature.',409);return response(old);}
 if(!form.isOpen(e))throw fail('Les inscriptions sont fermées.',409);
 if(input.registration_version!==e.registration_version)throw fail('Le formulaire a changé. Rechargez la page.',409);
 const c=form.config(e.registration_config,true),full_name=form.text(input.full_name,150,'Nom complet',true),whatsapp=form.phone(input.whatsapp),slogan=form.text(input.slogan,200,'Slogan'),bio=form.text(input.bio,5000,'Présentation'),answers=form.answers(input.answers,c.fields);
 if(full_name.length<2)throw fail('Nom complet : au moins deux caractères.');if(input.consent!==true)throw fail('Votre accord est requis pour traiter votre candidature et vous contacter sur WhatsApp.');
 const groups=await CampaignCategory.findAll({where:{event_id:e.id},transaction});const category_id=input.category_id||null;if(groups.length&&!groups.some(g=>g.id===category_id)||!groups.length&&category_id)throw fail('Choisissez une catégorie valide.');
 const[t]=await q('SELECT * FROM campaign_application_uploads WHERE id=:id AND event_id=:event AND token_hash=:hash AND expires_at>now() AND used_at IS NULL FOR UPDATE',{id:input.upload_id,event:e.id,hash:hash(input.upload_token)},transaction);if(!t?.image_url)throw fail('Ajoutez votre photo avant de soumettre.');
 const id=crypto.randomUUID();const[a]=await q(`INSERT INTO campaign_applications(id,event_id,request_key,fingerprint,full_name,whatsapp,photo_url,slogan,bio,category_id,answers,form_snapshot,consented_at) VALUES(:id,:event,:key,:fingerprint,:full_name,:whatsapp,:photo,:slogan,:bio,:category,CAST(:answers AS jsonb),CAST(:snapshot AS jsonb),now()) RETURNING *`,{id,event:e.id,key:input.request_key,fingerprint,full_name,whatsapp,photo:t.image_url,slogan,bio,category:category_id,answers:JSON.stringify(answers),snapshot:JSON.stringify({fields:c.fields,version:e.registration_version})},transaction);
 await q('UPDATE campaign_application_uploads SET used_at=now() WHERE id=:id',{id:t.id},transaction);return response(a);
 });
}
async function list(user,eventId,params={}){
 const e=await owned(user,eventId),page=Math.max(1,Math.min(100000,Number.parseInt(params.page)||1)),limit=25;
 if(params.status&&!['pending','approved','rejected','changes_requested'].includes(params.status))throw fail('Filtre invalide');
 const search=form.text(params.search||'',150,'Recherche'),replacements={event:e.id,status:params.status||null,search:`%${search.replace(/[\\%_]/g,'\\$&')}%`,limit,offset:(page-1)*limit};
 const where="event_id=:event AND (:status IS NULL OR status=:status) AND (full_name ILIKE :search OR whatsapp ILIKE :search)";
 const rows=await q(`SELECT * FROM campaign_applications WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT :limit OFFSET :offset`,replacements),[count]=await q(`SELECT count(*)::integer AS total FROM campaign_applications WHERE ${where}`,replacements);
 const categories=await CampaignCategory.findAll({where:{event_id:e.id},attributes:['id','name']});
 return {event:{categories,id:e.id,title:e.title,candidate_mode:e.candidate_mode,registration_config:e.registration_config,registration_version:e.registration_version},applications:rows,total:count.total,page,totalPages:Math.ceil(count.total/limit)};
}
async function detail(user,eventId,id){await owned(user,eventId);if(!uuid(id))throw fail('Candidature invalide');const[a]=await q('SELECT * FROM campaign_applications WHERE id=:id AND event_id=:event',{id,event:eventId});if(!a)throw fail('Candidature introuvable',404);const decisions=await q('SELECT * FROM campaign_application_decisions WHERE application_id=:id ORDER BY created_at DESC',{id});const ns=await q('SELECT n.* FROM campaign_application_notifications n JOIN campaign_application_decisions d ON d.id=n.decision_id WHERE d.application_id=:id ORDER BY n.created_at DESC',{id});return {...a,decisions,notifications:ns.map(n=>({...n,whatsapp_url:form.link(n.phone,notificationText(n.parameters))}))};}
function notificationText(p){return `Bonjour ${p[0]}, votre candidature à ${p[1]} est ${p[2]}. ${p[3]}`;}
async function review(user,eventId,id,input){
 if(!uuid(id)||!['approved','rejected','changes_requested'].includes(input.status))throw fail('Décision invalide');
 const reason=form.text(input.reason,1000,'Motif',input.status!=='approved');
 const notificationId=await db.transaction(async transaction=>{
 const e=await owned(user,eventId,transaction);if(e.archived_at)throw fail('Campagne archivée',409);
 const[a]=await q('SELECT * FROM campaign_applications WHERE id=:id AND event_id=:event FOR UPDATE',{id,event:eventId},transaction);if(!a)throw fail('Candidature introuvable',404);
 if(a.revision!==input.expected_revision)throw fail('La candidature a été modifiée. Rechargez sa fiche.',409);
 if(a.status==='approved')throw fail('Candidature déjà approuvée. Gérez le candidat depuis sa fiche.',409);
 if(a.status===input.status&&a.reason===reason)throw fail('Cette décision est déjà enregistrée.',409);
 let candidateId=a.candidate_id;
 if(input.status==='approved'){
  if(a.category_id&&!await CampaignCategory.findOne({where:{id:a.category_id,event_id:eventId},transaction}))throw fail('La catégorie n’existe plus.',409);
  const count=await Candidate.count({where:{event_id:eventId},transaction});if(e.max_candidates&&count>=e.max_candidates)throw fail('Limite de candidats atteinte.',409);
  const all=await Candidate.findAll({where:{event_id:eventId},attributes:['number','position'],transaction});const numbers=new Set(all.map(c=>c.number));let number=1;while(numbers.has(number)&&number<=999)number++;if(number>999)throw fail('Plus de numéro candidat disponible.',409);
  const row=await Candidate.create({event_id:eventId,name:a.full_name,number,photo_url:a.photo_url,slogan:a.slogan||null,bio:a.bio||null,category_id:a.category_id,is_active:true,position:Math.max(-1,...all.map(c=>c.position||0))+1},{transaction});candidateId=row.id;
 }
 await q('UPDATE campaign_applications SET status=:status,reason=:reason,candidate_id=:candidate,revision=revision+1,updated_at=now() WHERE id=:id',{id,status:input.status,reason,candidate:candidateId},transaction);
 const decision=crypto.randomUUID(),nid=crypto.randomUUID(),statusLabel={approved:'approuvée',rejected:'rejetée',changes_requested:'à compléter'}[input.status];
 await q('INSERT INTO campaign_application_decisions(id,application_id,actor_id,previous_status,status,reason) VALUES(:decision,:id,:actor,:old,:status,:reason)',{decision,id,actor:user.id,old:a.status,status:input.status,reason},transaction);
 await q('INSERT INTO campaign_application_notifications(id,decision_id,phone,parameters) VALUES(:nid,:decision,:phone,CAST(:params AS jsonb))',{nid,decision,phone:a.whatsapp,params:JSON.stringify([a.full_name,e.title,statusLabel,reason||'Bienvenue dans la compétition !'])},transaction);
 return nid;
 });
 await notifications.dispatch(notificationId);return detail(user,eventId,id);
}
async function configure(user,eventId,input){return db.transaction(async transaction=>{const e=await owned(user,eventId,transaction);if(e.status==='draft')throw fail('Utilisez le parcours de création pour cette campagne.',409);if(e.candidate_mode!=='registration')throw fail('Cette campagne n’utilise pas les inscriptions.',409);if(e.registration_version!==input.expected_version)throw fail('Le formulaire a été modifié. Rechargez la page.',409);const c=form.config(input.registration_config,true);await e.update({registration_config:c,registration_version:e.registration_version+1},{transaction});return {registration_config:c,registration_version:e.registration_version};});}
module.exports={publicForm,ticket,upload,submit,list,detail,review,configure,notificationText};
