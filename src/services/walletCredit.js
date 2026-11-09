// Customer wallet value and provider settlement are separate accounting amounts.
function walletCredit(topup,operation,net,fee){
 const target=Number(topup.amount_fcfa),gross=Number(operation.expected_amount);
 if(!Number.isSafeInteger(target)||target<1||!Number.isSafeInteger(gross)||gross<target)return 'WALLET_AMOUNT_INVALID';
 if(topup.pricing_snapshot?.fee_policy==='same_as_vote'){
  if(gross!==target||Number(topup.gross_fcfa)!==target)return 'WALLET_AMOUNT_INVALID';
  if(net!==null&&(net<0||net>gross))return 'PROVIDER_SETTLEMENT_INVALID';
  if(fee!==null&&(fee<0||fee>gross))return 'PROVIDER_SETTLEMENT_INVALID';
  if(net!==null&&fee!==null&&Math.abs(net+fee-gross)>.01)return 'PROVIDER_SETTLEMENT_INVALID';
  // applyEvent has already verified COMPLETED, external/provider IDs, gross,
  // currency and environment. Credit the purchased value, not merchant net.
  return null;
 }
 // Preserve the previous gross-for-net contract on older attempts.
 if(net===null)return 'NET_AMOUNT_MISSING';
 return net===target?null:'NET_AMOUNT_MISMATCH';
}
function resumableWalletNetCheck(op){return op.kind==='WALLET_TOPUP'&&((op.status==='RECONCILIATION'&&op.error_code==='NET_AMOUNT_MISMATCH')||(op.status==='AWAITING_DETAILS'&&op.error_code==='NET_AMOUNT_MISSING'))}
module.exports={walletCredit,resumableWalletNetCheck};
