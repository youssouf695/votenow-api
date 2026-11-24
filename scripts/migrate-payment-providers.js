const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');

async function migrate(db) {
  await db.transaction(async transaction => {
    const query = (sql, replacements) => db.query(sql, {transaction, replacements});
    await query('SELECT pg_advisory_xact_lock(82114729)');
    await query(fs.readFileSync(path.join(__dirname, 'payment-providers.sql'), 'utf8'));
    await query("INSERT INTO payment_providers(id,code) VALUES (:id,'kpay') ON CONFLICT DO NOTHING", {id:randomUUID()});
    for (const environment of ['sandbox', 'production']) {
      await query(`
        INSERT INTO provider_accounts(id,provider_code,environment,account_key)
        VALUES (:id,'kpay',:environment,'default') ON CONFLICT DO NOTHING
      `, {id: randomUUID(), environment});
      for (const direction of ['deposit', 'payout']) {
        for (const rail of ['mtn_momo', 'orange_money']) {
          await query(`
            INSERT INTO provider_capabilities(id,account_id,direction,rail,country,currency,priority,min_amount,max_amount)
            SELECT :id,id,:direction,:rail,'CMR','XAF',100,:minimum,:maximum
            FROM provider_accounts WHERE provider_code='kpay' AND environment=:environment AND account_key='default'
            ON CONFLICT DO NOTHING
          `, {id: randomUUID(), environment, direction, rail,
            minimum: direction === 'payout' ? 500 : 50,
            maximum: direction === 'payout' ? 2147483647 : 1000000});
          await query(`
            INSERT INTO provider_tariff_versions(id,capability_id,effective_at,source,rate_units,fixed_fee,min_fee,rounding)
            SELECT :id,c.id,'2000-01-01T00:00:00Z','adapter',0,0,0,'exact'
            FROM provider_capabilities c JOIN provider_accounts a ON a.id=c.account_id
            WHERE a.provider_code='kpay' AND a.environment=:environment AND a.account_key='default'
              AND c.rail=:rail AND c.direction=:direction ON CONFLICT DO NOTHING
          `, {id: randomUUID(), environment, direction, rail});
        }
      }
    }
  });
}

module.exports = migrate;
if (require.main === module) {
  if (!process.argv.includes('--apply')) {
    console.log('Plan : ajouter le catalogue des fournisseurs et initialiser KPay.');
  } else {
    const db = require('../src/config/database');
    migrate(db).catch(error => {console.error(error.original?.code || error.name);process.exitCode=1;}).finally(() => db.close());
  }
}
