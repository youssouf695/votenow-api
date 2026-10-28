function integer(value, label = 'Montant') {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw Object.assign(new Error(`${label} invalide`), { status: 400 });
  return number;
}
function normalizePhone(value) {
  let phone = String(value || '').replace(/[\s().-]/g, '').replace(/^\+/, '').replace(/^00/, '');
  if (/^06\d{8}$/.test(phone)) phone = phone.slice(1);
  if (/^6\d{8}$/.test(phone)) phone = '237' + phone;
  if (!/^2376\d{8}$/.test(phone)) throw Object.assign(new Error('Numéro camerounais invalide'), { status: 400 });
  return phone;
}
function amounts(price, quantity, rate) {
  const count = integer(quantity, 'Nombre de votes');
  if (count > 100) throw Object.assign(new Error('Maximum 100 votes par paiement'), { status: 400 });
  const gross = integer(integer(price) * count);
  const percent = Number(rate);
  if (!Number.isFinite(percent) || percent < 0 || percent > 50) throw new Error('Commission événement invalide');
  const commission = Math.round(gross * percent / 100);
  return { gross, commission, net: gross - commission, rate: percent, count };
}
// Le contrat public ne précise pas l'arrondi du payout. Aucun choix implicite.
function grossForNet(target, rate, rounding = 'exact') {
  target = integer(target);
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0 || rate >= 1) throw new Error('Tarif KPay invalide');
  if (!['exact', 'ceil_fee', 'floor_fee', 'round_fee'].includes(rounding)) throw new Error('Arrondi KPay non reconnu');
  const scale = 100000000;
  const units = Math.round(rate * scale);
  if (Math.abs(units / scale - rate) > 1e-10) throw new Error('Précision tarifaire non prise en charge');
  const estimate = Math.ceil(target / (1 - rate));
  if (!Number.isSafeInteger(estimate) || estimate > 2147483644 || units >= scale) throw new Error('Montant brut hors limites');
  for (let gross = Math.max(target, estimate - 3); gross <= estimate + 3; gross++) {
    const raw = BigInt(gross) * BigInt(units), denominator = BigInt(scale);
    let fee;
    if (rounding === 'exact') {
      if (raw % denominator !== 0n) continue;
      fee = Number(raw / denominator);
    } else if (rounding === 'ceil_fee') fee = Number((raw + denominator - 1n) / denominator);
    else if (rounding === 'floor_fee') fee = Number(raw / denominator);
    else fee = Number((raw + denominator / 2n) / denominator);
    if (gross - fee === target) return { gross, fee, net: target, rate, rounding };
  }
  throw Object.assign(new Error('Montant net exact non calculable sans règle d’arrondi KPay confirmée. Aucun transfert lancé.'), { status: 422 });
}
module.exports = { integer, normalizePhone, amounts, grossForNet };
