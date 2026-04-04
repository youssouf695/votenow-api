const express = require('express');
const { param, query } = require('express-validator');
const statsController = require('../controllers/statsController');
const { auth, authorize } = require('../middleware/auth');

const router = express.Router();

router.use(auth);

router.get('/event/:eventId', [
  param('eventId').isUUID()
], authorize('organizer', 'admin'), statsController.getEventAnalytics);

router.get('/revenue', [
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601()
], authorize('organizer', 'admin'), statsController.getRevenueReport);

module.exports = router;