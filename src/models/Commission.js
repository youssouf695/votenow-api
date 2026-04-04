const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Commission = sequelize.define('Commission', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  payment_id: {
    type: DataTypes.UUID,
    allowNull: false,
    unique: true,
    references: {
      model: 'payments',
      key: 'id'
    }
  },
  event_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'events',
      key: 'id'
    }
  },
  organizer_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  amount_fcfa: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: {
      min: 0
    }
  },
  rate_applied: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: false,
    validate: {
      min: 0,
      max: 100
    }
  },
  base_amount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'Montant sur lequel la commission a été calculée'
  },
  status: {
    type: DataTypes.ENUM('pending', 'paid', 'cancelled'),
    defaultValue: 'pending',
    allowNull: false
    // ⚠️ SUPPRIME LE COMMENTAIRE D'ICI
  },
  paid_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  period_start: {
    type: DataTypes.DATE,
    allowNull: true
  },
  period_end: {
    type: DataTypes.DATE,
    allowNull: true
  },
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {}
  }
}, {
  tableName: 'commissions',
  timestamps: true,
  indexes: [
    {
      fields: ['payment_id'],
      unique: true
    },
    {
      fields: ['event_id']
    },
    {
      fields: ['organizer_id']
    },
    {
      fields: ['status']
    },
    {
      fields: ['created_at']
    }
  ]
});

module.exports = Commission;