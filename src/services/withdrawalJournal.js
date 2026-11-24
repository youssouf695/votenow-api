const {randomUUID} = require('node:crypto');
const db = require('../config/database');
const {FinancialJournalEntry, FinancialJournalLine} = require('../models/FinancialJournal');

async function accountId(organizerId, kind, transaction) {
  const replacements = {id: randomUUID(), organizerId, kind};
  // Account definitions are immutable. A concurrent insert can only create the same account.
  await db.query(`
    INSERT INTO financial_accounts(id, organizer_id, kind, currency, book)
    VALUES (:id, :organizerId, :kind, 'XAF', 'organizer_current')
    ON CONFLICT (organizer_id, kind, currency, book) DO NOTHING
  `, {replacements, transaction});
  const [[account]] = await db.query(`
    SELECT id FROM financial_accounts WHERE organizer_id = :organizerId
      AND kind = :kind AND currency = 'XAF' AND book = 'organizer_current'
  `, {replacements, transaction});
  return account.id;
}

async function postWithdrawal(withdrawal, kind, source, transaction, operationId = null) {
  if (!transaction) throw new Error('Transaction financière requise');
  const {id, organizer_id: organizerId, amount_fcfa: amount} = withdrawal;
  const isReservation = kind === 'reserve';
  let debit = 'available';
  let credit = 'reserved';
  if (!isReservation) {
    const reservation = await FinancialJournalEntry.findOne({
      attributes: ['id'], where: {withdrawal_id: id, kind: 'reserve'}, transaction
    });
    // PostgreSQL checks the persisted coverage date before accepting this counterpart.
    debit = reservation ? 'reserved' : 'pre_coverage';
    credit = kind === 'release' ? 'available' : 'provider_clearing';
  }

  let newBalance;
  if (kind !== 'settle') {
    const delta = isReservation ? -amount : amount;
    const [[updated]] = await db.query(`
      WITH updated AS (
        UPDATE users SET balance_fcfa = balance_fcfa + :delta, updated_at = now()
        WHERE id = :organizerId AND balance_fcfa IS NOT NULL
          AND (:delta > 0 OR balance_fcfa >= :amount)
        RETURNING balance_fcfa
      ) SELECT balance_fcfa FROM updated
    `, {replacements: {delta, organizerId, amount}, transaction});
    if (!updated) throw Object.assign(new Error('Solde organisateur indisponible.'), {status: 409});
    newBalance = updated.balance_fcfa;
  }

  // Stable order for account creation across withdrawals of the same organizer.
  const accounts = {};
  for (const side of [debit, credit].sort()) accounts[side] = await accountId(organizerId, side, transaction);
  const entryId = randomUUID();
  await FinancialJournalEntry.create({
    id: entryId, withdrawal_id: id, kind, source, operation_id: operationId, idempotency_key: `${id}:${kind}`
  }, {transaction});
  await FinancialJournalLine.bulkCreate([
    {entry_id: entryId, side: 'debit', account_id: accounts[debit], amount_fcfa: amount},
    {entry_id: entryId, side: 'credit', account_id: accounts[credit], amount_fcfa: amount}
  ], {transaction});
  return newBalance;
}

module.exports = {postWithdrawal};
