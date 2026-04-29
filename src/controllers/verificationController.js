const { User, Verification } = require('../models');
const { sendVerificationEmail } = require('../services/email');
const { sendVerificationWhatsApp } = require('../services/whatsapp');
const { Op } = require('sequelize');
const jwt = require('jsonwebtoken');
const env = require('../config/env');

// Stockage temporaire des inscriptions en attente (à remplacer par Redis en production)
const pendingRegistrations = new Map();

// Générer un code à 6 chiffres
const generateCode = () => Math.floor(100000 + Math.random() * 900000).toString();

// Générer un token JWT
const generateToken = (user) => {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    env.jwt.secret,
    { expiresIn: env.jwt.expire }
  );
};

// ==================== NOUVEAU : ENVOI DE CODE PRÉ-INSCRIPTION ====================
exports.sendPreRegistrationCode = async (req, res) => {
  try {
    const { email, phone, full_name } = req.body;
    console.log('📥 Données reçues:', { email, phone, full_name });

    // Si phone est manquant (renvoi de code), on ne vérifie que l'email
    const whereConditions = [{ email }];
    if (phone) {
      whereConditions.push({ phone });
    }

    const existingUser = await User.findOne({
      where: {
        [Op.or]: whereConditions
      }
    });

    if (existingUser) {
      return res.status(400).json({ error: 'Email ou téléphone déjà utilisé' });
    }

    const code = generateCode();
    const expiresAt = Date.now() + 15 * 60 * 1000;

    pendingRegistrations.set(email, {
      code,
      expiresAt,
      data: req.body
    });

    setTimeout(() => {
      if (pendingRegistrations.has(email)) {
        const pending = pendingRegistrations.get(email);
        if (Date.now() > pending.expiresAt) {
          pendingRegistrations.delete(email);
        }
      }
    }, 15 * 60 * 1000);

    await sendVerificationEmail(email, code, full_name);

    res.json({
      message: 'Code envoyé par email',
      expires_in: 15
    });

  } catch (error) {
    console.error('Erreur envoi code pré-inscription:', error);
    res.status(500).json({ error: error.message });
  }
};

// ==================== NOUVEAU : VÉRIFICATION ET CRÉATION DE COMPTE ====================
exports.verifyAndCreateAccount = async (req, res) => {
  try {
    const { email, code } = req.body;

    const pending = pendingRegistrations.get(email);

    if (!pending) {
      return res.status(400).json({ error: 'Aucune inscription en attente' });
    }

    if (pending.code !== code) {
      return res.status(400).json({ error: 'Code invalide' });
    }

    if (Date.now() > pending.expiresAt) {
      pendingRegistrations.delete(email);
      return res.status(400).json({ error: 'Code expiré' });
    }

    const { full_name, phone, organization_name, website, password } = pending.data;

    // Créer l'utilisateur directement vérifié
    const user = await User.create({
      email,
      phone,
      full_name,
      password_hash: password,
      role: 'organizer',
      is_verified: true,
      organization_name: organization_name || null,
      website: website || null
    });

    // Nettoyer le stockage temporaire
    pendingRegistrations.delete(email);

    // Générer le token JWT
    const token = generateToken(user);

    res.status(201).json({
      message: 'Compte créé avec succès',
      token,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        phone: user.phone,
        role: user.role,
        is_verified: true,
        balance_fcfa: user.balance_fcfa
      }
    });

  } catch (error) {
    console.error('Erreur création compte:', error);
    res.status(500).json({ error: error.message });
  }
};

// ==================== ANCIENNES MÉTHODES (à garder pour utilisateurs existants) ====================

// Envoyer un code de vérification (pour utilisateur déjà existant)
exports.sendVerificationCode = async (req, res) => {
  try {
    const { userId, method } = req.body;

    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    if (user.is_verified) {
      return res.status(400).json({ error: 'Compte déjà vérifié' });
    }

    await Verification.destroy({
      where: {
        user_id: userId,
        type: method,
        expires_at: { [Op.lt]: new Date() }
      }
    });

    const code = generateCode();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await Verification.create({
      user_id: userId,
      code,
      type: method,
      expires_at: expiresAt
    });

    if (method === 'email') {
      await sendVerificationEmail(user.email, code, user.full_name);
    } else if (method === 'whatsapp') {
      await sendVerificationWhatsApp(user.phone, code, user.full_name);
    }

    res.json({
      message: `Code envoyé par ${method === 'email' ? 'email' : 'WhatsApp'}`,
      expires_in: 15
    });

  } catch (error) {
    console.error('Erreur envoi code:', error);
    res.status(500).json({ error: error.message });
  }
};

// Vérifier le code (pour utilisateur existant)
exports.verifyCode = async (req, res) => {
  try {
    const { userId, code, method } = req.body;

    const verification = await Verification.findOne({
      where: {
        user_id: userId,
        code,
        type: method,
        used: false,
        expires_at: { [Op.gt]: new Date() }
      }
    });

    if (!verification) {
      return res.status(400).json({ error: 'Code invalide ou expiré' });
    }

    await verification.update({ used: true });

    await User.update(
      { is_verified: true },
      { where: { id: userId } }
    );

    res.json({ message: 'Compte vérifié avec succès' });

  } catch (error) {
    console.error('Erreur vérification:', error);
    res.status(500).json({ error: error.message });
  }
};

// ==================== CONNEXION AVEC CODE OTP ====================

// Stockage temporaire des codes de connexion
const pendingLoginCodes = new Map();

// Étape 1 : Demander un code OTP pour la connexion
exports.requestLoginCode = async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log('📥 Demande code login:', { email });

    // Vérifier l'utilisateur
    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    }

    // Vérifier le mot de passe
    const isValid = await user.validatePassword(password);
    if (!isValid) {
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    }

    // Nettoyer les anciens codes
    for (const [key, value] of pendingLoginCodes.entries()) {
      if (value.email === email && value.expiresAt < Date.now()) {
        pendingLoginCodes.delete(key);
      }
    }

    const code = generateCode();
    const expiresAt = Date.now() + 15 * 60 * 1000;
    const id = `${email}-${Date.now()}`;

    pendingLoginCodes.set(id, {
      email,
      code,
      expiresAt
    });

    // Nettoyer après expiration
    setTimeout(() => {
      if (pendingLoginCodes.has(id)) {
        pendingLoginCodes.delete(id);
      }
    }, 15 * 60 * 1000);

    // Envoyer le code par email
    await sendVerificationEmail(email, code, user.full_name);

    res.json({
      message: 'Code de vérification envoyé par email',
      email,
      expires_in: 15
    });
  } catch (error) {
    console.error('Erreur requestLoginCode:', error);
    res.status(500).json({ error: error.message });
  }
};

// Étape 2 : Vérifier le code OTP et finaliser la connexion
exports.verifyLoginCode = async (req, res) => {
  try {
    const { email, code } = req.body;
    console.log('📥 Vérification code login:', { email, code });

    // Chercher le code dans le stockage temporaire
    let validCode = null;
    for (const [key, value] of pendingLoginCodes.entries()) {
      if (value.email === email && value.code === code && value.expiresAt > Date.now()) {
        validCode = value;
        pendingLoginCodes.delete(key);
        break;
      }
    }

    if (!validCode) {
      return res.status(400).json({ error: 'Code invalide ou expiré' });
    }

    // Récupérer l'utilisateur
    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    // ✅ AJOUTE ICI : Générer le token JWT
    const token = generateToken(user);

    // ✅ RENVOIE LE TOKEN ET L'UTILISATEUR
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
    console.error('Erreur verifyLoginCode:', error);
    res.status(500).json({ error: error.message });
  }
};