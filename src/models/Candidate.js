const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Candidate = sequelize.define('Candidate', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  event_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'events',
      key: 'id'
    },
    field: 'event_id'
  },
  name: {
    type: DataTypes.STRING(150),
    allowNull: false,
    validate: {
      len: [2, 150]
    }
  },
  number: {
    type: DataTypes.INTEGER,
    validate: {
      min: 1,
      max: 999
    }
  },
  bio: {
    type: DataTypes.TEXT
  },
  photo_url: {
    type: DataTypes.TEXT,
    validate: {
      isUrl: true
    }
  },
  vote_count: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    validate: {
      min: 0
    }
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  position: {
    type: DataTypes.INTEGER,  // Pour ordonner les candidats
    defaultValue: 0
  },
  metadata: {
    type: DataTypes.JSONB,  // Infos supplémentaires (âge, ville, etc.)
    defaultValue: {}
  }
}, {
  tableName: 'candidates',
  indexes: [
    {
      fields: ['event_id']
    },
    {
      fields: ['event_id', 'vote_count']
    },
    {
      fields: ['number']
    }
  ]
});

module.exports = Candidate;