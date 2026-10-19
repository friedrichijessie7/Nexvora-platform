/**
 * Dynamic Supply Chain Operating System — Authentication Middleware
 * JWT verification + role-check factory (requireRole).
 * 
 * Usage:
 *   const { verifyToken, requireRole } = require('../middleware/auth');
 * 
 * Routes:
 *   app.use('/api/admin/*', verifyToken, requireRole('superadmin', 'operator'));
 *   app.use('/api/shipments', verifyToken, requireRole('operator', 'superadmin'));
 */

const jwt = require('jsonwebtoken');
const { supabaseService } = require('../services/db');

/**
 * Verify JWT token from Authorization header.
 * Attaches decoded payload to req.user (including role).
 * Returns 401 if invalid/missing.
 * 
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'Authorization token missing',
      code: 'AUTH_TOKEN_MISSING',
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { id, role, iat, exp, ... }
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Token expired',
        code: 'TOKEN_EXPIRED',
      });
    }
    return res.status(401).json({
      success: false,
      error: 'Invalid authentication token',
      code: 'INVALID_TOKEN',
    });
  }
}

/**
 * Factory: requireRole(...roles)
 * Middleware that rejects the request if req.user.role is not one of the allowed roles.
 * 
 * @param {...string} roles - e.g. 'superadmin', 'operator', 'viewer', 'customer'
 * @returns {function} Express middleware
 */
function requireRole(...roles) {
  return async (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(403).json({
        success: false,
        error: 'Role information missing in token',
        code: 'ROLE_MISSING',
      });
    }

    const userRole = req.user.role;
    if (!roles.includes(userRole)) {
      return res.status(403).json({
        success: false,
        error: `Insufficient permissions. Required roles: [${roles.join(', ')}], got: ${userRole}`,
        code: 'INSUFFICIENT_PERMISSIONS',
      });
    }

    next();
  };
}

/**
 * Optional: RBAC enforcement via Supabase Row Level Security token.
 * This function can be used to set the JWT 'role' claim so that Supabase RLS
 * policies evaluate correctly for the scoped client.
 * 
 * @param {string} role - The role to set in the JWT payload (overrides decoded role)
 * @returns {function}
 */
function setRole(role) {
  return (req, res, next) => {
    // This is a no-op in the standard flow; role is typically set by the auth
    // strategy (e.g., JWT issued by an IdP). If you need to inject a role for
    // RLS testing, do so at the token issuance layer.
    next();
  };
}

module.exports = {
  verifyToken,
  requireRole,
  setRole,
};