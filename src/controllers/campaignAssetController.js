const {Event}=require('../models');
const images=require('../services/campaignImageUpload');
exports.imageType=images.imageType;
async function uploadImage(req,res,kind){try{
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(req.params.id))return res.status(400).json({error:'Campagne invalide'});
 const event=await Event.findOne({where:{id:req.params.id,organizer_id:req.user.id}});
 if(!event)return res.status(404).json({error:'Campagne introuvable'});
 if(event.archived_at)return res.status(409).json({error:'Cette campagne est archivée.'});
 const url=await images.upload(req.body,req.get('content-type'),event.id,kind);
 res.status(201).json(kind==='gallery'?{image_url:url}:{logo_url:url});
 }catch(e){res.status(e.status||503).json({error:e.status?e.message:'Envoi de l’image impossible.',code:e.code||'IMAGE_UPLOAD_FAILED',...(e.reference?{reference:e.reference}:{})});}}
exports.uploadPartnerLogo=(req,res)=>uploadImage(req,res,'partners');
exports.uploadGalleryImage=(req,res)=>uploadImage(req,res,'gallery');
