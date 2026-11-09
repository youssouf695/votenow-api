require('dotenv').config();
const sequelize=require('../src/config/database');
const {DataTypes}=require('sequelize');
async function main(){
 if(!process.argv.includes('--apply')){console.log('Plan : créer withdrawal_beneficiaries ; ajouter withdrawals.beneficiary_id, request_key et champs de frais V2. Aucun solde, frais ni retrait existant modifié. Relancer avec --apply.');return;}
 await sequelize.authenticate();const qi=sequelize.getQueryInterface();
 await sequelize.transaction(async transaction=>{
  await sequelize.query('SELECT pg_advisory_xact_lock(82114722)',{transaction});
  await sequelize.query(`CREATE TABLE IF NOT EXISTS withdrawal_beneficiaries (
   id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
   full_name varchar(150) NOT NULL,phone varchar(20) NOT NULL,method varchar(20) NOT NULL CHECK(method IN ('mtn_momo','orange_money')),
   verified_at timestamptz,deleted_at timestamptz,verification_hash varchar(64),verification_id uuid,verification_email varchar(255),
   expires_at timestamptz,attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),last_sent_at timestamptz,
   created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(user_id,phone)
  )`,{transaction});
  await sequelize.query('CREATE INDEX IF NOT EXISTS withdrawal_beneficiaries_user_active_idx ON withdrawal_beneficiaries(user_id,deleted_at)',{transaction});
  const columns=await qi.describeTable('withdrawals',{transaction});
  for(const [name,definition] of Object.entries({beneficiary_verified_at:{type:DataTypes.DATE,allowNull:true},fee_policy:{type:DataTypes.STRING(32),allowNull:true},fee_fcfa:{type:DataTypes.INTEGER,allowNull:true},net_fcfa:{type:DataTypes.INTEGER,allowNull:true},pricing_snapshot:{type:DataTypes.JSONB,allowNull:true}})) if(!columns[name])await qi.addColumn('withdrawals',name,definition,{transaction});
  if(!columns.beneficiary_id)await qi.addColumn('withdrawals','beneficiary_id',{type:DataTypes.UUID,allowNull:true,references:{model:'withdrawal_beneficiaries',key:'id'},onDelete:'RESTRICT'},{transaction});
  if(!columns.request_key)await qi.addColumn('withdrawals','request_key',{type:DataTypes.UUID,allowNull:true},{transaction});
  await sequelize.query('CREATE UNIQUE INDEX IF NOT EXISTS withdrawals_request_key_unique ON withdrawals(request_key) WHERE request_key IS NOT NULL',{transaction});
 });console.log('Migration des bénéficiaires terminée.');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>sequelize.close());
