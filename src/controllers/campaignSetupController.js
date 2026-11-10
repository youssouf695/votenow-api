const service=require('../services/campaignSetup');
const run=action=>async(req,res)=>{res.set('Cache-Control','no-store');try{res.json(await action(req))}catch(error){console.error('[campaign.setup]',{code:error.original?.code||error.code||null});res.status(error.status||503).json({error:error.status?error.message:'Enregistrement du parcours temporairement indisponible.'})}};
exports.create=run(req=>service.create(req.user,req.body));
exports.get=run(req=>service.get(req.user,req.params.id));
exports.save=run(req=>service.save(req.user,req.params.id,req.body));
exports.restart=run(req=>service.restart(req.user,req.params.id,req.body));
exports.publish=run(req=>service.publish(req.user,req.params.id,req.body));
