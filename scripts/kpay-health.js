require('dotenv').config({ path: require('node:path').resolve(__dirname, '../.env') });
const { getConfig } = require('../src/config/kpay');
const client = require('../src/services/kpayClient');
const { grossForNet } = require('../src/services/kpayAmounts');
(async () => {
  const config = getConfig();
  const [account, catalogue] = await Promise.all([client.me(), client.pricelist()]);
  const expected = config.mode === 'sandbox' ? 'TEST' : 'PRODUCTION';
  if (account.environment !== expected) throw new Error('Environnement KPay incohérent');
  console.log('Connexion KPay OK. Environnement :', config.mode);
  console.log('Application :', account.application?.name || '(sans nom)');
  const country = catalogue.countries?.find(row => row.code === 'CMR');
  for (const operator of country?.operators || []) {
    console.log(operator.operator, 'taux public encaissement :', operator.depositRate, 'taux public retrait :', operator.withdrawalRate);
    try { console.log('Projection pour 3000 FCFA nets :', grossForNet(3000, operator.withdrawalRate, process.env.KPAY_PAYOUT_ROUNDING || 'exact')); }
    catch (error) { console.log('Projection bloquée :', error.message); }
  }
  console.log('Aucun encaissement ni transfert initié. Confirmez les tarifs applicables à votre compte et l’arrondi auprès de KPay.');
})().catch(() => { console.error('Vérification KPay échouée. Contrôlez les clés, le réseau et le mode configuré.'); process.exitCode = 1; });
