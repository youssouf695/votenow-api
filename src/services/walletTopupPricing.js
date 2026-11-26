const POLICY = 'votenow_topup_fee_v1';

function topupFee(principal, rate) {
  return Number((BigInt(principal) * BigInt(rate) + 5000n) / 10000n);
}

module.exports = {POLICY, topupFee};
