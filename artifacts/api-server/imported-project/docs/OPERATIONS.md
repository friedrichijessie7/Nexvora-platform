# Northstar OS operational workflow

## Manual Override for a controlled demo

1. Sign in to **Control Center** with an Operator or SuperAdmin account.
2. Create an asset movement. The system creates a cryptographically generated visibility code and a `created` tracking event.
3. Select the movement and use **Set verified location** to establish a facility or partner-confirmed latitude/longitude. Use city-level privacy for investor demonstrations.
4. Apply one status at a time, respecting the state model: `created → picked_up → in_transit → out_for_delivery → delivered`. Every override writes a visibility event and immutable audit record with actor, IP, agent, prior value, and new value.
5. For a presentation, use **Run demo sequence** only on a new movement in `created` state. It runs the international scenario through the same protected status path; it does not bypass history.
6. Use the public home page with the generated visibility code. It shows the sequence and last verified generalized location—not a claim of live package GPS.

## Transition to live operations

- Create one facility record per partner node, cross-dock, or destination hub. Confirm coordinates and public city labels before activation.
- Issue an Operator account per approved partner team; never share a SuperAdmin credential. Require 12+ character passwords and deactivate access as soon as personnel change.
- Initially accept partner scans through a controlled operator procedure: retain the source scan/reference in the internal process, update the verified location, then apply the matching state transition.
- Reconcile the audit log daily against partner manifests. Flag time anomalies, unexpected location jumps, and manual POD uploads for review.
- When an integration is ready, place it behind a partner-specific adapter that validates signed webhook requests, maps partner event names into the internal state machine, and writes the same tracking-event/audit format. Do not grant partners the service-role key.
- Store photographs and signatures in private object storage with short-lived, customer-authorized access links; never place raw image blobs in tracking events.

## Security operations

- Keep `SUPABASE_SERVICE_KEY` only in the server/deployment secret manager.
- Apply `docs/schema.sql` before deploying the API. The public visibility route deliberately returns a whitelist rather than exposing database rows directly.
- Seed the first SuperAdmin through a one-time, audited administrative migration; do not add a default password to source control.
- Review rate-limit, authentication, and application logs. Rotate `JWT_SECRET` and service keys through a planned session invalidation process.
