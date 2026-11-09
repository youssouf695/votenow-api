const express = require('express');
const { body, param, query } = require('express-validator');
const withdrawalController = require('../controllers/withdrawalController');
const { auth, authorize } = require('../middleware/auth');

const router = express.Router();

// Toutes les routes nécessitent une authentification
router.use(auth);
const beneficiary = require('../controllers/beneficiaryController');
const {rateLimit}=require('../middleware/rateLimit');
const sendQuota=rateLimit({scope:'beneficiary-send',limit:5,seconds:3600,identify:req=>req.user.id});
const sendCooldown=rateLimit({scope:'beneficiary-send-cooldown',limit:1,seconds:30,identify:req=>req.user.id});
const verifyQuota=rateLimit({scope:'beneficiary-verify',limit:10,seconds:900,identify:req=>req.user.id});
router.get('/beneficiaries',authorize('organizer'),beneficiary.list);
router.post('/beneficiaries',authorize('organizer'),sendQuota,sendCooldown,beneficiary.create);
router.post('/beneficiaries/:id/resend',authorize('organizer'),sendQuota,sendCooldown,beneficiary.resend);
router.post('/beneficiaries/:id/verify',authorize('organizer'),verifyQuota,beneficiary.verify);
router.delete('/beneficiaries/:id',authorize('organizer'),beneficiary.remove);

router.post('/quote',authorize('organizer'),rateLimit({scope:'withdrawal-quote',limit:30,seconds:60,identify:req=>req.user.id}),withdrawalController.quoteWithdrawal);

// Routes pour organisateurs uniquement
router.post('/', [
  body('amount').isInt({ min: 100 }).withMessage('Montant invalide'),
  body('beneficiary_id').isUUID().withMessage('Sélectionnez un bénéficiaire validé'),
  body('request_id').isUUID().withMessage('Identifiant de demande requis'),

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
