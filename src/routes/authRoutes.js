const express = require('express');
const authController = require('../controllers/authController');
const { auth } = require('../middleware/auth');

const router = express.Router();

router.post('/register', authController.register);
router.post('/login', authController.login);
router.get('/me', auth, authController.me);
router.patch('/me', auth, authController.updateProfile);
router.post('/password', auth, require('../middleware/rateLimit').rateLimit({scope:'password-change',limit:5,seconds:900,identify:req=>req.user.id}),authController.changePassword);
router.post('/request-login-code', authController.requestLoginCode);
router.post('/verify-login-code', authController.verifyLoginCode);

module.exports = router;
