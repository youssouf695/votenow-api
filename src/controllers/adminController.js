const { User, Event, Payment, Withdrawal, Vote, Candidate, Commission, KpayOperation } = require('../models');
const sequelize = require('../config/database'); // ✅ import direct
const { Op } = require('sequelize');
const { validationResult } = require('express-validator');
const { postWithdrawal } = require('../services/withdrawalJournal');
const { changeLocked: changeCommissionLocked } = require('../services/campaignCommission');
const { campaignVotePrice } = require('../services/campaignVotePrice');


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
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
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
      order: [['created_at', 'DESC'], ['id', 'DESC']],
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

exports.updateUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { role, is_verified, balance_fcfa, full_name, email, phone, password } = req.body;

    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    const updates = {};
    if (role !== undefined) updates.role = role;
    if (is_verified !== undefined) updates.is_verified = is_verified;
    if (balance_fcfa !== undefined) updates.balance_fcfa = balance_fcfa;
    if (full_name !== undefined) updates.full_name = full_name;
    if (email !== undefined) updates.email = email;
    if (phone !== undefined) updates.phone = phone;
    
    // Si un nouveau mot de passe est fourni, le hasher
    if (password !== undefined && password.trim() !== '') {
      const bcrypt = require('bcryptjs');
      updates.password_hash = await bcrypt.hash(password, 10);
    }

    await user.update(updates);

    res.json({
      message: 'Utilisateur mis à jour avec succès',
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        is_verified: user.is_verified,
        balance: user.balance_fcfa
      }
    });
  } catch (error) {
    console.error('Erreur updateUser:', error);
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
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const { page = 1, limit = 20, status, search, organizer_id, archived } = req.query;
    const offset = (page - 1) * parseInt(limit);

    const where = {};
    if (status) where.status = status;
    if (organizer_id) where.organizer_id = organizer_id;
    if (archived === 'true') where.archived_at = { [Op.ne]: null };
    if (archived === 'false') where.archived_at = null;
    if (search) {
      where[Op.or] = [
        { title:       { [Op.iLike]: `%${search}%` } },
        { slug:        { [Op.iLike]: `%${search}%` } },
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
      order: [['created_at', 'DESC'], ['id', 'DESC']],
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

exports.getEventDetails = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    const event = await Event.findByPk(req.params.eventId, {
      attributes: ['id', 'organizer_id', 'slug', 'title', 'description', 'status', 'archived_at', 'created_at',
        'starts_at', 'ends_at', 'vote_price_fcfa', 'total_votes', 'total_collected'],
      include: [{ model: User, as: 'organizer', attributes: ['id', 'full_name', 'email'] }]
    });
    if (!event) return res.status(404).json({ error: 'Campagne introuvable' });
    return res.set('Cache-Control', 'no-store').json({ event });
  } catch (error) {
    console.error('Erreur détail campagne admin', { code: error.original?.code });
    return res.status(503).json({ error: 'Campagne temporairement indisponible' });
  }
};

exports.updateEvent = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { status, commission_rate, vote_price_fcfa, commission_reason, reason } = req.body;
    const event = await sequelize.transaction(async transaction => {
      const locked = await Event.findByPk(eventId, {transaction, lock: transaction.LOCK.UPDATE});
      const fail = (message, status) => Object.assign(new Error(message), {status});
      if (!locked) throw fail('Événement non trouvé',404);
      if (locked.archived_at) throw fail('Campagne archivée : historique conservé, modification interdite.',409);
      if (status === 'draft' && locked.status !== 'draft') {
        throw fail('Une campagne déjà publiée peut être mise en pause ou clôturée, pas remise en création.',409);
      }
      if (status === 'active') {
        const [unfinished] = await sequelize.query('SELECT event_id FROM campaign_setups WHERE event_id=:id AND published_at IS NULL',{
          replacements:{id:locked.id},transaction
        });
        if (unfinished.length) throw fail('Le parcours de création doit être terminé avant publication.',409);
        if (locked.status === 'draft') throw fail('La publication doit être effectuée par le parcours de création de la campagne.',409);
      }
      const updates = {};
      if (status !== undefined) updates.status = status;
      if (vote_price_fcfa !== undefined) {
        const price = campaignVotePrice(vote_price_fcfa, locked.vote_price_fcfa);
        if (price !== locked.vote_price_fcfa) updates.vote_price_fcfa = price;
      }
      if (commission_rate !== undefined) {
        await changeCommissionLocked(locked,req.user,{commission_rate,reason:commission_reason??reason},transaction);
      }
      await locked.update(updates,{transaction});
      return locked;
    });
    return res.json({ message: 'Événement mis à jour', event });
  } catch (error) {
    if (error.status) return res.status(error.status).json({error:error.message});
    console.error('Erreur admin updateEvent:', error.message);
    return res.status(500).json({ error: error.message });
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
      order: [['requested_at', 'DESC'], ['id', 'DESC']],
      limit: parseInt(limit),
      offset
    });

    const withdrawalIds = withdrawals.rows.map(row => row.id);
    const [stats, operations] = await Promise.all([Withdrawal.findAll({
      attributes: [
        'status',
        [sequelize.fn('COUNT', sequelize.col('Withdrawal.id')), 'count'],
        [sequelize.fn('SUM',   sequelize.col('amount_fcfa')),   'total']
      ],
      group: ['status'],
      raw: true
    }), withdrawalIds.length ? KpayOperation.findAll({
      where: { kind: 'PAYOUT', domain_id: { [Op.in]: withdrawalIds } },
      attributes: ['domain_id', 'status', 'provider_reference'],
      raw: true
    }) : []]);
    const operationsByWithdrawal = new Map(operations.map(operation => [operation.domain_id, operation]));

    res.json({
      total:       withdrawals.count,
      page:        parseInt(page),
      totalPages:  Math.ceil(withdrawals.count / parseInt(limit)),
      withdrawals: withdrawals.rows.map(row => {
        const operation = operationsByWithdrawal.get(row.id);
        return { ...row.toJSON(), provider_status: operation?.status ?? null, provider_reference: operation?.provider_reference ?? null };
      }),
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
  const { KpayOperation } = require('../models');
  const { payoutQuote, dispatch, hash, failure } = require('../services/kpayOperations');
  const { normalizePhone } = require('../services/kpayAmounts');
  const { getConfig } = require('../config/kpay');
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const { action, rejection_reason } = req.body;
    if (!['approve', 'reject'].includes(action)) throw failure('Action invalide');
    const snapshot = await Withdrawal.findByPk(req.params.withdrawalId);
    if (!snapshot) throw failure('Demande introuvable', 404);
    if (action === 'approve' && snapshot.status === 'processing') {
      const operation = await KpayOperation.findOne({ where: { kind: 'PAYOUT', domain_id: snapshot.id } });
      if (!operation) throw failure('Opération KPay introuvable pour ce retrait.', 409);
      if (operation.status === 'CREATED') await dispatch(operation.id);
      const withdrawal = await Withdrawal.findByPk(snapshot.id);
      return res.json({ message: withdrawal.status === 'done' ? 'Retrait confirmé.' : withdrawal.status === 'rejected' ? 'Transfert refusé. Montant restitué.' : 'Transfert déjà en cours de vérification.', withdrawal });
    }
    if (snapshot.status !== 'pending') throw failure('Demande déjà traitée', 409);
    const config = action === 'approve' ? getConfig() : null;
    const quote = action === 'approve' ? await payoutQuote(snapshot) : null;
    const operationId = await sequelize.transaction(async transaction => {
      const lock = { transaction, lock: transaction.LOCK.UPDATE };
      if (action === 'reject') {
        // Match organizer cancellation: lock the balance owner before the pending withdrawal.
        await User.findByPk(snapshot.organizer_id, lock);
      }
      const withdrawal = action === 'reject'
        ? await Withdrawal.findOne({ where: { id: snapshot.id, organizer_id: snapshot.organizer_id, status: 'pending' }, ...lock })
        : await Withdrawal.findByPk(snapshot.id, lock);
      if (withdrawal?.status !== 'pending') throw failure('Demande déjà traitée', 409);
      if (withdrawal.amount_fcfa !== snapshot.amount_fcfa || withdrawal.method !== snapshot.method || withdrawal.destination_phone !== snapshot.destination_phone) throw failure('Demande modifiée. Actualisez.', 409);
      if (action === 'reject') {
        await postWithdrawal(withdrawal, 'release', 'admin_reject', transaction);
        await withdrawal.update({ status: 'rejected', processed_by: req.user.id, processed_at: new Date(), rejection_reason: rejection_reason || 'Demande rejetée par l’administrateur' }, { transaction });
        return null;
      }
      const externalId = `vn-w-${withdrawal.id}`;
      const phone = normalizePhone(withdrawal.destination_phone);
      const provider = quote.network || { mtn_momo: 'MTN_MOMO_CMR', orange_money: 'ORANGE_CMR' }[withdrawal.method];
      const operation = await KpayOperation.create({ kind: 'PAYOUT', domain_id: withdrawal.id, request_key: withdrawal.id,
        external_id: externalId, fingerprint: hash([withdrawal.id, withdrawal.amount_fcfa, phone, provider]),
        environment: config.mode, status: 'CREATED', expected_amount: quote.gross, target_net: quote.policy === 'votenow_pays_v1' ? quote.net : withdrawal.amount_fcfa, pricing_snapshot: quote,
        request_payload: { amount: quote.gross, provider, phoneNumber: phone, sourceCountry: 'CMR', externalId,
          description: 'Reversement VoteNow', metadata: { withdrawalId: withdrawal.id } },
      }, { transaction });
      await withdrawal.update({ status: 'processing', processed_by: req.user.id, processed_at: new Date() }, { transaction });
      return operation.id;
    });
    if (operationId) await dispatch(operationId);
    const withdrawal = await Withdrawal.findByPk(snapshot.id);
    return res.json({ message: action === 'reject' ? 'Demande rejetée. Montant restitué.' : withdrawal.status === 'done' ? 'Retrait confirmé.' : withdrawal.status === 'rejected' ? 'Transfert refusé. Montant restitué.' : 'Demande transmise. Confirmation en attente.', withdrawal });
  } catch (error) { return res.status(error.status || 503).json({ error: error.status ? error.message : 'Traitement indisponible. Actualisez avant toute nouvelle action.' }); }
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
