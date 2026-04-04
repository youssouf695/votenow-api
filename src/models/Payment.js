const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Payment = sequelize.define('Payment', {
  id: {
    type: DataTypes.STRING(100),
    primaryKey: true
  },
  event_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'events',
      key: 'id'
    }
  },
  candidate_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'candidates',
      key: 'id'
    }
  },
  voter_phone: {
    type: DataTypes.STRING(20),
    allowNull: false
  },
  voter_name: {
    type: DataTypes.STRING(150)
  },
  amount_fcfa: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  votes_count: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  commission_amount: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  net_to_organizer: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  method: {
    type: DataTypes.ENUM('mtn_momo', 'orange_money', 'card'),
    allowNull: true
  },
  provider_ref: {
    type: DataTypes.STRING(100),
    unique: true
  },
  status: {
    type: DataTypes.ENUM('pending', 'success', 'failed', 'refunded'),
    defaultValue: 'pending'
  },
  ip_address: {
    type: DataTypes.INET
  }
}, {
  tableName: 'payments',
  indexes: [
    {
      fields: ['event_id']
    },
    {
      fields: ['candidate_id']
    },
    {
      fields: ['status']
    },
    {
      fields: ['provider_ref']
    }
  ]
});

module.exports = Payment;