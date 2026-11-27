const fs = require('node:fs');
const path = require('node:path');
const sql = file => fs.readFileSync(path.join(__dirname, file), 'utf8');

async function install(client, rate) {
  await client.query('SELECT pg_advisory_xact_lock(82114730)');
  const [{installed, ready}] = await client.query(`
    SELECT to_regclass('financial_book') IS NOT NULL AS installed,
           to_regclass('payout_fee_reservations') IS NOT NULL AND
           to_regprocedure('vn_financial_coverage_start()') IS NOT NULL AS ready
  `);
  if (installed) return;
  if (!ready) throw new Error('Journal financier et migration sponsored-payout requis');
  await client.query(`LOCK TABLE users, events, withdrawals, payments, wallet_accounts, wallet_entries,
    wallet_topups, kpay_operations, financial_journal_entries, payout_fee_funding IN ACCESS EXCLUSIVE MODE`);
  const [{unverified}] = await client.query('SELECT EXISTS (SELECT 1 FROM payout_fee_funding WHERE funded_fcfa<>0) AS unverified');
  if (unverified) throw new Error('Rapprocher le financement existant avant installation du grand livre');
  await client.query(sql('financial-book.sql'));
  await finalize(client,rate);
}

async function finalize(client,rate) {
  await client.query(`
    INSERT INTO votenow_fee_versions(flow,rate_bps,effective_at,reason)
    VALUES ('mobile_vote',${Number(rate)},statement_timestamp(),'Tarif existant à la bascule'),
           ('card_topup',500,statement_timestamp(),'Tarif préparé, flux désactivé')
  `);
  await client.query(sql('financial-opening.sql'));
}

async function coordinated(client, rate, {activateStaged=false}={}) {
  if (!/^\d{1,5}$/.test(rate) || Number(rate) > 10000) throw new Error('Tarif Mobile Money invalide');
  await client.query('SELECT pg_advisory_xact_lock(82114727)');
  const stage=require('./financial-book-stage');
  if(activateStaged)return stage.activateStage(client,rate,finalize);
  const [{staged}]=await client.query("SELECT current_schema()='public' AND to_regnamespace('votenow_financial_stage') IS NOT NULL AS staged");
  if(staged)throw Error('Utiliser prepare-financial-cutover.js --activate pour le schéma passif.');
  const db = {transaction: fn => fn(null), query: async statement => [await client.query(statement)]};
  await require('./migrate-financial-journal')(db);
  await require('./migrate-sponsored-payout')(db);
  await install(client, rate);
}

module.exports = coordinated;
if (require.main === module) {
  if (!process.argv.includes('--apply')) {
    console.log('Plan : journal étendu, tarifs versionnés et écritures d’ouverture. Écrivains à arrêter avant la bascule.');
  } else {
    const db = require('../src/config/database');
    db.transaction(transaction => coordinated({
      query: async statement => (await db.query(statement,{transaction}))[0]
    }, process.env.VOTENOW_KPAY_VOTE_FEE_BPS ?? '500'))
      .then(() => console.log('Journal étendu prêt.'))
      .catch(error => { console.error(error.original?.code || error.message); process.exitCode = 1; })
      .finally(() => db.close());
  }
}
