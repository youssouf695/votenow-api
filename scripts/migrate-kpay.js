// Exécuter depuis votenow-api : node scripts/migrate-kpay.js --apply
require('dotenv').config({ path: require('node:path').resolve(__dirname, '../.env') });
const sequelize = require('../src/config/database');
const { DataTypes } = require('sequelize');
const KpayOperation = require('../src/models/KpayOperation');
async function main() {
  await sequelize.authenticate();
  if (!process.argv.includes('--apply')) {
    console.log('Préparation : ajouter payments.commission_rate_applied, créer kpay_operations, définir le taux par défaut des nouveaux événements à 15 %.');
    console.log('Aucun changement effectué. Ajoutez --apply pour appliquer. Les taux des événements existants restent inchangés.');
    return;
  }
  await sequelize.transaction(async transaction => {
    const query = sequelize.getQueryInterface();
    const columns = await query.describeTable('payments', { transaction });
    if (!columns.commission_rate_applied) await query.addColumn('payments', 'commission_rate_applied', { type: DataTypes.DECIMAL(5, 2), allowNull: true }, { transaction });
    await KpayOperation.sync({ transaction });
    await sequelize.query('ALTER TABLE "events" ALTER COLUMN "commission_rate" SET DEFAULT 15.00', { transaction });
    if (process.argv.includes('--existing-default-20-to-15')) {
      await sequelize.query('UPDATE "events" SET "commission_rate" = 15.00 WHERE "commission_rate" = 20.00', { transaction });
      console.log('Événements actuellement à 20 % passés à 15 % pour leurs futurs paiements.');
    }
  });
  console.log('Migration KPay appliquée. Aucun paiement, vote ou solde historique modifié.');
}
main().catch(() => { console.error('Migration échouée. Vérifiez les journaux PostgreSQL et la connexion.'); process.exitCode = 1; }).finally(() => sequelize.close());
