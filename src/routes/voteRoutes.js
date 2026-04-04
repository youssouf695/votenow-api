const express = require('express');
const { body, param, query } = require('express-validator');
const voteController = require('../controllers/voteController');
const { auth, authorize } = require('../middleware/auth');

const router = express.Router();

// ==================== ROUTES PUBLIQUES ====================
// ⚠️ Les routes spécifiques DOIVENT être avant les routes avec :param
// sinon Express capture /public/stats/xxx comme /:voteId

router.get('/live/:eventId', [
  param('eventId').isUUID().withMessage('ID événement invalide')
], voteController.getLiveVotes);

router.get('/ranking/:eventId', [
  param('eventId').isUUID().withMessage('ID événement invalide'),
  query('limit').optional().isInt({ min: 1, max: 100 })
], voteController.getRanking);

router.get('/recent/:eventId', [
  param('eventId').isUUID().withMessage('ID événement invalide'),
  query('limit').optional().isInt({ min: 1, max: 50 })
], voteController.getRecentVotes);

router.get('/check/:eventId/:phone', [
  param('eventId').isUUID().withMessage('ID événement invalide'),
  param('phone').isMobilePhone('any').withMessage('Numéro invalide')
], voteController.checkVoter);

// ✅ Route publique stats — DOIT être avant /:voteId
router.get('/public/stats/:eventId', [
  param('eventId').isUUID().withMessage('ID événement invalide')
], voteController.getPublicEventStats);

// ✅ Route admin/all — DOIT être avant /:voteId
router.get('/admin/all', [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('eventId').optional().isUUID(),
  query('candidateId').optional().isUUID(),
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601()
], auth, authorize('admin'), voteController.getAllVotes);


// ==================== ROUTES PROTÉGÉES (ORGANISATEURS) ====================

router.get('/stats/:eventId', [
  param('eventId').isUUID().withMessage('ID événement invalide')
], auth, authorize('organizer', 'admin'), voteController.getEventStats);

router.get('/export/:eventId', [
  param('eventId').isUUID().withMessage('ID événement invalide'),
  query('format').optional().isIn(['csv', 'json'])
], auth, authorize('organizer', 'admin'), voteController.exportVotes);

router.get('/timeline/:eventId', [
  param('eventId').isUUID().withMessage('ID événement invalide'),
  query('interval').optional().isIn(['hour', 'day', 'week']),
  query('days').optional().isInt({ min: 1, max: 90 })
], auth, authorize('organizer', 'admin'), voteController.getVoteTimeline);

router.get('/by-candidate/:eventId', [
  param('eventId').isUUID().withMessage('ID événement invalide')
], auth, authorize('organizer', 'admin'), voteController.getVotesByCandidate);

router.get('/hourly/:eventId', [
  param('eventId').isUUID().withMessage('ID événement invalide'),
  query('days').optional().isInt({ min: 1, max: 30 })
], auth, authorize('organizer', 'admin'), voteController.getHourlyStats);


// ==================== ROUTES ADMIN — avec :param en DERNIER ====================
// ⚠️ Ces routes avec :voteId doivent absolument être après toutes les routes
// avec des segments fixes (public/stats, admin/all, stats/, etc.)

router.delete('/:voteId', [
  param('voteId').isUUID().withMessage('ID vote invalide'),
  body('reason').optional().isString()
], auth, authorize('admin'), voteController.deleteVote);

router.post('/:voteId/cancel', [
  param('voteId').isUUID().withMessage('ID vote invalide'),
  body('reason').notEmpty().withMessage('La raison est requise')
], auth, authorize('admin'), voteController.cancelVote);

module.exports = router;