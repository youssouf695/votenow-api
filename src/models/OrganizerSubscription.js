const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const OrganizerSubscription = sequelize.define('OrganizerSubscription', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  organizer_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  plan_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'subscription_plans',
      key: 'id'
    }
  },
  status: {
    type: DataTypes.ENUM('active', 'expired', 'cancelled', 'trial'),
    defaultValue: 'active'
  },
  started_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  expires_at: {
    type: DataTypes.DATE,
    allowNull: false
  },
  cancelled_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  payment_id: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'payments',
      key: 'id'
    }
  },
  amount_paid: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  auto_renew: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {}
  }
}, {
  tableName: 'organizer_subscriptions',
  timestamps: true,
  indexes: [
    {
      fields: ['organizer_id']
    },
    {
      fields: ['plan_id']
    },
    {
      fields: ['status']
    },
    {
      fields: ['expires_at']
    },
    {
      fields: ['organizer_id', 'status']
    }
  ]
});

module.exports = OrganizerSubscription;