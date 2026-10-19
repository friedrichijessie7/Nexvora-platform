/**
 * Dynamic Supply Chain Operating System — Rate Limiter Middleware
 * Global limiter + strict limiter for admin/auth routes.
 * 
 * Usage in Express:
 *   const { globalLimiter, strictLimiter } = require('../middleware/rateLimiter');
 * 
 * app.use(globalLimiter());     // on ALL routes (100 req/min/IP)
 * app.use('/api/admin/*', strictLimiter()); // admin routes only (10 req/min/IP)
 */

const rateLimit = require('express-rate-limit');

/**
 * Global limiter: 100 requests per minute per IP.
 * Applied to all routes before auth/role checks.
 */
function globalLimiter() {
  return rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 100,
    standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    message: { success: false, error: 'Too many requests, please try again later.', code: 'RATE_LIMITED' },
    keyGenerator: (req) => {
      // Prefer X-Forwarded-For for reverse-proxy setups; fall back to req.ip
      const forwarded = req.headers['x-forwarded-for'];
      if (forwarded && forwarded.split(',').length > 0) {
        return forwarded.split(',')[0].trim();
      }
      return req.ip;
    },
  });
}

/**
 * Strict limiter: 10 requests per minute per IP (for admin/auth routes).
 * Applied after global limiter; more restrictive.
 */
function strictLimiter() {
  return rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many requests, throttled. Please slow down.', code: 'STRICT_RATE_LIMITED' },
    skipSuccessfulRequests: false,
    keyGenerator: (req) => {
      const forwarded = req.headers['x-forwarded-for'];
      if (forwarded && forwarded.split(',').length > 0) {
        return forwarded.split(',')[0].trim();
      }
      return req.ip;
    },
  });
}

/**
 * Optional: per-endpoint limiter factory.
 * @param {object} options - { windowMs, max, keyGenerator? }
 * @returns {import('express-rate-limit').rateLimit}
 */
function createLimiter(options = {}) {
  return rateLimit({
    windowMs: options.windowMs || 60 * 1000,
    max: options.max || 100,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: options.keyGenerator,
  });
}

module.exports = {
  globalLimiter,
  strictLimiter,
  createLimiter,
};