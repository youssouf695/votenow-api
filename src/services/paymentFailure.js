// Only allow-listed interpretations leave the server. Never expose upstream text.
function classifyFailure(reason) {
  const text = typeof reason === 'string' ? reason.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().slice(0, 1000) : '';
  if (/insufficient[_ -]*(funds|balance)|not enough (funds|balance)|solde.*insuffisant|insufficient.*balance/.test(text)) return 'INSUFFICIENT_FUNDS';
  if (/invalid[_ -]*pin|incorrect[_ -]*pin|code secret incorrect|wrong[_ -]*pin/.test(text)) return 'INVALID_PIN';
  if (/user[_ -]*(cancelled|canceled)|customer[_ -]*(cancelled|canceled)|annul.*(client|utilisateur)/.test(text)) return 'USER_CANCELLED';
  if (/expired|expiration|expire|timed out|timeout/.test(text)) return 'EXPIRED';
  return 'PAYMENT_FAILED';
}
const messages = {
  INSUFFICIENT_FUNDS: 'Le solde de votre compte Mobile Money est insuffisant. Rechargez votre compte ou choisissez un autre moyen de paiement.',
  INVALID_PIN: 'Le code secret Mobile Money a été refusé. Vérifiez-le sur votre téléphone avant de réessayer.',
  USER_CANCELLED: 'Vous avez annulé la demande de paiement. Aucun vote n’a été validé.',
  EXPIRED: 'La demande de paiement a expiré. Si un débit apparaît sur votre compte, contactez le support avant de recommencer.',
  PAYMENT_FAILED: 'Le paiement n’a pas abouti. Si votre compte a été débité, contactez le support avant de recommencer.',
};
function publicFailure(operation, paymentStatus) {
  if (paymentStatus !== 'failed') return { failure_code: null, failure_message: null };
  const code = classifyFailure(operation?.last_event?.failureReason);
  return { failure_code: code, failure_message: messages[code] };
}
module.exports = { classifyFailure, publicFailure };
