const fs = require('node:fs');
const path = require('node:path');

async function migrate(sequelize) {
  return sequelize.transaction(async transaction => {
    await sequelize.query('SELECT pg_advisory_xact_lock(82114728)', {transaction});
    const [[existing]] = await sequelize.query(`
      SELECT to_regprocedure(format('%I.vn_financial_coverage_start()', current_schema())) IS NOT NULL AS coverage,
             to_regclass(format('%I.financial_accounts', current_schema())) IS NOT NULL AS accounts,
             to_regclass(format('%I.financial_journal_entries', current_schema())) IS NOT NULL AS entries,
             to_regclass(format('%I.financial_journal_lines', current_schema())) IS NOT NULL AS lines
    `, {transaction});
    if (Object.values(existing).every(Boolean)) return;
    if (Object.values(existing).some(Boolean)) throw new Error('Schéma financier partiel');

    const [[{cutoff}]] = await sequelize.query('SELECT clock_timestamp() AS cutoff', {transaction});
    await sequelize.query(`
      CREATE FUNCTION vn_financial_coverage_start() RETURNS timestamptz
      LANGUAGE SQL IMMUTABLE AS $$ SELECT TIMESTAMPTZ '${cutoff.toISOString()}' $$
    `, {transaction});
    await sequelize.query(fs.readFileSync(path.join(__dirname, 'financial-journal.sql'), 'utf8'), {transaction});
  });
}

module.exports = migrate;

if (require.main === module) {
  if (!process.argv.includes('--apply')) {
    console.log('Plan : créer le journal financier et fixer sa date de couverture. Aucun historique modifié.');
  } else {
    const sequelize = require('../src/config/database');
    migrate(sequelize)
      .then(() => console.log('Journal financier prêt.'))
      .catch(error => { console.error(error.original?.code || error.message); process.exitCode = 1; })
      .finally(() => sequelize.close());
  }
}
