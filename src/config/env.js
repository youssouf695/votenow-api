const dotenv = require('dotenv');
dotenv.config();

module.exports = {
  port: process.env.PORT || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
  appName: process.env.APP_NAME || 'VoteNow API',
  appUrl: process.env.APP_URL || 'http://localhost:5000',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:3000',
  
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    name: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === 'true'
  },
  
  jwt: {
    secret: process.env.JWT_SECRET || 'ma_super_cle_secrete_123456',
    expire: process.env.JWT_EXPIRE || '7d'
  },
  
  adminEmail: process.env.ADMIN_EMAIL || 'admin@local.com',
  adminPassword: process.env.ADMIN_PASSWORD || 'Admin123!'
};