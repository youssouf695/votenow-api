const axios = require('axios');

exports.sendVerificationEmail = async (to, code, fullName) => {
  try {
    const response = await axios.post(
      'https://api.brevo.com/v3/smtp/email',
      {
        sender: {
          name: 'VoteNow',
          email: process.env.BREVO_SENDER,
        },
        to: [{ email: to, name: fullName }],
        subject: '🔐 Ton code de vérification VoteNow',
        htmlContent: `
          <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto; padding: 32px; border-radius: 12px; border: 1px solid #E5E7EB;">
            <h2 style="color: #111827;">Bonjour ${fullName} 👋</h2>
            <p style="color: #374151;">Voici ton code de vérification :</p>
            <div style="font-size: 40px; font-weight: bold; letter-spacing: 10px; color: #4F46E5; text-align: center; padding: 24px; background: #F3F4F6; border-radius: 8px; margin: 24px 0;">
              ${code}
            </div>
            <p style="color: #6B7280; font-size: 13px;">⏱ Expire dans <strong>15 minutes</strong>. Ne le partage avec personne.</p>
          </div>
        `,
      },
      {
        headers: {
          'api-key': process.env.BREVO_API_KEY,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log(`✅ Email envoyé à ${to} — MessageId: ${response.data.messageId}`);
    return response.data;
  } catch (error) {
    console.error('❌ Erreur Brevo API:', error.response?.data || error.message);
    throw new Error("Erreur lors de l'envoi de l'email");
  }
};





// // services/email.js - SIMULATION PURE
// exports.sendVerificationEmail = async (to, code, fullName) => {
//   console.log(`
// ╔════════════════════════════════════════════════════════════╗
// ║  🔐 CODE DE VÉRIFICATION (SIMULATION)                     ║
// ╠════════════════════════════════════════════════════════════╣
// ║  Destinataire : ${to}
// ║  Code          : ${code}
// ║  Valable 15 min                                             
// ╚════════════════════════════════════════════════════════════╝
//   `);
  
//   // Toujours retourner une promesse résolue
//   return Promise.resolve();
// };