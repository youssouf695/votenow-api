const axios = require('axios');
const { getConfig } = require('../config/kpay');

async function request(method, path, data) {
  const config = getConfig();
  try {
    const response = await axios.request({
      method, url: config.baseUrl + path, data, timeout: 15000,
      maxRedirects: 0, maxContentLength: 1024 * 1024,
      headers: { 'X-API-Key': config.apiKey, 'X-Secret-Key': config.secretKey, 'Content-Type': 'application/json' },
    });
    return response.data;
  } catch (error) {
    // Ne jamais propager l'erreur Axios : elle contient les clés dans config.headers.
    const status = error.response?.status;
    const safe = new Error('La demande KPay ne peut pas être confirmée pour le moment.');
    safe.providerHttpStatus = status || null;
    safe.definitive = [400, 401, 403, 404, 422].includes(status);
    throw safe;
  }
}
async function pricelist() {
  const result = await axios.get('https://admin.kpay.site/api/public/pricelist', { timeout: 10000, maxRedirects: 0, maxContentLength: 1024 * 1024 });
  return result.data;
}
module.exports = {
  initiatePayment: data => request('POST', '/api/v1/payments/init', data),
  initiateWithdrawal: data => request('POST', '/api/v1/payments/withdraw', data),
  predictProvider: phoneNumber => request('POST', '/api/v1/payments/predict-provider', { phoneNumber }),
  me: () => request('GET', '/api/v1/payments/me'),
  balance: () => request('GET', '/api/v1/payments/balance'),
  pricelist,
};
