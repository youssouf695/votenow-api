const sponsored = require('./sponsoredPayout');
const crypto = require('node:crypto');
const {KpayOperation, Payment, Withdrawal, Event, Candidate, Vote, User, Commission} = require('../models');
const sequelize = require('../config/database');
const client = require('./kpayClient');
const {getConfig} = require('../config/kpay');
const {integer, normalizePhone, grossForNet} = require('./kpayAmounts');
const {postWithdrawal} = require('./withdrawalJournal');

const {walletCredit,resumableWalletNetCheck}=require('./walletCredit');
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

function payoutAmount(value) {
    if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+(\.\d+)?$/.test(value))) return null;
    return optionalAmount(value);
}

async function verifiedPayoutBeneficiary(withdrawal, transaction) {
    const {WithdrawalBeneficiary} = require('../models');
    const beneficiary = await WithdrawalBeneficiary.findOne({
        where: {id: withdrawal.beneficiary_id, user_id: withdrawal.organizer_id, deleted_at: null},
        transaction, ...(transaction ? {lock: transaction.LOCK.UPDATE} : {})
    });
    if (!beneficiary?.verified_at || !withdrawal.beneficiary_verified_at ||
        new Date(beneficiary.verified_at).getTime() !== new Date(withdrawal.beneficiary_verified_at).getTime() ||
        beneficiary.phone !== withdrawal.destination_phone || beneficiary.method !== withdrawal.method ||
        beneficiary.full_name !== withdrawal.destination_name) {
        throw failure('Le bénéficiaire du retrait doit être validé et correspondre aux coordonnées enregistrées.', 409);
    }
    return beneficiary;
}

async function verifiedHistoricalBeneficiary(withdrawal, transaction) {
    const {WithdrawalBeneficiary} = require('../models');
    const phone = normalizePhone(withdrawal.destination_phone);
    const where = {user_id: withdrawal.organizer_id, phone, deleted_at: null};
    if (withdrawal.beneficiary_id) where.id = withdrawal.beneficiary_id;
    const beneficiary = await WithdrawalBeneficiary.findOne({
        where, transaction, ...(transaction ? {lock: transaction.LOCK.UPDATE} : {})
    });
    if (!beneficiary?.verified_at || beneficiary.method !== withdrawal.method ||
        !withdrawal.destination_name?.trim() || beneficiary.full_name.trim() !== withdrawal.destination_name.trim()) {
        throw failure('Validez par email un bénéficiaire aux mêmes coordonnées ou annulez le retrait.', 409);
    }
    return beneficiary;
}

async function payoutQuote(withdrawal) {
    if (withdrawal.fee_policy === sponsored.POLICY) {
        await verifiedPayoutBeneficiary(withdrawal);
        return sponsored.revalidate(withdrawal);
    }
    if (process.env.KPAY_PAYOUT_PRICING_CONFIRMED !== 'true') {
        throw failure('Le tarif et l’arrondi des retraits doivent être confirmés auprès de KPay avant tout envoi. Aucun transfert lancé.', 503);
    }
    if (withdrawal.fee_policy === 'recipient_pays_v2') {
        await verifiedPayoutBeneficiary(withdrawal);
        const quote = await require('./recipientPayout').recipientQuote(withdrawal,{legacy:!withdrawal.pricing_snapshot?.provider_selection});
        if (quote.fee !== withdrawal.fee_fcfa || quote.net !== withdrawal.net_fcfa || quote.rate !== withdrawal.pricing_snapshot?.rate || quote.rounding !== withdrawal.pricing_snapshot?.rounding || quote.environment !== withdrawal.pricing_snapshot?.environment || quote.provider_selection?.tariff_id !== withdrawal.pricing_snapshot?.provider_selection?.tariff_id) {
            throw failure('Le tarif ou l’environnement de transfert a changé. Annulez la demande et confirmez un nouveau récapitulatif.', 409);
        }
        return quote;
    }
    const operator = {mtn_momo: 'MTN', orange_money: 'Orange'}[withdrawal.method];
    if (!operator) throw failure('Ce lot prend en charge les retraits MTN et Orange uniquement.', 422);
    await verifiedHistoricalBeneficiary(withdrawal);
    const catalogue = await client.pricelist();
    const country = catalogue.countries?.find(item => item.code === 'CMR' && item.currency === 'XAF');
    const tariff = country?.operators?.find(item => item.operator === operator);
    const quote = grossForNet(withdrawal.amount_fcfa, tariff?.withdrawalRate, process.env.KPAY_PAYOUT_ROUNDING || 'exact');
    return {...quote, operator, retrieved_at: new Date().toISOString()};
}

// Called by signed webhooks, authenticated status lookups and internal deposit failures.
async function applyEvent(event, internal = false, verifiedLookup = false, providerCode = 'kpay') {
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
        if ((operation.pricing_snapshot?.provider_selection?.provider_code || 'kpay') !== providerCode) throw failure('Fournisseur incohérent');
        if ((operation.kind !== prefix && !(operation.kind==='WALLET_TOPUP'&&prefix==='DEPOSIT')) || operation.environment !== getConfig().mode) throw failure('Opération incohérente');
        const payout = operation.kind === 'PAYOUT';
        if (operation.kind==='WALLET_TOPUP'&&internal&&expected==='COMPLETED') throw failure('Confirmation de recharge invalide');
        if (payout && (internal || typeof event.paymentId !== 'string' || !event.paymentId.trim() ||
            (event.isTest != null && typeof event.isTest !== 'boolean') || (event.currency != null && event.currency !== 'XAF'))) {
            throw failure('Confirmation de retrait invalide');
        }
        if ((payout ? payoutAmount(event.amount) : Number(event.amount)) !== operation.expected_amount || (event.currency && event.currency !== 'XAF')) throw failure('Montant ou devise incohérent');
        if (typeof event.isTest === 'boolean' && event.isTest !== (operation.environment === 'sandbox')) throw failure('Environnement incohérent');
        if (event.phoneNumber && operation.request_payload.phoneNumber && normalizePhone(event.phoneNumber) !== operation.request_payload.phoneNumber) throw failure('Bénéficiaire incohérent');
        if (event.provider && operation.request_payload.provider && event.provider !== operation.request_payload.provider) throw failure('Opérateur incohérent');
        if (!internal && operation.provider_id && operation.provider_id !== event.paymentId) throw failure('Référence incohérente');
        const pendingFailure = payout && operation.status === 'RECONCILIATION' && operation.error_code === 'PAYOUT_FAILURE_UNVERIFIED';
        const resolvesPendingFailure = pendingFailure && (expected === 'COMPLETED' || (verifiedLookup && expected === operation.last_event?.status));
        if (terminal.has(operation.status) && !resolvesPendingFailure && !(expected==='COMPLETED'&&resumableWalletNetCheck(operation))) {
            if (payout) {
                if ((pendingFailure && expected !== operation.last_event?.status) ||
                    (operation.status !== expected && operation.status !== 'RECONCILIATION')) {
                    await operation.update({error_code: 'CONFLICTING_FINAL_EVENT'}, {transaction});
                }
                return operation;
            }
            if (operation.status === expected && expected === 'FAILED' && !operation.last_event?.failureReason && typeof event.failureReason === 'string') {
                await operation.update({ last_event: event }, { transaction });
            }
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
        const fee = payout ? payoutAmount(event.feeAmount) : optionalAmount(event.feeAmount);
        const net = payout ? payoutAmount(event.netAmount) : optionalAmount(event.netAmount);
        if (!payout || expected === 'COMPLETED') {
            if (fee !== null) details.provider_fee = fee;
            if (net !== null) details.provider_net = net;
        }
        if (payout && operation.status === 'CREATED') {
            await operation.update({...details, status: 'RECONCILIATION', error_code: 'PAYOUT_EVENT_BEFORE_INIT'}, {transaction});
            return operation;
        }
        if (payout && expected !== 'COMPLETED') {
            if (operation.status === 'AWAITING_DETAILS') {
                await operation.update({status: 'RECONCILIATION', error_code: 'CONFLICTING_FINAL_EVENT'}, {transaction});
                return operation;
            }
            if (!verifiedLookup) {
                // A signed failure is a reconciliation candidate, not yet a refund.
                await operation.update({...details, status: 'RECONCILIATION', error_code: 'PAYOUT_FAILURE_UNVERIFIED'}, {transaction});
                return operation;
            }
        }
        if (operation.kind === 'WALLET_TOPUP') {
            const {WalletTopup,WalletEntry}=require('../models/Wallet');
            const topup=await WalletTopup.findByPk(operation.domain_id,{transaction,lock:transaction.LOCK.UPDATE});
            if(!topup||topup.status!=='pending')throw failure('Recharge déjà finalisée ou absente',409);
            if(expected==='COMPLETED'){
                const policy=topup.pricing_snapshot?.fee_policy;
                const {POLICY}=require('./walletTopupPricing');
                // Initiation values are estimates. Only the legacy gross-for-net contract uses them.
                const legacy=policy!=='same_as_vote'&&policy!==POLICY;
                const delivered=net??(legacy?optionalAmount(operation.provider_net):null);
                const chargedFee=fee??(legacy?optionalAmount(operation.provider_fee):null);
                if(!legacy){
                    details.provider_fee=fee;
                    details.provider_net=net;
                }
                if(policy===POLICY)await require('./votenowFees').requireTopupAccounting(transaction);
                const creditError=walletCredit(topup,operation,delivered,chargedFee);
                if(creditError){await operation.update({...details,status:creditError==='NET_AMOUNT_MISSING'?'AWAITING_DETAILS':'RECONCILIATION',error_code:creditError},{transaction});return operation;}
                await operation.update({error_code:null},{transaction});
                await WalletEntry.create({wallet_id:topup.wallet_id,amount_delta:topup.amount_fcfa,balance_after:0,source_kind:'topup',source_id:topup.id},{transaction});
                await topup.update({status:'success',completed_at:new Date()},{transaction});
            }else await topup.update({status:'failed',completed_at:new Date()},{transaction});
        } else if (prefix === 'DEPOSIT') {
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
                const eventRow = await Event.findByPk(payment.event_id, {transaction, lock: transaction.LOCK.UPDATE});
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
                const delivered = withdrawal.fee_policy === sponsored.POLICY ? net
                    : net ?? (pendingFailure || event.netAmount != null ? null : payoutAmount(operation.provider_net));
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
                if (withdrawal.fee_policy === sponsored.POLICY) {
                    const frozen = withdrawal.pricing_snapshot;
                    const actualFee = fee ?? (event.feeAmount == null ? operation.expected_amount - delivered : null);
                    if (!sponsored.matches(withdrawal, operation.pricing_snapshot) ||
                        operation.target_net !== withdrawal.amount_fcfa || operation.expected_amount !== frozen.gross ||
                        actualFee !== frozen.provider_fee) {
                        await operation.update({...details, status:'RECONCILIATION', error_code:'PAYOUT_SPONSORED_TERMS_MISMATCH'}, {transaction});
                        return operation;
                    }
                }
                await postWithdrawal(withdrawal, 'settle', 'provider_success', transaction, operation.id);
                await withdrawal.update({
                    status: 'done',
                    completed_at: new Date(),
                    transaction_ref: event.reference || operation.provider_reference || event.paymentId
                }, {transaction});
            } else {
                // Le montant réservé est restitué une seule fois après échec confirmé.
                await postWithdrawal(withdrawal, 'release', 'provider_failure', transaction, operation.id);
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

async function organizerSuspended(organizerId, transaction) {
    // Account restriction changes acquire this same user lock before writing.
    const user = await User.findByPk(organizerId, {transaction, lock: transaction.LOCK.UPDATE});
    if (!user) throw failure('Organisateur introuvable.', 409);
    const [restrictions] = await sequelize.query('SELECT suspended FROM user_restrictions WHERE user_id = :id', {
        replacements: {id: organizerId}, transaction
    });
    return restrictions[0]?.suspended === true;
}

function suspendedPayout() {
    return Object.assign(failure('Organisateur suspendu. Les fonds restent réservés.', 403), {code: 'PAYOUT_ORGANIZER_SUSPENDED'});
}

async function initiatePayout(operation, organizerId) {
    const attempt = await sequelize.transaction(async transaction => {
        if (await organizerSuspended(organizerId, transaction)) return null;
        // Keep suspension serialized until the outbound request has resolved.
        return {result: await startProviderRequest(operation, transaction)};
    });
    if (attempt) return attempt.result;

    await restoreUnsent(operation.id);
    throw suspendedPayout();
}

async function restoreUnsent(operationId) {
    // This dispatcher proved it did not call KPay. Release the user lock
    // before taking the operation lock in order to preserve lock ordering.
    await sequelize.transaction(async transaction => {
        const row = await KpayOperation.findByPk(operationId, {transaction, lock: transaction.LOCK.UPDATE});
        if (row.status === 'INITIATING' && !row.provider_id && !row.last_event) {
            await row.update({status: 'CREATED', started_at: null}, {transaction});
        }
    });
}

function managedOperation(operation) {
    return process.env.PAYMENT_PROVIDER_MANAGER_ENABLED === 'true' || Boolean(operation.pricing_snapshot?.provider_selection);
}

function operationClient(operation) {
    if (!operation.pricing_snapshot?.provider_selection) return client;
    const adapter = require('./paymentProviders/manager').operationAdapter(operation);
    return {
        initiateWithdrawal: payload => adapter.initiate('payout',payload),
        initiatePayment: payload => adapter.initiate('deposit',payload),
        getPayment: id => adapter.lookup(id)
    };
}

async function startProviderRequest(operation, transaction) {
    if (managedOperation(operation)) {
        await require('./paymentProviders/manager').assertDispatch(operation,transaction);
    }
    const selected = operationClient(operation);
    return operation.kind === 'PAYOUT'
        ? selected.initiateWithdrawal(operation.request_payload)
        : selected.initiatePayment(operation.request_payload);
}

async function dispatch(operationId) {
    let organizerId;
    const operation = await sequelize.transaction(async transaction => {
        const row = await KpayOperation.findByPk(operationId, {transaction, lock: transaction.LOCK.UPDATE});
        if (!row || row.status !== 'CREATED') return null;
        if (row.kind === 'DEPOSIT') {
            const {kpayVoteMode,unavailableKpayTotal}=require('./votePricing');
            const mode=kpayVoteMode();
            const confirmation=row.pricing_snapshot?.vote_confirmation;
            const sandbox=mode==='sandbox' && row.environment==='sandbox' && confirmation==='sandbox_unverified';
            const live=mode==='live' && row.environment==='production' && (!confirmation || confirmation==='live_unverified');
            if ((!sandbox && !live) || row.started_at || row.provider_id || row.last_event) {
                throw unavailableKpayTotal();
            }
        }
        if(row.environment!==getConfig().mode)throw failure('Cette tentative appartient à un autre environnement de paiement.',409);
        if(!['DEPOSIT','PAYOUT','WALLET_TOPUP'].includes(row.kind))throw failure('Type d’opération inconnu',409);

        if (row.kind === 'PAYOUT') {
            const withdrawal = await Withdrawal.findByPk(row.domain_id, {transaction, lock: transaction.LOCK.UPDATE});
            if (withdrawal?.status !== 'processing') throw failure('Ce retrait n’est plus en cours de traitement.', 409);
            organizerId = withdrawal.organizer_id;
            if (await organizerSuspended(organizerId, transaction)) throw suspendedPayout();
            const provider = row.pricing_snapshot?.network || {mtn_momo: 'MTN_MOMO_CMR', orange_money: 'ORANGE_CMR'}[withdrawal.method];
            if (withdrawal.fee_policy === sponsored.POLICY) {
                await verifiedPayoutBeneficiary(withdrawal, transaction);
                const frozen = await sponsored.revalidate(withdrawal);
                if (!sponsored.matches(withdrawal, row.pricing_snapshot) ||
                    row.expected_amount !== frozen.gross || row.target_net !== frozen.net ||
                    row.request_payload?.amount !== frozen.gross || row.request_payload?.provider !== frozen.network ||
                    row.request_payload?.phoneNumber !== withdrawal.destination_phone) throw sponsored.changed();
                await sponsored.assertReserved(withdrawal, transaction);
            } else if (withdrawal.fee_policy === 'recipient_pays_v2') {
                await verifiedPayoutBeneficiary(withdrawal, transaction);
                if (row.expected_amount !== withdrawal.amount_fcfa || row.request_payload?.amount !== withdrawal.amount_fcfa ||
                    row.request_payload?.phoneNumber !== withdrawal.destination_phone || row.request_payload?.provider !== provider ||
                    !Number.isSafeInteger(withdrawal.net_fcfa) || !Number.isSafeInteger(withdrawal.fee_fcfa) ||
                    withdrawal.net_fcfa < 1 || withdrawal.fee_fcfa < 0 || withdrawal.net_fcfa + withdrawal.fee_fcfa !== withdrawal.amount_fcfa) {
                    throw failure('Les coordonnées ou le récapitulatif du transfert ont changé. Aucun transfert lancé.', 409);
                }
                // Older admin handlers set target_net to the reserved amount. The frozen
                // recipient-pays contract is authoritative for the new withdrawal policy.
                await row.update({target_net: withdrawal.net_fcfa}, {transaction});
            } else {
                if (row.started_at || row.provider_id || row.last_event) {
                    throw failure('Une tentative de transfert existe déjà. Vérifiez son résultat auprès de KPay.', 409);
                }
                const beneficiary = await verifiedHistoricalBeneficiary(withdrawal, transaction);
                if (!provider || row.request_payload?.provider !== provider || row.request_payload?.phoneNumber !== beneficiary.phone) {
                    throw failure('Les coordonnées de l’envoi ne correspondent pas au bénéficiaire validé. Annulez le retrait.', 409);
                }
            }
        }
        if (row.kind==='WALLET_TOPUP'&&row.pricing_snapshot?.fee_policy&&row.pricing_snapshot.fee_policy===require('./walletTopupPricing').POLICY) {
            await require('./votenowFees').requireTopupAccounting(transaction);
        }
        if (managedOperation(row)) await require('./paymentProviders/manager').assertDispatch(row,transaction);
        await row.update({status: 'INITIATING', started_at: new Date()}, {transaction});
        return row;
    });
    if (!operation) return;
    let result;
    try {
        result = operation.kind === 'PAYOUT'
            ? await initiatePayout(operation, organizerId)
            : managedOperation(operation)
                ? await sequelize.transaction(transaction => startProviderRequest(operation,transaction))
                : await startProviderRequest(operation);
    } catch (error) {
        if (error.code === 'PAYOUT_ORGANIZER_SUSPENDED') throw error;
        if (error.code === 'NO_PAYMENT_PROVIDER') {
            await restoreUnsent(operation.id);
            throw error;
        }
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

        if (error.definitive && operation.kind !== 'PAYOUT') {
            await applyEvent({
                event: 'payment.failed',
                status: 'FAILED',
                externalId: operation.external_id,
                paymentId: operation.provider_id || 'init-rejected',
                amount: operation.expected_amount
            }, true, false, operation.pricing_snapshot?.provider_selection?.provider_code || 'kpay');
        } else {
            await sequelize.transaction(async transaction => {
                const row = await KpayOperation.findByPk(operation.id, {transaction, lock: transaction.LOCK.UPDATE});
                if (operation.kind === 'PAYOUT' ? row.status === 'INITIATING' : !terminal.has(row.status)) await row.update({
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
        if (row.kind === 'PAYOUT' && terminal.has(row.status)) return;
        if (!result || typeof result.id !== 'string' || result.externalId !== row.external_id ||
            (row.kind === 'PAYOUT' ? payoutAmount(result.amount) : Number(result.amount)) !== row.expected_amount ||
            (row.kind === 'PAYOUT' && (!result.id.trim() || (result.isTest != null && typeof result.isTest !== 'boolean') ||
                (result.currency != null && result.currency !== 'XAF') ||
                (result.provider != null && result.provider !== row.request_payload.provider) ||
                (result.phoneNumber != null && result.phoneNumber !== row.request_payload.phoneNumber))) ||
            (result.currency && result.currency !== 'XAF') ||
            (typeof result.isTest === 'boolean' && result.isTest !== (row.environment === 'sandbox')) ||
            (row.provider_id && row.provider_id !== result.id)) {
            if (row.kind === 'PAYOUT' ? row.status === 'INITIATING' : !terminal.has(row.status)) await row.update({
                status: 'UNKNOWN',
                error_code: 'INIT_RESPONSE_MISMATCH'
            }, {transaction});
            return;
        }
        if (row.kind==='WALLET_TOPUP'&&terminal.has(row.status)) return;
        const changes = {provider_id: result.id, provider_reference: result.reference || null};
        if (row.kind === 'PAYOUT' && ['FAILED', 'CANCELLED'].includes(result.status)) {
            if (row.status === 'INITIATING') await row.update({...changes, status: 'UNKNOWN', error_code: 'INIT_UNCERTAIN'}, {transaction});
            return;
        }
        // L'URL n'est jamais une preuve de paiement. Seul le webhook signé crédite les votes.
        if (['DEPOSIT','WALLET_TOPUP'].includes(row.kind) && (result.mode === 'GATEWAY' || result.gatewayUrl)) {
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
        const fee = row.kind === 'PAYOUT' ? payoutAmount(result.feeAmount) : optionalAmount(result.feeAmount);
        const net = row.kind === 'PAYOUT' ? payoutAmount(result.netAmount) : optionalAmount(result.netAmount);
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
    if (replay) await applyEvent(replay,false,false,operation.pricing_snapshot?.provider_selection?.provider_code || 'kpay');
}

// Une réponse de consultation authentifiée par nos clés KPay peut servir à
// réconcilier, à condition de vérifier strictement les identifiants et montants.
const lastLookup = new Map();

async function reconcileDeposit(operationId) {
    const operation = await KpayOperation.findByPk(operationId);
    if (!operation || !['DEPOSIT','WALLET_TOPUP'].includes(operation.kind) || !operation.provider_id ||
        (!['PENDING', 'UNKNOWN', 'INITIATING'].includes(operation.status)&&!resumableWalletNetCheck(operation))) return;
    const now = Date.now();
    if (now - (lastLookup.get(operationId) || 0) < 15000) return;
    lastLookup.set(operationId, now);
    try {
        const response = await operationClient(operation).getPayment(operation.provider_id);
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
        const applied=await applyEvent({
            event: events[data.status], status: data.status,
            externalId: data.externalId, paymentId: data.id,
            reference: data.reference, amount: data.amount,
            currency: data.currency, isTest: data.isTest,
            provider: data.provider, phoneNumber: data.phoneNumber,
            feeAmount: data.feeAmount, netAmount: data.netAmount,
            failureReason: typeof data.failureReason === 'string' ? data.failureReason.slice(0, 1000) : null,
        },false,true,operation.pricing_snapshot?.provider_selection?.provider_code || 'kpay');
        console.info('[kpay.reconcile] Résultat local', {operationId,providerStatus:data.status,localStatus:applied.status,errorCode:applied.error_code||null});
        return applied;
    } catch (error) {
        console.warn('[kpay.reconcile]', {
            operationId, code: error.code || null,
            providerHttpStatus: error.providerHttpStatus || null
        });
    }
}

module.exports = {operationClient,hash, payoutQuote, dispatch, applyEvent, optionalAmount, failure, reconcileDeposit};
