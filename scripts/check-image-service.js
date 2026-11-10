require('dotenv').config({quiet:true});
const {configuration}=require('../src/services/campaignImageUpload');
const c=configuration();
console.log(JSON.stringify({service:'images',configured:c.ready,missing:c.missing,invalid:c.invalid},null,2));
if(!c.ready)process.exitCode=1;
// Aucun appel réseau, aucune connexion DB, aucune valeur de clé/secret affichée.
