const service = require('../services/campaignCommission');

const run = handler => async (req,res) => {
  res.set('Cache-Control','no-store');
  try { res.json(await handler(req)); }
  catch (error) {
    res.status(error.status || 503).json({error:error.status ? error.message : 'Commission de campagne indisponible'});
  }
};

exports.getAdmin=run(req=>service.read(req.params.eventId,null,req.query.page));
exports.updateAdmin=run(req=>service.change(req.params.eventId,req.user,req.body));
exports.getOrganizer=run(req=>service.read(req.params.eventId,req.user.id));
