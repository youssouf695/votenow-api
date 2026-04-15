const twilio = require('twilio');

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

/**
 * Envoie un code de vérification par WhatsApp
 */
exports.sendVerificationWhatsApp = async (to, code, fullName) => {
  const message = `🔐 *VoteNow - Vérification*\n\nBonjour ${fullName},\n\nVotre code de vérification est : *${code}*\n\nCe code expirera dans 15 minutes.\n\nMerci de votre confiance !`;

  await client.messages.create({
    body: message,
    from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
    to: `whatsapp:${to}`
  });
};