/**
 * Dynamic Supply Chain Operating System — Auth Routes
 * JWT-based authentication: register, login, refresh, logout, me.
 * 
 * Route mounting pattern (in server.js):
 *   app.use('/api/auth', authRoutes); // verifyToken + requireRole applied per-route or globally
 */

const express = require('express');
const router = express.Router();

const { login, refresh, logout, register, me } = require('../controllers/authController');

// POST /api/auth/login — public (no auth required)
router.post('/login', login);

// POST /api/auth/refresh — public
router.post('/refresh', refresh);

// POST /api/auth/logout — authenticated
router.post('/logout', requireAuth, logout);

// GET /api/auth/me — authenticated
router.get('/me', requireAuth, me);

// POST /api/auth/register — SuperAdmin only
router.post('/register', requireAuth, requireRole('superadmin'), register);

module.exports = router;

// Per-route middleware helpers (these will be overridden by server.js global middleware)
function requireAuth(req, res, next) {
  // In production, the actual verifyToken from middleware/auth.js is mounted at the app level.
  // This fallback ensures the router does not crash if called directly.
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'Authorization token missing',
      code: 'AUTH_TOKEN_MISSING',
    });
  }
  try {
    const token = authHeader.split(' ')[1];
    const decoded = require('jsonwebtoken').verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      error: 'Invalid authentication token',
      code: 'INVALID_TOKEN',
    });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !req.user.role || !roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions.',
        code: 'INSUFFICIENT_PERMISSIONS',
      });
    }
    next();
  };
}