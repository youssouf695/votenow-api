const crypto=require('node:crypto'),axios=require('axios');
const fail=(message,status,code)=>Object.assign(new Error(message),{status,code});
function configuration(env=process.env){
 let parsed={};if(env.CLOUDINARY_URL){try{const u=new URL(env.CLOUDINARY_URL.trim());if(u.protocol!=='cloudinary:')throw Error();parsed={cloud:u.hostname,key:decodeURIComponent(u.username),secret:decodeURIComponent(u.password)};}catch{return {ready:false,invalid:['CLOUDINARY_URL'],missing:[]};}}
 const clean=v=>typeof v==='string'?v.trim():'';
 const c={cloud:clean(env.CLOUDINARY_CLOUD_NAME)||parsed.cloud||clean(env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME),key:clean(env.CLOUDINARY_API_KEY)||parsed.key,secret:clean(env.CLOUDINARY_API_SECRET)||parsed.secret};
 const missing=Object.entries({CLOUDINARY_CLOUD_NAME:c.cloud,CLOUDINARY_API_KEY:c.key,CLOUDINARY_API_SECRET:c.secret}).filter(([,v])=>!v).map(([k])=>k),invalid=c.cloud&&!/^[a-z0-9_-]+$/i.test(c.cloud)?['CLOUDINARY_CLOUD_NAME']:[];
 return {ready:!missing.length&&!invalid.length,missing,invalid,...c};
}
function imageType(buffer){if(!Buffer.isBuffer(buffer))return null;if(buffer.length>=8&&buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';if(buffer.length>=3&&buffer[0]===255&&buffer[1]===216&&buffer[2]===255)return 'image/jpeg';if(buffer.length>=12&&buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP')return 'image/webp';return null;}
async function upload(buffer,mimeHeader,eventId,kind){
 const mime=imageType(buffer);if(!mime||mime!==mimeHeader?.split(';')[0])throw fail('Choisissez une image JPEG, PNG ou WebP.',415,'IMAGE_FORMAT_INVALID');
 if(buffer.length>5*1024*1024)throw fail('Image trop volumineuse (5 Mo maximum).',413,'IMAGE_TOO_LARGE');
 if(!['gallery','partners','applications'].includes(kind)||!/^[a-f0-9-]{36}$/i.test(eventId))throw fail('Destination d’image invalide.',400,'IMAGE_DESTINATION_INVALID');
 const c=configuration();if(!c.ready){console.error('[images.configuration]',{missing:c.missing,invalid:c.invalid});throw fail('Le service d’images n’est pas configuré sur le serveur. Contactez l’administrateur.',503,'IMAGE_SERVICE_NOT_CONFIGURED');}
 const timestamp=Math.floor(Date.now()/1000),folder=`votenow/${kind}/${eventId}`,transformation='c_limit,h_1600,w_1600/f_webp/fl_strip_profile';
 const signature=crypto.createHash('sha1').update(`folder=${folder}&timestamp=${timestamp}&transformation=${transformation}${c.secret}`).digest('hex');
 const form=new FormData();form.append('file',new Blob([buffer],{type:mime}),'image');for(const[k,v]of Object.entries({folder,timestamp,transformation,api_key:c.key,signature}))form.append(k,String(v));
 try{const response=await axios.post(`https://api.cloudinary.com/v1_1/${c.cloud}/image/upload`,form,{timeout:30000,maxRedirects:0,maxContentLength:1024*1024});const u=new URL(response.data.secure_url);if(u.protocol!=='https:'||u.hostname!=='res.cloudinary.com'||!u.pathname.startsWith(`/${c.cloud}/`))throw Error('IMAGE_RESPONSE_INVALID');return u.href;}catch(e){
 const reference=crypto.randomUUID(),http=e.response?.status||null;console.error('[images.upload]',{reference,http,code:http===401||http===403?'IMAGE_PROVIDER_AUTH':http===400?'IMAGE_PROVIDER_REQUEST':'IMAGE_PROVIDER_UNAVAILABLE'});
 throw Object.assign(fail('Envoi de l’image impossible. Veuillez réessayer ou contacter le support avec cette référence.',503,'IMAGE_UPLOAD_FAILED'),{reference});
 }
}
module.exports={configuration,imageType,upload};
