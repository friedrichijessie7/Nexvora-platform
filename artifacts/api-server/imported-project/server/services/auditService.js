const { supabaseAdmin } = require('./db');

async function writeAuditLog({ actorId, action, targetTable, targetId, before = null, after = null, ip, userAgent }) {
  const { error } = await supabaseAdmin.from('audit_logs').insert({
    actor_id: actorId, action, target_table: targetTable, target_id: targetId,
    action_before: before, action_after: after,
    ip_address: ip || null, user_agent: userAgent || null,
  });
  if (error) {
    const err = new Error('Audit record could not be written; operation must be reconciled.');
    err.code = 'AUDIT_LOG_WRITE_FAILED';
    err.cause = error;
    throw err;
  }
}
module.exports = { writeAuditLog };
