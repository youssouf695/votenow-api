const crypto = require('node:crypto');
const { validationResult } = require('express-validator');
const { Payment, Event, Candidate, KpayOperation } = require('../models');
const sequelize = require('../config/database');
const { amounts, normalizePhone, integer } = require('../services/kpayAmounts');
const { hash, dispatch, failure } = require('../services/kpayOperations');
const kpay = require('../services/kpayClient');
const { getConfig } = require('../config/kpay');

function logPaymentError(label, error) {
  console.error(label, {
    name: error.name,
    message: error.message,
    code: error.code,
    status: error.status,
    upstreamStatus: error.response?.status,
    databaseCode: error.original?.code || error.parent?.code,
    constraint: error.original?.constraint || error.parent?.constraint,
    stack: error.stack,
  });
}

async function responseFor(operation) {
  const payment = await Payment.findByPk(operation.domain_id);

  if (!payment) {
    throw new Error('Paiement local absent');
  }

  const candidate = await Candidate.findByPk(payment.candidate_id);
  const current = await KpayOperation.findByPk(operation.id);

  if (!current) {
    throw new Error('Opération de paiement locale absente');
  }

  return {
    payment_id: payment.id,
    status: payment.status,
    amount: payment.amount_fcfa,
    votes_count: payment.votes_count,
    candidate: candidate?.name,
    method: payment.method,
    provider_status: current.status,
    message:
      payment.status === 'failed'
        ? 'Paiement non effectué.'
        : 'Demande enregistrée. La confirmation sera reçue automatiquement.',
  };
}

exports.initiatePayment = async (req, res) => {
  try {
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      return res.status(400).json({
        errors: errors.array(),
      });
    }

    const {
      request_id,
      event_id,
      candidate_id,
      votes_count,
      voter_name,
    } = req.body;

    const phone = normalizePhone(req.body.voter_phone);
    const quantity = integer(votes_count, 'Nombre de votes');
    const quotedAmount = integer(req.body.expected_amount);

    const fingerprint = hash([
      event_id,
      candidate_id,
      quantity,
      phone,
      quotedAmount,
    ]);

    let operation = await KpayOperation.findOne({
      where: {
        request_key: request_id,
      },
    });

    if (operation) {
      if (
        operation.environment !== getConfig().mode ||
        operation.kind !== 'DEPOSIT' ||
        operation.fingerprint !== fingerprint
      ) {
        throw failure(
          'Cette tentative correspond à un autre paiement.',
          409
        );
      }

      await dispatch(operation.id);

      return res.status(200).json(await responseFor(operation));
    }

    const config = getConfig();
    const event = await Event.findByPk(event_id);
    const now = Date.now();

    if (
      !event ||
      event.status !== 'active' ||
      (event.starts_at &&
        new Date(event.starts_at).getTime() > now) ||
      (event.ends_at &&
        new Date(event.ends_at).getTime() <= now)
    ) {
      throw failure('Événement non disponible', 400);
    }

    const candidate = await Candidate.findOne({
      where: {
        id: candidate_id,
        event_id,
        is_active: true,
      },
    });

    if (!candidate) {
      throw failure('Candidat non disponible', 400);
    }

    const calculation = amounts(
      event.vote_price_fcfa,
      quantity,
      event.commission_rate
    );

    if (calculation.gross !== quotedAmount) {
      throw failure(
        'Le tarif a changé. Actualisez le formulaire avant de payer.',
        409
      );
    }

    const predicted = await kpay.predictProvider(phone);

    if (
      predicted.country !== 'CMR' ||
      !['MTN_MOMO_CMR', 'ORANGE_CMR'].includes(predicted.provider)
    ) {
      throw failure('Opérateur non pris en charge', 422);
    }

    const paymentId = crypto.randomUUID();
    const externalId = `vn-v-${paymentId}`;

    try {
      operation = await sequelize.transaction(async (transaction) => {
        await Payment.create(
          {
            id: paymentId,
            event_id,
            candidate_id,
            voter_phone: phone,
            voter_name:
              typeof voter_name === 'string'
                ? voter_name.trim().slice(0, 150) || null
                : null,
            amount_fcfa: calculation.gross,
            votes_count: calculation.count,
            commission_amount: calculation.commission,
            net_to_organizer: calculation.net,
            commission_rate_applied: calculation.rate,
            method:
              predicted.provider === 'MTN_MOMO_CMR'
                ? 'mtn_momo'
                : 'orange_money',
            status: 'pending',
            ip_address: req.ip,
          },
          { transaction }
        );

        return KpayOperation.create(
          {
            kind: 'DEPOSIT',
            domain_id: paymentId,
            request_key: request_id,
            external_id: externalId,
            fingerprint,
            environment: config.mode,
            expected_amount: calculation.gross,
            status: 'CREATED',
            request_payload: {
              amount: calculation.gross,
              currency: 'XAF',
              provider: predicted.provider,
              phoneNumber: phone,
              externalId,
              description: `Votes : ${event.title}`.slice(0, 200),
              metadata: {
                paymentId,
              },
            },
          },
          { transaction }
        );
      });
    } catch (error) {
      if (error.name !== 'SequelizeUniqueConstraintError') {
        throw error;
      }

      operation = await KpayOperation.findOne({
        where: {
          request_key: request_id,
        },
      });

      if (!operation || operation.fingerprint !== fingerprint) {
        throw failure('Tentative concurrente incohérente', 409);
      }
    }

    await dispatch(operation.id);

    return res.status(201).json(await responseFor(operation));
  } catch (error) {
    logPaymentError('[payments.initiate]', error);

    return res.status(error.status || 503).json({
      error: error.status
        ? error.message
        : 'Paiement indisponible. Conservez cette tentative et réessayez sa vérification.',
    });
  }
};

exports.checkPaymentStatus = async (req, res) => {
  try {
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      return res.status(400).json({
        errors: errors.array(),
      });
    }

    const payment = await Payment.findByPk(req.params.paymentId, {
      include: [
        {
          model: Candidate,
          as: 'candidate',
          attributes: ['id', 'name', 'number'],
        },
      ],
    });

    if (!payment) {
      return res.status(404).json({
        error: 'Paiement non trouvé',
      });
    }

    const operation = await KpayOperation.findOne({
      where: {
        kind: 'DEPOSIT',
        domain_id: payment.id,
      },
    });

    return res.json({
      payment_id: payment.id,
      status: payment.status,
      amount: payment.amount_fcfa,
      votes_count: payment.votes_count,
      candidate: payment.candidate?.name,
      method: payment.method,
      created_at: payment.created_at,
      provider_status: operation?.status || null,
    });
  } catch (error) {
    logPaymentError('[payments.status]', error);

    return res.status(503).json({
      error: 'Vérification indisponible',
    });
  }
};

exports.getEventPayments = async (req, res) => {
  try {
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      return res.status(400).json({
        errors: errors.array(),
      });
    }

    const { eventId } = req.params;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(
      100,
      Math.max(1, Number(req.query.limit) || 20)
    );

    const event = await Event.findOne({
      where: {
        id: eventId,
        organizer_id: req.user.id,
      },
    });

    if (!event) {
      return res.status(403).json({
        error: 'Accès non autorisé',
      });
    }

    const where = {
      event_id: eventId,
    };

    if (req.query.status) {
      where.status = req.query.status;
    }

    const payments = await Payment.findAndCountAll({
      where,
      include: [
        {
          model: Candidate,
          as: 'candidate',
          attributes: ['id', 'name', 'number'],
        },
      ],
      order: [['created_at', 'DESC']],
      limit,
      offset: (page - 1) * limit,
    });

    const success = {
      event_id: eventId,
      status: 'success',
    };

    const [gross, commission, net, count] = await Promise.all([
      Payment.sum('amount_fcfa', { where: success }),
      Payment.sum('commission_amount', { where: success }),
      Payment.sum('net_to_organizer', { where: success }),
      Payment.count({ where: success }),
    ]);

    return res.json({
      payments: payments.rows,
      total: payments.count,
      page,
      totalPages: Math.ceil(payments.count / limit),
      summary: {
        total_collected: Number(gross || 0),
        total_commission: Number(commission || 0),
        total_net: Number(net || 0),
        success_count: count,
      },
    });
  } catch (error) {
    logPaymentError('[payments.history]', error);

    return res.status(500).json({
      error: 'Historique indisponible',
    });
  }
};