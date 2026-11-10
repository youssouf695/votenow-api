const {Event}=require('../models');
const {Op}=require('sequelize');
module.exports=async(req,res,next)=>{
 try{
  const id=req.params.eventId;
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id||''))return res.status(404).json({error:'Campagne introuvable'});
  const campaign=await Event.findOne({where:{id,status:{[Op.in]:['active','closed']},archived_at:null},attributes:['id']});
  if(!campaign)return res.status(404).json({error:'Campagne introuvable'});
  return next();
 }catch{return res.status(503).json({error:'Campagne temporairement indisponible'})}
};
