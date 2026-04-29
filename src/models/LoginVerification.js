const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const LoginVerification = sequelize.define('LoginVerification', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  email: {
    type: DataTypes.STRING(255),
    allowNull: false,
    indexes: true
  },
  code: {
    type: DataTypes.STRING(6),
    allowNull: false
  },
  expires_at: {
    type: DataTypes.DATE,
    allowNull: false
  },
  used: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  }
}, {
  tableName: 'login_verifications',
  timestamps: true,
  updatedAt: false
});

module.exports = LoginVerification;