/**
 * Dynamic Supply Chain Operating System — Tracking Code Generator
 * Generates Luhn mod-10 checksummed codes in format: PREFIX-BODY-CHECKSUM
 * e.g. NX-A7X9M2KP4R-83
 * 
 * Body charset excludes ambiguous characters: I, O, 0, 1
 * Checksum: 2-digit Luhn mod-10
 * Async DB uniqueness check with retry loop (max 5 attempts)
 */

const cryptoRandomString = require('crypto-random-string');

// Charset: A-Z except I, O; 2-9 digits (exclude 0, 1)
const BODY_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// --- Checksum: Luhn mod-10, 2 digits ---
/**
 * Compute Luhn mod-10 checksum for a string.
 * @param {string} input
 * @returns {string} 2-digit checksum
 */
function luhnMod10(input) {
  let sum = 0;
  let alternate = false;
  for (let i = input.length - 1; i >= 0; i--) {
    let digit = parseInt(input[i], 10);
    if (alternate) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    alternate = !alternate;
  }
  const check = (10 - (sum % 10)) % 10;
  return check.toString().padStart(2, '0'); // 2-digit checksum
}

/**
 * Generate a random body string of specified length from the restricted charset.
 * @param {number} length
 * @returns {string}
 */
function generateBody(length) {
  return cryptoRandomString({
    length,
    pool: BODY_CHARSET.split(''),
  }).join('');
}

/**
 * Generate the full tracking code body (prefix + body + checksum).
 * @param {string} prefix - e.g. 'NX'
 * @param {number} bodyLength - typically 8-12 characters
 * @returns {{code: string, body: string, checksum: string}}
 */
function generateCodeBody(prefix, bodyLength = 10) {
  const body = generateBody(bodyLength);
  const checksumInput = (prefix + body).toUpperCase();
  const checksum = luhnMod10(checksumInput);
  const code = `${prefix}-${body}-${checksum}`;
  return { code, body, checksum };
}

/**
 * Validate a tracking code format and checksum.
 * @param {string} code - e.g. 'NX-A7X9M2KP4R-83'
 * @returns {{valid: boolean, prefix?: string, body?: string, checksum?: string, error?: string}}
 */
function validateTrackingCode(code) {
  if (!code || typeof code !== 'string') {
    return { valid: false, error: 'Tracking code must be a non-empty string.' };
  }
  const parts = code.split('-');
  if (parts.length !== 3) {
    return { valid: false, error: 'Invalid tracking code format. Expected PREFIX-BODY-CHECKSUM.' };
  }
  const [prefix, body, checksum] = parts;
  // Validate prefix (basic: alphanumeric, 2-5 chars)
  if (!/^[A-Z0-9]{2,5}$/i.test(prefix)) {
    return { valid: false, error: 'Invalid prefix format.' };
  }
  // Validate body (no ambiguous chars, per charset)
  if (!/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/.test(body)) {
    return { valid: false, error: 'Invalid body characters. Ambiguous characters (I, O, 0, 1) are excluded.' };
  }
  // Validate checksum
  const checksumInput = (prefix + body).toUpperCase();
  const expectedChecksum = luhnMod10(checksumInput);
  if (checksum.toUpperCase() !== expectedChecksum.toUpperCase()) {
    return { valid: false, error: `Invalid checksum. Expected ${expectedChecksum}, got ${checksum}.` };
  }
  return {
    valid: true,
    prefix,
    body,
    checksum,
  };
}

/**
 * Asynchronously generate a unique tracking code, checking against the DB.
 * Retries on collision up to maxAttempts times.
 * @param {import('.').SupabaseService} supabase - Supabase service client
 * @param {object} options - { prefix, bodyLength, maxAttempts }
 * @returns {Promise<string>} - unique tracking code
 */
async function generateUniqueTrackingCode(supabase, { prefix, bodyLength = 10, maxAttempts = 5 }) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { code } = generateCodeBody(prefix, bodyLength);
    // Check uniqueness against shipments table
    const { data, error } = await supabaseService
      .from('shipments')
      .select('tracking_code')
      .eq('tracking_code', code)
      .single();

    if (error && error.code !== 'PGRST116') {
      // PGRST116 = "no rows returned" — that's fine, code is unique
      console.error('[ERROR] DB check error during tracking code generation:', error);
      throw new Error('Database error while generating tracking code.');
    }

    if (!data) {
      // Code is unique (no existing row with this tracking_code)
      return code;
    }

    // Collision: code already exists. Retry.
    if (attempt < maxAttempts) {
      continue;
    }
    // Exhausted retries — very unlikely with large body space, but fail gracefully
    throw new Error(`Unable to generate unique tracking code after ${maxAttempts} attempts. Consider increasing bodyLength.`);
  }
}

// --- Export API ---
module.exports = {
  generateCodeBody,
  validateTrackingCode,
  generateUniqueTrackingCode,
  BODY_CHARSET,
};