-- The cutoff snapshot does not replay historical flows or fund the fee envelope.
SELECT vn_book_post('opening_organizer',id,NULL,NULL,NULL,0,
  jsonb_build_object('historical_unprovisioned',balance_fcfa,'organizer_available:'||id,-balance_fcfa))
FROM users WHERE role='organizer' AND balance_fcfa <> 0;
SELECT vn_book_post('opening_card',id,NULL,NULL,NULL,0,
  jsonb_build_object('historical_opening',balance_fcfa,'card:'||id,-balance_fcfa))
FROM wallet_accounts WHERE balance_fcfa <> 0;
SELECT vn_book_post('opening_reserve',id,NULL,NULL,NULL,0,
  jsonb_build_object('historical_unprovisioned',amount_fcfa,'organizer_reserved:'||id,-amount_fcfa))
FROM withdrawals WHERE status IN ('pending','processing');
