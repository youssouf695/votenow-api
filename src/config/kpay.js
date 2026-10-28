function getConfig() {
  const mode = (process.env.KPAY_MODE || 'sandbox').trim();
  const apiKey = (process.env.KPAY_API_KEY || '').trim();
  const secretKey = (process.env.KPAY_SECRET_KEY || '').trim();
  const webhookSecret = (process.env.KPAY_WEBHOOK_SECRET || '').trim();

  const problems = [];

  if (!['sandbox', 'production'].includes(mode)) {
    problems.push('KPAY_MODE doit être sandbox ou production');
  }

  if (!apiKey) {
    problems.push('KPAY_API_KEY absente');
  } else if (['sandbox', 'production'].includes(mode)) {
    const prefix = mode === 'production'
      ? 'kpay_live_'
      : 'kpay_test_';

    if (!apiKey.startsWith(prefix)) {
      problems.push(`KPAY_API_KEY doit commencer par ${prefix}`);
    }
  }

  if (!secretKey) {
    problems.push('KPAY_SECRET_KEY absente');
  } else if (!/^[a-f0-9]{64}$/i.test(secretKey)) {
    problems.push(
      'KPAY_SECRET_KEY : format attendu de 64 caractères hexadécimaux'
    );
  }

  if (!webhookSecret) {
    problems.push('KPAY_WEBHOOK_SECRET absent');
  }

  if (problems.length) {
    const error = new Error(
      `Configuration KPay : ${problems.join(' ; ')}.`
    );
    error.status = 503;
    throw error;
  }

  return {
    mode,
    apiKey,
    secretKey,
    webhookSecret,
    baseUrl: 'https://admin.kpay.site',
  };
}

module.exports = { getConfig };