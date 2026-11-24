const express = require('express');
const { body, param, query } = require('express-validator');
const paymentController = require('../controllers/paymentController');
const { auth } = require('../middleware/auth');
const {rateLimit}=require('../middleware/rateLimit');
const {MAX_MOBILE_VOTES,MAX_MOBILE_AMOUNT}=require('../services/votePricing');

const router = express.Router();

// Le webhook KPay est enregistré dans app.js avant express.json.

// Routes publiques
router.get('/availability', paymentController.getPaymentAvailability);

const voteLimit=(scope,limit)=>rateLimit({scope,limit,seconds:60,identify:req=>req.ip});
router.post('/quote', voteLimit('mobile-vote-quote',90), [
  body('event_id').isUUID(),
  body('candidate_id').isUUID(),
  body('votes_count').if((_,{req})=>req.body.nominal_budget_fcfa===undefined).isInt({ min: 1, max: MAX_MOBILE_VOTES }),
  body('nominal_budget_fcfa').optional().isInt({min:1,max:MAX_MOBILE_AMOUNT})
], paymentController.quoteVote);

router.post('/initiate', voteLimit('mobile-vote-init',30), [
  body('expected_amount').isInt({ min: 50, max: 1000000 }),
  body('request_id').isUUID().withMessage('Identifiant de tentative requis'),
  body('event_id').isUUID(),
  body('candidate_id').isUUID(),
  body('votes_count').isInt({ min: 1, max: MAX_MOBILE_VOTES }),
  body('nominal_budget_fcfa').optional().isInt({min:1,max:MAX_MOBILE_AMOUNT}),
  body('rail').optional().isIn(['mtn_momo','orange_money']),
  body('voter_phone').notEmpty(),
  body('voter_name').optional()
], paymentController.initiatePayment);

router.get('/status/:paymentId', [
  param('paymentId').isUUID()
], paymentController.checkPaymentStatus);

// Réconciliation explicite : utilise le contrôleur de statut existant,
// qui tente déjà une consultation KPay pour un paiement en attente.
router.post('/:paymentId/reconcile', [
  param('paymentId').isUUID()
], paymentController.checkPaymentStatus);

// Routes protégées
router.get('/event/:eventId', [
  param('eventId').isUUID(),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('status').optional().isIn(['pending', 'success', 'failed', 'refunded'])
], auth, paymentController.getEventPayments);

module.exports = router;

