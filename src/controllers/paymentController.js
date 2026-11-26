const { publicFailure } = require('../services/paymentFailure');
const {randomUUID} = require('node:crypto');
const {validationResult} = require('express-validator');
const {Payment, Event, Candidate, KpayOperation} = require('../models');
const sequelize = require('../config/database');
const {normalizePhone, integer} = require('../services/kpayAmounts');
const {hash, dispatch, failure, reconcileDeposit} = require('../services/kpayOperations');
const kpay = require('../services/kpayClient');
const {getConfig} = require('../config/kpay');
const {mobileVoteTariff} = require('../services/votenowFees');
const {votePrice,quoteBreakdown,unavailableKpayTotal,kpayVoteMode,MAX_MOBILE_VOTES,MAX_MOBILE_AMOUNT} = require('../services/votePricing');
const {networks,depositHealth}=require('../services/paymentProviders/mobileHealth');
const mobileMethod='mobile_money';
const providerReview=operation=>['UNKNOWN','RECONCILIATION','AWAITING_DETAILS'].includes(operation?.status);

async function publicNetworks(mode,amount=null) {
    if(!mode)return [];
    const candidates=process.env.PAYMENT_PROVIDER_MANAGER_ENABLED==='true'
        ? await require('../services/paymentProviders/manager').depositCapabilities(mode==='sandbox'?'sandbox':'production',amount)
        : await Promise.all(Object.keys(networks).map(async rail=>({rail,state:await depositHealth(rail)})));
    const rank=['unavailable','unknown','delayed','available'];
    return Object.keys(networks).flatMap(rail=>{
        const routes=candidates.filter(row=>row.rail===rail);
        if(!routes.length)return [];
        return [{rail,state:rank[Math.max(...routes.map(row=>rank.indexOf(row.state)),0)]}];
    });
}

function logPaymentError(label, error) {
    console.error(label, {
        name: error.name,
        message: error.message,
        code: error.code,
        status: error.status,
        upstreamStatus: error.providerHttpStatus || null,
        providerErrorCode: error.providerErrorCode || null,
        providerErrorType: error.providerErrorType || null,
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
        ...publicFailure(current, payment.status),
        payment_id: payment.id,
        status: payment.status,
        amount: payment.amount_fcfa,
        requested_amount_fcfa: current.expected_amount,
        votes_count: payment.votes_count,
        candidate: candidate?.name,
        method: payment.method,
        review_required: providerReview(current),
        checkout_url: current.pricing_snapshot?.checkout_url || null,
        simulation: current.environment === 'sandbox',
        message:
            payment.status === 'failed'
                ? 'Paiement non effectué.'
                : 'Demande enregistrée. La confirmation sera reçue automatiquement.',
    };
}

exports.quoteVote = async (req,res) => {
    const errors=validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({errors:errors.array()});
    try {
        const {unitPrice,price}=await votePrice(req.body,undefined,MAX_MOBILE_VOTES);
        const mode=kpayVoteMode();
        const quote=quoteBreakdown(unitPrice,price,mobileMethod,await mobileVoteTariff());
        return res.set('Cache-Control','no-store').json({
            ...quote,
            budget_fcfa:req.body.nominal_budget_fcfa===undefined?price.gross:Number(req.body.nominal_budget_fcfa),
            payment_mode:mode==='sandbox'?'simulation':mode,
            networks:await publicNetworks(mode,quote.requested_amount_fcfa),
            max_requested_fcfa:MAX_MOBILE_AMOUNT,
        });
    } catch (error) {
        return res.status(error.status||503).json({error:error.status&&error.status<500?error.message:'Devis temporairement indisponible.'});
    }
};

async function selectVoteProvider(environment,amount,phone,selectedRail) {
    if (process.env.PAYMENT_PROVIDER_MANAGER_ENABLED==='true') {
        const quote=await require('../services/paymentProviders/manager').select({
            environment,direction:'deposit',amount,phone,rail:selectedRail
        });
        return {network:quote.network,rail:quote.rail,snapshot:{
            provider_selection:quote.provider_selection,tariff_terms:quote.tariff_terms
        }};
    }
    const detected=await kpay.predictProvider(phone);
    const rail=Object.keys(networks).find(key=>networks[key]===detected.provider);
    if (detected.country!=='CMR'||!rail) throw failure('Ce numéro ne correspond pas à un réseau mobile pris en charge.',422);
    if (selectedRail&&selectedRail!==rail) throw failure('Le numéro ne correspond pas au réseau sélectionné.',422);
    if (!['available','delayed'].includes(await depositHealth(rail))) throw unavailableKpayTotal();
    return {network:detected.provider,rail,snapshot:{}};
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

        const mode=kpayVoteMode();
        if (!mode) throw unavailableKpayTotal();
        const sandbox=mode==='sandbox';
        const environment=sandbox?'sandbox':'production';
        const matchesMode=req.body.vote_mode===mode || (sandbox && req.body.vote_mode===undefined);
        if (!matchesMode || req.body.accept_unverified_total!==true) {
            const message=sandbox?'Confirmez explicitement la simulation sans total votant garanti.'
                :'Confirmez le montant demandé et les éventuels frais opérateur avant de payer.';
            const code=sandbox?'KPAY_SANDBOX_CONFIRMATION_REQUIRED':'KPAY_LIVE_CONFIRMATION_REQUIRED';
            throw Object.assign(failure(message,409),{code});
        }
        const selection={event_id,candidate_id,votes_count:quantity,nominal_budget_fcfa:req.body.nominal_budget_fcfa};
        const verifyQuote=async ({unitPrice,price},transaction)=>{
            const quote=quoteBreakdown(unitPrice,price,mobileMethod,await mobileVoteTariff(transaction));
            if (quote.requested_amount_fcfa!==quotedAmount || price.count!==quantity) {
                throw Object.assign(failure('Le prix a changé. Actualisez le devis avant de confirmer.',409),{code:'VOTE_QUOTE_CHANGED'});
            }
            return quote;
        };
        await verifyQuote(await votePrice(selection,undefined,MAX_MOBILE_VOTES));
        const provider=await selectVoteProvider(environment,quotedAmount,phone,req.body.rail||null);
        const paymentId=randomUUID();
        const externalId=`vn-v-${paymentId}`;
        try {
            operation=await sequelize.transaction(async transaction=>{
                const current=await votePrice(selection,transaction,MAX_MOBILE_VOTES);
                const quote=await verifyQuote(current,transaction);
                const {price}=current;
                await Payment.create({
                    id:paymentId,event_id,candidate_id,voter_phone:phone,
                    voter_name:typeof req.body.voter_name==='string'?req.body.voter_name.trim().slice(0,150):null,
                    amount_fcfa:price.gross,votes_count:price.count,commission_amount:price.commission,
                    net_to_organizer:price.net,commission_rate_applied:price.rate,method:provider.rail,status:'pending',ip_address:req.ip
                },{transaction});
                return KpayOperation.create({
                    kind:'DEPOSIT',domain_id:paymentId,request_key:request_id,external_id:externalId,fingerprint,
                    environment,expected_amount:quote.requested_amount_fcfa,status:'CREATED',
                    pricing_snapshot:{...provider.snapshot,...quote,vote_confirmation:sandbox?'sandbox_unverified':'live_unverified'},
                    request_payload:{amount:quote.requested_amount_fcfa,provider:provider.network,phoneNumber:phone,externalId,currency:'XAF',
                        description:current.event.title.slice(0,200),metadata:{paymentId}}
                },{transaction});
            });
        } catch (error) {
            if (error.name!=='SequelizeUniqueConstraintError') throw error;
            operation=await KpayOperation.findOne({where:{request_key:request_id}});
            if (operation?.kind!=='DEPOSIT'||operation.environment!==environment||operation.fingerprint!==fingerprint) {
                throw failure('Tentative concurrente incohérente',409);
            }
        }
        await dispatch(operation.id);
        return res.status(201).json(await responseFor(operation));
    } catch (error) {
        if (error.code !== 'PAYMENT_UNAVAILABLE') logPaymentError('[payments.initiate]', error);

        return res.status(error.status || 503).json({
            ...(['PAYMENT_UNAVAILABLE','NO_PAYMENT_PROVIDER','VOTE_QUOTE_CHANGED'].includes(error.code) ? {code:error.code} : {}),
            error: error.code==='PAYMENT_UNAVAILABLE'||error.code==='NO_PAYMENT_PROVIDER' ? 'Le paiement mobile est indisponible.' : error.status && error.status < 500
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

        if (operation && payment.status === 'pending') {
            await reconcileDeposit(operation.id);
        }
        const refreshedPayment = await Payment.findByPk(payment.id);
        const refreshedOperation = operation ? await KpayOperation.findByPk(operation.id) : null;

        return res.json({
            ...publicFailure(refreshedOperation, refreshedPayment.status),
            payment_id: refreshedPayment.id,
            status: refreshedPayment.status,
            amount: refreshedPayment.amount_fcfa,
            requested_amount_fcfa: refreshedOperation?.expected_amount ?? null,
            votes_count: refreshedPayment.votes_count,
            candidate: payment.candidate?.name,
            method: refreshedPayment.method,
            created_at: refreshedPayment.created_at,
            review_required: providerReview(refreshedOperation),
            checkout_url: refreshedOperation?.pricing_snapshot?.checkout_url || null,
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

        const {eventId} = req.params;
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
            Payment.sum('amount_fcfa', {where: success}),
            Payment.sum('commission_amount', {where: success}),
            Payment.sum('net_to_organizer', {where: success}),
            Payment.count({where: success}),
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
// Disponibilité publique des moyens de paiement pour les dépôts.
exports.getPaymentAvailability = async (req, res) => {
    try {
        const mode=kpayVoteMode();
        return res.set('Cache-Control','no-store').json({
            mobile_payment:{mode:mode==='sandbox'?'simulation':mode,networks:await publicNetworks(mode)},
            votenow_card:{requires_account:true}
        });
    } catch (error) {
        console.warn('[payments.availability]',{code:error.original?.code||error.code||null});
        return res.status(503).json({error:'Moyens de paiement temporairement indisponibles.'});
    }
};
