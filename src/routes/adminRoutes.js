const express = require('express');
const { body, param, query } = require('express-validator');
const adminController = require('../controllers/adminController'); // ← Vérifie que le chemin est correct
const { auth, authorize } = require('../middleware/auth');

const router = express.Router();

// Toutes les routes admin nécessitent authentification et rôle admin
router.use(auth);
router.use(authorize('admin'));

// ==================== DASHBOARD ====================

/**
 * @route   GET /api/admin/dashboard
 * @desc    Dashboard principal
 */
router.get('/dashboard', adminController.getDashboard); // ← Vérifie que la fonction existe

// ==================== GESTION DES UTILISATEURS ====================

/**
 * @route   GET /api/admin/users
 * @desc    Liste tous les utilisateurs
 */
router.get('/users', [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('role').optional().isIn(['admin', 'organizer', 'voter']),
  query('verified').optional().isBoolean()
], adminController.getUsers);

/**
 * @route   GET /api/admin/users/:userId
 * @desc    Détails d'un utilisateur
 */
router.get('/users/:userId', [
  param('userId').isUUID()
], adminController.getUserDetails);

/**
 * @route   PUT /api/admin/users/:userId
 * @desc    Modifier un utilisateur
 */
router.put('/users/:userId', [
  param('userId').isUUID(),
  body('role').optional().isIn(['admin', 'organizer', 'voter']),
  body('is_verified').optional().isBoolean(),
  body('balance_fcfa').optional().isInt({ min: 0 }),
  body('full_name').optional().isString(),
  body('email').optional().isEmail(),
  body('phone').optional().isString()
], adminController.updateUser);

/**
 * @route   DELETE /api/admin/users/:userId
 * @desc    Supprimer un utilisateur
 */
router.delete('/users/:userId', [
  param('userId').isUUID()
], adminController.deleteUser);

// ==================== GESTION DES ÉVÉNEMENTS ====================

/**
 * @route   GET /api/admin/events
 * @desc    Liste tous les événements
 */
router.get('/events', [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('status').optional().isIn(['draft', 'active', 'paused', 'closed']),
  query('search').optional().isString()
], adminController.getAllEvents);

/**
 * @route   PUT /api/admin/events/:eventId
 * @desc    Modifier un événement
 */
router.put('/events/:eventId', [
  param('eventId').isUUID(),
  body('status').optional().isIn(['draft', 'active', 'paused', 'closed']),
  body('commission_rate').optional().isFloat({ min: 0, max: 50 }),
  body('vote_price_fcfa').optional().isInt({ min: 50 })
], adminController.updateEvent);

// ==================== GESTION DES RETRAITS ====================

/**
 * @route   GET /api/admin/withdrawals
 * @desc    Liste toutes les demandes de retrait
 */
router.get('/withdrawals', [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('status').optional().isIn(['pending', 'processing', 'done', 'rejected'])
], adminController.getWithdrawals);

/**
 * @route   POST /api/admin/withdrawals/:withdrawalId/process
 * @desc    Traiter une demande de retrait
 */
router.post('/withdrawals/:withdrawalId/process', [
  param('withdrawalId').isUUID(),
  body('action').isIn(['approve', 'reject']),
  body('rejection_reason').optional().isString()
], adminController.processWithdrawal);

// ==================== STATISTIQUES ====================

/**
 * @route   GET /api/admin/stats/platform
 * @desc    Statistiques globales de la plateforme
 */
router.get('/stats/platform', [
  query('period').optional().isIn(['week', 'month', 'year'])
], adminController.getPlatformStats);

module.exports = router;