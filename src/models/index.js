const User = require('./User');
const Event = require('./Event');
const Candidate = require('./Candidate');
const Payment = require('./Payment');
const Vote = require('./Vote');
const Withdrawal = require('./Withdrawal');
const SubscriptionPlan = require('./SubscriptionPlan'); 
const OrganizerSubscription = require('./OrganizerSubscription');
const Commission = require('./Commission');  


// ==================== ASSOCIATIONS ====================

// ---------- USER ----------
User.hasMany(Event, { 
  foreignKey: 'organizer_id', 
  as: 'events' 
});

User.hasMany(Withdrawal, { 
  foreignKey: 'organizer_id', 
  as: 'withdrawals' 
});

User.hasMany(Withdrawal, { 
  foreignKey: 'processed_by', 
  as: 'processedWithdrawals' 
});

// ---------- EVENT ----------
Event.belongsTo(User, { 
  foreignKey: 'organizer_id', 
  as: 'organizer' 
});

Event.hasMany(Candidate, { 
  foreignKey: 'event_id', 
  as: 'candidates' 
});

Event.hasMany(Payment, { 
  foreignKey: 'event_id', 
  as: 'payments' 
});

Event.hasMany(Vote, { 
  foreignKey: 'event_id', 
  as: 'votes' 
});

Event.hasMany(Withdrawal, { 
  foreignKey: 'event_id', 
  as: 'withdrawals' 
});

// ---------- CANDIDATE ----------
Candidate.belongsTo(Event, { 
  foreignKey: 'event_id', 
  as: 'event' 
});

Candidate.hasMany(Payment, { 
  foreignKey: 'candidate_id', 
  as: 'payments' 
});

Candidate.hasMany(Vote, { 
  foreignKey: 'candidate_id', 
  as: 'votes' 
});

// ---------- PAYMENT ----------
Payment.belongsTo(Event, { 
  foreignKey: 'event_id', 
  as: 'event' 
});

Payment.belongsTo(Candidate, { 
  foreignKey: 'candidate_id', 
  as: 'candidate' 
});

Payment.hasMany(Vote, { 
  foreignKey: 'payment_id', 
  as: 'votes' 
});

// ---------- VOTE ----------
Vote.belongsTo(Payment, { 
  foreignKey: 'payment_id', 
  as: 'payment' 
});

Vote.belongsTo(Candidate, { 
  foreignKey: 'candidate_id', 
  as: 'candidate' 
});

Vote.belongsTo(Event, { 
  foreignKey: 'event_id', 
  as: 'event' 
});

// ---------- WITHDRAWAL ----------
Withdrawal.belongsTo(User, { 
  foreignKey: 'organizer_id', 
  as: 'organizer' 
});

Withdrawal.belongsTo(User, { 
  foreignKey: 'processed_by', 
  as: 'processor' 
});

Withdrawal.belongsTo(Event, { 
  foreignKey: 'event_id', 
  as: 'event' 
});

// SubscriptionPlan <-> OrganizerSubscription
SubscriptionPlan.hasMany(OrganizerSubscription, { 
  foreignKey: 'plan_id', 
  as: 'subscriptions' 
});
OrganizerSubscription.belongsTo(SubscriptionPlan, { 
  foreignKey: 'plan_id', 
  as: 'plan' 
});

// User <-> OrganizerSubscription
User.hasMany(OrganizerSubscription, { 
  foreignKey: 'organizer_id', 
  as: 'subscriptions' 
});
OrganizerSubscription.belongsTo(User, { 
  foreignKey: 'organizer_id', 
  as: 'organizer' 
});

// Payment <-> OrganizerSubscription
Payment.hasOne(OrganizerSubscription, { 
  foreignKey: 'payment_id', 
  as: 'subscription' 
});
OrganizerSubscription.belongsTo(Payment, { 
  foreignKey: 'payment_id', 
  as: 'payment' 
});

// Commission associations
Commission.belongsTo(Payment, { 
  foreignKey: 'payment_id', 
  as: 'payment' 
});
Commission.belongsTo(Event, { 
  foreignKey: 'event_id', 
  as: 'event' 
});
Commission.belongsTo(User, { 
  foreignKey: 'organizer_id', 
  as: 'organizer' 
});

Payment.hasOne(Commission, { 
  foreignKey: 'payment_id', 
  as: 'commission' 
});

Event.hasMany(Commission, { 
  foreignKey: 'event_id', 
  as: 'commissions' 
});

User.hasMany(Commission, { 
  foreignKey: 'organizer_id', 
  as: 'commissions' 
});


// ==================== EXPORTS ====================
module.exports = {
  User,
  Event,
  Candidate,
  Payment,
  Vote,
  Withdrawal,
  SubscriptionPlan,
  OrganizerSubscription,
  Commission
};