const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Withdrawal = sequelize.define('Withdrawal', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  organizer_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'users', key: 'id' }
  },
  event_id: {
    type: DataTypes.UUID,
    allowNull: true,
    references: { model: 'events', key: 'id' }
  },
  amount_fcfa: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: { min: 100, max: 10000000 }
  },
  method: {
    type: DataTypes.ENUM('mtn_momo', 'orange_money', 'bank'),
    allowNull: false
  },
  destination_phone: {
    type: DataTypes.STRING(20),
    allowNull: false,
    validate: { is: /^[0-9]{8,15}$/ }
  },
  destination_account: {
    type: DataTypes.STRING(50),
    allowNull: true
  },
  destination_name: {
    type: DataTypes.STRING(150),
    allowNull: true
  },
  bank_name: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  status: {
    type: DataTypes.ENUM('pending', 'processing', 'done', 'rejected', 'cancelled'),
    defaultValue: 'pending'
  },
  processed_by: {
    type: DataTypes.UUID,
    allowNull: true,
    references: { model: 'users', key: 'id' }
  },
  // ✅ requested_at défini NORMALEMENT — pas comme createdAt
  requested_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  processed_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  completed_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  rejection_reason: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  transaction_ref: {
    type: DataTypes.STRING(100),
    allowNull: true,
    unique: true
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true
  }
}, {
  tableName: 'withdrawals',
  timestamps: true,
  // ✅ On laisse Sequelize gérer created_at et updated_at normalement
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['organizer_id'] },
    { fields: ['status'] },
    { fields: ['requested_at'] },
    { fields: ['status', 'requested_at'] }
  ]
});

// ✅ Associations — OBLIGATOIRES pour les include
Withdrawal.associate = (models) => {
  Withdrawal.belongsTo(models.User, {
    foreignKey: 'organizer_id',
    as: 'organizer'
  });
  Withdrawal.belongsTo(models.User, {
    foreignKey: 'processed_by',
    as: 'processor'
  });
  Withdrawal.belongsTo(models.Event, {
    foreignKey: 'event_id',
    as: 'event'
  });
};

module.exports = Withdrawal;