const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Event = sequelize.define('Event', {
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
    },
    field: 'organizer_id'
  },
  title: {
    type: DataTypes.STRING(200),
    allowNull: false,
    validate: {
      len: [3, 200]
    }
  },
  slug: {
    type: DataTypes.STRING(200),
    allowNull: false,
    unique: true,
    validate: {
      is: /^[a-z0-9-]+$/  // Seulement lettres minuscules, chiffres et tirets
    }
  },
  description: {
    type: DataTypes.TEXT
  },
  cover_image_url: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Image de couverture (grand format)'
  },
  avatar_url: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Image de profil (format carré/ronde)'
  },
  vote_price_fcfa: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 100,
    validate: {
      min: 50,
      max: 10000
    }
  },
  votes_per_payment: {
    type: DataTypes.INTEGER,
    defaultValue: 1,
    validate: {
      min: 1,
      max: 100
    }
  },
  commission_rate: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: false,
    defaultValue: 20.00,
    validate: {
      min: 0,
      max: 50
    }
  },
  status: {
    type: DataTypes.ENUM('draft', 'active', 'paused', 'closed'),
    defaultValue: 'draft'
  },
  starts_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  ends_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  max_candidates: {
    type: DataTypes.INTEGER,
    defaultValue: null,
    validate: {
      min: 1
    }
  },
  allow_anonymous: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  show_results: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  total_votes: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  total_collected: {
    type: DataTypes.INTEGER,
    defaultValue: 0  // Montant total collecté (brut)
  }
}, {
  tableName: 'events',
  indexes: [
    {
      fields: ['organizer_id']
    },
    {
      fields: ['status']
    },
    {
      fields: ['slug']
    },
    {
      fields: ['starts_at', 'ends_at']
    }
  ]
});

module.exports = Event;