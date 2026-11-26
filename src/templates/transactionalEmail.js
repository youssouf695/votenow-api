const LOGO_URL = 'https://votenow.cm/images/logonew.png';
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

const copy = {
  fr: {
    login: ['Votre code de connexion VoteNow', 'Confirmez votre connexion', 'Saisissez ce code sur la page de connexion pour accéder à votre compte.'],
    registration: ['Votre code d’inscription VoteNow', 'Terminez votre inscription', 'Saisissez ce code sur VoteNow pour confirmer votre adresse et créer votre compte.'],
    verification: ['Vérifiez votre adresse email VoteNow', 'Confirmez votre adresse email', 'Saisissez ce code sur VoteNow pour vérifier votre adresse email.'],
    beneficiary: ['Confirmez votre numéro de retrait VoteNow', 'Confirmez votre numéro de retrait', 'Saisissez ce code sur VoteNow pour autoriser ce bénéficiaire à recevoir vos retraits.'],
    beneficiaryResend: ['Votre nouveau code pour un numéro de retrait VoteNow', 'Confirmez votre numéro de retrait', 'Utilisez ce nouveau code sur VoteNow pour confirmer le bénéficiaire ci-dessous.'],
    walletCard: ['Vérifiez votre opération VoteNow Card', 'Confirmez votre opération Card', 'Saisissez ce code dans le panneau de sécurité de votre VoteNow Card.'],
    greeting: name => name ? `Bonjour ${name},` : 'Bonjour,',
    label: 'Code de vérification',
    expiry: 'Ce code expire dans 15 minutes.',
    safety: 'Saisissez le code uniquement sur VoteNow et ne le communiquez à personne. Si vous n’avez pas demandé cette opération, ignorez cet e-mail.',
    withdrawalSafety: 'Si vous n’avez pas demandé cet ajout, ne confirmez pas le bénéficiaire et sécurisez votre compte.',
    signature: 'L’équipe VoteNow',
    powered: 'Propulsé par CorporateTS',
  },
  en: {
    login: ['Your VoteNow sign-in code', 'Confirm your sign-in', 'Enter this code on the sign-in page to access your account.'],
    registration: ['Your VoteNow registration code', 'Finish signing up', 'Enter this code on VoteNow to confirm your email address and create your account.'],
    verification: ['Verify your VoteNow email address', 'Confirm your email address', 'Enter this code on VoteNow to verify your email address.'],
    beneficiary: ['Confirm your VoteNow withdrawal number', 'Confirm your withdrawal number', 'Enter this code on VoteNow to authorize this recipient for your withdrawals.'],
    beneficiaryResend: ['Your new VoteNow withdrawal number code', 'Confirm your withdrawal number', 'Use this new code on VoteNow to confirm the recipient below.'],
    walletCard: ['Verify your VoteNow Card action', 'Confirm your Card action', 'Enter this code in your VoteNow Card security panel.'],
    greeting: name => name ? `Hello ${name},` : 'Hello,',
    label: 'Verification code',
    expiry: 'This code expires in 15 minutes.',
    safety: 'Enter this code only on VoteNow and never share it. If you did not request this action, ignore this email.',
    withdrawalSafety: 'If you did not request this addition, do not confirm the recipient and secure your account.',
    signature: 'The VoteNow team',
    powered: 'Powered by CorporateTS',
  },
};

function emailLanguage(req) {
  return req.acceptsLanguages?.('fr', 'en') === 'en' ? 'en' : 'fr';
}

function renderOtpEmail({ kind, language = 'fr', name, code, beneficiary }) {
  const lang = language === 'en' ? 'en' : 'fr';
  const labels = copy[lang];
  const [subject, title, instruction] = labels[kind];
  const greeting = labels.greeting(name);
  const recipient = beneficiary ? [
    beneficiary.full_name, beneficiary.phone,
    beneficiary.method === 'orange_money' ? 'Orange Money' : 'MTN Mobile Money',
  ] : [];
  const notes = [labels.safety, ...(beneficiary ? [labels.withdrawalSafety] : [])];
  const textContent = [
    'VoteNow', title, greeting, instruction, recipient.join('\n'),
    `${labels.label}\n${code}\n${labels.expiry}`,
    notes.join('\n'), labels.signature, labels.powered,
  ].filter(Boolean).join('\n\n');
  const htmlContent = `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background-color:#f4f1e9;color:#17243b;font-family:Arial,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#f4f1e9"><tr><td align="center" style="padding:20px 10px;">
<!--[if mso]><table role="presentation" width="560" align="center"><tr><td><![endif]-->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#ffffff" style="max-width:560px;border:1px solid #ded7c8;">
<tr><td bgcolor="#17243b" style="padding:16px 22px;border-bottom:3px solid #c9a84c;">
<table role="presentation" cellspacing="0" cellpadding="0"><tr>
<td bgcolor="#faf3df" style="padding:4px 8px;"><img src="${LOGO_URL}" width="64" height="47" alt="" style="display:block;width:64px;height:auto;border:0;"></td>
<td style="padding-left:12px;color:#ffffff;font-size:17px;font-weight:bold;">VoteNow</td>
</tr></table></td></tr>
<tr><td style="padding:24px 22px;font-size:16px;line-height:1.55;">
<h1 style="margin:0 0 14px;font-family:Georgia,serif;font-size:27px;line-height:1.2;color:#17243b;">${escapeHtml(title)}</h1>
<p style="margin:0 0 8px;">${escapeHtml(greeting)}</p>
<p style="margin:0 0 16px;">${escapeHtml(instruction)}</p>
${recipient.length ? `<p style="margin:0 0 16px;padding:10px;background-color:#f3f5f8;overflow-wrap:anywhere;">${recipient.map(escapeHtml).join('<br>')}</p>` : ''}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#f5edd5"><tr><td align="center" style="padding:14px 8px;border:1px solid #dfc986;color:#17243b;">
<p style="margin:0;font-size:14px;font-weight:bold;">${escapeHtml(labels.label)}</p>
<p dir="ltr" style="margin:4px 0;font-family:Consolas,'Courier New',monospace;font-size:34px;line-height:1.2;font-weight:bold;">${escapeHtml(code)}</p>
<p style="margin:0;font-size:14px;">${escapeHtml(labels.expiry)}</p>
</td></tr></table>
${notes.map(note => `<p style="margin:14px 0 0;color:#465369;font-size:14px;">${escapeHtml(note)}</p>`).join('')}
<p style="margin:16px 0 0;font-weight:bold;">${escapeHtml(labels.signature)}</p>
</td></tr>
<tr><td bgcolor="#e9eef4" style="padding:12px 22px;color:#34435a;font-size:13px;">${escapeHtml(labels.powered)}</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`;
  return { subject, htmlContent, textContent };
}

module.exports = { renderOtpEmail, emailLanguage };
