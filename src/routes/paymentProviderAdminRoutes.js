const router = require('express').Router();
const manager = require('../services/paymentProviders/manager');

const run = fn => async (req,res) => {
  res.set('Cache-Control','no-store');
  try {res.json(await fn(req));}
  catch(error) {
    res.status(error.status || 503).json({
      error: error.status ? error.message : 'Configuration des fournisseurs indisponible'
    });
  }
};

router.get('/',run(() => manager.list()));
router.patch('/providers/:id',run(req => manager.update(req.user,'provider',req.params.id,req.body)));
router.patch('/accounts/:id',run(req => manager.update(req.user,'account',req.params.id,req.body)));
router.patch('/capabilities/:id',run(req => manager.update(req.user,'capability',req.params.id,req.body)));
router.post('/capabilities/:id/tariffs',run(req => manager.publish(req.user,req.params.id,req.body)));
router.post('/simulate',run(req => {
  const {environment,direction,amount,rail,as_of} = req.body || {};
  return manager.select({environment,direction,amount,rail,asOf:as_of,simulation:true});
}));

module.exports = router;
