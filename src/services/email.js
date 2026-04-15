// services/email.js
exports.sendVerificationEmail = async (to, code, fullName) => {
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'VoteNow <onboarding@resend.dev>',
        // from: 'VoteNow <noreply@contact.votenow.com>',
        to: [to],
        subject: '🔐 Votre code de vérification VoteNow',
        html: `<div>Bonjour ${fullName},<br/><br/>Votre code de vérification est : <strong>${code}</strong><br/><br/>Ce code expirera dans 15 minutes.<br/><br/>L'équipe VoteNow</div>`
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Resend API Error: ${response.status} - ${errorBody}`);
    }

    const data = await response.json();
    console.log(`✅ Email envoyé à ${to}, ID: ${data.id}`);
  } catch (error) {
    console.error('❌ Erreur envoi email:', error);
    throw error;
  }
};