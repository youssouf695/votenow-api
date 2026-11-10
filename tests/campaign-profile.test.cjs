const {test}=require('node:test'),assert=require('node:assert/strict');
const {settings}=require('../src/services/campaignSettings');
const templates=require('../src/config/templates.json');
test('new profile settings persist for all existing campaign templates',()=>{
 for(const template of templates){const saved=settings({template_id:template.id,candidate_layout:'split-right',candidate_background:true,card_motion:'spotlight'});assert.equal(saved.candidate_layout,'split-right');assert.equal(saved.candidate_background,true);assert.equal(saved.card_motion,'spotlight');assert.equal(settings({template_id:template.id}).candidate_layout,template.candidate_layout)}
});
test('invalid profile layouts and background types cannot be saved',()=>{
 for(const extra of [{candidate_layout:'javascript:x'},{candidate_background:'false'},{card_motion:'infinite'}])assert.throws(()=>settings({template_id:templates[0].id,...extra}),{status:400})
});
