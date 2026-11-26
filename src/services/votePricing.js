const {Event, Candidate} = require('../models');
const {amounts} = require('./kpayAmounts');

const failure = (message,status=400,code) => Object.assign(new Error(message),{status,code});

function voteInteger(value,label) {
  const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(number) || number<1) throw failure(`${label} invalide`);
  return number;
}

const MAX_MOBILE_VOTES=10000;
const MAX_MOBILE_AMOUNT=1000000;

function budgetVotes(unit,budget,maxVotes) {
  const amount=voteInteger(budget,'Montant');
  if(amount>MAX_MOBILE_AMOUNT) throw failure('Montant supérieur au plafond du paiement.');
  const count=Math.floor(amount/unit);
  if(count<1||count>maxVotes) throw failure('Le montant doit correspondre au minimum à un vote et rester sous le plafond.');
  return count;
}

async function votePrice({event_id,candidate_id,votes_count,nominal_budget_fcfa},transaction,maxVotes=100) {
  const options=transaction?{transaction,lock:transaction.LOCK.UPDATE}:{};
  const event=await Event.findByPk(event_id,options);
  const now=Date.now();
  if (!event || event.archived_at || event.status !== 'active' ||
      (event.starts_at && new Date(event.starts_at).getTime() > now) ||
      (event.ends_at && new Date(event.ends_at).getTime() <= now)) {
    throw failure('Événement non disponible',409);
  }
  const candidate=await Candidate.findOne({where:{id:candidate_id,event_id,is_active:true},...options});
  if (!candidate) throw failure('Candidat non disponible',409);
  const count=nominal_budget_fcfa===undefined ? voteInteger(votes_count,'Nombre de votes')
    : budgetVotes(event.vote_price_fcfa,nominal_budget_fcfa,maxVotes);
  return {unitPrice:event.vote_price_fcfa,price:amounts(event.vote_price_fcfa,count,event.commission_rate,maxVotes),event};
}

function quoteBreakdown(unitPrice,price,method,tariff) {
  const card=method==='votenow_card';
  if (!card) {
    const value=tariff?.rate_bps ?? process.env.VOTENOW_KPAY_VOTE_FEE_BPS ?? '500';
    const rate=Number(value);
    if (!/^\d{1,5}$/.test(value)||rate>10000) throw failure('Tarif de paiement VoteNow indisponible.',503);
    // Apply the rate once to the nominal total, rounding half a franc up.
    const fee=Number((BigInt(price.gross)*BigInt(rate)+5000n)/10000n);
    const requested=price.gross+fee;
    if (!Number.isSafeInteger(requested)||requested>MAX_MOBILE_AMOUNT) throw failure('Montant demandé supérieur au plafond du paiement mobile.',400);
    return {
      method,currency:'XAF',unit_price_fcfa:unitPrice,votes_count:price.count,nominal_fcfa:price.gross,
      votenow_payment_fee_fcfa:fee,votenow_payment_fee_bps:rate,requested_amount_fcfa:requested,
      ...(tariff ? {votenow_fee_version_id:tariff.id} : {}),
      collection_fee_fcfa:null,total_debit_fcfa:null,confirmable:false
    };
  }
  return {
    method,currency:'XAF',unit_price_fcfa:unitPrice,votes_count:price.count,nominal_fcfa:price.gross,
    collection_fee_fcfa:0,total_debit_fcfa:price.gross,confirmable:true
  };
}

function unavailableKpayTotal() {
  return failure('Le paiement mobile est indisponible.',503,'PAYMENT_UNAVAILABLE');
}

function kpayVoteMode() {
  const local = ['development','test'].includes(process.env.NODE_ENV);
  if ((process.env.NODE_ENV === 'production' || (local && process.env.KPAY_LOCAL_LIVE_VOTES_ENABLED === 'true')) &&
      (process.env.KPAY_MODE || '').trim() === 'production' &&
      require('../config/kpay').getConfig().mode === 'production') return 'live';
  if (local &&
    process.env.KPAY_SANDBOX_VOTES_ENABLED === 'true' &&
    require('../config/kpay').getConfig().mode === 'sandbox') return 'sandbox';
  return null;
}

module.exports={votePrice,voteInteger,quoteBreakdown,unavailableKpayTotal,kpayVoteMode,budgetVotes,MAX_MOBILE_VOTES,MAX_MOBILE_AMOUNT};
