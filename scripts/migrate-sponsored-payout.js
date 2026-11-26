const fs = require('node:fs');
const path = require('node:path');

async function migrate(db) {
  return db.transaction(async transaction => {
    await db.query('SELECT pg_advisory_xact_lock(82114729)', { transaction });
    const [[state]] = await db.query(`
      SELECT to_regclass('financial_accounts') IS NOT NULL AND
             to_regclass('financial_journal_entries') IS NOT NULL AND
             to_regclass('financial_journal_lines') IS NOT NULL AND
             to_regprocedure('vn_financial_coverage_start()') IS NOT NULL AND
             to_regclass('provider_accounts') IS NOT NULL AND
             to_regclass('provider_capabilities') IS NOT NULL AND
             to_regclass('provider_tariff_versions') IS NOT NULL AND
             to_regclass('kpay_operations') IS NOT NULL AS ready,
             to_regclass('payout_fee_funding') IS NOT NULL AS funding,
             to_regclass('payout_fee_reservations') IS NOT NULL AS reservations
    `, { transaction });
    if (!state.ready) throw new Error('Catalogue, opérations et journal financier requis.');
    if (state.funding && state.reservations) return;
    if (state.funding || state.reservations) throw new Error('Schéma sponsorisé partiel.');
    await db.query(fs.readFileSync(path.join(__dirname, 'sponsored-payout.sql'), 'utf8'), { transaction });
  });
}

module.exports = migrate;

if (require.main === module) {
  if (!process.argv.includes('--apply')) console.log('Plan : ajouter la réserve des frais VoteNow et figer les nouveaux snapshots. Aucun financement ni activation.');
  else {
    const db = require('../src/config/database');
    migrate(db).then(() => console.log('Socle des frais VoteNow prêt.'))
      .catch(error => { console.error(error.original?.code || error.message); process.exitCode = 1; })
      .finally(() => db.close());
  }
}
