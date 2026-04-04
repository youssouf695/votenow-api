const express = require('express');
const router = express.Router();
const { SubscriptionPlan } = require('../models');

// Route publique — liste les plans actifs (affichés sur la page pricing)
router.get('/', async (req, res) => {
  try {
    const plans = await SubscriptionPlan.findAll({
      where: { is_active: true },
      order: [['sort_order', 'ASC']],
      attributes: [
        'id', 'name', 'description', 'price_fcfa',
        'max_events', 'max_candidates_per_event',
        'commission_rate', 'duration_days',
        'features', 'sort_order'
      ]
    });

    res.json({ plans });

  } catch (error) {
    console.error('Erreur getPlans:', error.message);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;