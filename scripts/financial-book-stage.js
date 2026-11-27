const {readFileSync}=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const stageSchema='votenow_financial_stage';
const files=['financial-journal.sql','sponsored-payout.sql','financial-book.sql'];
const legacyTables='users|withdrawals|kpay_operations|provider_accounts';
const externalTriggers='sponsored_payout_snapshot|financial_book_vote|financial_book_topup|financial_book_provider_result';
const tables=['financial_accounts','financial_journal_entries','financial_journal_lines','payout_fee_funding',
  'payout_fee_reservations','financial_book','votenow_fee_versions','financial_funding_evidence','financial_settlement_evidence'];

function definitions() {
  const deferred=[];
  const originals=files.map(file=>readFileSync(path.join(__dirname,file),'utf8'));
  let triggers=0, foreignKeys=0;
  const passive=originals.map(source=>source
    .replace(/^CREATE TABLE ([a-z_]+) \([\s\S]*?^\);/gm,(statement,table)=>statement.replace(
      new RegExp(`^(  )([a-z_]+)([^\\n]*?) REFERENCES (${legacyTables})\\(id\\)( ON DELETE RESTRICT)?`,'gm'),
      (_,indent,column,definition,target,onDelete='')=>{
        deferred.push(`ALTER TABLE ${table} ADD FOREIGN KEY (${column}) REFERENCES ${target}(id)${onDelete};`);
        foreignKeys++;
        return indent+column+definition;
      }))
    .replace(new RegExp(`^CREATE TRIGGER (?:${externalTriggers})\\b[^;]+;`,'gm'),statement=>{
      deferred.push(statement);
      triggers++;
      return '';
    }));
  if(triggers!==4||foreignKeys!==14)throw Error('La séparation du SQL comptable doit être revue.');
  return {passive,deferred,version:createHash('sha256').update(originals.join('\n')).digest('hex')};
}

async function state(client) {
  const [row]=await client.query(`
    SELECT to_regnamespace('${stageSchema}') IS NOT NULL AS staged,
      to_regclass('public.financial_book') IS NOT NULL OR
      to_regclass('public.financial_accounts') IS NOT NULL OR
      to_regclass('public.financial_journal_entries') IS NOT NULL OR
      to_regclass('public.financial_journal_lines') IS NOT NULL OR
      to_regclass('public.payout_fee_funding') IS NOT NULL OR
      to_regclass('public.payout_fee_reservations') IS NOT NULL OR
      to_regclass('public.votenow_fee_versions') IS NOT NULL OR
      to_regclass('public.financial_funding_evidence') IS NOT NULL OR
      to_regclass('public.financial_settlement_evidence') IS NOT NULL OR
      to_regprocedure('public.vn_financial_coverage_start()') IS NOT NULL AS public_objects,
      obj_description(to_regnamespace('${stageSchema}'),'pg_namespace') AS version
  `);
  return row;
}

async function inspect(client) {
  const current=await state(client);
  if(!current.staged)return current;
  const [detail]=await client.query(`
    SELECT
      (SELECT count(*)::int FROM pg_class WHERE relnamespace='${stageSchema}'::regnamespace AND relkind='r') AS tables,
      (SELECT count(*)::int FROM pg_class WHERE relnamespace='${stageSchema}'::regnamespace AND relkind='i') AS indexes,
      (SELECT count(*)::int FROM pg_proc WHERE pronamespace='${stageSchema}'::regnamespace) AS functions,
      (SELECT count(*)::int FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
        JOIN pg_proc p ON p.oid=t.tgfoid WHERE c.relnamespace='public'::regnamespace
        AND p.pronamespace='${stageSchema}'::regnamespace) AS legacy_triggers,
      (SELECT count(*)::int FROM pg_constraint c
        JOIN pg_class target ON target.oid=c.confrelid
        WHERE c.connamespace='${stageSchema}'::regnamespace AND c.contype='f'
        AND target.relnamespace='public'::regnamespace) AS legacy_foreign_keys,
      NOT EXISTS (SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role']) AS r(name)
        WHERE has_schema_privilege(r.name,'${stageSchema}','USAGE,CREATE')) AS private,
      (${tables.map(table=>`EXISTS (SELECT 1 FROM ${stageSchema}.${table})`).join(' OR ')}) AS nonempty
  `);
  return {...current,...detail};
}

async function preflight(client,version) {
  const row=await state(client);
  if(row.public_objects)throw Error('Objets comptables déjà présents dans public.');
  if(row.staged&&row.version!==version)throw Error('Schéma passif différent du SQL attendu.');
  return row.staged;
}

async function installStage(client) {
  await client.query('SELECT pg_advisory_xact_lock(82114727)');
  const {passive,version}=definitions();
  if(await preflight(client,version))return;
  await client.query(`CREATE SCHEMA ${stageSchema};
    REVOKE ALL ON SCHEMA ${stageSchema} FROM PUBLIC, anon, authenticated, service_role;
    SET LOCAL search_path TO ${stageSchema}, public`);
  for(const sql of passive)await client.query(sql);
  await client.query(`
    REVOKE ALL ON ALL TABLES IN SCHEMA ${stageSchema} FROM PUBLIC, anon, authenticated, service_role;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${stageSchema} FROM PUBLIC, anon, authenticated, service_role;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ${stageSchema} FROM PUBLIC, anon, authenticated, service_role;
    COMMENT ON SCHEMA ${stageSchema} IS '${version}';
  `);
}

async function activateStage(client,rate,finalize) {
  await client.query('SELECT pg_advisory_xact_lock(82114727)');
  const {deferred,version}=definitions();
  if(!await preflight(client,version))throw Error('Schéma passif absent.');
  await client.query(`SET LOCAL search_path TO public;
    LOCK TABLE users, events, withdrawals, payments, wallet_accounts, wallet_entries, wallet_topups,
      kpay_operations, provider_accounts IN ACCESS EXCLUSIVE MODE`);
  const [contents]=await client.query(`SELECT (${tables.map(table=>`EXISTS (SELECT 1 FROM ${stageSchema}.${table})`).join(' OR ')}) AS nonempty`);
  if(contents.nonempty)throw Error('Le schéma passif contient des données.');
  const [{cutoff}]=await client.query('SELECT clock_timestamp()::text AS cutoff');
  await client.query(`CREATE FUNCTION vn_financial_coverage_start() RETURNS timestamptz
    LANGUAGE SQL IMMUTABLE AS $$ SELECT TIMESTAMPTZ '${cutoff}' $$`);
  for(const table of tables)await client.query(`ALTER TABLE ${stageSchema}.${table} SET SCHEMA public`);
  await client.query(`
    DO $$
    DECLARE f record;
    BEGIN
      FOR f IN SELECT p.oid::regprocedure AS signature, p.proconfig IS NOT NULL AS configured
        FROM pg_proc p WHERE p.pronamespace='${stageSchema}'::regnamespace
      LOOP
        EXECUTE format('ALTER FUNCTION %s SET SCHEMA public',f.signature);
        IF f.configured THEN
          EXECUTE format('ALTER FUNCTION %s SET search_path TO public', f.signature);
        END IF;
      END LOOP;
    END $$;
    DROP SCHEMA ${stageSchema};
  `);
  for(const sql of deferred)await client.query(sql);
  await finalize(client,rate);
}

module.exports={installStage,activateStage,inspect};
