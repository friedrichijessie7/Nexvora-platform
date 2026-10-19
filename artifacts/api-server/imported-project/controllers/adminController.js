/**
 * Dynamic Supply Chain Operating System — Admin Controller
 * Manual override, simulation, audit logs, user/facility management.
 * All endpoints protected by JWT + role check (SuperAdmin/Operator).
 * Strict rate limiter applies.
 */

const { supabaseService } = require('../services/db');
const { writeAuditLog } = require('../services/auditService');
const { strictLimiter } = require('../middleware/rateLimiter');
const validation = require('../middleware/validation');

/**
 * POST /api/admin/facilities
 * Create a hub/node with GPS coords.
 * Protected: JWT + (SuperAdmin OR Operator).
 * 
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function createFacility(req, res) {
  // Validate payload
  const payload = req.body.facility || req.body;
  const requiredFields = ['code', 'name', 'type', 'latitude', 'longitude', 'country'];
  for (const f of requiredFields) {
    if (!payload[f]) {
      return res.status(400).json({
        success: false,
        error: `Missing required field: ${f}.`,
        code: 'MISSING_FACILITY_FIELD',
      });
    }
  }

  // Validate types
  if (typeof payload.latitude !== 'number' || typeof payload.longitude !== 'number') {
    return res.status(400).json({
      success: false,
      error: 'latitude and longitude must be numbers.',
      code: 'INVALID_COORDS',
    });
  }

  // Check for duplicate facility code
  const { data: existing } = await supabaseService
    .from('facilities')
    .select('id')
    .eq('code', payload.code)
    .single();

  if (existing) {
    return res.status(409).json({
      success: false,
      error: 'A facility with that code already exists.',
      code: 'FACILITY_CODE_EXISTS',
    });
  }

  const { data, error } = await supabaseService.from('facilities').insert([
    {
      code: payload.code,
      name: payload.name,
      type: payload.type,
      address_line1: payload.address_line1 || null,
      address_line2: payload.address_line2 || null,
      city: payload.city || null,
      state_province: payload.state_province || null,
      postal_code: postal_code || null,
      country: payload.country,
      latitude: payload.latitude,
      longitude: payload.longitude,
      geofence_radius_meters: payload.geofence_radius_meters || 500,
      is_active: true,
      created_by_id: req.user.id,
    },
  ]).select().single();

  if (error) {
    console.error('[ERROR] Failed to create facility:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to create facility.',
      code: 'DB_ERROR',
    });
  }

  // Audit log
  await writeAuditLog({
    actorId: req.user.id,
    action: 'facility_create',
    targetTable: 'facilities',
    targetId: data.id,
    before: null,
    after: {
      code: data.code,
      name: data.name,
      latitude: data.latitude,
      longitude: data.longitude,
    },
    ipAddress: req.ip,
    userAgent: req.get('User-Agent'),
  });

  return res.status(201).json({
    success: true,
    data: { facility: data },
    error: null,
    code: null,
  });
}

/**
 * POST /api/admin/shipments
 * Create a new shipment (same logic as auth controller but with full admin override).
 * Protected: JWT + role check. Strict limiter.
 * 
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function adminCreateShipment(req, res) {
  // Reuse shipment controller logic but with admin context
  // For brevity, we inline the essential parts; in production, refactor to shared service.
  const payload = req.body.shipment;

  if (!payload) {
    return res.status(400).json({
      success: false,
      error: 'Shipment payload is required.',
      code: 'MISSING_PAYLOAD',
    });
  }

  // Generate tracking code
  const trackingCode = await (await import('../services/trackingCodeGenerator'))
    .generateUniqueTrackingCode(supabaseService, {
      prefix: payload.prefix || 'NX',
      bodyLength: payload.bodyLength || 10,
    });

  // Resolve facility
  let facilityId = payload.facility_id;
  let currentLat = null;
  let currentLng = null;

  if (facilityId) {
    const { data: fac, error: facError } = await supabaseService
      .from('facilities')
      .select('id, latitude, longitude')
      .eq('id', facilityId)
      .single();

    if (facError || !fac) {
      return res.status(400).json({
        success: false,
        error: 'Specified facility not found.',
        code: 'FACILITY_NOT_FOUND',
      });
    }
    currentLat = fac.latitude;
    currentLng = fac.longitude;
    facilityId = fac.id;
  }

  // Generalized address
  const consigneeAddressGeneralized = payload.consignee_address
    ? `${payload.consignee_address.city || 'Unknown City'}, ${payload.consignee_address.country || 'Unknown'}`
    : null;

  // Insert shipment
  const { data: shipment, error: shipError } = await supabaseService
    .from('shipments')
    .insert([
      {
        tracking_code: trackingCode,
        prefix: trackingCode.split('-')[0],
        status: 'created',
        customer_id: payload.customer_id || null,
        operator_id: req.user.id,
        facility_id: facilityId || null,
        consignee_name: payload.consignee_name || null,
        consignee_email: payload.consignee_email || null,
        consignee_address_generalized: consigneeAddressGeneralized || null,
        weight_kg: payload.weight_kg || 0,
        service_type: payload.service_type || 'standard',
        declared_value_cents: payload.declared_value_cents || 0,
        security_flags: payload.security_flags || {} instanceof Object ? payload.security_flags : {},
        privacy_mode: payload.privacy_mode !== false,
        current_lat: currentLat,
        current_lng: currentLng,
        last_verified_at: new Date(),
      },
    ])
    .select()
    .single();

  if (shipError) {
    console.error('[ERROR] Failed to create admin shipment:', shipError);
    return res.status(500).json({
      success: false,
      error: 'Failed to create shipment.',
      code: 'DB_ERROR',
    });
  }

  // Write audit log for creation
  await writeAuditLog({
    actorId: req.user.id,
    action: 'shipment_create',
    targetTable: 'shipments',
    targetId: shipment.id,
    before: null,
    after: {
      status: 'created',
      tracking_code: trackingCode,
      consignee_name: shipment.consignee_name,
    },
    ipAddress: req.ip,
    userAgent: req.get('User-Agent'),
  });

  // Write initial tracking_event
  await supabaseService.from('tracking_events').insert([
    {
      shipment_id: shipment.id,
      event_type: 'status_change',
      status_from: null,
      status_to: 'created',
      triggered_by: req.user.id,
      triggered_by_ip: req.ip,
      triggered_by_user_agent: req.get('User-Agent'),
      metadata: { created_by_admin: true },
    },
  ]);

  return res.status(201).json({
    success: true,
    data: { shipment },
    error: null,
    code: null,
  });
}

/**
 * GET /api/admin/shipments
 * Paginated list with filters. SuperAdmin only (or operator sees own).
 * Protected: JWT + role check. Strict limiter.
 * 
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function listAdminShipments(req, res) {
  // Validate pagination
  const validationResult = validation.validatePagination('pagination').concat(
    validation.handleValidationErrors
  )(req, res);
  if (validationResult) {
    return res.status(400).json(validationResult);
  }

  const { page = 1, limit = 20, status, facility_id, operator_id } = req.query;
  const offset = (page - 1) * limit;

  let query = supabaseService.from('shipments').select('*', { count: 'exact' }).order('created_at', { ascending: false });

  // Role filtering: SuperAdmin sees all; Operator sees only their own
  if (req.user.role !== 'superadmin') {
    query = query.eq('operator_id', req.user.id);
  } else {
    // SuperAdmin filters
    if (status) query = query.eq('status', status);
    if (facility_id) query = query.eq('facility_id', facility_id);
    if (operator_id) query = query.eq('operator_id', operator_id);
  }

  query = query.range(offset, offset + Number(limit) - 1);

  const { data: shipments, error, count } = await query;

  if (error) {
    console.error('[ERROR] Failed to list admin shipments:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve shipments.',
      code: 'DB_ERROR',
    });
  }

  return res.json({
    success: true,
    data: {
      shipments,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: count,
        totalPages: Math.ceil((count || 0) / Number(limit)),
      },
    },
    error: null,
    code: null,
  });
}

/**
 * PATCH /api/admin/shipments/:id/status
 * Manual status override with full audit logging.
 * Protected: JWT + role check. Strict limiter.
 * 
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function adminUpdateStatus(req, res) {
  const { id } = req.params;
  const { new_status, notes } = req.body;

  if (!new_status) {
    return res.status(400).json({
      success: false,
      error: 'New status is required.',
      code: 'MISSING_NEW_STATUS',
    });
  }

  const validStatuses = [
    'created', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'failed', 'cancelled',
  ];
  if (!validStatuses.includes(new_status)) {
    return res.status(422).json({
      success: false,
      error: `Invalid status. Must be one of: ${validStatuses.join(', ')}.`,
      code: 'INVALID_STATUS',
    });
  }

  // Lookup shipment
  const { data: shipment, error: shipError } = await supabaseService
    .from('shipments')
    .select('*')
    .eq('id', id)
    .single();

  if (shipError || !shipment) {
    return res.status(404).json({
      success: false,
      error: 'Shipment not found.',
      code: 'NOT_FOUND',
    });
  }

  // Validate transition
  const allowedTransitions = {
    created: ['picked_up', 'cancelled'],
    picked_up: ['in_transit', 'cancelled'],
    in_transit: ['out_for_delivery', 'failed', 'cancelled'],
    out_for_delivery: ['delivered', 'failed'],
    delivered: [],
    failed: ['cancelled'],
    cancelled: [],
  };

  const currentStatus = shipment.status;
  const permitted = allowedTransitions[currentStatus] || [];

  if (!permitted.includes(new_status)) {
    return res.status(422).json({
      success: false,
      error: `Invalid status transition. Current: ${currentStatus} → Allowed: ${permitted.join(', ') || 'none'}.`,
      code: 'INVALID_TRANSITION',
    });
  }

  // Before snapshot
  const beforeSnapshot = {
    status: currentStatus,
    tracking_code: shipment.tracking_code,
    facility_id: shipment.facility_id,
    current_lat: shipment.current_lat,
    current_lng: shipment.current_lng,
  };

  // Update status
  const { data: updated, error: updateError } = await supabaseService
    .from('shipments')
    .update({
      status: new_status,
      status_changed_at: new Date(),
    })
    .eq('id', id)
    .select()
    .single();

  if (updateError) {
    console.error('[ERROR] Failed to update admin shipment status:', updateError);
    return res.status(500).json({
      success: false,
      error: 'Failed to update shipment status.',
      code: 'DB_ERROR',
    });
  }

  // Audit log
  await writeAuditLog({
    actorId: req.user.id,
    action: 'shipment_status_update',
    targetTable: 'shipments',
    targetId: id,
    before: beforeSnapshot,
    after: {
      status: new_status,
      tracking_code: updated.tracking_code,
      facility_id: updated.facility_id,
      current_lat: updated.current_lat,
      current_lng: updated.current_lng,
    },
    ipAddress: req.ip,
    userAgent: req.get('User-Agent'),
  });

  // Tracking event
  await supabaseService.from('tracking_events').insert([
    {
      shipment_id: id,
      event_type: 'status_change',
      status_from: currentStatus,
      status_to: new_status,
      triggered_by: req.user.id,
      triggered_by_ip: req.ip,
      triggered_by_user_agent: req.get('User-Agent'),
      metadata: notes ? { notes } : {},
    },
  ]);

  return res.json({
    success: true,
    data: { shipment: updated },
    error: null,
    code: null,
  });
}

/**
 * GET /api/admin/audit-logs
 * SuperAdmin only, paginated immutable audit trail.
 * 
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function listAuditLogs(req, res) {
  // Validate pagination
  const validationResult = validation.validatePagination('pagination').concat(
    validation.handleValidationErrors
  )(req, res);
  if (validationResult) {
    return res.status(400).json(validationResult);
  }

  const { page = 1, limit = 50, action, target_table } = req.query;
  const offset = (page - 1) * limit;

  let query = supabaseService.from('audit_logs').select('*', { count: 'exact' }).order('created_at', { ascending: false });

  // Filtering (SuperAdmin only — but we already requireRole)
  if (action) query = query.eq('action', action);
  if (target_table) query = query.eq('target_table', target_table);

  query = query.range(offset, offset + Number(limit) - 1);

  const { data: logs, error, count } = await query;

  if (error) {
    console.error('[ERROR] Failed to fetch audit logs:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve audit logs.',
      code: 'DB_ERROR',
    });
  }

  return res.json({
    success: true,
    data: {
      audit_logs: logs,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: count,
        totalPages: Math.ceil((count || 0) / Number(limit)),
      },
    },
    error: null,
    code: null,
  });
}

/**
 * POST /api/admin/users
 * Create operator/viewer accounts (SuperAdmin only).
 * 
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function createAdminUser(req, res) {
  const { email, password, role, action, userId } = req.body;

  if (!email || !password || !role) {
    return res.status(400).json({
      success: false,
      error: 'Email, password, and role are required.',
      code: 'MISSING_FIELDS',
    });
  }

  // Valid roles
  const validRoles = ['superadmin', 'operator', 'viewer', 'customer'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({
      success: false,
      error: `Invalid role. Must be one of: ${validRoles.join(', ')}.`,
      code: 'INVALID_ROLE',
    });
  }

  // Check if user already exists
  const { data: existing } = await supabaseService
    .from('users')
    .select('id')
    .eq('email', email)
    .single();

  if (existing) {
    return res.status(409).json({
      success: false,
      error: 'A user with that email already exists.',
      code: 'EMAIL_EXISTS',
    });
  }

  // Hash password
  const saltRounds = parseInt(process.env.BCRYPT_ROUNDS, 10) || 12;
  const passwordHash = await bcrypt.hash(password, saltRounds);

  // Create user
  const { data, error } = await supabaseService.from('users').insert([
    {
      email,
      password_hash: passwordHash,
      role,
      is_active: true,
      // If action is "deactivate" or similar, we handle separately;
      // here we just create an active user.
    },
  ]).select('id, email, role, is_active, created_at').single();

  if (error) {
    console.error('[ERROR] Failed to create admin user:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to create user account.',
      code: 'DB_ERROR',
    });
  }

  // If action is "deactivate", deactivate the referenced user
  if (action === 'deactivate' && userId && data.id !== userId) {
    await supabaseService.from('users').update({ is_active: false }).eq('id', userId);
  }

  return res.status(201).json({
    success: true,
    data: { user: data },
    error: null,
    code: null,
  });
}

/**
 * POST /api/admin/shipments/:id/simulate
 * Simulation mode for investors/demos.
 * Every step writes real tracking_event + audit_log — behaves exactly like manual override.
 * Protected: JWT + role check. Strict limiter.
 * 
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function adminSimulate(req, res) {
  const { id } = req.params;
  const { scenario } = req.body;

  if (!scenario) {
    return res.status(400).json({
      success: false,
      error: 'Scenario name is required.',
      code: 'MISSING_SCENARIO',
    });
  }

  // Lookup shipment
  const { data: shipment, error: shipError } = await supabaseService
    .from('shipments')
    .select('*')
    .eq('id', id)
    .single();

  if (shipError || !shipment) {
    return res.status(404).json({
      success: false,
      error: 'Shipment not found.',
      code: 'NOT_FOUND',
    });
  }

  // Define scenarios (same as shipmentController)
  const scenarios = {
    international_demo: [
      { status: 'picked_up', facility_id: 'hub-01', notes: 'Origin facility scan' },
      { status: 'in_transit', facility_id: 'hub-02', notes: 'In transit between hubs' },
      { status: 'out_for_delivery', facility_id: 'hub-03', notes: 'Out for delivery' },
      { status: 'delivered', facility_id: null, notes: 'Delivery confirmed' },
    ],
    domestic_express: [
      { status: 'picked_up', facility_id: 'hub-01', notes: 'Pickup confirmed' },
      { status: 'in_transit', facility_id: null, notes: 'En route' },
      { status: 'delivered', facility_id: null, notes: 'Delivered' },
    ],
  };

  const sequence = scenarios[scenario];
  if (!sequence) {
    return res.status(400).json({
      success: false,
      error: `Unknown scenario: ${scenario}. Available: ${Object.keys(scenarios).join(', ')}`,
      code: 'UNKNOWN_SCENARIO',
    });
  }

  // Walk sequence; each step writes audit_log + tracking_event
  for (const step of sequence) {
    const { status, facility_id, notes: stepNotes } = step;

    // Validate transition
    const allowedFrom = {
      created: ['picked_up', 'cancelled'],
      picked_up: ['in_transit', 'cancelled'],
      in_transit: ['out_for_delivery', 'failed', 'cancelled'],
      out_for_delivery: ['delivered', 'failed'],
      delivered: [],
      failed: ['cancelled'],
      cancelled: [],
    };

    const currentStatus = shipment.status;
    const permitted = allowedFrom[currentStatus] || [];

    if (!permitted.includes(status)) {
      return res.status(422).json({
        success: false,
        error: `Simulation aborted: invalid transition ${currentStatus} → ${status}.`,
        code: 'INVALID_TRANSITION',
      });
    }

    // Resolve facility GPS
    let lat = shipment.current_lat;
    let lng = shipment.current_lng;
    let newFacilityId = shipment.facility_id;

    if (facility_id) {
      const { data: fac, error: facError } = await supabaseService
        .from('facilities')
        .select('id, latitude, longitude')
        .eq('id', facility_id)
        .single();

      if (facError || !fac) {
        return res.status(400).json({
          success: false,
          error: `Simulation facility not found: ${facility_id}`,
          code: 'FACILITY_NOT_FOUND',
        });
      }
      lat = fac.latitude;
      lng = fac.longitude;
      newFacilityId = fac.id;
    }

    // Update shipment
    const { data: updated, error: updateError } = await supabaseService
      .from('shipments')
      .update({
        status,
        current_lat: lat,
        current_lng: lng,
        facility_id: newFacilityId,
        status_changed_at: new Date(),
        last_verified_at: new Date(),
      })
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      console.error('[ERROR] Simulation step failed:', updateError);
      return res.status(500).json({
        success: false,
        error: 'Simulation step failed due to database error.',
        code: 'DB_ERROR',
      });
    }

    // Audit log for this step
    await writeAuditLog({
      actorId: req.user.id,
      action: 'simulation_event',
      targetTable: 'shipments',
      targetId: id,
      before: {
        status: currentStatus,
        tracking_code: shipment.tracking_code,
        facility_id: shipment.facility_id,
        current_lat: shipment.current_lat,
        current_lng: shipment.current_lng,
      },
      after: {
        status: updated.status,
        tracking_code: updated.tracking_code,
        facility_id: updated.facility_id,
        current_lat: updated.current_lat,
        current_lng: updated.current_lng,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    // Tracking event
    await supabaseService.from('tracking_events').insert([
      {
        shipment_id: id,
        event_type: 'simulation_event',
        status_from: currentStatus,
        status_to: status,
        triggered_by: req.user.id,
        triggered_by_ip: req.ip,
        triggered_by_user_agent: req.get('User-Agent'),
        facility_id: newFacilityId,
        metadata: { scenario, notes: stepNotes, simulation: true },
      },
    ]);

    shipment.status = updated.status;
    shipment.current_lat = updated.current_lat;
    shipment.current_lng = updated.current_lng;
    shipment.facility_id = updated.facility_id;
  }

  const { data: finalShipment, error: finalError } = await supabaseService
    .from('shipments')
    .select('*')
    .eq('id', id)
    .single();

  return res.json({
    success: true,
    data: { shipment: finalShipment, scenario, steps: sequence.length },
    error: null,
    code: null,
  });
}

module.exports = {
  createFacility,
  adminCreateShipment,
  listAdminShipments,
  adminUpdateStatus,
  listAuditLogs,
  createAdminUser,
  adminSimulate,
};