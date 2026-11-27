const migrate = require('./migrate-financial-book');

const tables = `financial_accounts, financial_journal_entries, financial_journal_lines,
  financial_book, votenow_fee_versions, payout_fee_funding, payout_fee_reservations,
  financial_funding_evidence, financial_settlement_evidence`;
const functions = `vn_financial_coverage_start(), vn_financial_immutable(), vn_financial_check_withdrawal(),
  vn_sponsored_payout_snapshot(), vn_payout_fee_close_once(), vn_book_balanced(jsonb),
  vn_book_post(text,uuid,uuid,text,uuid,bigint,jsonb), vn_book_vote(), vn_book_topup(),
  vn_book_withdrawal(), vn_book_provider_result(), vn_book_funding(), vn_book_check_funding_projection(),
  vn_book_allocation(), vn_book_statement()`;

async function main() {
  const mode=process.argv[2];
  if (!['--apply','--stage','--activate','--status'].includes(mode)) {
    console.log('Plan : --status pour constater, --stage pour installer le schéma passif, --activate pour basculer.');
    return;
  }
  const db = require('../src/config/database');
  try {
    const stage=require('./financial-book-stage');
    if(mode==='--status'||mode==='--stage'){
      const state=await db.transaction(async transaction=>{
        const query=async sql=>(await db.query(sql,{transaction,logging:false}))[0];
        if(mode==='--stage'){
          await query("SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='20s'");
          await stage.installStage({query});
        }
        return stage.inspect({query});
      });
      console.log(JSON.stringify(state));
      return;
    }
    const flags = ['WITHDRAWAL_VOTENOW_PAYS_ENABLED', 'WALLET_TOPUP_FEES_ENABLED', 'WALLET_CARD_IDENTITY_ENABLED'];
    if (flags.some(flag => process.env[flag] !== 'false')) throw new Error('Les trois options doivent être explicitement désactivées');
    const rate = process.env.VOTENOW_KPAY_VOTE_FEE_BPS;
    if (!/^\d{1,5}$/.test(rate || '')) throw new Error('Le tarif Mobile Money actif doit être fourni');
    const name = process.env.FINANCIAL_RUNTIME_ROLE;
    if (!/^[a-z_][a-z0-9_]{0,62}$/.test(name || '') ||
        ['postgres','anon','authenticated','service_role','public'].includes(name)) throw new Error('Rôle applicatif dédié requis');
    const role = `"${name}"`;
    await db.transaction(async transaction => {
      const query = async (sql, bind) => (await db.query(sql, {bind,transaction,logging:false}))[0];
      await query("SET LOCAL search_path TO public; SET LOCAL lock_timeout='10s'");
      const [access] = await query(`
        SELECT NOT (rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls OR rolreplication)
          AND rolcanlogin AND NOT pg_has_role(rolname,current_user,'MEMBER') AS restricted
        FROM pg_roles WHERE rolname=$1
      `,[name]);
      if (!access?.restricted) throw new Error('Rôle applicatif absent ou privilégié');
      await migrate({query},rate,{activateStaged:mode==='--activate'});
      const exposed = 'PUBLIC, anon, authenticated, service_role';
      await query(`REVOKE ALL ON TABLE ${tables} FROM ${exposed};
        REVOKE ALL ON SEQUENCE votenow_fee_versions_id_seq FROM ${exposed};
        REVOKE ALL ON FUNCTION ${functions} FROM ${exposed};
        GRANT SELECT ON TABLE ${tables} TO ${role};
        GRANT INSERT ON financial_accounts, financial_journal_entries, financial_journal_lines,
          financial_book, votenow_fee_versions, payout_fee_reservations TO ${role};
        GRANT UPDATE (state,operation_id,closed_at) ON payout_fee_reservations TO ${role};
        GRANT USAGE ON SEQUENCE votenow_fee_versions_id_seq TO ${role};
        GRANT EXECUTE ON FUNCTION ${functions} TO ${role};`);
      const [acl] = await query(`
        SELECT NOT EXISTS (
          SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role']) AS r(name)
          CROSS JOIN unnest(ARRAY['financial_book','financial_funding_evidence','financial_settlement_evidence',
            'payout_fee_funding','votenow_fee_versions','financial_accounts','financial_journal_entries',
            'financial_journal_lines','payout_fee_reservations']) AS t(name)
          WHERE has_table_privilege(r.name,t.name,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')
        ) AND NOT EXISTS (
          SELECT 1 FROM unnest(ARRAY['financial_funding_evidence','financial_settlement_evidence','payout_fee_funding']) AS t(name)
          WHERE has_table_privilege($1,t.name,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')
        ) AS isolated
      `,[name]);
      if (!acl.isolated) throw new Error('Droits financiers indirects détectés');
    });
    console.log('Migration comptable et permissions validées.');
  } finally {await db.close();}
}

if (require.main===module) main().catch(error=>{
  console.error(error.original?.code||error.message);
  process.exitCode=1;
});
