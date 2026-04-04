const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Vote = sequelize.define('Vote', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
    comment: 'Identifiant unique du vote'
  },
  payment_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'payments',
      key: 'id'
    },
    field: 'payment_id',
    comment: 'Référence au paiement associé'
  },
  candidate_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'candidates',
      key: 'id'
    },
    field: 'candidate_id',
    comment: 'Candidat ayant reçu le vote'
  },
  event_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'events',
      key: 'id'
    },
    field: 'event_id',
    comment: 'Événement concerné'
  },
  quantity: {
    type: DataTypes.INTEGER,
    defaultValue: 1,
    allowNull: false,
    validate: {
      min: 1,
      max: 1000
    },
    comment: 'Nombre de votes (1 paiement = plusieurs votes possibles)'
  },
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {},
    comment: 'Métadonnées supplémentaires (source, appareil, etc.)'
  },
  ip_address: {
    type: DataTypes.INET,
    allowNull: true,
    comment: 'Adresse IP du votant'
  },
  user_agent: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'User-Agent du navigateur/appareil'
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    allowNull: false,
    field: 'created_at',
    comment: 'Date et heure du vote'
  }
}, {
  tableName: 'votes',
  timestamps: true,          // Active createdAt et updatedAt
  updatedAt: false,          // Désactive updatedAt car les votes sont immuables
  createdAt: 'created_at',   // Nom de la colonne pour createdAt
  underscored: true,         // Utilise des noms de colonnes en snake_case
  indexes: [
    {
      name: 'idx_votes_payment',
      fields: ['payment_id'],
      comment: 'Index pour recherche par paiement'
    },
    {
      name: 'idx_votes_candidate',
      fields: ['candidate_id'],
      comment: 'Index pour recherche par candidat'
    },
    {
      name: 'idx_votes_event',
      fields: ['event_id'],
      comment: 'Index pour recherche par événement'
    },
    {
      name: 'idx_votes_event_candidate',
      fields: ['event_id', 'candidate_id'],
      comment: 'Index composite pour stats par événement/candidat'
    },
    {
      name: 'idx_votes_created_at',
      fields: ['created_at'],
      comment: 'Index pour recherches temporelles'
    },
    {
      name: 'idx_votes_event_created',
      fields: ['event_id', 'created_at'],
      comment: 'Index pour timeline par événement'
    }
  ],
  hooks: {
    beforeCreate: async (vote) => {
      // Validation supplémentaire si nécessaire
      console.log(`✅ Création d'un vote pour le candidat ${vote.candidate_id}`);
    },
    afterCreate: async (vote) => {
      // Hook pour mise à jour du compteur en temps réel
      // Peut être utilisé pour WebSocket
      console.log(`🎯 Vote enregistré: ${vote.quantity} voix`);
    }
  }
});

module.exports = Vote;