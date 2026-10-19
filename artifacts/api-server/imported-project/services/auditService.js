/**
 * Dynamic Supply Chain Operating System — Audit Service
 * Immutable audit log writing for all admin/destructive actions.
 * Every manual override MUST call this function. Failure to write the audit
 * log will abort the associated operation.
 * 
 * Writes to the `audit_logs` table with actor user ID, action, target details,
 * before/after snapshots, IP address, and user agent.
 */

const { supabaseService } = require('../services/db');

/**
 * Write an immutable audit log entry.
 * Must be awaited on every mutating admin action.
 * If the write fails, the calling operation must be rolled back/aborted.
 * 
 * @param {object} params
 * @param {string} params.actorId - UUID of the user performing the action
 * @param {string} params.action - e.g. "shipment_status_update", "geolocation_override", "user_create"
 * @param {string} params.targetTable - e.g. "shipments", "facilities", "users"
 * @param {string} params.targetId - UUID of the target record
 * @param {object} [params.before] - JSONB snapshot of state before the change
 * @param {object} [params.after] - JSONB snapshot of state after the change
 * @param {string} [params.ipAddress] - Client IP address (string format, will be cast to INET)
 * @param {string} [params.userAgent] - HTTP User-Agent string
 * @returns {Promise<void>}
 */
async function writeAuditLog({
  actorId,
  action,
  targetTable,
  targetId,
  before,
  after,
  ipAddress,
  userAgent,
}) {
  // Build the payload
  const payload = {
    actor_id: actorId,
    action,
    target_table: targetTable,
    target_id: targetId,
    ip_address: ipAddress ? `${ipAddress}` : null, // ensure string for INET cast
    user_agent: userAgent || null,
  };

  // Capture before/after as JSONB if provided
  if (before && typeof before === 'object') {
    payload.action_before = JSON.stringify(before);
  }
  if (after && typeof after === 'object') {
    payload.action_after = JSON.stringify(after);
  }

  const { error } = await supabaseService.from('audit_logs').insert([payload]);

  if (error) {
    console.error(
      `[AUDIT FAIL] Could not write audit log entry:`,
      error.message,
      { payload }
    );
    // Abort the calling operation — the caller must roll back / reject
    const err = new Error(
      `Audit log write failed. Operation aborted for action: ${action}.`
    );
    err.code = 'AUDIT_LOG_WRITE_FAILED';
    throw err;
  }

  // Optional: also log to console for real-time visibility in dev
  if (process.env.NODE_ENV === 'development') {
    console.log(`[AUDIT] ${action} by ${actorId} on ${targetTable}/${targetId}`);
  }
}

module.exports = {
  writeAuditLog,
};