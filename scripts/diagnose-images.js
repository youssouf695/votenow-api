require('dotenv').config({quiet:true});
const { configuration } = require('../src/services/campaignImageUpload');
const config = configuration();
console.log(JSON.stringify({
  service:'images', configured:config.ready, mode:config.mode,
  missing:config.missing, invalid:config.invalid,
  instructions:config.ready
    ? 'Configuration présente. Testez une image partenaire et une candidature pour vérifier le preset ou les clés auprès de Cloudinary.'
    : 'Configurer sur le serveur API : CLOUDINARY_CLOUD_NAME + CLOUDINARY_UPLOAD_PRESET (mêmes valeurs que les variables NEXT_PUBLIC du frontend), OU CLOUDINARY_CLOUD_NAME + CLOUDINARY_API_KEY + CLOUDINARY_API_SECRET. Puis redémarrer/redéployer API.'
},null,2));
if (!config.ready) process.exitCode=1;
// No network/DB access and no values of credentials or presets printed.
