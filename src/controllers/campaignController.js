const {Event, Candidate, CampaignCategory}=require('../models');
const sequelize=require('../config/database');
const {Op}=require('sequelize');
const validate=require('../services/campaignSettings');
function fail(message,status=400){return Object.assign(new Error(message),{status});}
async function owned(id,user,transaction){
 const row=await Event.findOne({where:{id,organizer_id:user.id},transaction,...(transaction?{lock:transaction.LOCK.UPDATE}:{})});
 if(!row)throw fail('Campagne introuvable',404);return row;
}
function error(res,err){ return res.status(err.status||500).json({error:err.status?err.message:'Configuration de campagne indisponible'}); }
exports.getSite=async(req,res)=>{try{
 const event=await owned(req.params.id,req.user);
 const categories=await CampaignCategory.findAll({where:{event_id:event.id},order:[['position','ASC']]});
 res.json({site_config:event.site_config,categories,partners:event.partners||[],archived_at:event.archived_at,site_version:event.site_version});
}catch(err){error(res,err);}};
exports.saveSite=async(req,res)=>{try{
 const config=validate.settings(req.body.site_config);
 const groups=validate.categories(req.body.categories??[]);
 const partners=validate.partners(req.body.partners??[]);
 await sequelize.transaction(async transaction=>{
  const event=await owned(req.params.id,req.user,transaction);
  if (!Number.isInteger(req.body.expected_version) || req.body.expected_version !== event.site_version) throw fail('La campagne a été modifiée ailleurs. Rechargez la page avant d’enregistrer.',409);
  if(event.archived_at)throw fail('Une campagne archivée ne peut plus être modifiée',409);
  const old=await CampaignCategory.findAll({where:{event_id:event.id},transaction});
  for(const group of groups){
   const foreign=await CampaignCategory.findByPk(group.id,{transaction});
   if(foreign&&foreign.event_id!==event.id)throw fail('Catégorie d’une autre campagne',400);
  }
  const removed=old.filter(row=>!groups.some(group=>group.id===row.id)).map(row=>row.id);
  if(removed.length&&await Candidate.count({where:{event_id:event.id,category_id:{[Op.in]:removed}},transaction}))throw fail('Réaffectez les candidats avant de supprimer leur catégorie',409);
  if(removed.length){const [applications]=await sequelize.query('SELECT 1 FROM campaign_applications WHERE event_id=:event AND category_id IN (:ids) LIMIT 1',{replacements:{event:event.id,ids:removed},transaction});if(applications.length)throw fail('Cette catégorie contient des candidatures. Conservez-la pour préserver leurs dossiers.',409);}
  if(removed.length)await CampaignCategory.destroy({where:{id:{[Op.in]:removed},event_id:event.id},transaction});
  for(const group of groups)await CampaignCategory.upsert({...group,event_id:event.id},{transaction});
  await event.update({site_config:config,partners,site_version:event.site_version+1},{transaction});
 });
 return exports.getSite(req,res);
}catch(err){error(res,err);}};
exports.archive=async(req,res)=>{try{
 await sequelize.transaction(async transaction=>{
 const event=await owned(req.params.id,req.user,transaction);
 if(!event.archived_at)await event.update({status:'closed',archived_at:new Date()},{transaction});
 });res.json({message:'Campagne archivée. Son historique est conservé.'});
}catch(err){error(res,err);}};
