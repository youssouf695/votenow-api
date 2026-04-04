const { User, Event, Payment, Withdrawal, Vote, Candidate, Commission } = require('../models');
const sequelize = require('../config/database'); // ✅ import direct
const { Op } = require('sequelize');
const { validationResult } = require('express-validator');


// ==================== DASHBOARD ADMIN ====================
exports.getDashboard = async (req, res) => {
  try {
    const [
      totalUsers, totalOrganizers, totalVoters, totalAdmins,
      totalEvents, activeEvents, draftEvents, closedEvents
    ] = await Promise.all([
      User.count(),
      User.count({ where: { role: 'organizer' } }),
      User.count({ where: { role: 'voter' } }),
      User.count({ where: { role: 'admin' } }),
      Event.count(),
      Event.count({ where: { status: 'active' } }),
      Event.count({ where: { status: 'draft' } }),
      Event.count({ where: { status: 'closed' } })
    ]);

    const finances = await Payment.findOne({
      where: { status: 'success' },
      attributes: [
        [sequelize.fn('SUM', sequelize.col('amount_fcfa')),       'total_collected'],
        [sequelize.fn('SUM', sequelize.col('commission_amount')), 'total_commission']
      ],
      raw: true
    });

    const [pendingWithdrawals, pendingWithdrawalsAmount, totalVotes] = await Promise.all([
      Withdrawal.count({ where: { status: 'pending' } }),
      Withdrawal.sum('amount_fcfa', { where: { status: 'pending' } }),
      Vote.sum('quantity')
    ]);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [newUsers, newEvents] = await Promise.all([
      User.count({ where: { created_at: { [Op.gte]: thirtyDaysAgo } } }),
      Event.count({ where: { created_at: { [Op.gte]: thirtyDaysAgo } } })
    ]);

    res.json({
      users: {
        total:            totalUsers,
        organizers:       totalOrganizers,
        voters:           totalVoters,
        admins:           totalAdmins,
        new_last_30days:  newUsers
      },
      events: {
        total:            totalEvents,
        active:           activeEvents,
        draft:            draftEvents,
        closed:           closedEvents,
        new_last_30days:  newEvents
      },
      finances: {
        total_collected:  Number(finances?.total_collected  || 0),
        total_commission: Number(finances?.total_commission || 0),
        platform_revenue: Number(finances?.total_commission || 0),
        pending_withdrawals: {
          count:  pendingWithdrawals,
          amount: pendingWithdrawalsAmount || 0
        }
      },
      votes: { total: totalVotes || 0 },
      timestamp: new Date()
    });

  } catch (error) {
    console.error('Erreur getDashboard:', error.message);
    res.status(500).json({ error: error.message });
  }
};


// ==================== GESTION UTILISATEURS ====================

exports.getUsers = async (req, res) => {
  try {
    const { page = 1, limit = 20, role, search, verified } = req.query;
    const offset = (page - 1) * parseInt(limit);

    const where = {};
    if (role)                     where.role        = role;
    if (verified !== undefined)   where.is_verified = verified === 'true';

    if (search) {
      where[Op.or] = [
        { email:     { [Op.iLike]: `%${search}%` } },
        { full_name: { [Op.iLike]: `%${search}%` } },
        { phone:     { [Op.iLike]: `%${search}%` } }
      ];
    }

    const users = await User.findAndCountAll({
      where,
      attributes: { exclude: ['password_hash'] },
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset
    });

    res.json({
      total:      users.count,
      page:       parseInt(page),
      totalPages: Math.ceil(users.count / parseInt(limit)),
      users:      users.rows
    });

  } catch (error) {
    console.error('Erreur getUsers:', error.message);
    res.status(500).json({ error: error.message });
  }
};


exports.getUserDetails = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findByPk(userId, {
      attributes: { exclude: ['password_hash'] },
      include: [
        {
          model: Event,
          as: 'events',
          limit: 10,
          order: [['created_at', 'DESC']],
          required: false
        },
        {
          model: Withdrawal,
          as: 'withdrawals',
          limit: 10,
          order: [['requested_at', 'DESC']],
          required: false
        }
      ]
    });

    if (!user) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    // ✅ Sous-requête sûre — pas de SQL literal avec variable utilisateur
    const userEvents = await Event.findAll({
      where: { organizer_id: userId },
      attributes: ['id'],
      raw: true
    });
    const eventIds = userEvents.map(e => e.id);

    const [totalEvents, totalCollected, totalWithdrawn] = await Promise.all([
      Event.count({ where: { organizer_id: userId } }),
      eventIds.length > 0
        ? Payment.sum('amount_fcfa', {
            where: { event_id: { [Op.in]: eventIds }, status: 'success' }
          })
        : 0,
      Withdrawal.sum('amount_fcfa', {
        where: { organizer_id: userId, status: 'done' }
      })
    ]);

    res.json({
      user,
      stats: {
        total_events:    totalEvents,
        total_collected: totalCollected  || 0,
        total_withdrawn: totalWithdrawn  || 0,
        current_balance: user.balance_fcfa
      }
    });

  } catch (error) {
    console.error('Erreur getUserDetails:', error.message);
    res.status(500).json({ error: error.message });
  }
};


exports.updateUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { role, is_verified, balance_fcfa, full_name, email, phone } = req.body;

    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    const updates = {};
    if (role          !== undefined) updates.role          = role;
    if (is_verified   !== undefined) updates.is_verified   = is_verified;
    if (balance_fcfa  !== undefined) updates.balance_fcfa  = balance_fcfa;
    if (full_name     !== undefined) updates.full_name     = full_name;
    if (email         !== undefined) updates.email         = email;
    if (phone         !== undefined) updates.phone         = phone;

    await user.update(updates);

    res.json({
      message: 'Utilisateur mis à jour avec succès',
      user: {
        id:          user.id,
        email:       user.email,
        full_name:   user.full_name,
        role:        user.role,
        is_verified: user.is_verified,
        balance:     user.balance_fcfa
      }
    });

  } catch (error) {
    console.error('Erreur updateUser:', error.message);
    res.status(500).json({ error: error.message });
  }
};


exports.deleteUser = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const { userId } = req.params;

    if (userId === req.user.id) {
      await t.rollback();
      return res.status(400).json({ error: 'Vous ne pouvez pas supprimer votre propre compte' });
    }

    const user = await User.findByPk(userId, { transaction: t });
    if (!user) {
      await t.rollback();
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    await user.destroy({ transaction: t });
    await t.commit();

    res.json({ message: 'Utilisateur supprimé avec succès' });

  } catch (error) {
    await t.rollback();
    console.error('Erreur deleteUser:', error.message);
    res.status(500).json({ error: error.message });
  }
};


// ==================== GESTION ÉVÉNEMENTS ====================

exports.getAllEvents = async (req, res) => {
  try {
    const { page = 1, limit = 20, status, search } = req.query;
    const offset = (page - 1) * parseInt(limit);

    const where = {};
    if (status) where.status = status;
    if (search) {
      where[Op.or] = [
        { title:       { [Op.iLike]: `%${search}%` } },
        { description: { [Op.iLike]: `%${search}%` } }
      ];
    }

    const events = await Event.findAndCountAll({
      where,
      include: [{
        model: User,
        as: 'organizer',       // ✅ alias correct
        attributes: ['id', 'full_name', 'email']
      }],
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset
    });

    res.json({
      total:      events.count,
      page:       parseInt(page),
      totalPages: Math.ceil(events.count / parseInt(limit)),
      events:     events.rows
    });

  } catch (error) {
    console.error('Erreur getAllEvents:', error.message);
    res.status(500).json({ error: error.message });
  }
};


exports.updateEvent = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { status, commission_rate, vote_price_fcfa } = req.body;

    const event = await Event.findByPk(eventId);
    if (!event) {
      return res.status(404).json({ error: 'Événement non trouvé' });
    }

    const updates = {};
    if (status          !== undefined) updates.status          = status;
    if (commission_rate !== undefined) updates.commission_rate = commission_rate;
    if (vote_price_fcfa !== undefined) updates.vote_price_fcfa = vote_price_fcfa;

    await event.update(updates);

    res.json({ message: 'Événement mis à jour', event });

  } catch (error) {
    console.error('Erreur admin updateEvent:', error.message);
    res.status(500).json({ error: error.message });
  }
};


// ==================== GESTION RETRAITS ====================

exports.getWithdrawals = async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const offset = (page - 1) * parseInt(limit);

    const where = {};
    if (status) where.status = status;

    const withdrawals = await Withdrawal.findAndCountAll({
      where,
      include: [
        {
          model: User,
          as: 'organizer',     // ✅ alias correct
          attributes: ['id', 'full_name', 'email', 'phone']
        },
        {
          model: Event,
          as: 'event',         // ✅ alias correct
          attributes: ['id', 'title'],
          required: false
        }
      ],
      order: [['requested_at', 'DESC']],
      limit: parseInt(limit),
      offset
    });

    // ✅ COUNT corrigé
    const stats = await Withdrawal.findAll({
      attributes: [
        'status',
        [sequelize.fn('COUNT', sequelize.col('Withdrawal.id')), 'count'],
        [sequelize.fn('SUM',   sequelize.col('amount_fcfa')),   'total']
      ],
      group: ['status'],
      raw: true
    });

    res.json({
      total:       withdrawals.count,
      page:        parseInt(page),
      totalPages:  Math.ceil(withdrawals.count / parseInt(limit)),
      withdrawals: withdrawals.rows,
      stats: stats.reduce((acc, s) => {
        acc[s.status] = {
          count: parseInt(s.count),
          total: parseInt(s.total || 0)
        };
        return acc;
      }, {})
    });

  } catch (error) {
    console.error('Erreur getWithdrawals:', error.message);
    res.status(500).json({ error: error.message });
  }
};


exports.processWithdrawal = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const { withdrawalId } = req.params;
    const { action, rejection_reason, transaction_ref } = req.body;

    if (!['approve', 'reject'].includes(action)) {
      await t.rollback();
      return res.status(400).json({ error: 'Action invalide — approve ou reject' });
    }

    const withdrawal = await Withdrawal.findByPk(withdrawalId, {
      include: [{
        model: User,
        as: 'organizer',
        attributes: ['id', 'balance_fcfa']
      }],
      transaction: t
    });

    if (!withdrawal) {
      await t.rollback();
      return res.status(404).json({ error: 'Demande de retrait non trouvée' });
    }

    if (withdrawal.status !== 'pending') {
      await t.rollback();
      return res.status(400).json({ error: `Demande déjà traitée (status: ${withdrawal.status})` });
    }

    if (action === 'approve') {
      await withdrawal.update({
        status:          'done',
        processed_by:    req.user.id,
        processed_at:    new Date(),
        completed_at:    new Date(),
        transaction_ref: transaction_ref || null
      }, { transaction: t });

    } else {
      // Rejeter → rembourser le solde
      await User.increment(
        { balance_fcfa: withdrawal.amount_fcfa },
        { where: { id: withdrawal.organizer_id }, transaction: t }
      );

      await withdrawal.update({
        status:            'rejected',
        processed_by:      req.user.id,
        processed_at:      new Date(),
        rejection_reason:  rejection_reason || 'Demande rejetée par l\'administrateur'
      }, { transaction: t });
    }

    await t.commit();

    res.json({
      message:    `Retrait ${action === 'approve' ? 'approuvé' : 'rejeté'} avec succès`,
      withdrawal
    });

  } catch (error) {
    await t.rollback();
    console.error('Erreur processWithdrawal:', error.message);
    res.status(500).json({ error: error.message });
  }
};


// ==================== STATISTIQUES GLOBALES ====================

exports.getPlatformStats = async (req, res) => {
  try {
    const { period = 'month' } = req.query;

    const now = new Date();
    let startDate;

    switch (period) {
      case 'week':  startDate = new Date(now.setDate(now.getDate() - 7));         break;
      case 'year':  startDate = new Date(now.setFullYear(now.getFullYear() - 1)); break;
      default:      startDate = new Date(now.setMonth(now.getMonth() - 1));
    }

    const [newUsers, newEvents, payments] = await Promise.all([
      User.count({  where: { created_at: { [Op.gte]: startDate } } }),
      Event.count({ where: { created_at: { [Op.gte]: startDate } } }),
      Payment.findOne({
        where: { status: 'success', created_at: { [Op.gte]: startDate } },
        attributes: [
          [sequelize.fn('SUM', sequelize.col('amount_fcfa')),       'total'],
          [sequelize.fn('SUM', sequelize.col('commission_amount')), 'commission']
        ],
        raw: true
      })
    ]);

    // Top organisateurs — ✅ COUNT corrigé + alias correct
    const topOrganizers = await Event.findAll({
      attributes: [
        'organizer_id',
        [sequelize.fn('COUNT', sequelize.col('Event.id')),          'event_count'], // ✅
        [sequelize.fn('SUM',   sequelize.col('total_collected')),   'total_revenue']
      ],
      include: [{
        model: User,
        as: 'organizer',       // ✅ alias correct
        attributes: ['id', 'full_name', 'email']
      }],
      group: ['Event.organizer_id', 'organizer.id'],
      order: [[sequelize.fn('SUM', sequelize.col('total_collected')), 'DESC']],
      limit: 5
    });

    res.json({
      period,
      start_date: startDate,
      end_date:   new Date(),
      metrics: {
        new_users:  newUsers,
        new_events: newEvents,
        revenue: {
          total:      Number(payments?.total      || 0),
          commission: Number(payments?.commission || 0)
        }
      },
      top_organizers: topOrganizers
    });

  } catch (error) {
    console.error('Erreur getPlatformStats:', error.message);
    res.status(500).json({ error: error.message });
  }
};