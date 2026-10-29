const crypto = require('node:crypto');
const {KpayOperation, Payment, Withdrawal, Event, Candidate, Vote, User, Commission} = require('../models');
const sequelize = require('../config/database');
const client = require('./kpayClient');
const {getConfig} = require('../config/kpay');
const {integer, normalizePhone, grossForNet} = require('./kpayAmounts');

const terminal = new Set(['COMPLETED', 'FAILED', 'CANCELLED', 'RECONCILIATION']);
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

function failure(message, status = 400) {
    return Object.assign(new Error(message), {status});
}

function optionalAmount(value) {
    if (value === null || value === undefined || value === '') return null;
    const amount = Number(value);
    return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

async function payoutQuote(withdrawal) {
    if (process.env.KPAY_PAYOUT_PRICING_CONFIRMED !== 'true') {
        throw failure('Le tarif et l’arrondi des retraits doivent être confirmés auprès de KPay avant tout envoi. Aucun transfert lancé.', 503);
    }
    const operator = {mtn_momo: 'MTN', orange_money: 'Orange'}[withdrawal.method];
    if (!operator) throw failure('Ce lot prend en charge les retraits MTN et Orange uniquement.', 422);
    const catalogue = await client.pricelist();
    const country = catalogue.countries?.find(item => item.code === 'CMR' && item.currency === 'XAF');
    const tariff = country?.operators?.find(item => item.operator === operator);
    const quote = grossForNet(withdrawal.amount_fcfa, tariff?.withdrawalRate, process.env.KPAY_PAYOUT_ROUNDING || 'exact');
    return {...quote, operator, retrieved_at: new Date().toISOString()};
}

// Appelé seulement après vérification HMAC, ou pour un rejet HTTP certain de l'init.
async function applyEvent(event, internal = false) {
    const prefix = event.event?.startsWith('payout.') ? 'PAYOUT' : 'DEPOSIT';
    const endings = {completed: 'COMPLETED', failed: 'FAILED', cancelled: 'CANCELLED'};
    const expected = endings[event.event?.split('.')[1]];
    if (!expected || event.status !== expected || !event.externalId || !event.paymentId) throw failure('Notification KPay invalide');
    return sequelize.transaction(async transaction => {
        const operation = await KpayOperation.findOne({
            where: {external_id: event.externalId},
            transaction,
            lock: transaction.LOCK.UPDATE
        });
        if (!operation) throw failure('Opération inconnue', 404);
        if (operation.kind !== prefix || operation.environment !== getConfig().mode) throw failure('Opération incohérente');
        if (Number(event.amount) !== operation.expected_amount || (event.currency && event.currency !== 'XAF')) throw failure('Montant ou devise incohérent');
        if (typeof event.isTest === 'boolean' && event.isTest !== (operation.environment === 'sandbox')) throw failure('Environnement incohérent');
        if (event.phoneNumber && operation.request_payload.phoneNumber && normalizePhone(event.phoneNumber) !== operation.request_payload.phoneNumber) throw failure('Bénéficiaire incohérent');
        if (event.provider && operation.request_payload.provider && event.provider !== operation.request_payload.provider) throw failure('Opérateur incohérent');
        if (!internal && operation.provider_id && operation.provider_id !== event.paymentId) throw failure('Référence incohérente');
        if (terminal.has(operation.status)) {
            if (operation.status !== expected && operation.status !== 'RECONCILIATION') {
                await operation.update({
                    status: 'RECONCILIATION',
                    error_code: 'CONFLICTING_FINAL_EVENT',
                    last_event: event
                }, {transaction});
            }
            return operation;
        }
        const details = {last_event: internal ? operation.last_event : event};
        if (!internal) {
            details.provider_id = event.paymentId;
            details.provider_reference = event.reference || operation.provider_reference || null;
        }
        const fee = optionalAmount(event.feeAmount), net = optionalAmount(event.netAmount);
        if (fee !== null) details.provider_fee = fee;
        if (net !== null) details.provider_net = net;
        if (prefix === 'DEPOSIT') {
            const payment = await Payment.findByPk(operation.domain_id, {transaction, lock: transaction.LOCK.UPDATE});
            if (!payment) throw new Error('Paiement local absent');
            if (payment.status !== 'pending') {
                await operation.update({
                    ...details,
                    status: 'RECONCILIATION',
                    error_code: 'LOCAL_FINAL_STATE'
                }, {transaction});
                return operation;
            }
            if (expected === 'COMPLETED') {
                const eventRow = await Event.findByPk(payment.event_id, {transaction});
                if (!eventRow) throw new Error('Événement absent');
                await payment.update({
                    status: 'success',
                    provider_ref: event.reference || operation.provider_reference || event.paymentId
                }, {transaction});
                await Vote.bulkCreate(Array.from({length: payment.votes_count}, () => ({
                    payment_id: payment.id, candidate_id: payment.candidate_id, event_id: payment.event_id,
                    quantity: 1, ip_address: payment.ip_address,
                })), {transaction});
                await Candidate.increment({vote_count: payment.votes_count}, {
                    where: {id: payment.candidate_id},
                    transaction
                });
                await Event.increment({
                    total_votes: payment.votes_count,
                    total_collected: payment.amount_fcfa
                }, {where: {id: payment.event_id}, transaction});
                await User.increment({balance_fcfa: payment.net_to_organizer}, {
                    where: {id: eventRow.organizer_id},
                    transaction
                });
                await Commission.create({
                    payment_id: payment.id,
                    event_id: payment.event_id,
                    organizer_id: eventRow.organizer_id,
                    amount_fcfa: payment.commission_amount,
                    rate_applied: payment.commission_rate_applied,
                    base_amount: payment.amount_fcfa,
                    status: 'pending',
                    metadata: {provider: 'kpay', operation_id: operation.id},
                }, {transaction});
            } else await payment.update({status: 'failed'}, {transaction});
        } else {
            const withdrawal = await Withdrawal.findByPk(operation.domain_id, {
                transaction,
                lock: transaction.LOCK.UPDATE
            });
            if (!withdrawal || withdrawal.status !== 'processing') {
                await operation.update({
                    ...details,
                    status: 'RECONCILIATION',
                    error_code: 'LOCAL_FINAL_STATE'
                }, {transaction});
                return operation;
            }
            if (expected === 'COMPLETED') {
                const delivered = net ?? optionalAmount(operation.provider_net);
                if (delivered === null) {
                    // Un webhook peut précéder la réponse de l'initiation : on attend ses détails.
                    await operation.update({
                        ...details,
                        status: 'AWAITING_DETAILS',
                        error_code: 'NET_AMOUNT_MISSING'
                    }, {transaction});
                    return operation;
                }
                if (delivered !== operation.target_net) {
                    await operation.update({
                        ...details,
                        status: 'RECONCILIATION',
                        error_code: 'NET_AMOUNT_MISMATCH'
                    }, {transaction});
                    return operation;
                }
                await withdrawal.update({
                    status: 'done',
                    completed_at: new Date(),
                    transaction_ref: event.reference || operation.provider_reference || event.paymentId
                }, {transaction});
            } else {
                // Le montant réservé est restitué une seule fois après échec confirmé.
                await User.increment({balance_fcfa: withdrawal.amount_fcfa}, {
                    where: {id: withdrawal.organizer_id},
                    transaction
                });
                await withdrawal.update({
                    status: 'rejected',
                    completed_at: new Date(),
                    rejection_reason: 'Transfert non effectué. Montant restitué au solde.'
                }, {transaction});
            }
        }
        await operation.update({
            ...details,
            status: expected,
            completed_at: new Date(),
            error_code: null
        }, {transaction});
        return operation;
    });
}

async function dispatch(operationId) {
    const operation = await sequelize.transaction(async transaction => {
        const row = await KpayOperation.findByPk(operationId, {transaction, lock: transaction.LOCK.UPDATE});
        if (!row || row.status !== 'CREATED') return null;
        await row.update({status: 'INITIATING', started_at: new Date()}, {transaction});
        return row;
    });
    if (!operation) return;
    let result;
    try {
        result = operation.kind === 'DEPOSIT' ? await client.initiatePayment(operation.request_payload) : await client.initiateWithdrawal(operation.request_payload);
    } catch (error) {
        console.error('[kpay.dispatch]', {
            operationId: operation.id,
            externalId: operation.external_id,
            environment: operation.environment,
            providerHttpStatus: error.providerHttpStatus,
            definitive: error.definitive,
            providerErrorCode: error.providerErrorCode || null,
            providerErrorType: error.providerErrorType || null,
            message: error.message,
        });

        if (error.definitive) {
            await applyEvent({
                event: operation.kind === 'DEPOSIT' ? 'payment.failed' : 'payout.failed',
                status: 'FAILED',
                externalId: operation.external_id,
                paymentId: operation.provider_id || 'init-rejected',
                amount: operation.expected_amount
            }, true);
        } else {
            await sequelize.transaction(async transaction => {
                const row = await KpayOperation.findByPk(operation.id, {transaction, lock: transaction.LOCK.UPDATE});
                if (!terminal.has(row.status)) await row.update({
                    status: 'UNKNOWN',
                    error_code: 'INIT_UNCERTAIN'
                }, {transaction});
            });
        }
        return;
    }
    let replay;
    await sequelize.transaction(async transaction => {
        const row = await KpayOperation.findByPk(operation.id, {transaction, lock: transaction.LOCK.UPDATE});
        if (!result || typeof result.id !== 'string' || result.externalId !== row.external_id || Number(result.amount) !== row.expected_amount ||
            (result.currency && result.currency !== 'XAF') ||
            (typeof result.isTest === 'boolean' && result.isTest !== (row.environment === 'sandbox')) ||
            (row.provider_id && row.provider_id !== result.id)) {
            if (!terminal.has(row.status)) await row.update({
                status: 'UNKNOWN',
                error_code: 'INIT_RESPONSE_MISMATCH'
            }, {transaction});
            return;
        }
        const changes = {provider_id: result.id, provider_reference: result.reference || null};
        // L'URL n'est jamais une preuve de paiement. Seul le webhook signé crédite les votes.
        if (row.kind === 'DEPOSIT' && (result.mode === 'GATEWAY' || result.gatewayUrl)) {
            let checkout;
            try {
                checkout = new URL(result.gatewayUrl);
                if (checkout.protocol !== 'https:' || !checkout.hostname || checkout.username || checkout.password) throw new Error('URL invalide');
            } catch (_) {
                await row.update({status: 'UNKNOWN', error_code: 'GATEWAY_URL_MISSING'}, {transaction});
                return;
            }
            changes.pricing_snapshot = {...(row.pricing_snapshot || {}), checkout_url: checkout.toString()};
        }
        const fee = optionalAmount(result.feeAmount), net = optionalAmount(result.netAmount);
        if (fee !== null) changes.provider_fee = fee;
        if (net !== null) changes.provider_net = net;
        if (!terminal.has(row.status) && row.status !== 'AWAITING_DETAILS') changes.status = 'PENDING';
        await row.update(changes, {transaction});
        if (row.kind === 'DEPOSIT') await Payment.update({provider_ref: result.reference || result.id}, {
            where: {id: row.domain_id},
            transaction
        });
        // Seul le webhook signé déclenche le succès, même si l'init annonce COMPLETED.
        if (row.status === 'AWAITING_DETAILS' && row.last_event) replay = row.last_event;
    });
    if (replay) await applyEvent(replay);
}

// Une réponse de consultation authentifiée par nos clés KPay peut servir à
// réconcilier, à condition de vérifier strictement les identifiants et montants.
const lastLookup = new Map();

async function reconcileDeposit(operationId) {
    const operation = await KpayOperation.findByPk(operationId);
    if (!operation || operation.kind !== 'DEPOSIT' || !operation.provider_id ||
        !['PENDING', 'UNKNOWN', 'INITIATING'].includes(operation.status)) return;
    const now = Date.now();
    if (now - (lastLookup.get(operationId) || 0) < 15000) return;
    lastLookup.set(operationId, now);
    try {
        const response = await client.getPayment(operation.provider_id);
        // Le GET officiel renvoie directement l'objet paiement.
        const data = response?.data?.payment ?? response?.payment ?? response?.data ?? response;
        if (!data || data.id !== operation.provider_id ||
            data.externalId !== operation.external_id ||
            Number(data.amount) !== Number(operation.expected_amount) ||
            data.currency !== 'XAF' ||
            (typeof data.isTest === 'boolean' && data.isTest !== (operation.environment === 'sandbox')) ||
            (data.provider && data.provider !== operation.request_payload.provider) ||
            (data.phoneNumber && normalizePhone(data.phoneNumber) !== operation.request_payload.phoneNumber)) {
            console.warn('[kpay.reconcile] Réponse incohérente ou incomplète', {
                operationId,
                providerIdMatches: data?.id === operation.provider_id,
                externalIdMatches: data?.externalId === operation.external_id,
                amountMatches: Number(data?.amount) === Number(operation.expected_amount),
                currency: data?.currency,
                provider: data?.provider,
                status: data?.status
            });
            return;
        }
        const events = {COMPLETED: 'payment.completed', FAILED: 'payment.failed', CANCELLED: 'payment.cancelled'};
        if (!events[data.status]) {
            console.info('[kpay.reconcile] Statut non terminal', {operationId, providerStatus: data.status});
            return;
        }
        await applyEvent({
            event: events[data.status], status: data.status,
            externalId: data.externalId, paymentId: data.id,
            reference: data.reference, amount: data.amount,
            currency: data.currency, isTest: data.isTest,
            provider: data.provider, phoneNumber: data.phoneNumber,
            feeAmount: data.feeAmount, netAmount: data.netAmount,
        });
        console.info('[kpay.reconcile] État terminal traité', {operationId, providerStatus: data.status});
    } catch (error) {
        console.warn('[kpay.reconcile]', {
            operationId, code: error.code || null,
            providerHttpStatus: error.providerHttpStatus || null
        });
    }
}

module.exports = {hash, payoutQuote, dispatch, applyEvent, optionalAmount, failure, reconcileDeposit};
