const jwt = require('jsonwebtoken');
const { User, LoginVerification } = require('../models');
const { sendVerificationEmail } = require('../services/email');
const { Op } = require('sequelize');

const JWT_SECRET = process.env.JWT_SECRET || 'ma_super_cle_secrete_123456';
const JWT_EXPIRE = '7d';

const generateToken = (user) => {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRE }
  );
};

const generateCode = () => Math.floor(100000 + Math.random() * 900000).toString();

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

exports.requestLoginCode = async (req, res) => {
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

    await LoginVerification.destroy({
      where: { email, used: false, expires_at: { [Op.lt]: new Date() } }
    });

    const code = generateCode();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await LoginVerification.create({ email, code, expires_at: expiresAt });

    await sendVerificationEmail(email, code, user.full_name);

    res.json({ message: 'Code envoyé', email, expires_in: 15 });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
};

exports.verifyLoginCode = async (req, res) => {
  try {
    const { email, code } = req.body;

    const verification = await LoginVerification.findOne({
      where: { email, code, used: false, expires_at: { [Op.gt]: new Date() } }
    });

    if (!verification) {
      return res.status(400).json({ error: 'Code invalide ou expiré' });
    }

    await verification.update({ used: true });

    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
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
        balance: user.balance_fcfa,
        is_verified: user.is_verified
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
};