const jwt = require('jsonwebtoken');
const { User } = require('../models');
const env = require('../config/env');

const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      throw new Error();
    }

    const decoded = jwt.verify(token, env.jwt.secret);
    const user = await User.findByPk(decoded.id);

    if (!user || (decoded.version || 0) !== (user.auth_version || 0)) {
      throw new Error();
    }

    const [restrictions]=await require('../config/database').query('SELECT suspended FROM user_restrictions WHERE user_id=:id',{replacements:{id:user.id}});
    if(restrictions[0]?.suspended)return res.status(403).json({error:'Compte suspendu. Contactez le support VoteNow.',code:'ACCOUNT_SUSPENDED'});
    req.user = user;
    req.token = token;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Veuillez vous authentifier' });
  }
};

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ 
        error: 'Vous n\'avez pas les droits pour cette action' 
      });
    }
    next();
  };
};

module.exports = { auth, authorize };
