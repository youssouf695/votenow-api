const images=require('./campaignImageUpload');
module.exports={upload:(buffer,mime,eventId)=>images.upload(buffer,mime,eventId,'applications')};
