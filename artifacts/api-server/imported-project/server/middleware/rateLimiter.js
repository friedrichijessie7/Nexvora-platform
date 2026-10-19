const rateLimit = require('express-rate-limit');
const keyGenerator = (req) => req.ip;
const globalLimiter = () => rateLimit({ windowMs: 60_000, limit: 100, standardHeaders: 'draft-7', legacyHeaders: false, keyGenerator, message: { success: false, error: 'Rate limit exceeded.', code: 'RATE_LIMITED' } });
const strictLimiter = () => rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false, keyGenerator, message: { success: false, error: 'Too many sensitive requests.', code: 'STRICT_RATE_LIMITED' } });
module.exports = { globalLimiter, strictLimiter };
