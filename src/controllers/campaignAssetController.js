const crypto=require('node:crypto');
const axios=require('axios');
const {Event}=require('../models');
function imageType(buffer){
 if(!Buffer.isBuffer(buffer))return null;
 if(buffer.length>=8&&buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
 if(buffer.length>=3&&buffer[0]===255&&buffer[1]===216&&buffer[2]===255)return 'image/jpeg';
 if(buffer.length>=12&&buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP')return 'image/webp';
 return null;
}
exports.imageType=imageType;
async function uploadImage(req,res,kind){
 try{
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(req.params.id))return res.status(400).json({error:'Campagne invalide'});
  const event=await Event.findOne({where:{id:req.params.id,organizer_id:req.user.id}});
  if(!event)return res.status(404).json({error:'Campagne introuvable'});
  if(event.archived_at)return res.status(409).json({error:'Cette campagne est archivée.'});
  const mime=imageType(req.body);
  if(!mime||!['image/png','image/jpeg','image/webp'].includes(req.get('content-type')?.split(';')[0]))return res.status(415).json({error:'Choisissez une image JPEG, PNG ou WebP.'});
  if(req.body.length>5*1024*1024)return res.status(413).json({error:'Image trop volumineuse (5 Mo maximum).'});
  const cloud=process.env.CLOUDINARY_CLOUD_NAME,key=process.env.CLOUDINARY_API_KEY,secret=process.env.CLOUDINARY_API_SECRET;
  if(!cloud||!key||!secret||!/^[a-z0-9_-]+$/i.test(cloud))return res.status(503).json({error:'Le service d’images est temporairement indisponible.'});
  const timestamp=Math.floor(Date.now()/1000),folder=`votenow/${kind==='gallery'?'gallery':'partners'}/${event.id}`,transformation='c_limit,h_1200,w_1200/f_webp/fl_strip_profile';
  const signature=crypto.createHash('sha1').update(`folder=${folder}&timestamp=${timestamp}&transformation=${transformation}${secret}`).digest('hex');
  const form=new FormData();form.append('file',new Blob([req.body],{type:mime}),kind);for(const [name,value]of Object.entries({folder,timestamp,transformation,api_key:key,signature}))form.append(name,String(value));
  const response=await axios.post(`https://api.cloudinary.com/v1_1/${cloud}/image/upload`,form,{timeout:30000,maxRedirects:0,maxContentLength:1024*1024});
  const url=new URL(response.data.secure_url);
  if(url.protocol!=='https:'||url.hostname!=='res.cloudinary.com'||!url.pathname.startsWith(`/${cloud}/`))throw Error('Unexpected image URL');
  return res.status(201).json(kind==='gallery'?{image_url:url.href}:{logo_url:url.href});
 }catch(error){return res.status(503).json({error:'Envoi de l’image impossible. Veuillez réessayer.'});}
}
exports.uploadPartnerLogo=(req,res)=>uploadImage(req,res,'partner');
exports.uploadGalleryImage=(req,res)=>uploadImage(req,res,'gallery');
