const { Payment, Event, Candidate, Vote, User, Commission } = require('../models');
const sequelize = require('../config/database');
const { validationResult } = require('express-validator');
const { Op } = require('sequelize');
const flutterwaveService = require('../services/flutterwave'); // ← Changé
const { v4: uuidv4 } = require('uuid');


// ==================== 1. INITIER UN PAIEMENT ====================
// exports.initiatePayment = async (req, res) => {
//   try {
//     const errors = validationResult(req);
//     if (!errors.isEmpty()) {
//       return res.status(400).json({ errors: errors.array() });
//     }

//     const { event_id, candidate_id, votes_count, voter_phone, voter_name } = req.body;

//     // Vérifier que l'événement est actif
//     const event = await Event.findOne({
//       where: {
//         id: event_id,
//         status: 'active',
//         ends_at: { [Op.gt]: new Date() }
//       }
//     });

//     if (!event) {
//       return res.status(404).json({ error: 'Événement non disponible ou terminé' });
//     }

//     // Vérifier que le candidat existe et est actif
//     const candidate = await Candidate.findOne({
//       where: { id: candidate_id, event_id, is_active: true }
//     });

//     if (!candidate) {
//       return res.status(404).json({ error: 'Candidat non trouvé ou inactif' });
//     }

//     // Calculer les montants
//     const amount = event.vote_price_fcfa * votes_count;
//     const commissionAmt = Math.round(amount * (event.commission_rate / 100));
//     const netToOrganizer = amount - commissionAmt;

//     // Détecter la méthode selon le préfixe du numéro
//     const method = detectMethod(voter_phone);

//     // Générer une référence unique pour Flutterwave
//     const tx_ref = uuidv4();
//     const paymentId = uuidv4();

//     // Créer la transaction en attente
//     const payment = await Payment.create({
//       id: paymentId,
//       event_id,
//       candidate_id,
//       voter_phone,
//       voter_name: voter_name || null,
//       amount_fcfa: amount,
//       votes_count,
//       commission_amount: commissionAmt,
//       net_to_organizer: netToOrganizer,
//       method,
//       status: 'pending',
//       ip_address: req.ip,
//       provider_ref: tx_ref  // Stocker la référence Flutterwave
//     });

//     // ── PRODUCTION : Flutterwave ─────────────────────────────
//     try {
//       const result = await flutterwaveService.initiatePayment({
//         amount,
//         email: `${voter_phone}@votenow.cm`,
//         phoneNumber: voter_phone,
//         fullName: voter_name || 'Votant',
//         tx_ref,
//         redirectUrl: `${process.env.FRONTEND_URL}/payment/status?payment_id=${paymentId}`
//       });

//       // La transaction a été initiée avec succès
//       return res.json({
//         payment_id: payment.id,
//         tx_ref: result.tx_ref,
//         payment_url: result.payment_link,
//         amount,
//         votes_count,
//         candidate: candidate.name,
//         status: 'pending',
//         message: 'Redirection vers la page de paiement...'
//       });

//     } catch (flutterwaveError) {
//       // En cas d'erreur, marquer le paiement comme échoué
//       await payment.update({ status: 'failed' });
//       console.error('❌ Erreur Flutterwave:', flutterwaveError);
//       return res.status(400).json({ 
//         error: flutterwaveError.message || 'Erreur lors de l\'initialisation du paiement' 
//       });
//     }

//   } catch (error) {
//     console.error('Erreur initiatePayment:', error.message);
//     res.status(500).json({ error: error.message });
//   }
// };
exports.initiatePayment = async (req, res) => {
  try {
    const { event_id, candidate_id, votes_count, voter_phone, voter_name } = req.body;

    // Vérifier l'événement
    const event = await Event.findOne({
      where: {
        id: event_id,
        status: 'active',
        ends_at: { [Op.gt]: new Date() }
      }
    });

    if (!event) {
      return res.status(404).json({ error: 'Événement non disponible' });
    }

    // Vérifier le candidat
    const candidate = await Candidate.findOne({
      where: { id: candidate_id, event_id, is_active: true }
    });

    if (!candidate) {
      return res.status(404).json({ error: 'Candidat non trouvé' });
    }

    // Calculer les montants
    const amount = event.vote_price_fcfa * votes_count;
    const commissionAmt = Math.round(amount * (event.commission_rate / 100));
    const netToOrganizer = amount - commissionAmt;

    // Créer le paiement en mode "attente"
    const payment = await Payment.create({
      event_id,
      candidate_id,
      voter_phone,
      voter_name: voter_name || null,
      amount_fcfa: amount,
      votes_count,
      commission_amount: commissionAmt,
      net_to_organizer: netToOrganizer,
      status: 'pending',
      ip_address: req.ip
    });

    // ✅ SIMULATION : traitement automatique après 2 secondes
    setTimeout(async () => {
      await exports.handleSuccessfulPayment(payment.id);
    }, 2000);

    // ✅ Réponse immédiate
    res.json({
      payment_id: payment.id,
      amount,
      votes_count,
      candidate: candidate.name,
      status: 'pending',
      message: 'Vote en cours de traitement (simulation)'
    });

  } catch (error) {
    console.error('Erreur initiatePayment:', error);
    res.status(500).json({ error: error.message });
  }
};


// ==================== 2. TRAITER UN PAIEMENT RÉUSSI ====================
// exports.handleSuccessfulPayment = async (paymentId) => {
//   const t = await sequelize.transaction();

//   try {
//     const payment = await Payment.findByPk(paymentId, {
//       include: [
//         { model: Event,     as: 'event' },
//         { model: Candidate, as: 'candidate' }
//       ],
//       transaction: t
//     });

//     if (!payment) {
//       await t.rollback();
//       console.error(`❌ Payment ${paymentId} introuvable`);
//       return;
//     }

//     if (payment.status !== 'pending') {
//       await t.rollback();
//       console.log(`⚠️ Payment ${paymentId} déjà traité (status: ${payment.status})`);
//       return;
//     }

//     // 1. Marquer le paiement comme réussi
//     await payment.update({ status: 'success' }, { transaction: t });

//     // 2. Créer les votes en bulk
//     const votesData = Array.from({ length: payment.votes_count }, () => ({
//       payment_id: payment.id,
//       candidate_id: payment.candidate_id,
//       event_id: payment.event_id,
//       quantity: 1,
//       ip_address: payment.ip_address
//     }));
//     await Vote.bulkCreate(votesData, { transaction: t });

//     // 3. Incrémenter le compteur du candidat
//     await Candidate.increment(
//       { vote_count: payment.votes_count },
//       { where: { id: payment.candidate_id }, transaction: t }
//     );

//     // 4. Mettre à jour les totaux de l'événement
//     await Event.increment(
//       {
//         total_votes: payment.votes_count,
//         total_collected: payment.amount_fcfa
//       },
//       { where: { id: payment.event_id }, transaction: t }
//     );

//     // 5. Créditer le solde de l'organisateur
//     await User.increment(
//       { balance_fcfa: payment.net_to_organizer },
//       { where: { id: payment.event.organizer_id }, transaction: t }
//     );

//     // 6. Enregistrer la commission
//     await Commission.create({
//       payment_id: payment.id,
//       event_id: payment.event_id,
//       organizer_id: payment.event.organizer_id,
//       amount_fcfa: payment.commission_amount,
//       rate_applied: payment.event.commission_rate,
//       base_amount: payment.amount_fcfa,
//       status: 'pending'
//     }, { transaction: t });

//     await t.commit();
//     console.log(`✅ Paiement ${paymentId} traité — ${payment.votes_count} votes pour ${payment.candidate?.name}`);

//   } catch (error) {
//     await t.rollback();
//     console.error(`❌ Erreur traitement paiement ${paymentId}:`, error.message);
//   }
// };

exports.handleSuccessfulPayment = async (paymentId) => {
  const t = await sequelize.transaction();

  try {
    const payment = await Payment.findByPk(paymentId, {
      include: [
        { model: Event, as: 'event' },
        { model: Candidate, as: 'candidate' }
      ],
      transaction: t
    });

    if (!payment || payment.status !== 'pending') {
      await t.rollback();
      return;
    }

    // 1. Marquer le paiement comme réussi
    await payment.update({ status: 'success' }, { transaction: t });

    // 2. Créer les votes
    const votesData = Array.from({ length: payment.votes_count }, () => ({
      payment_id: payment.id,
      candidate_id: payment.candidate_id,
      event_id: payment.event_id,
      quantity: 1,
      ip_address: payment.ip_address
    }));
    await Vote.bulkCreate(votesData, { transaction: t });

    // 3. Incrémenter le compteur du candidat
    await Candidate.increment(
      { vote_count: payment.votes_count },
      { where: { id: payment.candidate_id }, transaction: t }
    );

    // 4. Mettre à jour les totaux de l'événement
    await Event.increment(
      {
        total_votes: payment.votes_count,
        total_collected: payment.amount_fcfa
      },
      { where: { id: payment.event_id }, transaction: t }
    );

    // 5. Créditer l'organisateur
    await User.increment(
      { balance_fcfa: payment.net_to_organizer },
      { where: { id: payment.event.organizer_id }, transaction: t }
    );

    // 6. Enregistrer la commission
    await Commission.create({
      payment_id: payment.id,
      event_id: payment.event_id,
      organizer_id: payment.event.organizer_id,
      amount_fcfa: payment.commission_amount,
      rate_applied: payment.event.commission_rate,
      base_amount: payment.amount_fcfa,
      status: 'pending'
    }, { transaction: t });

    await t.commit();
    console.log(`✅ Vote enregistré : ${payment.votes_count} votes pour ${payment.candidate.name}`);

  } catch (error) {
    await t.rollback();
    console.error('Erreur traitement vote:', error);
  }
};

// ==================== 3. VÉRIFICATION APRÈS REDIRECTION (sans webhook) ====================
exports.verifyPaymentAfterRedirect = async (req, res) => {
  try {
    const { payment_id, transaction_id, status } = req.query;

    if (!payment_id) {
      return res.redirect(`${process.env.FRONTEND_URL}/payment/error?message=Paramètres manquants`);
    }

    const payment = await Payment.findByPk(payment_id);

    if (!payment) {
      return res.redirect(`${process.env.FRONTEND_URL}/payment/error?message=Paiement non trouvé`);
    }

    // Vérifier le statut auprès de Flutterwave
    if (transaction_id) {
      const verification = await flutterwaveService.verifyPayment(transaction_id);
      
      if (verification.status === 'success' && verification.data.status === 'successful') {
        // Paiement confirmé
        if (payment.status === 'pending') {
          await exports.handleSuccessfulPayment(payment.id);
        }
        return res.redirect(`${process.env.FRONTEND_URL}/payment/success?payment_id=${payment_id}`);
      }
    }

    // Si le statut est déjà success en base
    if (payment.status === 'success') {
      return res.redirect(`${process.env.FRONTEND_URL}/payment/success?payment_id=${payment_id}`);
    }

    // Sinon, erreur
    return res.redirect(`${process.env.FRONTEND_URL}/payment/error?message=Paiement non confirmé`);

  } catch (error) {
    console.error('Erreur vérification:', error);
    return res.redirect(`${process.env.FRONTEND_URL}/payment/error?message=Erreur technique`);
  }
};


// ==================== 4. WEBHOOK FLUTTERWAVE ====================
exports.handleWebhook = async (req, res) => {
  try {
    const signature = req.headers['verif-hash'];
    const expectedSignature = process.env.FLW_WEBHOOK_SECRET;

    // Vérifier la signature (optionnel mais recommandé)
    if (expectedSignature && signature !== expectedSignature) {
      console.error('❌ Signature webhook invalide');
      return res.status(401).json({ error: 'Signature invalide' });
    }

    const payload = req.body;
    console.log('📩 Webhook Flutterwave reçu:', payload);

    const { event, data } = payload;

    if (event === 'charge.completed') {
      const { tx_ref, status, id, amount } = data;

      if (status === 'successful') {
        const payment = await Payment.findOne({ where: { provider_ref: tx_ref } });
        
        if (payment && payment.status === 'pending') {
          await exports.handleSuccessfulPayment(payment.id);
          console.log(`✅ Paiement ${payment.id} confirmé via webhook`);
        }
      } else if (status === 'failed') {
        await Payment.update(
          { status: 'failed' },
          { where: { provider_ref: tx_ref } }
        );
        console.log(`❌ Paiement ${tx_ref} échoué`);
      }
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('Erreur webhook:', error.message);
    res.status(500).json({ error: error.message });
  }
};


// ==================== 5. VÉRIFIER STATUT D'UN PAIEMENT (API) ====================
exports.checkPaymentStatus = async (req, res) => {
  try {
    const { paymentId } = req.params;

    const payment = await Payment.findByPk(paymentId, {
      include: [{
        model: Candidate,
        as: 'candidate',
        attributes: ['id', 'name', 'number']
      }]
    });

    if (!payment) {
      return res.status(404).json({ error: 'Paiement non trouvé' });
    }

    res.json({
      payment_id: payment.id,
      status: payment.status,
      amount: payment.amount_fcfa,
      votes_count: payment.votes_count,
      candidate: payment.candidate?.name,
      method: payment.method,
      created_at: payment.created_at
    });

  } catch (error) {
    console.error('Erreur checkPaymentStatus:', error.message);
    res.status(500).json({ error: error.message });
  }
};


// ==================== 6. HISTORIQUE PAIEMENTS D'UN ÉVÉNEMENT ====================
exports.getEventPayments = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { page = 1, limit = 20, status } = req.query;
    const offset = (page - 1) * parseInt(limit);

    const event = await Event.findOne({
      where: { id: eventId, organizer_id: req.user.id }
    });

    if (!event) {
      return res.status(403).json({ error: 'Accès non autorisé' });
    }

    const where = { event_id: eventId };
    if (status) where.status = status;

    const payments = await Payment.findAndCountAll({
      where,
      include: [{
        model: Candidate,
        as: 'candidate',
        attributes: ['id', 'name', 'number']
      }],
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset
    });

    const successPayments = payments.rows.filter(p => p.status === 'success');

    res.json({
      payments: payments.rows,
      total: payments.count,
      page: parseInt(page),
      totalPages: Math.ceil(payments.count / parseInt(limit)),
      summary: {
        total_collected: successPayments.reduce((s, p) => s + p.amount_fcfa, 0),
        total_commission: successPayments.reduce((s, p) => s + p.commission_amount, 0),
        total_net: successPayments.reduce((s, p) => s + p.net_to_organizer, 0),
        success_count: successPayments.length
      }
    });

  } catch (error) {
    console.error('Erreur getEventPayments:', error.message);
    res.status(500).json({ error: error.message });
  }
};


// ==================== UTILITAIRE ====================
function detectMethod(phone) {
  const cleaned = phone.replace(/\s+/g, '').replace(/^\+237/, '');
  if (/^6[5-9]/.test(cleaned)) return 'mtn_momo';
  if (/^6[9]/.test(cleaned))   return 'orange_money';
  return 'mtn_momo';
}