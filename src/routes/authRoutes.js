const express = require('express');
const { body } = require('express-validator');
const authController = require('../controllers/authController');
const { auth } = require('../middleware/auth');

const router = express.Router();

router.post('/register', [
  body('email').isEmail().normalizeEmail(),
  body('phone').notEmpty().withMessage('Téléphone requis'),
  body('full_name').notEmpty().withMessage('Nom complet requis'),
  body('password').isLength({ min: 6 }).withMessage('Mot de passe trop court')
], authController.register);

router.post('/login', [
  body('email').isEmail(),
  body('password').notEmpty()
], authController.login);

router.get('/me', auth, authController.me);

module.exports = router;