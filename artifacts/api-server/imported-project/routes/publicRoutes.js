/**
 * Dynamic Supply Chain Operating System — Public Routes
 * Rate-limited, no-auth endpoints: health check, shipment tracking by code.
 */

const express = require('express');
const router = express.Router();

const { trackByCode } = require('../controllers/shipmentController');
const { globalLimiter } = require('../middleware/rateLimiter');

// Public: GET /health
router.get('/health', (req, res) => {
  res.json({
    success: true,
    data: {
      status: 'healthy',
      service: 'Dynamic Supply Chain OS',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    },
    error: null,
    code: null,
  });
});

// GET /api/track/:code — secure tracking, no auth required, rate-limited
router.get('/track/:code', globalLimiter(), trackByCode);

module.exports = router;