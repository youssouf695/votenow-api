const { createHash } = require('node:crypto');
const sequelize = require('../config/database');
const { resolveLoginUser, normalizeIdentifier } = require('../utils/loginIdentity');

async function initializeRateLimits() {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS api_rate_limits (
      bucket_key VARCHAR(64) PRIMARY KEY,
      hits INTEGER NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL
    )
  `);

  await sequelize.query(`
    CREATE INDEX IF NOT EXISTS api_rate_limits_expiry_idx
    ON api_rate_limits (expires_at)
  `);
}

function rateLimit({ scope, limit, seconds, identify }) {
  return async (req, res, next) => {
    try {
      const identity = await identify(req);

      if (!identity) {
        return res.status(400).json({
          error: 'Identifiant requis pour cette opération'
        });
      }

      const key = createHash('sha256')
        .update(JSON.stringify([scope, identity]))
        .digest('hex');

      const [rows] = await sequelize.query(`
        INSERT INTO api_rate_limits AS bucket (
          bucket_key, hits, expires_at
        )
        VALUES (
          $1, 1,
          CURRENT_TIMESTAMP + ($2 * INTERVAL '1 second')
        )
        ON CONFLICT (bucket_key) DO UPDATE SET
          hits = CASE
            WHEN bucket.expires_at <= CURRENT_TIMESTAMP THEN 1
            ELSE LEAST(bucket.hits + 1, $3 + 1)
          END,
          expires_at = CASE
            WHEN bucket.expires_at <= CURRENT_TIMESTAMP
              THEN CURRENT_TIMESTAMP + ($2 * INTERVAL '1 second')
            ELSE bucket.expires_at
          END
        RETURNING hits,
          GREATEST(
            1,
            CEIL(EXTRACT(EPOCH FROM (
              expires_at - CURRENT_TIMESTAMP
            )))
          )::INTEGER AS retry_after
      `, {
        bind: [key, seconds, limit]
      });

      const bucket = rows[0];

      if (bucket.hits > limit) {
        res.set('Retry-After', String(bucket.retry_after));
        res.set('Cache-Control', 'no-store');

        return res.status(429).json({
          error: 'Trop de tentatives. Veuillez patienter avant de réessayer.',
          retry_after: bucket.retry_after
        });
      }

      return next();
    } catch (error) {
      console.error('Erreur limitation des requêtes :', error.message);

      // Ne pas poursuivre une action sensible sans son contrôle.
      res.status(503).json({
        error: 'Service temporairement indisponible. Réessayez plus tard.'
      });
    }
  };
}

// Email et téléphone d'un même compte utilisent les mêmes compteurs.
async function accountIdentifier(req) {
  const loginPaths = [
    '/auth/login', '/auth/request-login-code', '/auth/verify-login-code',
    '/verifications/request-login-code', '/verifications/verify-login-code'
  ];
  const path = req.path.replace(/\/+$/, '').toLowerCase();
  if (loginPaths.includes(path)) {
    const identity = normalizeIdentifier(req.body?.email);
    if (!identity) return null;
    const user = await resolveLoginUser(req);
    return user
      ? user.email.trim().toLowerCase()
      : `${identity.type}:${identity.value}`;
  }
  const email = req.body?.email;
  return typeof email === 'string' && email.trim() && email.trim().length <= 255
    ? email.trim().toLowerCase()
    : null;
}

const loginAttempts = rateLimit({
  scope: 'login-attempts',
  limit: 10,
  seconds: 15 * 60,
  identify: accountIdentifier
});

const otpCooldown = rateLimit({
  scope: 'otp-send-cooldown',
  limit: 1,
  seconds: 30,
  identify: accountIdentifier
});

const otpSendQuota = rateLimit({
  scope: 'otp-send-quota',
  limit: 5,
  seconds: 60 * 60,
  identify: accountIdentifier
});

const otpVerification = rateLimit({
  scope: 'otp-verification',
  limit: 10,
  seconds: 15 * 60,
  identify: accountIdentifier
});

function protectSensitiveActions(req, res, next) {
  if (req.method !== 'POST') return next();

  // Même compteur pour les deux chemins de connexion.
  const loginPaths = [
    '/auth/login',
    '/auth/request-login-code',
    '/verifications/request-login-code'
  ];

  const sendPaths = [
    '/auth/request-login-code',
    '/verifications/request-login-code',
    '/verifications/send-pre-registration-code'
  ];

  const verifyPaths = [
    '/auth/verify-login-code',
    '/verifications/verify-login-code',
    '/verifications/verify-and-create'
  ];

  const path = req.path.replace(/\/+$/, '').toLowerCase();
  const controls = [];

  if (loginPaths.includes(path)) controls.push(loginAttempts);

  if (sendPaths.includes(path)) {
    controls.push(otpCooldown, otpSendQuota);
  }

  if (verifyPaths.includes(path)) {
    controls.push(otpVerification);
  }

  let index = 0;

  function run(error) {
    if (error) return next(error);

    const control = controls[index++];

    if (!control) return next();

    return control(req, res, run);
  }

  return run();
}

async function cleanExpiredRateLimits() {
  await sequelize.query(`
    DELETE FROM api_rate_limits
    WHERE expires_at <= CURRENT_TIMESTAMP
  `);
}

module.exports = {
  initializeRateLimits,
  protectSensitiveActions,
  cleanExpiredRateLimits
};

