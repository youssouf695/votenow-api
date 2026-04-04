const express = require('express');
const { body, param, query } = require('express-validator');
const withdrawalController = require('../controllers/withdrawalController');
const { auth, authorize } = require('../middleware/auth');

const router = express.Router();

// Toutes les routes nécessitent une authentification
router.use(auth);

// Routes pour organisateurs uniquement
router.post('/', [
  body('amount').isInt({ min: 100 }).withMessage('Montant invalide'),
  body('method').isIn(['mtn_momo', 'orange_money', 'bank']).withMessage('Méthode invalide'),
  body('destination_phone').optional().isMobilePhone('any').withMessage('Numéro invalide'),
  body('destination_account').optional().isString(),
  body('destination_name').optional().isString(),
  body('bank_name').optional().isString(),
  body('event_id').optional().isUUID().withMessage('ID événement invalide')
], authorize('organizer'), withdrawalController.requestWithdrawal);

router.get('/my-withdrawals', authorize('organizer'), withdrawalController.getMyWithdrawals);

router.get('/stats', authorize('organizer'), withdrawalController.getWithdrawalStats);

router.get('/:id', [
  param('id').isUUID()
], authorize('organizer'), withdrawalController.getWithdrawalDetails);

router.delete('/:id', [
  param('id').isUUID()
], authorize('organizer'), withdrawalController.cancelWithdrawal);

module.exports = router;