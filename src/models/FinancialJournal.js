const {DataTypes: D} = require('sequelize');
const db = require('../config/database');

const options = tableName => ({tableName, timestamps: false});
const id = () => ({type: D.UUID, primaryKey: true});

const FinancialAccount = db.define('FinancialAccount', {
  id: id(),
  organizer_id: D.UUID,
  kind: D.TEXT,
  currency: D.CHAR(3),
  book: D.TEXT
}, options('financial_accounts'));

const FinancialJournalEntry = db.define('FinancialJournalEntry', {
  id: id(),
  withdrawal_id: D.UUID,
  kind: D.TEXT,
  source: D.TEXT,
  operation_id: D.UUID,
  idempotency_key: D.TEXT,
  recorded_at: {type: D.DATE, defaultValue: db.literal('DEFAULT')}
}, options('financial_journal_entries'));

const FinancialJournalLine = db.define('FinancialJournalLine', {
  entry_id: id(),
  side: {type: D.TEXT, primaryKey: true},
  account_id: D.UUID,
  amount_fcfa: D.INTEGER
}, options('financial_journal_lines'));

module.exports = {FinancialAccount, FinancialJournalEntry, FinancialJournalLine};
