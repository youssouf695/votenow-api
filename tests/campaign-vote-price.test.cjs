const assert = require('node:assert/strict');
const {test} = require('node:test');
const {Event, Candidate} = require('../src/models');
const controller = require('../src/controllers/eventController');
const {normalize, validateThrough} = require('../src/services/campaignSetup');
const {votePrice, quoteBreakdown} = require('../src/services/votePricing');

function response() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('creation rejects 50 FCFA and stores 100 FCFA', async t => {
  t.mock.method(Event, 'findOne', async () => null);
  const create = t.mock.method(Event, 'create', async values => values);
  const req = {user: {id: 'owner'}, body: {title: 'Campagne test', vote_price_fcfa: 50}};
  const refused = response();
  await controller.createEvent(req, refused);
  assert.equal(refused.statusCode, 400);
  assert.equal(create.mock.callCount(), 0);
  const accepted = response();
  await controller.createEvent({...req, body: {...req.body, vote_price_fcfa: 100}}, accepted);
  assert.equal(accepted.statusCode, 201);
  assert.equal(accepted.body.event.vote_price_fcfa, 100);
});

test('a historical 50 FCFA campaign can be edited and quoted, but assigning a different subminimum price fails', async t => {
  const event = {status: 'active', vote_price_fcfa: 50, commission_rate: 15,
    async update(changes) { Object.assign(this, changes); }};
  t.mock.method(Event, 'findOne', async () => event);
  t.mock.method(Event, 'findByPk', async () => event);
  t.mock.method(Candidate, 'findOne', async () => ({id: 'candidate'}));
  const update = async body => {
    const res = response();
    await controller.updateEvent({params: {id: 'event'}, user: {id: 'owner'}, body}, res);
    return res.statusCode;
  };
  assert.equal(await update({title: 'Nouveau titre'}), 200);
  assert.equal(await update({description: 'Description', vote_price_fcfa: '50'}), 200);
  assert.equal(await update({vote_price_fcfa: 75}), 400);
  assert.equal(event.vote_price_fcfa, 50);
  assert.equal(event.status, 'active');
  const {unitPrice, price} = await votePrice({event_id: 'event', candidate_id: 'candidate', votes_count: 1});
  assert.equal(quoteBreakdown(unitPrice, price, 'votenow_card').total_debit_fcfa, 50);
  assert.equal(quoteBreakdown(unitPrice, price, 'kpay').nominal_fcfa, 50);
  const historicalBudget = await votePrice({event_id: 'event', candidate_id: 'candidate', nominal_budget_fcfa: 50});
  assert.equal(historicalBudget.price.count, 1);
  assert.equal(quoteBreakdown(historicalBudget.unitPrice, historicalBudget.price, 'votenow_card').total_debit_fcfa, 50);
  assert.equal(await update({vote_price_fcfa: 100}), 200);
  assert.equal(await update({vote_price_fcfa: 50}), 400);
});

test('the setup wizard distinguishes creation from retaining a legacy draft price', () => {
  const draft = price => normalize({basics: {title: 'Campagne test', vote_price_fcfa: price},
    categories: [], candidates: [], content: {partners: []}});
  assert.throws(() => validateThrough(draft(50), 1), {status: 400});
  assert.doesNotThrow(() => validateThrough(draft(100), 1));
  assert.doesNotThrow(() => validateThrough(draft(50), 1, null, Date.now(), 50));
  assert.throws(() => validateThrough(draft(75), 1, null, Date.now(), 50), {status: 400});
});
