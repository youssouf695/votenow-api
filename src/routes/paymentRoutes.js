const express = require('express');
const { body, param, query } = require('express-validator');
const paymentController = require('../controllers/paymentController');
const { auth } = require('../middleware/auth');

const router = express.Router();

// Webhook Chipdeals (public)
router.post('/webhook', paymentController.handleWebhook);

// Routes publiques
router.post('/initiate', [
  body('event_id').isUUID(),
  body('candidate_id').isUUID(),
  body('votes_count').isInt({ min: 1, max: 100 }),
  body('voter_phone').notEmpty(),
  body('voter_name').optional()
], paymentController.initiatePayment);

router.get('/status/:paymentId', [
  param('paymentId').isUUID()
], paymentController.checkPaymentStatus);

// Routes protégées
router.get('/event/:eventId', [
  param('eventId').isUUID()
], auth, paymentController.getEventPayments);

module.exports = router;