const crypto=require('node:crypto'),axios=require('axios');
const {imageType}=require('../controllers/campaignAssetController');
const {fail}=require('./registrationForm');
async function upload(buffer,contentType,eventId){
 const mime=imageType(buffer);
 if(!mime||mime!==contentType?.split(';')[0])throw fail('Choisissez une image JPEG, PNG ou WebP.',415);
 if(buffer.length>5*1024*1024)throw fail('Photo : 5 Mo maximum.',413);
 const cloud=process.env.CLOUDINARY_CLOUD_NAME,key=process.env.CLOUDINARY_API_KEY,secret=process.env.CLOUDINARY_API_SECRET;
 if(!cloud||!key||!secret||!/^[a-z0-9_-]+$/i.test(cloud))throw fail('Le service d’images n’est pas configuré.',503);
 const timestamp=Math.floor(Date.now()/1000),folder=`votenow/applications/${eventId}`,transformation='c_limit,h_1600,w_1600/f_webp/fl_strip_profile';
 const signature=crypto.createHash('sha1').update(`folder=${folder}&timestamp=${timestamp}&transformation=${transformation}${secret}`).digest('hex');
 const form=new FormData();form.append('file',new Blob([buffer],{type:mime}),'application');for(const[k,v]of Object.entries({folder,timestamp,transformation,api_key:key,signature}))form.append(k,String(v));
 try{const r=await axios.post(`https://api.cloudinary.com/v1_1/${cloud}/image/upload`,form,{timeout:30000,maxRedirects:0,maxContentLength:1024*1024});const u=new URL(r.data.secure_url);if(u.protocol!=='https:'||u.hostname!=='res.cloudinary.com'||!u.pathname.startsWith(`/${cloud}/`))throw Error();return u.href;}catch{throw fail('Envoi de la photo impossible. Réessayez.',503);}
}
module.exports={upload};
