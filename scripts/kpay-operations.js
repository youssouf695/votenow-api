// Consultation uniquement : aucune opération KPay réinitiée ou solde modifié.
require('dotenv').config({ path: require('node:path').resolve(__dirname, '../.env') });
const sequelize = require('../src/config/database');
const Operation = require('../src/models/KpayOperation');
const { Op } = require('sequelize');
(async () => {
  await sequelize.authenticate();
  const rows = await Operation.findAll({
    where: { status: { [Op.in]: ['CREATED', 'INITIATING', 'UNKNOWN', 'PENDING', 'AWAITING_DETAILS', 'RECONCILIATION'] } },
    attributes: ['id', 'kind', 'domain_id', 'external_id', 'environment', 'status', 'provider_id', 'provider_reference',
      'expected_amount', 'target_net', 'provider_net', 'provider_fee', 'error_code', 'created_at'],
    order: [['created_at', 'ASC']], limit: 50, raw: true,
  });
  console.table(rows);
  console.log('Lecture seule. Statut incertain : rapprochez external_id dans KPay avant tout nouvel envoi ou remboursement.');
})().catch(() => { console.error('Consultation indisponible. Vérifiez la connexion et la migration.'); process.exitCode = 1; }).finally(() => sequelize.close());
