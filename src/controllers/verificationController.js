const { User, Verification } = require('../models');
const { sendVerificationEmail } = require('../services/email');
const { Op } = require('sequelize');
const jwt = require('jsonwebtoken');
const env = require('../config/env');

const generateCode=()=>require('node:crypto').randomInt(100000,1000000).toString();

// ==================== ANCIENNES MÉTHODES (à garder pour utilisateurs existants) ====================

// Envoyer un code de vérification (pour utilisateur déjà existant)
exports.sendVerificationCode = async (req, res) => {
  try {
    const userId=req.user.id; const method=req.body.method;
    if(method!=='email')return res.status(422).json({error:'La vérification disponible est par email.'});

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
    const userId=req.user.id; const {code,method}=req.body;
    if(method!=='email')return res.status(422).json({error:'La vérification disponible est par email.'});

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

// Les routes historiques /verifications partagent le même stockage et la même
// résolution d'identifiant que /auth. Les pré-inscriptions utilisent désormais PostgreSQL.
const authController = require('./authController');
exports.requestLoginCode = authController.requestLoginCode;
exports.verifyLoginCode = authController.verifyLoginCode;

const registration=require('./registrationController');
exports.sendPreRegistrationCode=registration.send;
exports.verifyAndCreateAccount=registration.verify;
