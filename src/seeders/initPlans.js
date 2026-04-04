const { SubscriptionPlan } = require('../models');

const plans = [
  {
    name: 'Gratuit',
    description: 'Pour découvrir la plateforme',
    price_fcfa: 0,
    max_events: 1,
    max_candidates_per_event: 5,
    commission_rate: 25.00,
    features: {
      analytics: false,
      export: false,
      api_access: false,
      custom_branding: false,
      priority_support: false
    },
    sort_order: 1
  },
  {
    name: 'Standard',
    description: 'Pour les organisateurs réguliers',
    price_fcfa: 5000,
    max_events: 5,
    max_candidates_per_event: 20,
    commission_rate: 20.00,
    features: {
      analytics: true,
      export: true,
      api_access: false,
      custom_branding: false,
      priority_support: false
    },
    sort_order: 2
  },
  {
    name: 'Premium',
    description: 'Pour les professionnels',
    price_fcfa: 25000,
    max_events: -1, // -1 = illimité
    max_candidates_per_event: 100,
    commission_rate: 15.00,
    features: {
      analytics: true,
      export: true,
      api_access: true,
      custom_branding: true,
      priority_support: true
    },
    sort_order: 3
  }
];

async function initPlans() {
  console.log('Initialisation des plans d\'abonnement...');
  
  for (const plan of plans) {
    const [instance, created] = await SubscriptionPlan.findOrCreate({
      where: { name: plan.name },
      defaults: plan
    });
    
    if (created) {
      console.log(`Plan créé: ${plan.name}`);
    } else {
      console.log(`ℹPlan déjà existant: ${plan.name}`);
    }
  }
  
  console.log('Initialisation terminée!');
}

module.exports = initPlans;