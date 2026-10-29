const express = require('express');
const { body, param, query } = require('express-validator');
const paymentController = require('../controllers/paymentController');
const { auth } = require('../middleware/auth');

const router = express.Router();

// Le webhook KPay est enregistré dans app.js avant express.json.

// Routes publiques
router.get('/availability', paymentController.getPaymentAvailability);

router.post('/initiate', [
  body('expected_amount').isInt({ min: 50, max: 1000000 }),
  body('request_id').isUUID().withMessage('Identifiant de tentative requis'),
  body('event_id').isUUID(),
  body('candidate_id').isUUID(),
  body('votes_count').isInt({ min: 1, max: 100 }),
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

