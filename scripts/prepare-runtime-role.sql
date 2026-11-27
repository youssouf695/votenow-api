\set ON_ERROR_STOP on
BEGIN;
CREATE ROLE votenow_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
SELECT format('GRANT CONNECT ON DATABASE %I TO votenow_app', current_database()) \gexec
GRANT USAGE ON SCHEMA public TO votenow_app;
ALTER ROLE votenow_app SET search_path TO public;

GRANT SELECT ON
  public.users, public.verifications, public.login_verifications, public.pending_registrations,
  public.events, public.candidates, public.campaign_setups, public.campaign_categories,
  public.campaign_applications, public.campaign_application_uploads, public.campaign_application_decisions,
  public.campaign_application_notifications, public.votes, public.payments, public.commissions,
  public.kpay_operations, public.withdrawals, public.withdrawal_beneficiaries,
  public.wallet_accounts, public.wallet_entries, public.wallet_topups, public.wallet_purchases,
  public.transaction_admin_actions, public.transaction_receipts, public.transaction_states, public.user_restrictions,
  public.payment_providers, public.provider_accounts, public.provider_capabilities, public.provider_tariff_versions,
  public.analytics_events, public.api_rate_limits, public.subscription_plans, public.organizer_subscriptions
TO votenow_app;

GRANT INSERT, UPDATE, DELETE ON
  public.users, public.verifications, public.login_verifications, public.pending_registrations,
  public.events, public.candidates, public.campaign_categories, public.campaign_application_uploads,
  public.api_rate_limits
TO votenow_app;

GRANT INSERT, UPDATE ON
  public.campaign_setups, public.campaign_applications, public.campaign_application_notifications,
  public.payments, public.commissions, public.kpay_operations, public.withdrawals, public.withdrawal_beneficiaries,
  public.wallet_accounts, public.wallet_topups, public.transaction_receipts, public.user_restrictions
TO votenow_app;

GRANT INSERT ON
  public.campaign_application_decisions, public.votes, public.wallet_entries, public.wallet_purchases,
  public.transaction_admin_actions, public.transaction_states, public.provider_tariff_versions
TO votenow_app;

GRANT INSERT, DELETE ON public.analytics_events TO votenow_app;
GRANT UPDATE ON public.payment_providers, public.provider_accounts, public.provider_capabilities TO votenow_app;
GRANT USAGE ON SEQUENCE public.transaction_admin_actions_id_seq, public.transaction_states_id_seq TO votenow_app;

-- Interactive password prompt. Keep the generated credential in the deployment secret store.
\password votenow_app
COMMIT;
