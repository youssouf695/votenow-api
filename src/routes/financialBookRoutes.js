const router = require('express').Router();
const db = require('../config/database');

const read = (sql, bind, transaction) => db.query(sql, {bind,transaction,type:db.QueryTypes.SELECT});
const run = handler => async (req,res) => {
  res.set('Cache-Control','no-store');
  try { res.json(await handler(req)); }
  catch (error) {
    const code = error.original?.code;
    res.status(error.status || (code === '23505' ? 409 : 503)).json({
      code: error.status ? 'INVALID_INPUT' : code === '23505' ? 'DATE_CONFLICT' : 'BOOK_UNAVAILABLE'
    });
  }
};
const invalid = () => Object.assign(new Error('Invalid input'),{status:400});
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;

router.get('/',run(async ({query}) => {
  const {from=null,to=null,kind=null,provider=null} = query;
  const page = Number(query.page ?? 1);
  if ((from && !date(from)) || (to && !date(to)) || (from && to && from > to) ||
      (kind && (typeof kind !== 'string' || !/^[a-z_]{1,40}$/.test(kind))) ||
      (provider && (typeof provider !== 'string' || !/^[a-z0-9_-]{1,40}$/.test(provider))) ||
      !Number.isInteger(page) || page < 1 || page > 100000) throw invalid();
  const scope = `($1::date IS NULL OR financial_book.recorded_at >= ($1::date::timestamp AT TIME ZONE 'UTC'))
    AND ($2::date IS NULL OR financial_book.recorded_at < (($2::date+1)::timestamp AT TIME ZONE 'UTC'))
    AND ($3::text IS NULL OR kind=$3) AND ($4::text IS NULL OR provider_code=$4)`;
  const filters = [from||null,to||null,kind||null,provider||null];
  return db.transaction({isolationLevel:'REPEATABLE READ',readOnly:true},async transaction => {
    const [totals] = await read(`
      WITH filtered AS (SELECT * FROM financial_book WHERE ${scope}),
      amounts AS (SELECT line.* FROM filtered CROSS JOIN LATERAL
        jsonb_to_recordset(filtered.lines) AS line(account text,amount numeric))
      SELECT (SELECT coalesce(sum(nominal_fcfa),0) FROM filtered) AS nominal,
        coalesce(-sum(amount) FILTER (WHERE account='commercial_commission'),0) AS commissions,
        coalesce(-sum(amount) FILTER (WHERE account='payment_fee'),0) AS payment_fees,
        coalesce(sum(amount) FILTER (WHERE account='collection_cost'),0) AS collection_cost,
        coalesce(sum(amount) FILTER (WHERE account='payout_cost'),0) AS payout_cost,
        abs(coalesce(sum(amount) FILTER (WHERE account='reconciliation_difference'),0)) AS differences,
        coalesce(-sum(amount) FILTER (WHERE account='recipient_fee_recovery'),0) AS recipient_fee_recovery
      FROM amounts
    `,filters,transaction);
    const entries = await read(`SELECT financial_book.*,e.evidence_ref FROM financial_book
      LEFT JOIN financial_settlement_evidence e ON e.operation_id=financial_book.operation_id
      WHERE ${scope} ORDER BY recorded_at DESC,kind,source_id LIMIT 26 OFFSET $5`,[...filters,(page-1)*25],transaction);
    const [positions] = await read(`
      SELECT
        (SELECT coalesce(sum(balance_fcfa),0) FROM users WHERE role='organizer') AS organizer_available,
        (SELECT coalesce(sum(amount_fcfa),0) FROM withdrawals WHERE status IN ('pending','processing')) AS organizer_reserved,
        (SELECT coalesce(sum(balance_fcfa),0) FROM wallet_accounts) AS card_outstanding,
        (SELECT coalesce(sum((line->>'amount')::numeric),0) FROM financial_book b
         CROSS JOIN LATERAL jsonb_array_elements(b.lines) AS line
         WHERE b.kind IN ('opening_organizer','opening_reserve') AND line->>'account'='historical_unprovisioned') AS historical_unprovisioned,
        (SELECT min(effective_at) FROM votenow_fee_versions) AS coverage_since
    `,[],transaction);
    const funding = await read(`
      SELECT a.id,a.account_key,a.provider_code,coalesce(f.funded_fcfa,0) AS funded,
        coalesce(r.reserved,0) AS allocated,coalesce(r.settled,0) AS consumed,
        coalesce(f.funded_fcfa,0)-coalesce(r.reserved,0)-coalesce(r.settled,0) AS remaining
      FROM provider_accounts a LEFT JOIN payout_fee_funding f ON f.account_id=a.id
      LEFT JOIN (SELECT account_id,sum(fee_fcfa) FILTER (WHERE state='reserved') AS reserved,
        sum(fee_fcfa) FILTER (WHERE state='settled') AS settled
        FROM payout_fee_reservations GROUP BY account_id) r ON r.account_id=a.id
      WHERE a.environment='production' ORDER BY a.provider_code,a.account_key
    `,[],transaction);
    const allocations = await read(`SELECT withdrawal_id,account_id,fee_fcfa
      FROM payout_fee_reservations WHERE state='reserved' ORDER BY withdrawal_id LIMIT 50`,[],transaction);
    const evidence = await read(`SELECT * FROM financial_funding_evidence
      ORDER BY recorded_at DESC,id LIMIT 50`,[],transaction);
    const review = await read(`
      SELECT op.id,op.domain_id,op.kind,op.status,op.error_code,op.updated_at,p.provider_code,
        op.expected_amount,op.target_net,
        CASE WHEN op.last_event->>'netAmount' ~ '^[0-9]{1,12}(\\.[0-9]{1,4})?$'
          THEN (op.last_event->>'netAmount')::numeric END AS reported_net
      FROM kpay_operations op
      CROSS JOIN LATERAL (SELECT coalesce(op.pricing_snapshot#>>'{provider_selection,provider_code}','kpay') AS provider_code) p
      WHERE op.environment='production' AND ($1::text IS NULL OR p.provider_code=$1) AND (
        op.status IN ('RECONCILIATION','AWAITING_DETAILS') OR
        (op.status='COMPLETED' AND op.completed_at >= (SELECT min(effective_at) FROM votenow_fee_versions)
          AND (op.last_event->>'feeAmount' IS NULL OR op.last_event->>'netAmount' IS NULL)
          AND NOT EXISTS (SELECT 1 FROM financial_settlement_evidence e WHERE e.operation_id=op.id)
          AND NOT EXISTS (SELECT 1 FROM financial_book b WHERE b.source_id=op.id
            AND b.kind IN ('collection_settlement','payout_cost')))
      ) ORDER BY op.updated_at DESC,op.id LIMIT 50
    `,[provider||null],transaction);
    const providers = await read('SELECT code FROM payment_providers ORDER BY code',[],transaction);
    const kinds = await read('SELECT DISTINCT kind FROM financial_book ORDER BY kind',[],transaction);
    const tariffs = await read('SELECT * FROM votenow_fee_versions ORDER BY effective_at DESC,id DESC',[],transaction);
    return {totals,positions,funding,allocations,evidence,review,providers,kinds,tariffs,entries:entries.slice(0,25),hasNext:entries.length>25};
  });
}));

router.post('/tariffs',run(async ({body,user}) => {
  const {flow,rate_bps:rate,effective_at:effective,reason} = body || {};
  if (!['mobile_vote','card_topup'].includes(flow) || !Number.isInteger(rate) || rate < 0 || rate > 10000 ||
      typeof effective !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(effective) ||
      !Number.isFinite(Date.parse(effective)) || Date.parse(effective) <= Date.now()+1000 ||
      typeof reason !== 'string' || reason.trim().length < 10 || reason.trim().length > 500) throw invalid();
  const [version] = await read(`INSERT INTO votenow_fee_versions(flow,rate_bps,effective_at,actor_id,reason)
    VALUES($1,$2,$3,$4,$5) RETURNING *`,[flow,rate,effective,user.id,reason.trim()]);
  return version;
}));

module.exports = router;
