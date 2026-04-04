const { Vote, Candidate, Event, Payment, User } = require('../models');
const sequelize = require('../config/database'); // ✅ import direct
const { Op } = require('sequelize');
const { Parser } = require('json2csv');


// ==================== ROUTES PUBLIQUES ====================

// Classement + derniers votes en direct
exports.getLiveVotes = async (req, res) => {
  try {
    const { eventId } = req.params;

    const event = await Event.findByPk(eventId, {
      attributes: ['id', 'title', 'show_results', 'status']
    });

    if (!event) {
      return res.status(404).json({ error: 'Événement non trouvé' });
    }

    const [ranking, recentVotes, totalVotes] = await Promise.all([
      Candidate.findAll({
        where: { event_id: eventId, is_active: true },
        attributes: ['id', 'name', 'number', 'photo_url', 'vote_count'],
        order: [['vote_count', 'DESC']],
        limit: 10
      }),
      Vote.findAll({
        where: { event_id: eventId },
        include: [{
          model: Candidate,
          as: 'candidate',       // ✅ alias correct
          attributes: ['id', 'name', 'photo_url']
        }],
        order: [['created_at', 'DESC']],
        limit: 20
      }),
      Vote.sum('quantity', { where: { event_id: eventId } })
    ]);

    res.json({
      event: { id: event.id, title: event.title },
      live: {
        total_votes:  totalVotes || 0,
        last_update:  new Date()
      },
      ranking,
      recent: recentVotes.map(v => ({
        id:        v.id,
        candidate: v.candidate?.name || 'Inconnu',
        quantity:  v.quantity,
        time:      v.created_at
      }))
    });

  } catch (error) {
    console.error('Erreur getLiveVotes:', error.message);
    res.status(500).json({ error: error.message });
  }
};


// Classement seul
exports.getRanking = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { limit = 10 } = req.query;

    const [ranking, totalVotes] = await Promise.all([
      Candidate.findAll({
        where: { event_id: eventId, is_active: true },
        attributes: ['id', 'name', 'number', 'photo_url', 'vote_count'],
        order: [['vote_count', 'DESC']],
        limit: parseInt(limit)
      }),
      Vote.sum('quantity', { where: { event_id: eventId } })
    ]);

    res.json({
      event_id:    eventId,
      total_votes: totalVotes || 0,
      ranking:     ranking.map((c, i) => ({ ...c.toJSON(), rank: i + 1 }))
    });

  } catch (error) {
    console.error('Erreur getRanking:', error.message);
    res.status(500).json({ error: error.message });
  }
};


// Derniers votes
exports.getRecentVotes = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { limit = 20 } = req.query;

    const recentVotes = await Vote.findAll({
      where: { event_id: eventId },
      include: [{
        model: Candidate,
        as: 'candidate',         // ✅ alias correct
        attributes: ['id', 'name', 'photo_url']
      }],
      order: [['created_at', 'DESC']],
      limit: parseInt(limit)
    });

    res.json({
      event_id: eventId,
      count:    recentVotes.length,
      votes:    recentVotes.map(v => ({
        id:        v.id,
        candidate: v.candidate?.name || 'Inconnu',
        quantity:  v.quantity,
        time:      v.created_at
      }))
    });

  } catch (error) {
    console.error('Erreur getRecentVotes:', error.message);
    res.status(500).json({ error: error.message });
  }
};


// Vérifier si un numéro a déjà voté
exports.checkVoter = async (req, res) => {
  try {
    const { eventId, phone } = req.params;

    const votes = await Vote.findAll({
      where: { event_id: eventId },
      include: [{
        model: Payment,
        as: 'payment',           // ✅ alias correct
        where: { voter_phone: phone, status: 'success' },
        required: true,
        attributes: ['id', 'voter_phone', 'amount_fcfa']
      }],
      order: [['created_at', 'ASC']]
    });

    const totalQuantity = votes.reduce((sum, v) => sum + v.quantity, 0);

    res.json({
      event_id:       eventId,
      phone,
      has_voted:      votes.length > 0,
      votes_count:    votes.length,
      total_quantity: totalQuantity,
      first_vote:     votes.length > 0 ? votes[0].created_at : null
    });

  } catch (error) {
    console.error('Erreur checkVoter:', error.message);
    res.status(500).json({ error: error.message });
  }
};
// Version publique des stats (sans auth)
exports.getPublicEventStats = async (req, res) => {
  try {
    const { eventId } = req.params;

    // Vérifier que l'événement existe et est public
    const event = await Event.findOne({
      where: { 
        id: eventId,
        status: 'active'
      }
    });

    if (!event) {
      return res.status(404).json({ error: 'Événement non trouvé' });
    }

    // Stats basiques
    const totalVotes = await Vote.sum('quantity', { where: { event_id: eventId } });
    const uniqueVoters = await Payment.count({
      where: { event_id: eventId, status: 'success' },
      distinct: true,
      col: 'voter_phone'
    });

    res.json({
      summary: {
        total_votes: totalVotes || 0,
        unique_voters: uniqueVoters || 0
      }
    });
  } catch (error) {
    console.error('Erreur getPublicEventStats:', error);
    res.status(500).json({ error: error.message });
  }
};

// ==================== ROUTES PROTÉGÉES ====================

// Stats détaillées d'un événement
exports.getEventStats = async (req, res) => {
  try {
    const { eventId } = req.params;

    const event = await Event.findOne({
      where: { id: eventId, organizer_id: req.user.id }
    });

    if (!event && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Accès non autorisé' });
    }

    const [totalVotes, totalPayments, uniqueVoters] = await Promise.all([
      Vote.sum('quantity', { where: { event_id: eventId } }),
      Payment.count({ where: { event_id: eventId, status: 'success' } }),
      Payment.count({
        where: { event_id: eventId, status: 'success' },
        distinct: true,
        col: 'voter_phone'
      })
    ]);

    const candidatesStats = await Candidate.findAll({
      where: { event_id: eventId },
      attributes: ['id', 'name', 'number', 'photo_url', 'vote_count'],
      order: [['vote_count', 'DESC']]
    });

    const topVoters = await Payment.findAll({
      where: { event_id: eventId, status: 'success' },
      attributes: [
        'voter_phone',
        [sequelize.fn('COUNT', sequelize.col('Payment.id')), 'payments_count'], // ✅
        [sequelize.fn('SUM', sequelize.col('votes_count')),  'total_votes']
      ],
      group: ['voter_phone'],
      order: [[sequelize.fn('SUM', sequelize.col('votes_count')), 'DESC']],
      limit: 10,
      raw: true
    });

    const tv = totalVotes || 0;
    const uv = uniqueVoters || 0;

    res.json({
      event: { id: event?.id, title: event?.title },
      summary: {
        total_votes:             tv,
        total_payments:          totalPayments,
        unique_voters:           uv,
        average_votes_per_voter: uv > 0 ? (tv / uv).toFixed(2) : 0
      },
      candidates: candidatesStats,
      top_voters:  topVoters
    });

  } catch (error) {
    console.error('Erreur getEventStats:', error.message);
    res.status(500).json({ error: error.message });
  }
};



// Export CSV / JSON
exports.exportVotes = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { format = 'json' } = req.query;

    const event = await Event.findOne({
      where: { id: eventId, organizer_id: req.user.id }
    });

    if (!event && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Accès non autorisé' });
    }

    const votes = await Vote.findAll({
      where: { event_id: eventId },
      include: [
        { model: Candidate, as: 'candidate', attributes: ['name', 'number'] }, // ✅
        { model: Payment,   as: 'payment',   attributes: ['voter_phone', 'amount_fcfa', 'method'] } // ✅
      ],
      order: [['created_at', 'DESC']]
    });

    const formattedVotes = votes.map(v => ({
      id:               v.id,
      date:             v.created_at,
      candidate:        v.candidate?.name,
      candidate_number: v.candidate?.number,
      quantity:         v.quantity,
      voter_phone:      v.payment?.voter_phone,
      amount:           v.payment?.amount_fcfa,
      payment_method:   v.payment?.method
    }));

    if (format === 'csv') {
      const parser = new Parser();
      const csv    = parser.parse(formattedVotes);
      res.header('Content-Type', 'text/csv');
      res.attachment(`votes_${event?.slug || eventId}_${Date.now()}.csv`);
      return res.send(csv);
    }

    res.json({
      event: event?.title,
      total: votes.length,
      votes: formattedVotes
    });

  } catch (error) {
    console.error('Erreur exportVotes:', error.message);
    res.status(500).json({ error: error.message });
  }
};


// Évolution des votes dans le temps
exports.getVoteTimeline = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { interval = 'day', days = 30 } = req.query;

    const since = new Date();
    since.setDate(since.getDate() - parseInt(days));

    const truncUnit = ['hour', 'day', 'week'].includes(interval) ? interval : 'day';
    const groupBy   = sequelize.fn('DATE_TRUNC', truncUnit, sequelize.col('Vote.created_at'));

    const timeline = await Vote.findAll({
      where: {
        event_id:   eventId,
        created_at: { [Op.gte]: since }
      },
      attributes: [
        [groupBy, 'period'],
        [sequelize.fn('COUNT', sequelize.col('Vote.id')), 'vote_count'],  // ✅
        [sequelize.fn('SUM',   sequelize.col('quantity')), 'total_quantity']
      ],
      group:  [groupBy],
      order:  [[groupBy, 'ASC']],
      raw: true
    });

    res.json({
      event_id: eventId,
      interval,
      days:     parseInt(days),
      data:     timeline.map(t => ({
        period:        t.period,
        votes:         parseInt(t.vote_count),
        quantity:      parseInt(t.total_quantity || 0)
      }))
    });

  } catch (error) {
    console.error('Erreur getVoteTimeline:', error.message);
    res.status(500).json({ error: error.message });
  }
};


// Répartition des votes par candidat
exports.getVotesByCandidate = async (req, res) => {
  try {
    const { eventId } = req.params;

    const stats = await Vote.findAll({
      where: { event_id: eventId },
      attributes: [
        'candidate_id',
        [sequelize.fn('COUNT', sequelize.col('Vote.id')), 'votes_count'],    // ✅
        [sequelize.fn('SUM',   sequelize.col('quantity')), 'total_quantity']
      ],
      include: [{
        model: Candidate,
        as: 'candidate',           // ✅ alias correct
        attributes: ['name', 'number', 'photo_url']
      }],
      group: ['Vote.candidate_id', 'candidate.id'],
      order: [[sequelize.fn('SUM', sequelize.col('quantity')), 'DESC']]
    });

    const total = stats.reduce((sum, s) => sum + parseInt(s.dataValues.total_quantity || 0), 0);

    res.json({
      event_id:    eventId,
      total_votes: total,
      candidates:  stats.map(s => ({
        candidate:     s.candidate,
        votes_count:   parseInt(s.dataValues.votes_count),
        total_quantity:parseInt(s.dataValues.total_quantity || 0),
        percentage:    total > 0
          ? ((parseInt(s.dataValues.total_quantity) / total) * 100).toFixed(2) + '%'
          : '0%'
      }))
    });

  } catch (error) {
    console.error('Erreur getVotesByCandidate:', error.message);
    res.status(500).json({ error: error.message });
  }
};


// Stats horaires (heatmap)
exports.getHourlyStats = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { days = 7 } = req.query;

    const since = new Date();
    since.setDate(since.getDate() - parseInt(days));

    const hourlyStats = await Vote.findAll({
      where: { event_id: eventId, created_at: { [Op.gte]: since } },
      attributes: [
        [sequelize.fn('EXTRACT', sequelize.literal('HOUR FROM "Vote"."created_at"')), 'hour'],
        [sequelize.fn('COUNT', sequelize.col('Vote.id')), 'votes_count'],    // ✅
        [sequelize.fn('SUM',   sequelize.col('quantity')), 'total_quantity']
      ],
      group: [sequelize.fn('EXTRACT', sequelize.literal('HOUR FROM "Vote"."created_at"'))],
      order: [[sequelize.literal('hour'), 'ASC']],
      raw: true
    });

    // Tableau complet 0h → 23h
    const fullDay = Array.from({ length: 24 }, (_, i) => {
      const stat = hourlyStats.find(s => parseInt(s.hour) === i);
      return {
        hour:          `${String(i).padStart(2, '0')}h`,
        votes_count:   stat ? parseInt(stat.votes_count)   : 0,
        total_quantity:stat ? parseInt(stat.total_quantity) : 0
      };
    });

    res.json({
      event_id:      eventId,
      days_analyzed: parseInt(days),
      hourly_data:   fullDay
    });

  } catch (error) {
    console.error('Erreur getHourlyStats:', error.message);
    res.status(500).json({ error: error.message });
  }
};


// ==================== ROUTES ADMIN ====================

// Supprimer un vote (admin)
exports.deleteVote = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const { voteId } = req.params;
    const { reason } = req.body;

    const vote = await Vote.findByPk(voteId, {
      include: [{ model: Candidate, as: 'candidate' }], // ✅ alias correct
      transaction: t
    });

    if (!vote) {
      await t.rollback();
      return res.status(404).json({ error: 'Vote non trouvé' });
    }

    await Candidate.decrement(
      { vote_count: vote.quantity },
      { where: { id: vote.candidate_id }, transaction: t }
    );

    console.log(`🗑️ Vote ${voteId} supprimé par admin ${req.user.id}. Raison: ${reason}`);

    await vote.destroy({ transaction: t });
    await t.commit();

    res.json({
      message: 'Vote supprimé avec succès',
      deleted_vote: {
        candidate: vote.candidate?.name,
        quantity:  vote.quantity,
        reason
      }
    });

  } catch (error) {
    await t.rollback();
    console.error('Erreur deleteVote:', error.message);
    res.status(500).json({ error: error.message });
  }
};


// Annuler un vote avec remboursement (admin)
exports.cancelVote = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const { voteId } = req.params;
    const { reason } = req.body;

    const vote = await Vote.findByPk(voteId, {
      include: [
        { model: Candidate, as: 'candidate' }, // ✅ alias correct
        { model: Payment,   as: 'payment'   }  // ✅ alias correct
      ],
      transaction: t
    });

    if (!vote) {
      await t.rollback();
      return res.status(404).json({ error: 'Vote non trouvé' });
    }

    // Décrémenter le compteur du candidat
    await Candidate.decrement(
      { vote_count: vote.quantity },
      { where: { id: vote.candidate_id }, transaction: t }
    );

    // Marquer le paiement comme remboursé
    if (vote.payment) {
      await vote.payment.update({ status: 'refunded' }, { transaction: t });

      // Décréditer le solde de l'organisateur
      const event = await Event.findByPk(vote.event_id, { transaction: t });
      if (event) {
        await User.decrement(
          { balance_fcfa: vote.payment.net_to_organizer },
          { where: { id: event.organizer_id }, transaction: t }
        );
        // Mettre à jour les totaux de l'événement
        await Event.decrement(
          {
            total_votes:     vote.quantity,
            total_collected: vote.payment.amount_fcfa
          },
          { where: { id: vote.event_id }, transaction: t }
        );
      }
    }

    await t.commit();

    res.json({
      message: 'Vote annulé avec succès',
      cancelled_vote: {
        id:        vote.id,
        candidate: vote.candidate?.name,
        quantity:  vote.quantity,
        reason
      }
    });

  } catch (error) {
    await t.rollback();
    console.error('Erreur cancelVote:', error.message);
    res.status(500).json({ error: error.message });
  }
};


// Tous les votes (admin)
exports.getAllVotes = async (req, res) => {
  try {
    const {
      page = 1, limit = 20,
      eventId, candidateId,
      startDate, endDate
    } = req.query;

    const offset = (page - 1) * parseInt(limit);
    const where  = {};

    if (eventId)     where.event_id     = eventId;
    if (candidateId) where.candidate_id = candidateId;
    if (startDate || endDate) {
      where.created_at = {};
      if (startDate) where.created_at[Op.gte] = new Date(startDate);
      if (endDate)   where.created_at[Op.lte] = new Date(endDate);
    }

    const votes = await Vote.findAndCountAll({
      where,
      include: [
        { model: Candidate, as: 'candidate', attributes: ['id', 'name', 'number'] },   // ✅
        { model: Event,     as: 'event',     attributes: ['id', 'title', 'slug'] },    // ✅
        { model: Payment,   as: 'payment',   attributes: ['voter_phone', 'amount_fcfa', 'status'] } // ✅
      ],
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset
    });

    res.json({
      total:      votes.count,
      page:       parseInt(page),
      totalPages: Math.ceil(votes.count / parseInt(limit)),
      votes:      votes.rows
    });

  } catch (error) {
    console.error('Erreur getAllVotes:', error.message);
    res.status(500).json({ error: error.message });
  }
};