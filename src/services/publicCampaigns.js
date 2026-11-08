const { Op } = require('sequelize');
function buildPublicQuery(query, now = new Date()) {
  const status = query.status === undefined ? 'all' : query.status;
  if (!['all', 'active', 'upcoming', 'closed'].includes(status)) throw Object.assign(new Error('Filtre de campagne invalide'), { status: 400 });
  const page = Math.max(1, Math.min(100000, Math.floor(Number(query.page) || 1)));
  const limit = Math.max(1, Math.min(100, Math.floor(Number(query.limit) || 10)));
  const ended = { [Op.or]: [{ status: 'closed' }, { status: 'active', ends_at: { [Op.lte]: now } }] };
  const notEnded = { [Op.or]: [{ ends_at: null }, { ends_at: { [Op.gt]: now } }] };
  let where;
  if (status === 'closed') where = ended;
  else if (status === 'upcoming') where = { status: 'active', starts_at: { [Op.gt]: now }, [Op.and]: [notEnded] };
  else if (status === 'active') where = { status: 'active', [Op.and]: [notEnded, { [Op.or]: [{ starts_at: null }, { starts_at: { [Op.lte]: now } }] }] };
  else where = { status: { [Op.in]: ['active', 'closed'] } };
  where.archived_at = null;
  return { where, page, limit };
}
function publicStatus(event, now = Date.now()) {
  if (event.status === 'closed' || (event.ends_at && new Date(event.ends_at).getTime() <= now)) return 'closed';
  if (event.starts_at && new Date(event.starts_at).getTime() > now) return 'upcoming';
  return event.status;
}
module.exports = { buildPublicQuery, publicStatus };
