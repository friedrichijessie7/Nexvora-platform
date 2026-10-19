/**
 * Dynamic Supply Chain Operating System — Admin Routes
 * Manual override, simulation, audit logs, user/facility management.
 * All endpoints protected by JWT + role check (SuperAdmin/Operator).
 * Strict rate limiter applies.
 */

const express = require('router');
const router = express.Router();

const {
  createFacility,
  adminCreateShipment,
  listAdminShipments,
  adminUpdateStatus,
  listAuditLogs,
  createAdminUser,
  adminSimulate,
} = require('../controllers/adminController');

// All admin routes apply:
// - verifyToken (JWT authentication)
// - requireRole('superadmin', 'operator') (except where noted)
// - strictLimiter (10 req/min/IP)

// POST /api/admin/facilities — create hub/node
router.post('/facilities', requireRole('superadmin', 'operator'), createFacility);

// POST /api/admin/shipments — create shipment (admin)
router.post('/shipments', requireRole('superadmin', 'operator'), strictLimiter(), adminCreateShipment);

// GET /api/admin/shipments — paginated list
router.get('/shipments', requireRole('superadmin', 'operator'), listAdminShipments);

// PATCH /api/admin/shipments/:id/status — manual status override
router.patch('/shipments/:id/status', requireRole('superadmin', 'operator'), strictLimiter(), adminUpdateStatus);

// GET /api/admin/audit-logs — SuperAdmin only, paginated
router.get('/audit-logs', requireRole('superadmin'), listAuditLogs);

// POST /api/admin/users — create operator/viewer accounts
router.post('/users', requireRole('superadmin'), createAdminUser);

// POST /api/admin/shipments/:id/simulate — simulation mode
router.post('/shipments/:id/simulate', requireRole('superadmin', 'operator'), strictLimiter(), adminSimulate);

module.exports = router;

// Per-route middleware helpers (mounted in server.js)
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

function strictLimiter() {
  const rateLimit = require('express-rate-limit');
  return rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many requests, throttled. Please slow down.', code: 'STRICT_RATE_LIMITED' },
  });
}