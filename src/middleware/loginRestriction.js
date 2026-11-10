module.exports=async(req,res,next)=>{
 if(req.method!=='POST'||!['/login','/request-login-code','/verify-login-code'].includes(req.path))return next();
 try{
  const user=await require('../utils/loginIdentity').resolveLoginUser(req);
  if(user){const [rows]=await require('../config/database').query('SELECT suspended FROM user_restrictions WHERE user_id=:id',{replacements:{id:user.id}});if(rows[0]?.suspended)return res.status(401).json({error:'Email, téléphone, mot de passe ou code incorrect.'})}
  next();
 }catch{return res.status(503).json({error:'Connexion temporairement indisponible.'})}
};
