function getConfig() {
  const mode = process.env.KPAY_MODE || 'sandbox';
  const apiKey = process.env.KPAY_API_KEY || '';
  const secretKey = process.env.KPAY_SECRET_KEY || '';
  const webhookSecret = process.env.KPAY_WEBHOOK_SECRET || '';
  if (!['sandbox', 'production'].includes(mode)) throw new Error('KPAY_MODE invalide');
  const prefix = mode === 'sandbox' ? 'kpay_test_' : 'kpay_live_';
  if (!apiKey.startsWith(prefix) || !/^[a-f0-9]{64}$/i.test(secretKey) || !webhookSecret) {
    const error = new Error('Configuration KPay absente ou incohérente.');
    error.status = 503;
    throw error;
  }
  return { mode, apiKey, secretKey, webhookSecret, baseUrl: 'https://admin.kpay.site' };
}
module.exports = { getConfig };
