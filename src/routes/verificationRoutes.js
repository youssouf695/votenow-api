const express = require('express');
const verificationController = require('../controllers/verificationController');

const router = express.Router();

// Routes publiques (pré-inscription)
router.post('/send-pre-registration-code', verificationController.sendPreRegistrationCode);
router.post('/verify-and-create', verificationController.verifyAndCreateAccount);

// Routes protégées (utilisateurs existants)
router.post('/send', verificationController.sendVerificationCode);
router.post('/verify', verificationController.verifyCode);

// Routes pour la connexion avec OTP
router.post('/request-login-code', verificationController.requestLoginCode);
router.post('/verify-login-code', verificationController.verifyLoginCode);
module.exports = router;