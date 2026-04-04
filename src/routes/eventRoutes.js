const express = require('express');
const { body, param } = require('express-validator');
const eventController = require('../controllers/eventController');
const { auth, authorize } = require('../middleware/auth');

const router = express.Router();

// ==================== ROUTES PUBLIQUES ====================
// Accessibles sans authentification
router.get('/public', eventController.getPublicEvents);
router.get('/public/:slug', eventController.getPublicEventBySlug); // ← Changé ici
router.get('/public/:slug/ranking', eventController.getEventRanking);
router.get('/public/id/:id', eventController.getPublicEventById); // ← Nouvelle route

// ==================== ROUTES PROTÉGÉES ====================
// Toutes les routes après auth nécessitent une authentification
router.use(auth);

// --- Gestion des événements ---
router.post('/',
  [
    body('title').notEmpty().withMessage('Titre requis'),
    body('vote_price_fcfa').isInt({ min: 50, max: 10000 }).withMessage('Prix invalide'),
    body('starts_at').optional().isISO8601(),
    body('ends_at').optional().isISO8601()
  ],
  authorize('organizer', 'admin'),
  eventController.createEvent
);

router.get('/my-events',
  authorize('organizer', 'admin'),
  eventController.getMyEvents
);

router.get('/:id',
  authorize('organizer', 'admin'),
  eventController.getEventById // ← Route protégée pour l'organisateur
);

router.put('/:id',
  [
    param('id').isUUID().withMessage('ID invalide'),
    body('title').optional().notEmpty(),
    body('vote_price_fcfa').optional().isInt({ min: 50, max: 10000 })
  ],
  authorize('organizer', 'admin'),
  eventController.updateEvent
);

router.post('/:id/publish',
  [param('id').isUUID()],
  authorize('organizer', 'admin'),
  eventController.publishEvent
);

// --- Gestion des candidats ---
router.get('/:eventId/candidates',
  authorize('organizer', 'admin'),
  eventController.getCandidates
);

router.post('/:eventId/candidates',
  [
    param('eventId').isUUID(),
    body('name').notEmpty().withMessage('Nom requis'),
    body('number').optional().isInt({ min: 1 }),
    body('bio').optional()
  ],
  authorize('organizer', 'admin'),
  eventController.addCandidate
);

router.put('/candidates/:candidateId',
  [
    param('candidateId').isUUID(),
    body('name').optional().notEmpty(),
    body('number').optional().isInt({ min: 1 })
  ],
  authorize('organizer', 'admin'),
  eventController.updateCandidate
);

router.delete('/candidates/:candidateId',
  [param('candidateId').isUUID()],
  authorize('organizer', 'admin'),
  eventController.deleteCandidate
);

module.exports = router;