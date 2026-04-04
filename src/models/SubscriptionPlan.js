const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const SubscriptionPlan = sequelize.define('SubscriptionPlan', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: true,
    validate: {
      notEmpty: true
    }
  },
  description: {
    type: DataTypes.TEXT
  },
  price_fcfa: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: {
      min: 0
    }
  },
  duration_days: {
    type: DataTypes.INTEGER,
    defaultValue: 30,
    validate: {
      min: 1,
      max: 365
    }
  },
  max_events: {
    type: DataTypes.INTEGER,
    defaultValue: 1,
    validate: {
      min: 0 // 0 = illimité
    }
  },
  max_candidates_per_event: {
    type: DataTypes.INTEGER,
    defaultValue: 10,
    validate: {
      min: 1
    }
  },
  commission_rate: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 20.00,
    validate: {
      min: 0,
      max: 50
    }
  },
  features: {
    type: DataTypes.JSONB,
    defaultValue: {
      analytics: false,
      export: false,
      api_access: false,
      custom_branding: false,
      priority_support: false
    }
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  sort_order: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  }
}, {
  tableName: 'subscription_plans',
  timestamps: true,
  indexes: [
    {
      fields: ['is_active']
    },
    {
      fields: ['price_fcfa']
    }
  ]
});

module.exports = SubscriptionPlan;