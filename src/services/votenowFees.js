const db = require('../config/database');

async function mobileVoteTariff(transaction) {
  const [[{installed}]] = await db.query(
    "SELECT to_regclass('votenow_fee_versions') IS NOT NULL AS installed", {transaction}
  );
  if (!installed) return null;
  const [[tariff]] = await db.query(`
    SELECT id, rate_bps FROM votenow_fee_versions WHERE flow='mobile_vote' AND effective_at <= statement_timestamp()
    ORDER BY effective_at DESC LIMIT 1
  `, {transaction});
  if (!tariff) throw Object.assign(new Error('Tarif de paiement VoteNow indisponible.'), {status:503});
  return tariff;
}

async function requireTopupAccounting(transaction) {
  const [[{ready}]] = await db.query(`
    SELECT to_regclass('financial_book') IS NOT NULL
      AND to_regclass('votenow_fee_versions') IS NOT NULL
      AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('wallet_entries')
        AND tgname='financial_book_topup' AND tgenabled IN ('O','A'))
      AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('kpay_operations')
        AND tgname='financial_book_provider_result' AND tgenabled IN ('O','A')) AS ready
  `, {transaction});
  if (!ready) throw Object.assign(new Error('Comptabilité des recharges indisponible.'), {status:503});
}

async function cardTopupTariff() {
  await requireTopupAccounting();
  const [[tariff]] = await db.query(`
    SELECT id, rate_bps FROM votenow_fee_versions WHERE flow='card_topup' AND effective_at <= statement_timestamp()
    ORDER BY effective_at DESC LIMIT 1
  `);
  if (!tariff) throw Object.assign(new Error('Tarif de recharge indisponible.'), {status:503});
  return tariff;
}

module.exports = {mobileVoteTariff, cardTopupTariff, requireTopupAccounting};
