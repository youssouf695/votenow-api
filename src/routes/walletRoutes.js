const router=require('express').Router(),{auth}=require('../middleware/auth'),{rateLimit}=require('../middleware/rateLimit'),controller=require('../controllers/walletController');
router.use(auth);
router.use(rateLimit({scope:'wallet',limit:120,seconds:60,identify:req=>req.user.id}));
router.get('/',controller.me);router.post('/open',controller.open);router.get('/history',controller.history);
router.post('/quote',rateLimit({scope:'wallet-quote',limit:30,seconds:60,identify:req=>req.user.id}),controller.quote);router.post('/topups',rateLimit({scope:'wallet-topup',limit:5,seconds:60,identify:req=>req.user.id}),controller.topup);router.get('/topups/:id',controller.status);router.post('/votes',controller.vote);
module.exports=router;
