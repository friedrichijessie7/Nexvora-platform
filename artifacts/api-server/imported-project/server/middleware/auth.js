const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { supabaseAdmin } = require('../services/db');

async function verifyToken(req, res, next) {
  const token = req.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return res.status(401).json({ success: false, error: 'Authentication is required.', code: 'AUTH_REQUIRED' });
  try {
    const claims = jwt.verify(token, env.JWT_SECRET, { issuer: env.JWT_ISSUER });
    const { data: user, error } = await supabaseAdmin.from('users').select('id,email,role,security_clearance,is_active').eq('id', claims.sub).single();
    if (error || !user || !user.is_active) return res.status(401).json({ success: false, error: 'Account is unavailable.', code: 'ACCOUNT_UNAVAILABLE' });
    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, error: error.name === 'TokenExpiredError' ? 'Session expired.' : 'Invalid session.', code: 'INVALID_TOKEN' });
  }
}
function requireRole(...roles) {
  return (req, res, next) => roles.includes(req.user?.role)
    ? next()
    : res.status(403).json({ success: false, error: 'This role is not authorized for this action.', code: 'FORBIDDEN' });
}
module.exports = { verifyToken, requireRole };
