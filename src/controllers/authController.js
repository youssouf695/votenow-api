const jwt = require('jsonwebtoken');
const { User, LoginVerification } = require('../models');
const { sendVerificationEmail } = require('../services/email');
const { Op } = require('sequelize');
const { randomInt } = require('node:crypto');
const { resolveLoginUser, maskEmail } = require('../utils/loginIdentity');

const env = require('../config/env');
const JWT_SECRET = env.jwt.secret;
const JWT_EXPIRE = env.jwt.expire || '7d';
if (!JWT_SECRET || !JWT_SECRET.trim()) throw new Error('JWT_SECRET est obligatoire');

const generateToken = (user) => {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRE }
  );
};

const generateCode = () => randomInt(100000, 1000000).toString();

exports.register = async (req, res) => {
  try {
    const { email, phone, full_name, password } = req.body;

    const existingUser = await User.findOne({
      where: { [Op.or]: [{ email }, { phone }] }
    });

    if (existingUser) {
      return res.status(400).json({ error: 'Email ou téléphone déjà utilisé' });
    }

    const user = await User.create({
      email,
      phone,
      full_name,
      password_hash: password,
      role: 'organizer'
    });

    const token = generateToken(user);

    res.status(201).json({
      message: 'Inscription réussie',
      token,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ where: { email } });

    if (!user) {
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    }

    const isValid = await user.validatePassword(password);
    if (!isValid) {
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    }

    const token = generateToken(user);

    res.json({
      message: 'Connexion réussie',
      token,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        balance: user.balance_fcfa
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.me = async (req, res) => {
  try {
    res.json({
      user: {
        id: req.user.id,
        email: req.user.email,
        full_name: req.user.full_name,
        role: req.user.role,
        balance: req.user.balance_fcfa,
        is_verified: req.user.is_verified
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ==================== LOGIN OTP ====================

// L'OTP est toujours envoyé par email, même si le compte est trouvé par téléphone.
exports.requestLoginCode = async (req, res) => {
  try {
    const password = req.body?.password;
    if (typeof password !== 'string' || !password || password.length > 1024) {
      return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect' });
    }

    const user = await resolveLoginUser(req);
    if (!user || !user.password_hash || !(await user.validatePassword(password))) {
      return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect' });
    }

    const email = user.email;
    const code = generateCode();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await LoginVerification.destroy({
      where: { email, used: false, expires_at: { [Op.lt]: new Date() } }
    });
    const verification = await LoginVerification.create({ email, code, expires_at: expiresAt });

    try {
      await sendVerificationEmail(email, code, user.full_name);
    } catch (error) {
      // Un code dont l'envoi a échoué ne doit pas rester utilisable.
      await verification.update({ used: true });
      throw error;
    }

    res.json({
      message: 'Code envoyé par email',
      email,
      email_masked: maskEmail(email),
      delivery_method: 'email',
      expires_in: 15
    });
  } catch (error) {
    console.error('Erreur requestLoginCode:', error.message);
    res.status(500).json({ error: 'Impossible d’envoyer le code. Réessayez plus tard.' });
  }
};

exports.verifyLoginCode = async (req, res) => {
  try {
    const code = req.body?.code;
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: 'Code invalide ou expiré' });
    }
    const user = await resolveLoginUser(req);
    if (!user) return res.status(400).json({ error: 'Code invalide ou expiré' });

    // L'UPDATE conditionnel évite deux validations simultanées du même code.
    const [count] = await LoginVerification.update({ used: true }, {
      where: {
        email: user.email,
        code,
        used: false,
        expires_at: { [Op.gt]: new Date() }
      }
    });
    if (!count) return res.status(400).json({ error: 'Code invalide ou expiré' });

    const token = generateToken(user);
    res.json({
      message: 'Connexion réussie',
      token,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        balance: user.balance_fcfa,
        is_verified: user.is_verified
      }
    });
  } catch (error) {
    console.error('Erreur verifyLoginCode:', error.message);
    res.status(500).json({ error: 'Impossible de vérifier le code. Réessayez plus tard.' });
  }
};
