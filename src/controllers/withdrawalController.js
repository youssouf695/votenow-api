const { Withdrawal, User, Event } = require('../models');
const sequelize = require('../config/database'); // ✅ import direct
const { validationResult } = require('express-validator');
const { Op } = require('sequelize');


// ==================== 1. DEMANDER UN RETRAIT ====================
exports.requestWithdrawal = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      await t.rollback();
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      amount,
      method,
      destination_phone,
      event_id,
      destination_account,
      destination_name,
      bank_name
    } = req.body;

    // Compte vérifié ?
    if (!req.user.is_verified) {
      await t.rollback();
      return res.status(403).json({
        error: 'Compte non vérifié. Vérifiez votre compte avant de faire un retrait.'
      });
    }

    // Solde suffisant ?
    if (req.user.balance_fcfa < amount) {
      await t.rollback();
      return res.status(400).json({
        error: 'Solde insuffisant',
        balance: req.user.balance_fcfa,
        requested: amount
      });
    }

    // Montant minimum par méthode
    const minAmounts = { mtn_momo: 500, orange_money: 500, bank: 5000 };
    if (amount < minAmounts[method]) {
      await t.rollback();
      return res.status(400).json({
        error: `Montant minimum pour ${method} : ${minAmounts[method]} FCFA`
      });
    }

    // Pas de demande déjà en cours
    const existingPending = await Withdrawal.findOne({
      where: {
        organizer_id: req.user.id,
        status: { [Op.in]: ['pending', 'processing'] }
      }
    });

    if (existingPending) {
      await t.rollback();
      return res.status(400).json({
        error: 'Vous avez déjà une demande de retrait en cours de traitement'
      });
    }

    // Vérifier l'événement si spécifié
    if (event_id) {
      const event = await Event.findOne({
        where: { id: event_id, organizer_id: req.user.id }
      });
      if (!event) {
        await t.rollback();
        return res.status(404).json({ error: 'Événement non trouvé' });
      }
    }

    // Bloquer le montant (éviter double dépense)
    await User.decrement(
      { balance_fcfa: amount },
      { where: { id: req.user.id }, transaction: t }
    );

    // Créer la demande
    const withdrawal = await Withdrawal.create({
      organizer_id: req.user.id,
      event_id: event_id || null,
      amount_fcfa: amount,
      method,
      destination_phone,
      destination_account: destination_account || null,
      destination_name: destination_name || null,
      bank_name: bank_name || null,
      status: 'pending'
    }, { transaction: t });

    await t.commit();

    res.status(201).json({
      message: 'Demande de retrait envoyée avec succès',
      withdrawal: {
        id: withdrawal.id,
        amount_fcfa: withdrawal.amount_fcfa,
        method: withdrawal.method,
        destination_phone: withdrawal.destination_phone,
        status: withdrawal.status,
        requested_at: withdrawal.requested_at,
        estimated_processing: '24-48h'
      },
      new_balance: req.user.balance_fcfa - amount
    });

  } catch (error) {
    await t.rollback();
    console.error('Erreur requestWithdrawal:', error.message);
    res.status(500).json({ error: error.message });
  }
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
  const t = await sequelize.transaction();

  try {
    const { id } = req.params;

    const withdrawal = await Withdrawal.findOne({
      where: {
        id,
        organizer_id: req.user.id,
        status: 'pending'       // On ne peut annuler que si encore pending
      }
    });

    if (!withdrawal) {
      await t.rollback();
      return res.status(404).json({ error: 'Demande non trouvée ou déjà traitée' });
    }

    // Rembourser le solde
    await User.increment(
      { balance_fcfa: withdrawal.amount_fcfa },
      { where: { id: req.user.id }, transaction: t }
    );

    await withdrawal.update({
      status: 'cancelled',
      completed_at: new Date()
    }, { transaction: t });

    await t.commit();

    res.json({
      message: 'Demande annulée avec succès',
      new_balance: req.user.balance_fcfa + withdrawal.amount_fcfa
    });

  } catch (error) {
    await t.rollback();
    console.error('Erreur cancelWithdrawal:', error.message);
    res.status(500).json({ error: error.message });
  }
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