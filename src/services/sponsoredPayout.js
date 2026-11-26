const db = require('../config/database');
const { getConfig } = require('../config/kpay');

const POLICY = 'votenow_pays_v1';
const enabled = () => process.env.WITHDRAWAL_VOTENOW_PAYS_ENABLED === 'true';
const unavailable = () => Object.assign(new Error('Les retraits sans frais sont temporairement indisponibles.'), { status: 503 });
const changed = () => Object.assign(new Error('Les conditions de transfert ont changé. Aucun transfert lancé.'), { status: 409 });

async function requireAccounting() {
  const [[row]] = await db.query(`
    SELECT to_regclass('financial_accounts') IS NOT NULL
      AND to_regclass('financial_journal_entries') IS NOT NULL
      AND to_regclass('financial_journal_lines') IS NOT NULL
      AND to_regprocedure('vn_financial_coverage_start()') IS NOT NULL
      AND to_regclass('payout_fee_funding') IS NOT NULL
      AND to_regclass('payout_fee_reservations') IS NOT NULL
      AND to_regclass('financial_book') IS NOT NULL
      AND to_regclass('financial_funding_evidence') IS NOT NULL AS ready
  `);
  if (!row?.ready) throw unavailable();
}

async function quote(amount, rail, capabilityId) {
  await requireAccounting();
  const route = await require('./paymentProviders/manager').select({
    environment: getConfig().mode, direction: 'payout', amount, rail, capabilityId, exactNet: true,
  });
  const result = { ...route, amount, net: amount, fee: 0, provider_fee: route.fee, policy: POLICY };
  return result;
}

function matches(withdrawal, quote) {
  const original = withdrawal.pricing_snapshot;
  return original?.policy === POLICY && quote?.policy === POLICY &&
    withdrawal.fee_fcfa === 0 && withdrawal.net_fcfa === withdrawal.amount_fcfa &&
    quote.amount === withdrawal.amount_fcfa && quote.net === withdrawal.net_fcfa && quote.fee === 0 &&
    quote.net_contract === 'gross_less_fee_v1' && Boolean(quote.network && quote.provider_selection?.account_id) &&
    Number.isSafeInteger(quote.provider_fee) && quote.provider_fee >= 0 &&
    quote.gross === quote.net + quote.provider_fee &&
    ['amount', 'net', 'fee', 'gross', 'provider_fee', 'network', 'environment', 'net_contract']
      .every(key => quote[key] === original[key]) &&
    ['provider_code', 'account_id', 'account_key', 'capability_id', 'tariff_id', 'rail', 'direction', 'amount']
      .every(key => quote.provider_selection?.[key] === original.provider_selection?.[key]) &&
    ['source', 'rate_units', 'fixed_fee', 'min_fee', 'max_fee', 'rounding']
      .every(key => quote.tariff_terms?.[key] === original.tariff_terms?.[key]);
}

async function revalidate(withdrawal) {
  const frozen = withdrawal.pricing_snapshot;
  const capability = frozen?.provider_selection?.capability_id;
  if (!capability || !matches(withdrawal, frozen)) throw changed();
  const current = await quote(withdrawal.amount_fcfa, withdrawal.method, capability);
  if (!matches(withdrawal, current)) throw changed();
  return frozen;
}

async function checkFunding(quote, transaction) {
  const account = quote.provider_selection.account_id;
  const [[funding]] = await db.query(`
    SELECT funded_fcfa FROM payout_fee_funding WHERE account_id = :account ${transaction ? 'FOR UPDATE' : ''}
  `, { replacements: { account }, transaction });
  if (!funding) throw unavailable();
  const [[usage]] = await db.query(`
    SELECT COALESCE(sum(fee_fcfa),0) AS used
    FROM payout_fee_reservations WHERE account_id = :account AND state IN ('reserved','settled')
  `, { replacements: { account }, transaction });
  if (BigInt(funding.funded_fcfa) - BigInt(usage.used) < BigInt(quote.provider_fee)) throw unavailable();
}

async function assertReserved(withdrawal, transaction) {
  const [[record]] = await db.query(`
    SELECT 1 FROM payout_fee_reservations
    WHERE withdrawal_id = :id AND account_id = :account AND fee_fcfa = :fee AND state = 'reserved'
  `, { replacements: {
    id: withdrawal.id, account: withdrawal.pricing_snapshot.provider_selection.account_id,
    fee: withdrawal.pricing_snapshot.provider_fee,
  }, transaction });
  if (!record) throw unavailable();
}

async function postFee(withdrawal, kind, transaction, operationId) {
  const quote = withdrawal.pricing_snapshot;
  if (!matches(withdrawal, quote)) throw changed();
  const replacements = { id: withdrawal.id, account: quote.provider_selection.account_id, fee: quote.provider_fee, operationId };
  if (kind === 'reserve') {
    await checkFunding(quote, transaction);
    await db.query(`INSERT INTO payout_fee_reservations(withdrawal_id,account_id,fee_fcfa,state)
      VALUES (:id,:account,:fee,'reserved')`, { replacements, transaction });
    return;
  }
  const [[closed]] = await db.query(`WITH closed AS (
    UPDATE payout_fee_reservations SET state = :state, operation_id = :operationId, closed_at = now()
    WHERE withdrawal_id = :id AND account_id = :account AND fee_fcfa = :fee AND state = 'reserved'
    RETURNING withdrawal_id
  ) SELECT * FROM closed`, {
    replacements: { ...replacements, state: kind === 'settle' ? 'settled' : 'released' }, transaction,
  });
  if (!closed) throw changed();
}

module.exports = { POLICY, enabled, quote, matches, revalidate, checkFunding, assertReserved, postFee, changed };
