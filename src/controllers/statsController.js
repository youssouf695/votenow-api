const { Event, Candidate, Payment, Vote, User } = require('../models');
const sequelize = require('../config/database'); // ✅ import direct
const { Op } = require('sequelize');


// ==================== ANALYTICS PAR ÉVÉNEMENT ====================
exports.getEventAnalytics = async (req, res) => {
  try {
    const { eventId } = req.params;

    const event = await Event.findOne({
      where: { id: eventId, organizer_id: req.user.id }
    });

    if (!event) {
      return res.status(403).json({ error: 'Accès non autorisé' });
    }

    // 1. Stats générales depuis payments
    const payments = await Payment.findAll({
      where: { event_id: eventId, status: 'success' },
      raw: true
    });

    const totalVotes     = payments.reduce((sum, p) => sum + p.votes_count, 0);
    const totalCollected = payments.reduce((sum, p) => sum + p.amount_fcfa, 0);
    const totalCommission = payments.reduce((sum, p) => sum + p.commission_amount, 0);
    const uniqueVoters   = new Set(payments.map(p => p.voter_phone)).size;

    // 2. Répartition par méthode de paiement
    const paymentMethods = await Payment.findAll({
      where: { event_id: eventId, status: 'success' },
      attributes: [
        'method',
        [sequelize.fn('COUNT', sequelize.col('Payment.id')), 'count'], // ✅
        [sequelize.fn('SUM', sequelize.col('amount_fcfa')), 'total']
      ],
      group: ['method'],
      raw: true
    });

    // 3. Votes par heure (dernières 24h)
    const last24h = new Date();
    last24h.setHours(last24h.getHours() - 24);

    const hourlyVotes = await Vote.findAll({
      where: {
        event_id: eventId,
        created_at: { [Op.gte]: last24h }
      },
      attributes: [
        [sequelize.fn('DATE_TRUNC', 'hour', sequelize.col('Vote.created_at')), 'hour'],
        [sequelize.fn('COUNT', sequelize.col('Vote.id')), 'votes']         // ✅
      ],
      group: [sequelize.fn('DATE_TRUNC', 'hour', sequelize.col('Vote.created_at'))],
      order: [[sequelize.fn('DATE_TRUNC', 'hour', sequelize.col('Vote.created_at')), 'ASC']],
      raw: true
    });

    // 4. Top votants
    const topVoters = await Payment.findAll({
      where: { event_id: eventId, status: 'success' },
      attributes: [
        'voter_phone',
        [sequelize.fn('COUNT', sequelize.col('Payment.id')), 'payments_count'], // ✅
        [sequelize.fn('SUM', sequelize.col('votes_count')), 'total_votes'],
        [sequelize.fn('SUM', sequelize.col('amount_fcfa')), 'total_spent']
      ],
      group: ['voter_phone'],
      order: [[sequelize.fn('SUM', sequelize.col('votes_count')), 'DESC']],
      limit: 10,
      raw: true
    });

    res.json({
      event: { id: event.id, title: event.title, status: event.status },
      summary: {
        total_votes:               totalVotes,
        total_collected:           totalCollected,
        total_commission:          totalCommission,
        net_revenue:               totalCollected - totalCommission,
        unique_voters:             uniqueVoters,
        average_votes_per_voter:   uniqueVoters > 0
          ? (totalVotes / uniqueVoters).toFixed(2) : 0
      },
      charts: {
        payment_methods: paymentMethods,
        hourly_activity: hourlyVotes,
        top_voters:      topVoters
      }
    });

  } catch (error) {
    console.error('Erreur getEventAnalytics:', error.message);
    res.status(500).json({ error: error.message });
  }
};


// ==================== RAPPORT DE REVENUS ====================
exports.getRevenueReport = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const eventWhere = { organizer_id: req.user.id };
    if (startDate && endDate) {
      eventWhere.created_at = {
        [Op.between]: [new Date(startDate), new Date(endDate)]
      };
    }

    const events = await Event.findAll({
      where: eventWhere,
      include: [{
        model: Payment,
        as: 'payments',        // ✅ alias correct
        where: { status: 'success' },
        required: false,
        attributes: []
      }],
      attributes: [
        'id', 'title', 'status', 'created_at',
        // ✅ alias lowercase 'payments' au lieu de 'Payments'
        [sequelize.fn('COUNT', sequelize.col('payments.id')), 'payments_count'],
        [sequelize.fn('SUM',   sequelize.col('payments.amount_fcfa')), 'total_collected'],
        [sequelize.fn('SUM',   sequelize.col('payments.commission_amount')), 'total_commission'],
        [sequelize.fn('SUM',   sequelize.col('payments.votes_count')), 'total_votes']
      ],
      group: ['Event.id'],
      order: [['created_at', 'DESC']]
    });

    const totals = events.reduce((acc, e) => {
      acc.total_collected  += Number(e.dataValues.total_collected  || 0);
      acc.total_commission += Number(e.dataValues.total_commission || 0);
      acc.total_votes      += Number(e.dataValues.total_votes      || 0);
      return acc;
    }, { total_collected: 0, total_commission: 0, total_votes: 0 });

    res.json({
      period: {
        start: startDate || 'toujours',
        end:   endDate   || 'maintenant'
      },
      summary: {
        ...totals,
        net_revenue:   totals.total_collected - totals.total_commission,
        events_count:  events.length
      },
      events
    });

  } catch (error) {
    console.error('Erreur getRevenueReport:', error.message);
    res.status(500).json({ error: error.message });
  }
};