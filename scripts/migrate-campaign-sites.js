require('dotenv').config();
const sequelize=require('../src/config/database');
const {DataTypes}=require('sequelize');
async function main(){
 if(!process.argv.includes('--apply')){console.log('Plan : ajouter events.site_config, site_version, partners, archived_at ; créer campaign_categories ; ajouter candidates.slogan et category_id. Aucun vote ni montant modifié. Relancer avec --apply.');return;}
 await sequelize.authenticate();
 const qi=sequelize.getQueryInterface();
 await sequelize.transaction(async transaction=>{
  await sequelize.query("SELECT pg_advisory_xact_lock(82114721)",{transaction});
  const e=await qi.describeTable('events',{transaction});
  for(const [name,definition] of Object.entries({site_version:{type:DataTypes.INTEGER,allowNull:false,defaultValue:0},site_config:{type:DataTypes.JSONB,allowNull:true},partners:{type:DataTypes.JSONB,allowNull:false,defaultValue:[]},archived_at:{type:DataTypes.DATE,allowNull:true}}))if(!e[name])await qi.addColumn('events',name,definition,{transaction});
  await sequelize.query(`CREATE TABLE IF NOT EXISTS campaign_categories (
   id uuid PRIMARY KEY, event_id uuid NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
   name varchar(100) NOT NULL, position integer NOT NULL DEFAULT 0,
   created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
   UNIQUE(event_id,name)
  )`,{transaction});
  const c=await qi.describeTable('candidates',{transaction});
  if(!c.slogan)await qi.addColumn('candidates','slogan',{type:DataTypes.STRING(200),allowNull:true},{transaction});
  if(!c.category_id)await qi.addColumn('candidates','category_id',{type:DataTypes.UUID,allowNull:true,references:{model:'campaign_categories',key:'id'},onDelete:'RESTRICT'},{transaction});
  await sequelize.query('CREATE UNIQUE INDEX IF NOT EXISTS campaign_categories_id_event_unique ON campaign_categories(id,event_id)',{transaction});
  // A category must belong to the same event even if application validation is bypassed.
  const [constraints]=await sequelize.query("SELECT 1 FROM pg_constraint WHERE conname='candidates_category_event_fk' AND conrelid='candidates'::regclass",{transaction});
  if(!constraints.length)await sequelize.query('ALTER TABLE candidates ADD CONSTRAINT candidates_category_event_fk FOREIGN KEY (category_id,event_id) REFERENCES campaign_categories(id,event_id) ON DELETE RESTRICT',{transaction});
 });console.log('Migration des sites de campagne terminée.');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>sequelize.close());
