// A legacy price can be retained, but cannot be assigned to a different campaign.
function campaignVotePrice(value, currentPrice) {
  const price = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  const unchanged = Number.isSafeInteger(price) && price > 0 && price === currentPrice;
  if (!unchanged && (!Number.isSafeInteger(price) || price < 100 || price > 10000)) {
    throw Object.assign(new Error('Le prix d’un vote doit être compris entre 100 et 10 000 FCFA.'), {status:400});
  }
  return price;
}

module.exports = {campaignVotePrice};
