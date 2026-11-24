const client = require('../kpayClient');
const {getConfig} = require('../../config/kpay');

const {networks:network,depositHealth}=require('./mobileHealth');
const operator = {mtn_momo: 'MTN', orange_money: 'Orange'};

module.exports = {
  supports(account, {simulation = false} = {}) {
    return account.account_key === 'default' && (simulation || account.environment === getConfig().mode);
  },
  network(rail) { return network[rail]; },
  health(route) { return depositHealth(route.rail); },
  async eligible(route, phone) {
    if (route.direction === 'payout') return true;
    const predicted = await client.predictProvider(phone);
    if (predicted.country !== 'CMR' || predicted.provider !== network[route.rail]) return false;
    return ['available','delayed'].includes(await depositHealth(route.rail));
  },
  async tariff(route) {
    const catalogue = await client.pricelist();
    const row = catalogue.countries?.find(item => item.code === 'CMR' && item.currency === 'XAF')
      ?.operators?.find(item => item.operator === operator[route.rail]);
    const rate = route.direction === 'payout' ? row?.withdrawalRate : row?.depositRate;
    return {
      rate_units: typeof rate === 'number' ? Math.round(rate * 100000000) : null,
      rounding: route.direction === 'payout' ? process.env.KPAY_PAYOUT_ROUNDING || 'exact' : 'round_fee'
    };
  },
  initiate(direction, payload) {
    return direction === 'payout' ? client.initiateWithdrawal(payload) : client.initiatePayment(payload);
  },
  lookup(id) { return client.getPayment(id); }
};
