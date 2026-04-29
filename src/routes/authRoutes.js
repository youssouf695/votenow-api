const express = require('express');
const authController = require('../controllers/authController');
const { auth } = require('../middleware/auth');

const router = express.Router();

router.post('/register', authController.register);
router.post('/login', authController.login);
router.get('/me', auth, authController.me);
router.post('/request-login-code', authController.requestLoginCode);
router.post('/verify-login-code', authController.verifyLoginCode);

module.exports = router;