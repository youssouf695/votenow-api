const crypto = require('node:crypto');
const { getConfig } = require('../config/kpay');
const { applyEvent } = require('../services/kpayOperations');
function validSignature(raw, signature, secret) {
  if (!Buffer.isBuffer(raw) || !/^[a-f0-9]{64}$/i.test(String(signature || ''))) return false;
  const expected = crypto.createHmac('sha256', secret).update(raw).digest();
  return crypto.timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}
async function handleWebhook(req, res) {
  try {
    const { webhookSecret } = getConfig();
    if (!validSignature(req.body, req.get('X-KPAY-Signature'), webhookSecret)) return res.status(400).json({ error: 'Signature invalide' });
    const event = JSON.parse(req.body.toString('utf8'));
    if (!/^(payment|payout)\.(completed|failed|cancelled)$/.test(event.event || '')) return res.status(200).json({ received: true });
    const header = req.get('X-KPAY-Event');
    if (header && header !== event.event) return res.status(400).json({ error: 'Notification incohérente' });
    await applyEvent(event);
    return res.status(200).json({ received: true });
  } catch (error) {
    // Une erreur transactionnelle renvoie 500 : KPay peut rejouer la notification.
    return res.status(error instanceof SyntaxError ? 400 : error.status || 500).json({ error: error.status ? error.message : 'Notification non traitée' });
  }
}
module.exports = { handleWebhook, validSignature };
