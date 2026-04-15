const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const env = require('./config/env');

// Routes 
const authRoutes = require('./routes/authRoutes');
const eventRoutes = require('./routes/eventRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const voteRoutes = require('./routes/voteRoutes');
const withdrawalRoutes = require('./routes/withdrawalRoutes');
const adminRoutes = require('./routes/adminRoutes');
const statsRoutes = require('./routes/statsRoutes');
const subscriptionRoutes = require('./routes/subscriptionRoutes');
const verificationRoutes = require('./routes/verificationRoutes'); // ← AJOUT

const app = express();

// Middleware
app.use(helmet());
app.use(cors({
  origin: env.clientUrl,
  credentials: true
}));
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/votes', voteRoutes);
app.use('/api/withdrawals', withdrawalRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/subscription-plans', subscriptionRoutes);
app.use('/api/verifications', verificationRoutes); // ← AJOUT

// Route de test
app.get('/', (req, res) => {
  res.json({ 
    message: `Bienvenue sur l'API ${env.appName}`,
    version: '1.0.0',
    endpoints: [
      '/api/auth',
      '/api/events',
      '/api/payments',
      '/api/votes',
      '/api/withdrawals',
      '/api/admin',
      '/api/stats',
      '/api/verifications'
    ]
  });
});

module.exports = app;