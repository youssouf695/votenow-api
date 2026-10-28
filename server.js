const app = require('./src/app');
const sequelize = require('./src/config/database');
const env = require('./src/config/env');
const {
  initializeRateLimits,
  cleanExpiredRateLimits
} = require('./src/middleware/rateLimit');

const PORT = env.port;
process.on('uncaughtException', (err) => {
  console.error('💥 UNCAUGHT EXCEPTION:', err.message);
  console.error(err.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 UNHANDLED REJECTION at:', promise);
  console.error('Reason:', reason);
  process.exit(1);
});

async function startServer() {
  try {
    await sequelize.authenticate();
    console.log('Connexion à PostgreSQL établie');
    
    // Les changements de schéma doivent être appliqués séparément.
    // Ne pas modifier les tables métier à chaque démarrage.
    
    await initializeRateLimits();
    await cleanExpiredRateLimits();

    const cleanupTimer = setInterval(() => {
      cleanExpiredRateLimits().catch(error => {
        console.error('Nettoyage des limites :', error.message);
      });
    }, 15 * 60 * 1000);

    cleanupTimer.unref();

    const server = app.listen(PORT, () => {
      console.log(`🚀 Serveur sur http://localhost:${PORT}`);
    });
    
    server.on('error', (err) => {
      console.error('💥 LISTEN ERROR:', err.message);
      console.error(err.stack);
    });
  } catch (error) {
    console.error('Erreur:', error);
    process.exit(1);
  }
}

startServer();

