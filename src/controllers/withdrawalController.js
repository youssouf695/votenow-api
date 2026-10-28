const { Withdrawal, User, Event } = require('../models');
const sequelize = require('../config/database'); // ✅ import direct
const { validationResult } = require('express-validator');
const { Op } = require('sequelize');


// ==================== 1. DEMANDER UN RETRAIT ====================
exports.requestWithdrawal = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const { integer, normalizePhone } = require('../services/kpayAmounts');
    const amount = integer(req.body.amount);
    const method = req.body.method;
    if (!['mtn_momo', 'orange_money'].includes(method)) return res.status(422).json({ error: 'Choisissez MTN Mobile Money ou Orange Money.' });
    if (amount < 500 || amount > 10000000) return res.status(400).json({ error: 'Montant de retrait invalide (500 à 10 000 000 FCFA).' });
    const phone = normalizePhone(req.body.destination_phone);
    const result = await sequelize.transaction(async transaction => {
      const user = await User.findByPk(req.user.id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!user?.is_verified) throw Object.assign(new Error('Compte non vérifié'), { status: 403 });
      if (user.balance_fcfa < amount) throw Object.assign(new Error('Solde insuffisant'), { status: 400 });
      const pending = await Withdrawal.findOne({ where: { organizer_id: user.id, status: { [Op.in]: ['pending', 'processing'] } }, transaction });
      if (pending) throw Object.assign(new Error('Vous avez déjà une demande en cours.'), { status: 409 });
      if (req.body.event_id) {
        const event = await Event.findOne({ where: { id: req.body.event_id, organizer_id: user.id }, transaction });
        if (!event) throw Object.assign(new Error('Événement non trouvé'), { status: 404 });
      }
      await User.decrement({ balance_fcfa: amount }, { where: { id: user.id }, transaction });
      const withdrawal = await Withdrawal.create({ organizer_id: user.id, event_id: req.body.event_id || null,
        amount_fcfa: amount, method, destination_phone: phone, status: 'pending' }, { transaction });
      return { withdrawal, new_balance: user.balance_fcfa - amount };
    });
    return res.status(201).json({ message: 'Demande de retrait enregistrée', ...result });
  } catch (error) { return res.status(error.status || 500).json({ error: error.status ? error.message : 'Demande non enregistrée' }); }
};

// ==================== 2. HISTORIQUE DES RETRAITS ====================
exports.getMyWithdrawals = async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const offset = (page - 1) * parseInt(limit);

    const where = { organizer_id: req.user.id };
    if (status) where.status = status;

    const withdrawals = await Withdrawal.findAndCountAll({
      where,
      include: [{
        model: Event,
        as: 'event',            // ✅ alias obligatoire
        attributes: ['id', 'title', 'slug'],
        required: false         // ✅ LEFT JOIN — retrait global sans event_id
      }],
      order: [['requested_at', 'DESC']],
      limit: parseInt(limit),
      offset
    });

    // ✅ COUNT corrigé
    const stats = await Withdrawal.findAll({
      where: { organizer_id: req.user.id },
      attributes: [
        'status',
        [sequelize.fn('COUNT', sequelize.col('Withdrawal.id')), 'count'],
        [sequelize.fn('SUM', sequelize.col('amount_fcfa')), 'total']
      ],
      group: ['status'],
      raw: true
    });

    res.json({
      withdrawals: withdrawals.rows,
      pagination: {
        total: withdrawals.count,
        page: parseInt(page),
        totalPages: Math.ceil(withdrawals.count / parseInt(limit)),
        limit: parseInt(limit)
      },
      stats: stats.reduce((acc, s) => {
        acc[s.status] = {
          count: parseInt(s.count),
          total: parseInt(s.total || 0)
        };
        return acc;
      }, {})
    });

  } catch (error) {
    console.error('Erreur getMyWithdrawals:', error.message);
    res.status(500).json({ error: error.message });
  }
};


// ==================== 3. DÉTAIL D'UN RETRAIT ====================
exports.getWithdrawalDetails = async (req, res) => {
  try {
    const { id } = req.params;

    const withdrawal = await Withdrawal.findOne({
      where: { id, organizer_id: req.user.id },
      include: [{
        model: Event,
        as: 'event',            // ✅ alias obligatoire
        attributes: ['id', 'title', 'slug'],
        required: false
      }]
    });

    if (!withdrawal) {
      return res.status(404).json({ error: 'Demande non trouvée' });
    }

    res.json({ withdrawal });

  } catch (error) {
    console.error('Erreur getWithdrawalDetails:', error.message);
    res.status(500).json({ error: error.message });
  }
};


// ==================== 4. ANNULER UNE DEMANDE ====================
exports.cancelWithdrawal = async (req, res) => {
  try {
    const result = await sequelize.transaction(async transaction => {
      const withdrawal = await Withdrawal.findOne({ where: { id: req.params.id, organizer_id: req.user.id }, transaction, lock: transaction.LOCK.UPDATE });
      if (!withdrawal || withdrawal.status !== 'pending') throw Object.assign(new Error('Demande déjà traitée ou introuvable'), { status: 409 });
      await User.increment({ balance_fcfa: withdrawal.amount_fcfa }, { where: { id: req.user.id }, transaction });
      await withdrawal.update({ status: 'cancelled', completed_at: new Date() }, { transaction });
      const user = await User.findByPk(req.user.id, { transaction });
      return { new_balance: user.balance_fcfa };
    });
    return res.json({ message: 'Demande annulée', ...result });
  } catch (error) { return res.status(error.status || 500).json({ error: error.status ? error.message : 'Annulation indisponible' }); }
};

// ==================== 5. STATISTIQUES MENSUELLES ====================
exports.getWithdrawalStats = async (req, res) => {
  try {
    const stats = await Withdrawal.findAll({
      where: { organizer_id: req.user.id },
      attributes: [
        [sequelize.fn('DATE_TRUNC', 'month', sequelize.col('requested_at')), 'month'],
        [sequelize.fn('COUNT', sequelize.col('Withdrawal.id')), 'count'], // ✅ COUNT corrigé
        [sequelize.fn('SUM', sequelize.col('amount_fcfa')), 'total']
      ],
      group: [sequelize.fn('DATE_TRUNC', 'month', sequelize.col('requested_at'))],
      order: [[sequelize.fn('DATE_TRUNC', 'month', sequelize.col('requested_at')), 'DESC']],
      limit: 12,
      raw: true
    });

    res.json({
      monthly_stats: stats.map(s => ({
        month: s.month,
        count: parseInt(s.count),
        total: parseInt(s.total || 0)
      }))
    });

  } catch (error) {
    console.error('Erreur getWithdrawalStats:', error.message);
    res.status(500).json({ error: error.message });
  }
};

