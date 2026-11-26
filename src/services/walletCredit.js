const {POLICY,topupFee}=require('./walletTopupPricing');
// Customer wallet value and provider settlement are separate accounting amounts.
function walletCredit(topup,operation,net,fee){
 const target=Number(topup.amount_fcfa),gross=Number(operation.expected_amount);
 if(!Number.isSafeInteger(target)||target<1||!Number.isSafeInteger(gross)||gross<target)return 'WALLET_AMOUNT_INVALID';
 const snapshot=topup.pricing_snapshot;
 if(snapshot?.fee_policy===POLICY||snapshot?.fee_policy==='same_as_vote'){
  const priced=snapshot.fee_policy===POLICY;
  const rate=snapshot.votenow_payment_fee_bps;
  if(priced&&(!Number.isInteger(rate)||rate<0||rate>10000))return 'WALLET_AMOUNT_INVALID';
  const expectedFee=priced?topupFee(target,rate):0;
  if(gross!==target+expectedFee||Number(topup.gross_fcfa)!==gross)return 'WALLET_AMOUNT_INVALID';
  if(priced){
   const frozen=operation.pricing_snapshot;
   if(!snapshot.votenow_fee_version_id||snapshot.votenow_payment_fee_fcfa!==expectedFee||
      snapshot.net!==target||snapshot.gross!==gross||snapshot.fee!==expectedFee||
      operation.target_net!==target||!['fee_policy','votenow_fee_version_id','votenow_payment_fee_bps',
       'votenow_payment_fee_fcfa','net','gross','fee'].every(key=>frozen?.[key]===snapshot[key]))return 'WALLET_AMOUNT_INVALID';
  }
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
function resumableWalletNetCheck(op){return op.kind==='WALLET_TOPUP'&&((op.status==='RECONCILIATION'&&['NET_AMOUNT_MISMATCH','PROVIDER_SETTLEMENT_INVALID'].includes(op.error_code))||(op.status==='AWAITING_DETAILS'&&op.error_code==='NET_AMOUNT_MISSING'))}
module.exports={walletCredit,resumableWalletNetCheck};
