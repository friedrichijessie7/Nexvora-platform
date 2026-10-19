/**
 * Dynamic Supply Chain Operating System — Validation Middleware
 * Input sanitization and payload validation using express-validator patterns.
 * All functions are pure (no express dependency) so they can be used standalone
 * or with the express-validator middleware wrapper.
 */

const { body, param, query, matchedData, validationResult } = require('express-validator');

/**
 * Sanitize a string: trim, strip HTML tags, limit length.
 * @param {string} value
 * @param {number} [maxLength=255]
 * @returns {string}
 */
function sanitizeString(value, maxLength = 255) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/<[^>]*>/g, '') // strip HTML tags
    .trim()
    .substring(0, maxLength);
}

/**
 * Validate that a string is non-empty after sanitization.
 * @param {string} value
 * @param {number} [maxLength=255]
 * @returns {string} sanitized value (throws if invalid)
 */
function validateRequired(value, maxLength = 255) {
  const sanitized = sanitizeString(value, maxLength);
  if (sanitized.length === 0) {
    throw new Error('This field is required.');
  }
  return sanitized;
}

/**
 * Check tracking code format (express-validator middleware).
 * @param {string} paramName - e.g. 'trackingCode'
 * @returns {import('express-validator').ValidationChain}
 */
function validateTrackingCode(paramName = 'trackingCode') {
  return [
    body(paramName)
      .trim()
      .notEmpty().withMessage(`${paramName} is required.`)
      .isString().withMessage(`${paramName} must be a string.`)
      .matches(/^[A-Z0-9]-[A-Z2-9HJKLMNPQRSTUVWXYZ]+-[0-9]{2}$/i)
      .withMessage('Invalid tracking code format. Expected PREFIX-BODY-CHECKSUM.'),
  ];
}

/**
 * Validate shipment creation payload (express-validator middleware).
 * @param {string} paramName - default 'shipment'
 * @returns {import('express-validator').ValidationChain[]}
 */
function validateShipmentPayload(paramName = 'shipment') {
  return [
    body(paramName)
      .trim()
      .notEmpty().withMessage('Shipment payload is required.')
      .isObject().withMessage('Shipment payload must be a JSON object.'),
    // Example nested fields — customize as needed
    body(`${paramName}.consignee_name`)
      .trim()
      .optional({ checkFalsy: true })
      .isLength({ max: 255 }).withMessage('Consignee name must be <= 255 characters.'),
    body(`${paramName}.weight_kg`)
      .optional({ checkFalsy: true })
      .isFloat({ min: 0 }).withMessage('Weight must be a non-negative number.'),
    body(`${paramName}.service_type`)
      .optional({ checkFalsy: true })
      .isIn(['express', 'standard', 'economy', 'overnight']).withMessage('Invalid service type.'),
    body(`${paramName}.consignee_address`)
      .optional({ checkFalsy: true })
      .isObject().withMessage('Consignee address must be a JSON object.'),
    // Custom sanitizer for address fields
    body(`${paramName}.consignee_address.street`)
      .optional({ checkFalsy: true })
      .trim()
      .isLength({ max: 300 }).withMessage('Street address must be <= 300 characters.'),
    body(`${paramName}.consignee_address.city`)
      .optional({ checkFalsy: true })
      .trim()
      .isLength({ max: 200 }).withMessage('City must be <= 200 characters.'),
    body(`${paramName}.consignee_address.country`)
      .optional({ checkFalsy: true })
      .trim()
      .isLength({ max: 100 }).withMessage('Country must be <= 100 characters.'),
  ];
}

/**
 * Validate pagination query parameters.
 * @param {string} paramName - default 'pagination'
 * @returns {import('express-validator').ValidationChain[]}
 */
function validatePagination(paramName = 'pagination') {
  return [
    query(`${paramName}.page`)
      .optional({ checkFalsy: true })
      .isInt({ min: 1 }).withMessage('Page must be a positive integer.'),
    query(`${paramName}.limit`)
      .optional({ checkFalsy: true })
      .isInt({ min: 1, max: 200 }).withMessage('Limit must be between 1 and 200.'),
    query(`${paramName}.status`)
      .optional({ checkFalsy: true })
      .isIn(['created', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'failed', 'cancelled'])
      .withMessage('Invalid status filter.'),
    query(`${paramName}.facility_id`)
      .optional({ checkFalsy: true })
      .isString().withMessage('Facility ID must be a string.'),
  ];
}

/**
 * Wrap express-validator results. Returns 400 with validation errors if any.
 * Usage in Express route:
 *   router.post('/', validateShipmentPayload(), (req, res) => {
 *     const errors = validationResult(req);
 *     if (!errors.isEmpty()) return res.status(400).json({ success: false, error: errors.array()[0].msg });
 *     // proceed
 *   });
 * @param {import('express').Request} req
 * @returns {{success: boolean, error?: string} | null} — null if valid, error obj if invalid
 */
function handleValidationErrors(req) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const firstError = errors.array()[0];
    return {
      success: false,
      error: firstError.msg,
      code: 'VALIDATION_ERROR',
    };
  }
  return null;
}

module.exports = {
  sanitizeString,
  validateRequired,
  validateTrackingCode,
  validateShipmentPayload,
  validatePagination,
  handleValidationErrors,
};