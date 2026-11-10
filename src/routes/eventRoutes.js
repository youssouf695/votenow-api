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
const setupController=require('../controllers/campaignSetupController');
router.post('/setup',authorize('organizer','admin'),setupController.create);
router.get('/:id/setup',authorize('organizer','admin'),setupController.get);
router.put('/:id/setup',authorize('organizer','admin'),setupController.save);
router.post('/:id/setup/restart',authorize('organizer','admin'),setupController.restart);
router.post('/:id/setup/publish',authorize('organizer','admin'),setupController.publish);
const campaignController = require('../controllers/campaignController');
const campaignAssets = require('../controllers/campaignAssetController');
const { rateLimit } = require('../middleware/rateLimit');
router.post('/:id/partner-logo', authorize('organizer','admin'), rateLimit({scope:'partner-logo',seconds:3600,limit:30,identify:req=>req.user.id}), express.raw({type:['image/jpeg','image/png','image/webp'],limit:'5mb'}), campaignAssets.uploadPartnerLogo);
router.post('/:id/gallery-image', authorize('organizer','admin'), rateLimit({scope:'gallery-image',seconds:3600,limit:30,identify:req=>req.user.id}), express.raw({type:['image/jpeg','image/png','image/webp'],limit:'5mb'}), campaignAssets.uploadGalleryImage);
router.get('/:id/site', authorize('organizer', 'admin'), campaignController.getSite);
router.put('/:id/site', authorize('organizer', 'admin'), campaignController.saveSite);
router.post('/:id/archive', authorize('organizer', 'admin'), campaignController.archive);

router.delete('/:id', authorize('organizer', 'admin'), (req, res) => {
  return res.status(409).json({ error: 'Une campagne ne peut pas être supprimée. Clôturez-la pour conserver son historique.' });
});

// --- Gestion des événements ---
router.post('/',
  [
    body('title').notEmpty().withMessage('Titre requis'),
    body('vote_price_fcfa').isInt({ min: 100, max: 10000 }).withMessage('Prix invalide'),
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
    body('vote_price_fcfa').optional().isInt({ min: 100, max: 10000 })
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
