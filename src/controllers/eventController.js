const { Event, Candidate, User, CampaignCategory } = require('../models');
const sequelize = require('../config/database'); // ✅ import direct
const { validationResult } = require('express-validator');
const { Op } = require('sequelize');


// ==================== UTILITAIRE ====================
const generateSlug = (title) => {
  return title
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // retire accents
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/--+/g, '-')
    .trim();
};


// ==================== CRÉER UN ÉVÉNEMENT ====================
exports.createEvent = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      title, description, vote_price_fcfa,
      votes_per_payment, starts_at, ends_at,
      allow_anonymous, show_results, max_candidates
    } = req.body;

    if (!Number.isInteger(Number(vote_price_fcfa)) || Number(vote_price_fcfa) < 100 || Number(vote_price_fcfa) > 10000) return res.status(400).json({ error: 'Le prix d’un vote doit être compris entre 100 et 10 000 FCFA.' });

    // Slug unique
    let slug  = generateSlug(title);
    let count = 1;
    while (await Event.findOne({ where: { slug } })) {
      slug = `${generateSlug(title)}-${count++}`;
    }

    const event = await Event.create({
      organizer_id:    req.user.id,
      title,
      slug,
      description:     description     || null,
      cover_image_url: req.body.cover_image_url || null,
      avatar_url: req.body.avatar_url || null,
      site_config: req.body.site_config ? require('../services/campaignSettings').settings(req.body.site_config) : null,
      vote_price_fcfa: vote_price_fcfa || 200,
      votes_per_payment: votes_per_payment || 1,
      commission_rate: 15.00,
      max_candidates:  max_candidates  || null,
      allow_anonymous: allow_anonymous !== undefined ? allow_anonymous : true,
      show_results:    show_results    !== undefined ? show_results    : true,
      starts_at:       starts_at       || null,
      ends_at:         ends_at         || null,
      status:          'draft'
    });

    res.status(201).json({ message: 'Événement créé avec succès', event });

  } catch (error) {
    console.error('Erreur createEvent:', error.message);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Opération de campagne indisponible' });
  }
};

// ==================== GET EVENT BY ID (PROTÉGÉ) ====================
exports.getEventById = async (req, res) => {
  try {
    const { id } = req.params;
    const event = await Event.findOne({
      where: { id, organizer_id: req.user.id },
      include: [{ model: CampaignCategory, as: 'categories' }, {
        model: Candidate,
        as: 'candidates', // ← AJOUTE L'ALIAS ICI !
        where: { is_active: true },
        required: false
      }]
    });

    if (!event) {
      return res.status(404).json({ error: 'Événement non trouvé' });
    }

    res.json({ event });
  } catch (error) {
    console.error('Erreur getEventById:', error);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Opération de campagne indisponible' });
  }
};

// ==================== GET EVENT BY ID (PUBLIC) ====================
exports.getPublicEventById = async (req, res) => {
  try {
    const { id } = req.params;

    const event = await Event.findOne({
      where: { 
        id,
        status: { [Op.in]: ['active', 'closed'] }, archived_at: null
      },
      include: [{ model: CampaignCategory, as: 'categories' }, {
        model: Candidate,
        as: 'candidates', // ← AJOUTE L'ALIAS ICI
        where: { is_active: true },
        required: false
      }]
    });

    if (!event) {
      return res.status(404).json({ error: 'Événement non trouvé' });
    }

    if (event.candidates) {
      event.candidates.sort((a, b) => b.vote_count - a.vote_count);
    }

    res.json({ event });
  } catch (error) {
    console.error('Erreur getPublicEventById:', error);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Opération de campagne indisponible' });
  }
};

// ==================== MES ÉVÉNEMENTS ====================
exports.getMyEvents = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * parseInt(limit);

    const where = { organizer_id: req.user.id };
    if (status) where.status = status;

    const events = await Event.findAndCountAll({
      where,
      distinct: true,
      include: [{ model: CampaignCategory, as: 'categories' }, {
        model: Candidate,
        as: 'candidates',      // ✅ alias correct
        attributes: ['id', 'name', 'number', 'vote_count', 'photo_url'],
        required: false
      }],
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset
    });

    res.json({
      events: events.rows,
      total: events.count,
      page: parseInt(page),
      totalPages: Math.ceil(events.count / parseInt(limit))
    });

  } catch (error) {
    console.error('Erreur getMyEvents:', error.message);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Opération de campagne indisponible' });
  }
};


// ==================== DÉTAIL PAR SLUG (PROTÉGÉ) ====================
exports.getEventBySlug = async (req, res) => {
  try {
    const { slug } = req.params;

    const event = await Event.findOne({
      where: { slug, archived_at: null },
      include: [
        {
          model: Candidate,
          as: 'candidates',    // ✅ alias correct
          where: { is_active: true },
          required: false
          // ⚠️ order dans un include n'est pas supporté — trié ci-dessous
        },
        {
          model: User,
          as: 'organizer',
          attributes: ['id', 'full_name']
        }
      ],
      // ✅ order sur la query principale pour les candidats
      order: [[{ model: Candidate, as: 'candidates' }, 'vote_count', 'DESC']]
    });

    if (!event) {
      return res.status(404).json({ error: 'Événement non trouvé' });
    }

    if (event.status === 'draft' && event.organizer_id !== req.user?.id) {
      return res.status(403).json({ error: 'Événement non publié' });
    }

    res.json({ event });

  } catch (error) {
    console.error('Erreur getEventBySlug:', error.message);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Opération de campagne indisponible' });
  }
};

// ==================== DÉTAIL PAR SLUG (PUBLIC) ====================
exports.getPublicEventBySlug = async (req, res) => {
  try {
    const { slug } = req.params;
    console.log('🔍 [PUBLIC] Slug reçu:', slug);
    console.log('🔍 [PUBLIC] Utilisateur:', req.user ? 'Connecté' : 'Non connecté'); // ← Vérifie si req.user existe

    const event = await Event.findOne({
      where: { slug, archived_at: null },
      include: [{ model: CampaignCategory, as: 'categories' }, {
        model: Candidate,
        as: 'candidates',
        where: { is_active: true },
        required: false
      }]
    });

    if (!event) {
      return res.status(404).json({ error: 'Événement non trouvé' });
    }

    // Ne montrer que les événements publiés
    if (!['active', 'closed'].includes(event.status) || event.archived_at) {
      return res.status(404).json({ error: 'Événement non trouvé' });
    }

    res.json({ event });
  } catch (error) {
    console.error('❌ [PUBLIC] Erreur:', error);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Opération de campagne indisponible' });
  }
};

// ==================== MODIFIER UN ÉVÉNEMENT ====================
exports.updateEvent = async (req, res) => {
  try {
    const { id } = req.params;

    const event = await Event.findOne({
      where: { id, organizer_id: req.user.id }
    });

    if (!event) {
      return res.status(404).json({ error: 'Événement non trouvé' });
    }

    if (event.status === 'closed' || event.archived_at) {
      return res.status(400).json({ error: 'Impossible de modifier un événement clôturé' });
    }

    // Champs autorisés à la modification
    const allowed = [
      'title', 'description', 'cover_image_url', 'avatar_url',
      'vote_price_fcfa', 'votes_per_payment',
      'starts_at', 'ends_at', 'max_candidates',
      'allow_anonymous', 'show_results'
    ];

    const updates = {};
    allowed.forEach(field => {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    });

    if (updates.vote_price_fcfa !== undefined && (!Number.isInteger(Number(updates.vote_price_fcfa)) || Number(updates.vote_price_fcfa) < 100 || Number(updates.vote_price_fcfa) > 10000)) return res.status(400).json({ error: 'Le prix d’un vote doit être compris entre 100 et 10 000 FCFA.' });
    await event.update(updates);

    res.json({ message: 'Événement mis à jour', event });

  } catch (error) {
    console.error('Erreur updateEvent:', error.message);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Opération de campagne indisponible' });
  }
};


// ==================== PUBLIER UN ÉVÉNEMENT ====================
exports.publishEvent = async (req, res) => {
  try {
    const { id } = req.params;

    const event = await Event.findOne({
      where: { id, organizer_id: req.user.id }
    });

    if (!event) {
      return res.status(404).json({ error: 'Événement non trouvé' });
    }

    if (event.status !== 'draft') {
      return res.status(400).json({ error: `Impossible de publier un événement "${event.status}"` });
    }

    const candidateCount = await Candidate.count({ where: { event_id: event.id } });
    if (candidateCount < 2) {
      return res.status(400).json({ error: 'Ajoutez au moins 2 candidats avant de publier' });
    }

    await event.update({
      status:    'active',
      starts_at: event.starts_at || new Date()
    });

    res.json({ message: 'Événement publié avec succès', event });

  } catch (error) {
    console.error('Erreur publishEvent:', error.message);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Opération de campagne indisponible' });
  }
};


// ==================== CLÔTURER UN ÉVÉNEMENT ====================
exports.closeEvent = async (req, res) => {
  try {
    const { id } = req.params;

    const event = await Event.findOne({
      where: { id, organizer_id: req.user.id }
    });

    if (!event) {
      return res.status(404).json({ error: 'Événement non trouvé' });
    }

    if (event.status === 'closed' || event.archived_at) {
      return res.status(400).json({ error: 'Événement déjà clôturé' });
    }

    await event.update({ status: 'closed', ends_at: new Date() });

    res.json({ message: 'Événement clôturé', event });

  } catch (error) {
    console.error('Erreur closeEvent:', error.message);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Opération de campagne indisponible' });
  }
};


// ==================== GESTION DES CANDIDATS ====================
exports.getCandidates = async (req, res) => {
  try {
    const { eventId } = req.params;
    const candidates = await Candidate.findAll({
      where: { event_id: eventId },
      order: [['vote_count', 'DESC']]
    });
    res.json({ candidates });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Opération de campagne indisponible' });
  }
};

exports.addCandidate = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { name, number, bio, photo_url, slogan, category_id } = req.body;

    const event = await Event.findOne({
      where: { id: eventId, organizer_id: req.user.id }
    });

    if (!event) {
      return res.status(404).json({ error: 'Événement non trouvé' });
    }

    if (event.status === 'closed' || event.archived_at) {
      return res.status(400).json({ error: 'Impossible d\'ajouter un candidat à un événement clôturé' });
    }

    // Vérifier la limite de candidats
    if (event.max_candidates) {
      const currentCount = await Candidate.count({ where: { event_id: eventId } });
      if (currentCount >= event.max_candidates) {
        return res.status(400).json({ error: 'Nombre maximum de candidats atteint' });
      }
    }

    // Numéro unique dans cet événement
    if (number) {
      const existing = await Candidate.findOne({ where: { event_id: eventId, number } });
      if (existing) {
        return res.status(400).json({ error: 'Ce numéro est déjà utilisé' });
      }
    }

    if (slogan !== undefined && (typeof slogan !== 'string' || slogan.length > 200)) return res.status(400).json({ error: 'Slogan limité à 200 caractères' });
    if (category_id && !/^[a-f0-9-]{36}$/i.test(category_id)) return res.status(400).json({ error: 'Catégorie invalide' });
    if (category_id && !await CampaignCategory.findOne({ where: { id: category_id, event_id: eventId } })) return res.status(400).json({ error: 'Catégorie invalide pour cette campagne' });
    const candidate = await Candidate.create({
      event_id:  eventId,
      name,
      slogan: slogan?.trim() || null,
      category_id: category_id || null,
      number:    number    || null,
      bio:       bio       || null,
      photo_url: photo_url || null
    });

    res.status(201).json({ message: 'Candidat ajouté avec succès', candidate });

  } catch (error) {
    console.error('Erreur addCandidate:', error.message);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Opération de campagne indisponible' });
  }
};


// ==================== MODIFIER UN CANDIDAT ====================
exports.updateCandidate = async (req, res) => {
  try {
    const { candidateId } = req.params;

    const candidate = await Candidate.findByPk(candidateId, {
      include: [{
        model: Event,
        as: 'event',           // ✅ alias correct
        where: { organizer_id: req.user.id }
      }]
    });

    if (!candidate) {
      return res.status(404).json({ error: 'Candidat non trouvé' });
    }

    const allowed = ['slogan', 'category_id', 'name', 'number', 'bio', 'photo_url', 'is_active', 'position', 'metadata'];
    const updates = {};
    allowed.forEach(field => {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    });

    if (candidate.event?.archived_at) return res.status(409).json({ error: 'Campagne archivée' });
    if (updates.slogan !== undefined && updates.slogan !== null && (typeof updates.slogan !== 'string' || updates.slogan.length > 200)) return res.status(400).json({ error: 'Slogan limité à 200 caractères' });
    if (updates.category_id && !/^[a-f0-9-]{36}$/i.test(updates.category_id)) return res.status(400).json({ error: 'Catégorie invalide' });
    if (updates.category_id && !await CampaignCategory.findOne({ where: { id: updates.category_id, event_id: candidate.event_id } })) return res.status(400).json({ error: 'Catégorie invalide pour cette campagne' });
    if (updates.category_id === '') updates.category_id = null;
    await candidate.update(updates);

    res.json({ message: 'Candidat mis à jour', candidate });

  } catch (error) {
    console.error('Erreur updateCandidate:', error.message);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Opération de campagne indisponible' });
  }
};


// ==================== SUPPRIMER UN CANDIDAT ====================
exports.deleteCandidate = async (req, res) => {
  try {
    const { candidateId } = req.params;

    const candidate = await Candidate.findByPk(candidateId, {
      include: [{
        model: Event,
        as: 'event',           // ✅ alias correct
        where: { organizer_id: req.user.id }
      }]
    });

    if (!candidate) {
      return res.status(404).json({ error: 'Candidat non trouvé' });
    }

    if (candidate.event?.archived_at) return res.status(409).json({ error: 'Campagne archivée : historique conservé.' });
    if (candidate.vote_count > 0) {
      // Soft delete — ne pas supprimer un candidat qui a déjà reçu des votes
      await candidate.update({ is_active: false });
      return res.json({ message: 'Candidat désactivé (avait des votes)' });
    }

    await candidate.destroy();
    res.json({ message: 'Candidat supprimé avec succès' });

  } catch (error) {
    console.error('Erreur deleteCandidate:', error.message);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Opération de campagne indisponible' });
  }
};


// ==================== ROUTES PUBLIQUES ====================

exports.getPublicEvents = async (req, res) => {
  try {
    const { buildPublicQuery, publicStatus } = require('../services/publicCampaigns');
    const { where, page, limit } = buildPublicQuery(req.query);
    const events = await Event.findAndCountAll({
      where,
      include: [{ model: User, as: 'organizer', attributes: ['id', 'full_name'] }],
      order: [['created_at', 'DESC']], limit, offset: (page - 1) * limit,
    });
    res.json({
      events: events.rows.map(row => { const data = row.toJSON(); return { ...data, display_status: publicStatus(data) }; }),
      total: events.count, page, totalPages: Math.ceil(events.count / limit),
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Liste des campagnes indisponible' });
  }
};


exports.getEventRanking = async (req, res) => {
  try {
    const { slug } = req.params;

    const event = await Event.findOne({
      where: { slug },
      attributes: ['id', 'title', 'show_results', 'status']
    });

    if (!event) {
      return res.status(404).json({ error: 'Événement non trouvé' });
    }

    // Respecter la config show_results de l'organisateur
    if (!event.show_results && event.status !== 'closed') {
      return res.status(403).json({ error: 'Classement masqué par l\'organisateur' });
    }

    const ranking = await Candidate.findAll({
      where: { event_id: event.id, is_active: true },
      attributes: ['id', 'name', 'number', 'photo_url', 'vote_count'],
      order: [['vote_count', 'DESC']],
      limit: 100
    });

    const totalVotes = ranking.reduce((sum, c) => sum + c.vote_count, 0);

    res.json({
      event:       { id: event.id, title: event.title },
      ranking:     ranking.map((c, i) => ({ ...c.toJSON(), rank: i + 1 })),
      total_votes: totalVotes
    });

  } catch (error) {
    console.error('Erreur getEventRanking:', error.message);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Opération de campagne indisponible' });
  }
};



