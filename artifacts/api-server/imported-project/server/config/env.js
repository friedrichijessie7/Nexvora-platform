require('dotenv').config();

const required = ['DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'JWT_SECRET'];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
if (process.env.JWT_SECRET.length < 48) throw new Error('JWT_SECRET must be at least 48 characters.');

const nodeEnv = process.env.NODE_ENV || 'development';
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');

module.exports = Object.freeze({
  NODE_ENV: nodeEnv,
  PORT: port,
  DATABASE_URL: process.env.DATABASE_URL,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || null,
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_ISSUER: process.env.JWT_ISSUER || 'dynamic-supply-chain-os',
  ALLOWED_ORIGINS: (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',').map((v) => v.trim()).filter(Boolean),
  BCRYPT_ROUNDS: Math.min(15, Math.max(10, Number(process.env.BCRYPT_ROUNDS || 12))),
  TRACKING_PREFIX: (process.env.TRACKING_PREFIX || 'NX').toUpperCase(),
  COMPANY_NAME: process.env.COMPANY_NAME || 'Northstar OS',
  SUPABASE_DATABASE_URL: process.env.SUPABASE_DATABASE_URL || null,
});
