const client = require('../kpayClient');
const {getConfig} = require('../../config/kpay');

const networks = {mtn_momo: 'MTN_MOMO_CMR', orange_money: 'ORANGE_CMR'};
const cached = new Map();

function depositHealth(rail) {
  const mode = getConfig().mode;
  let entry = cached.get(mode);
  if (!entry || entry.expires <= Date.now()) {
    entry = {expires: Date.now() + 15000};
    entry.result = Promise.resolve().then(() => client.availability()).then(result => {
      const countries = Array.isArray(result) ? result : result?.data;
      const providers = Array.isArray(countries) ? countries.find(row => row?.country === 'CMR')?.providers : null;
      return Array.isArray(providers) ? providers : [];
    }).catch(() => { entry.expires = Date.now() + 5000; return null; });
    cached.set(mode, entry);
  }
  return entry.result.then(providers => {
    const types = providers?.find(row => row?.provider === networks[rail])?.operationTypes;
    const status = Array.isArray(types) ? types.find(row => row?.operationType === 'DEPOSIT')?.status : types?.DEPOSIT;
    return ({OPERATIONAL:'available',DELAYED:'delayed',CLOSED:'unavailable'})[status] || 'unknown';
  });
}

module.exports = {networks,depositHealth};
