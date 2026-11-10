require('dotenv').config({quiet:true});
const fs=require('node:fs'),path=require('node:path'),db=require('../src/config/database');
const {audit}=require('../src/services/balanceAudit');
async function main(){
 const args=process.argv.slice(2);if(args.length&&!(args.length===2&&args[0]==='--output'&&args[1]))throw Error('Usage : node scripts/audit-balances.js [--output fichier.json]. Aucune option de modification acceptée.');
 const report=await audit(),content=JSON.stringify(report,null,2)+'\n';
 if(args.length){const output=path.resolve(args[1]);fs.writeFileSync(output,content,{encoding:'utf8',flag:'wx'});console.log('Rapport en lecture seule créé : '+output)}else console.log(content);
}
if(require.main===module)main().catch(e=>{console.error('Audit arrêté :',e.original?.code||e.code||e.message);process.exitCode=1}).finally(()=>db.close());
module.exports={main};
