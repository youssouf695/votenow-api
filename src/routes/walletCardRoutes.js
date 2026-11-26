const router=require('express').Router();
const card=require('../services/walletCard');
const {emailLanguage}=require('../templates/transactionalEmail');

const run=handler=>async (req,res)=>{
 res.set('Cache-Control','no-store, private');
 try {res.json(await handler(req));}
 catch(error){
  const code=error.status?error.code:'CARD_UNAVAILABLE';
  res.status(error.status||503).json({code,error:code});
 }
};
router.get('/',run(req=>card.state(req.user.id)));
router.post('/challenge',run(req=>card.issue(req.user.id,req.token,req.body?.action,emailLanguage(req))));
router.post('/action',run(req=>card.operate(req.user.id,req.token,req.body?.action,req.body||{})));

module.exports={router,admin:run(req=>card.admin(req.user.id,req.params.userId,req.body?.action,req.body?.reason))};
