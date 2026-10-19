const crypto = require('crypto');
const { supabaseAdmin } = require('./db');
const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function luhnDigit(input) {
  const digits = [...input.toUpperCase()].flatMap((char) => char >= 'A' && char <= 'Z' ? String(char.charCodeAt(0) - 55) : char).map(Number);
  let sum = 0;
  for (let i = digits.length - 1, parity = 0; i >= 0; i--, parity ^= 1) {
    let value = digits[i];
    if (parity) value = value * 2 > 9 ? value * 2 - 9 : value * 2;
    sum += value;
  }
  return String((10 - (sum % 10)) % 10).padStart(2, '0');
}
function randomBody(length = 10) {
  return Array.from({ length }, () => CHARSET[crypto.randomInt(CHARSET.length)]).join('');
}
function validateTrackingCode(code) {
  const match = String(code || '').toUpperCase().match(/^([A-Z]{2,5})-([A-HJ-NP-Z2-9]{10})-(\d{2})$/);
  return Boolean(match && luhnDigit(`${match[1]}${match[2]}`) === match[3]);
}
async function generateTrackingCode(prefix = 'NX') {
  const cleanPrefix = String(prefix).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5) || 'NX';
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const body = randomBody();
    const code = `${cleanPrefix}-${body}-${luhnDigit(`${cleanPrefix}${body}`)}`;
    const { data, error } = await supabaseAdmin.from('shipments').select('id').eq('tracking_code', code).maybeSingle();
    if (error) throw new Error(`Tracking-code uniqueness check failed: ${error.message}`);
    if (!data) return code;
  }
  throw new Error('Unable to generate a unique tracking code.');
}
module.exports = { generateTrackingCode, validateTrackingCode };
