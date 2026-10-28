const { fn, col, where } = require('sequelize');
const { User } = require('../models');

// Le champ historique "email" transporte un email OU un téléphone international.
function normalizeIdentifier(value) {
  if (typeof value !== 'string') return null;
  const input = value.trim();
  if (!input || input.length > 255) return null;

  if (input.includes('@')) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input)) return null;
    return { type: 'email', value: input.toLowerCase() };
  }

  // Pas de déduction automatique du pays à partir d'un numéro national.
  if (!/^\+?[\d\s().-]+$/.test(input)) return null;
  const digits = input.replace(/\D/g, '').replace(/^00/, '');
  if (!/^[1-9]\d{7,14}$/.test(digits)) return null;
  return { type: 'phone', value: digits };
}

async function findLoginUser(identifier) {
  if (!identifier) return null;
  const condition = identifier.type === 'email'
    ? where(fn('lower', col('email')), identifier.value)
    : where(
        fn('regexp_replace',
          fn('regexp_replace', col('phone'), '[^0-9]', '', 'g'),
          '^00', '', ''
        ),
        identifier.value
      );

  // Ne jamais choisir arbitrairement parmi des comptes ambigus.
  const users = await User.findAll({ where: condition, limit: 2 });
  return users.length === 1 ? users[0] : null;
}

const resolvedUser = Symbol('resolvedLoginUser');
function resolveLoginUser(req) {
  if (!req[resolvedUser]) {
    req[resolvedUser] = findLoginUser(normalizeIdentifier(req.body?.email));
  }
  return req[resolvedUser];
}

function maskEmail(email) {
  if (typeof email !== 'string') return '';
  const at = email.lastIndexOf('@');
  if (at < 1) return '';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  const suffix = dot > 0 ? domain.slice(dot) : '';
  return `${local[0]}***@${domain[0] || '*'}***${suffix}`;
}

module.exports = { normalizeIdentifier, findLoginUser, resolveLoginUser, maskEmail };
