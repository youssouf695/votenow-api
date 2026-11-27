BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path TO public;
SELECT vn_financial_coverage_start() AS withdrawal_coverage,
  (SELECT min(effective_at) FROM votenow_fee_versions) AS book_coverage,
  (SELECT count(*) FROM financial_book WHERE NOT vn_book_balanced(lines)) AS unbalanced_entries,
  (SELECT count(*) FROM payout_fee_funding) AS funding_rows,
  (SELECT count(*) FROM payout_fee_reservations) AS sponsored_allocations;
WITH lines AS (
  SELECT b.kind,l.account,l.amount FROM financial_book b
  CROSS JOIN LATERAL jsonb_to_recordset(b.lines) AS l(account text, amount numeric)
)
SELECT
  (SELECT coalesce(sum(balance_fcfa),0) FROM users WHERE role='organizer') AS available,
  coalesce(-sum(amount) FILTER(WHERE account LIKE 'organizer_available:%'),0) AS book_available,
  (SELECT coalesce(sum(amount_fcfa),0) FROM withdrawals WHERE status IN ('pending','processing')) AS reserved,
  coalesce(-sum(amount) FILTER(WHERE account LIKE 'organizer_reserved:%'),0) AS book_reserved,
  (SELECT coalesce(sum(balance_fcfa),0) FROM wallet_accounts) AS card,
  coalesce(-sum(amount) FILTER(WHERE account LIKE 'card:%'),0) AS book_card,
  coalesce(sum(amount) FILTER(WHERE account='historical_unprovisioned'),0) AS historical_unprovisioned
FROM lines;
SELECT flow,rate_bps,effective_at FROM votenow_fee_versions ORDER BY flow,effective_at;
SELECT tgname,tgenabled FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE 'financial_book_%' ORDER BY tgname;
SELECT current_user,has_table_privilege(current_user,'financial_book','SELECT') AS can_read_book,
  has_table_privilege(current_user,'financial_funding_evidence','INSERT') AS can_register_funding,
  has_table_privilege(current_user,'payout_fee_funding','UPDATE') AS can_edit_funding;
ROLLBACK;
