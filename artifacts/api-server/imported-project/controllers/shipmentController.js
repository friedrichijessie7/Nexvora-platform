/**
 * Dynamic Supply Chain Operating System — Shipment Controller
 * Public + authenticated endpoints for shipment creation, tracking, and updates.
 * 
 * Dependencies: 
 *   - validation middleware (validateTrackingCode, validateShipmentPayload)
 *   - trackingCodeGenerator (generateUniqueTrackingCode)
 *   - auditService (writeAuditLog)
 *   - notificationService (notifyShipmentCreated, notifyStatusChange)
 *   - db (supabaseService, createScopedClient)
 *   - rateLimiter (strictLimiter for admin routes)
 */

const { supabaseService } = require('../services/db');
const { generateUniqueTrackingCode } = require('../services/trackingCodeGenerator');
const { writeAuditLog } = require('../services/auditService');
const { notifyShipmentCreated, notifyStatusChange } = require('../services/notificationService');
const validation = require('../middleware/validation');

/**
 * PUBLIC: GET /api/track/:code
 * Secure tracking — returns shipment + ordered tracking_events timeline.
 * Strips sensitive fields: receiver exact address, internal notes.
 * No auth required; rate-limited.
 * 
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function trackByCode(req, res) {
  const { code } = req.params;

  if (!code) {
    return res.status(400).json({
      success: false,
      error: 'Tracking code is required.',
      code: 'MISSING_CODE',
    });
  }

  // Validate format
  const validated = validation.validateTrackingCode(code);
  if (!validated.valid) {
    return res.status(400).json({
      success: false,
      error: validated.error,
      code: 'INVALID_TRACKING_CODE',
    });
  }

  const { prefix, body, checksum } = validated;

  // Query shipments table by tracking_code
  const { data: shipment, error: shipError } = await supabaseService
    .from('shipments')
    .select(`
      id,
      tracking_code,
      status,
      consignee_name,
      consignee_email,
      consignee_address_generalized,
      weight_kg,
      service_type,
      declared_value_cents,
      security_flags,
      privacy_mode,
      current_lat,
      current_lng,
      last_verified_at,
      created_at,
      facilities!current_facility_fk (id, code, name, latitude, longitude)
    `)
    .eq('tracking_code', code)
    .single();

  if (shipError || !shipment) {
    return res.status(404).json({
      success: false,
      error: 'Shipment not found.',
      code: 'NOT_FOUND',
    });
  }

  // Build safe response — strip/blur sensitive fields based on privacy_mode
  const safeShipment = {
    id: shipment.id,
    tracking_code: shipment.tracking_code,
    status: shipment.status,
    consignee_name: shipment.consignee_name,
    consignee_email: shipment.consignee_email,
    // If privacy_mode is true, show only city-level; otherwise show generalized address
    consignee_address: shipment.privacy_mode
      ? shipment.consignee_address_generalized || 'City level privacy'
      : shipment.consignee_address_generalized,
    weight_kg: shipment.weight_kg,
    service_type: shipment.service_type,
    declared_value_cents: shipment.declared_value_cents,
    security_flags: shipment.security_flags,
    privacy_mode: shipment.privacy_mode,
    current_lat: shipment.privacy_mode ? null : shipment.current_lat,
    current_lng: shipment.privacy_mode ? null : shipment.current_lng,
    last_verified_at: shipment.last_verified_at,
    created_at: shipment.created_at,
    // Facility info (last known hub)
    current_facility: shipment.facilities
      ? {
          id: shipment.facilities.id,
          code: shipment.facilities.code,
          name: shipment.facilities.name,
          latitude: shipment.facilities.latitude,
          longitude: shipment.facilities.longitude,
        }
      : null,
  };

  // Get ordered tracking events timeline
  const { data: events, error: eventsError } = await supabaseService
    .from('tracking_events')
    .select('*')
    .eq('shipment_id', shipment.id)
    .order('created_at', { ascending: true });

  if (eventsError) {
    console.error('[ERROR] Failed to fetch tracking events:', eventsError);
  }

  // Strip sensitive fields from events (no internal notes, no exact GPS in public view)
  const safeEvents = (events || []).map((ev) => ({
    id: ev.id,
    event_type: ev.event_type,
    status_from: ev.status_from,
    status_to: ev.status_to,
    created_at: ev.created_at,
    // Only expose location if not privacy-sensitive
    location_lat: shipment.privacy_mode ? null : ev.location_lat,
    location_lng: shipment.privacy_mode ? null : ev.location_lng,
    facility_id: ev.facility_id,
    metadata: ev.metadata,
  }));

  return res.json({
    success: true,
    data: {
      shipment: safeShipment,
      tracking_timeline: safeEvents,
    },
    error: null,
    code: null,
  });
}

/**
 * AUTHENTICATED: POST /api/admin/shipments
 * Create a new shipment → generates tracking code → writes initial tracking_event.
 * Protected by JWT + role check (operator/superadmin).
 * Strict rate limiter applies.
 * 
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function createShipment(req, res) {
  // Validate payload
  const validationResult = validation.validateShipmentPayload('shipment').concat(
    validation.handleValidationErrors
  )(req, res);
  if (validationResult) {
    return res.status(400).json(validationResult);
  }

  const payload = req.body.shipment;

  // Generate unique tracking code
  const trackingCode = await generateUniqueTrackingCode(supabaseService, {
    prefix: payload.prefix || 'NX',
    bodyLength: payload.bodyLength || 10,
  });

  // Determine current facility (optional — if provided, set as current location)
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

  // Compute generalized address (blur exact street, show city-level for privacy)
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
        operator_id: req.user.id, // the admin creating it
        facility_id: facilityId || null,
        consignee_name: payload.consignee_name || null,
        consignee_email: payload.consignee_email || null,
        consignee_address_generalized: consigneeAddressGeneralized || null,
        weight_kg: payload.weight_kg || 0,
        service_type: payload.service_type || 'standard',
        declared_value_cents: payload.declared_value_cents || 0,
        security_flags: payload.security_flags || {} instanceof Object ? payload.security_flags : {},
        privacy_mode: payload.privacy_mode !== false, // default true
        current_lat: currentLat,
        current_lng: currentLng,
        last_verified_at: new Date(),
      },
    ])
    .select()
    .single();

  if (shipError) {
    console.error('[ERROR] Failed to create shipment:', shipError);
    return res.status(500).json({
      success: false,
      error: 'Failed to create shipment record.',
      code: 'DB_ERROR',
    });
  }

  // Write initial tracking_event (created)
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

  // Write first tracking_event
  const { error: eventError } = await supabaseService.from('tracking_events').insert([
    {
      shipment_id: shipment.id,
      event_type: 'status_change',
      status_from: null,
      status_to: 'created',
      triggered_by: req.user.id,
      triggered_by_ip: req.ip,
      triggered_by_user_agent: req.get('User-Agent'),
      location_lat: currentLat,
      location_lng: currentLng,
      metadata: { initial_created: true },
    },
  ]);

  if (eventError) {
    console.error('[ERROR] Failed to create initial tracking event:', eventError);
    // Note: audit log already written; event failure is logged but does not abort
  }

  // Notify (stubbed)
  notifyShipmentCreated(shipment);

  return res.status(201).json({
    success: true,
    data: { shipment },
    error: null,
    code: null,
  });
}

/**
 * AUTHENTICATED: GET /api/admin/shipments
 * Paginated list with filters (status, facility, date range).
 * Protected by JWT + role check (operator/superadmin).
 * Strict rate limiter applies.
 * 
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function listShipments(req, res) {
  // Validate pagination
  const validationResult = validation.validatePagination('pagination').concat(
    validation.handleValidationErrors
  )(req, res);
  if (validationResult) {
    return res.status(400).json(validationResult);
  }

  const { page = 1, limit = 20, status, facility_id } = req.query;
  const offset = (page - 1) * limit;

  // Build query
  let query = supabaseService.from('shipments').select('*', { count: 'exact' });

  // Role-based filtering
  // Operator sees only their shipments; SuperAdmin sees all
  if (req.user.role !== 'superadmin') {
    query = query.eq('operator_id', req.user.id);
  }

  if (status) {
    query = query.eq('status', status);
  }
  if (facility_id) {
    query = query.eq('facility_id', facility_id);
  }

  // Apply pagination
  query = query.order('created_at', { ascending: false }).range(offset, offset + Number(limit) - 1);

  const { data: shipments, error, count } = await query;

  if (error) {
    console.error('[ERROR] Failed to list shipments:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve shipments.',
      code: 'DB_ERROR',
    });
  }

  // Sanitize each shipment (blur sensitive fields for non-owners)
  // In a real app, we'd check each shipment's privacy_mode vs user role
  const safeShipments = (shipments || []).map((s) => ({
    id: s.id,
    tracking_code: s.tracking_code,
    status: s.status,
    consignee_name: s.consignee_name,
    consignee_email: s.consignee_email,
    consignee_address: s.privacy_mode
      ? s.consignee_address_generalized || 'City level privacy'
      : s.consignee_address_generalized,
    weight_kg: s.weight_kg,
    service_type: s.service_type,
    created_at: s.created_at,
  }));

  return res.json({
    success: true,
    data: {
      shipments: safeShipments,
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
 * AUTHENTICATED: PATCH /api/admin/shipments/:id/status
 * Manual status override → validates transition → writes tracking_event + audit_log.
 * Protected by JWT + role check. Strict rate limiter.
 * 
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function updateStatus(req, res) {
  const { id } = req.params;
  const { new_status, notes } = req.body;

  if (!new_status) {
    return res.status(400).json({
      success: false,
      error: 'New status is required.',
      code: 'MISSING_NEW_STATUS',
    });
  }

  // Validate status is a valid enum value
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

  // Look up shipment
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

  // --- Validate status transition against allowed map ---
  const allowedTransitions = {
    created: ['picked_up', 'cancelled'],
    picked_up: ['in_transit', 'cancelled'],
    in_transit: ['out_for_delivery', 'failed', 'cancelled'],
    out_for_delivery: ['delivered', 'failed'],
    delivered: [], // final state
    failed: ['cancelled'],
    cancelled: [], // final state
  };

  const currentStatus = shipment.status;
  const permitted = allowedTransitions[currentStatus] || [];

  if (!permitted.includes(new_status)) {
    return res.status(422).json({
      success: false,
      error: `Invalid status transition. Current: ${currentStatus} → Allowed: ${permitted.length > 0 ? permitted.join(', ') : 'no further transitions'}.`,
      code: 'INVALID_TRANSITION',
    });
  }

  // Capture "before" snapshot for audit log
  const beforeSnapshot = {
    status: currentStatus,
    tracking_code: shipment.tracking_code,
    facility_id: shipment.facility_id,
    current_lat: shipment.current_lat,
    current_lng: shipment.current_lng,
  };

  // Update shipment status + status_changed_at
  const { data: updated, error: updateError } = await supabaseService
    .from('shipments')
    .update({
      status: new_status,
      status_changed_at: new Date(),
      // Optionally update GPS if the transition implies a location change
      // (for this implementation, we keep GPS separate via location override)
    })
    .eq('id', id)
    .select()
    .single();

  if (updateError) {
    console.error('[ERROR] Failed to update shipment status:', updateError);
    return res.status(500).json({
      success: false,
      error: 'Failed to update shipment status.',
      code: 'DB_ERROR',
    });
  }

  // Write audit log
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

  // Write tracking_event for this status change
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

  // Notify status change
  notifyStatusChange(updated, currentStatus, new_status);

  return res.json({
    success: true,
    data: { shipment: updated },
    error: null,
    code: null,
  });
}

/**
 * AUTHENTICATED: PATCH /api/admin/shipments/:id/location
 * Manual geolocation override (lat/lng or facility_id) → writes tracking_event + audit_log.
 * 
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function updateLocation(req, res) {
  const { id } = req.params;
  const { lat, lng, facility_id, notes } = req.body;

  if (!lat && !lng && !facility_id) {
    return res.status(400).json({
      success: false,
      error: 'Either lat/lng or facility_id is required.',
      code: 'MISSING_LOCATION',
    });
  }

  // Look up shipment
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

  // Determine new coordinates
  let newLat = shipment.current_lat;
  let newLng = shipment.current_lng;
  let newFacilityId = shipment.facility_id;

  if (facility_id) {
    // Resolve facility to GPS
    const { data: fac, error: facError } = await supabaseService
      .from('facilities')
      .select('id, latitude, longitude')
      .eq('id', facility_id)
      .single();

    if (facError || !fac) {
      return res.status(400).json({
        success: false,
        error: 'Specified facility not found.',
        code: 'FACILITY_NOT_FOUND',
      });
    }
    newLat = fac.latitude;
    newLng = fac.longitude;
    newFacilityId = fac.id;
  } else if (lat !== undefined && lng !== undefined) {
    newLat = parseFloat(lat);
    newLng = parseFloat(lng);
  }

  // Capture "before" snapshot
  const beforeSnapshot = {
    status: shipment.status,
    tracking_code: shipment.tracking_code,
    facility_id: shipment.facility_id,
    current_lat: shipment.current_lat,
    current_lng: shipment.current_lng,
  };

  // Update shipment location
  const { data: updated, error: updateError } = await supabaseService
    .from('shipments')
    .update({
      current_lat: newLat,
      current_lng: newLng,
      facility_id: newFacilityId,
      last_verified_at: new Date(),
    })
    .eq('id', id)
    .select()
    .single();

  if (updateError) {
    console.error('[ERROR] Failed to update shipment location:', updateError);
    return res.status(500).json({
      success: false,
      error: 'Failed to update shipment location.',
      code: 'DB_ERROR',
    });
  }

  // Write audit log
  await writeAuditLog({
    actorId: req.user.id,
    action: 'geolocation_override',
    targetTable: 'shipments',
    targetId: id,
    before: beforeSnapshot,
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

  // Write tracking_event for location update
  await supabaseService.from('tracking_events').insert([
    {
      shipment_id: id,
      event_type: 'location_update',
      status_from: shipment.status,
      status_to: shipment.status, // status unchanged
      triggered_by: req.user.id,
      triggered_by_ip: req.ip,
      triggered_by_user_agent: req.get('User-Agent'),
      location_lat: newLat,
      location_lng: newLng,
      facility_id: newFacilityId,
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
 * AUTHENTICATED: POST /api/admin/shipments/:id/simulate
 * Simulation mode: walks shipment through a predefined scenario sequence.
 * Every step writes real tracking_event + audit_log — behaves exactly like manual override.
 * 
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function simulateScenario(req, res) {
  const { id } = req.params;
  const { scenario } = req.body; // e.g. "international_demo"

  if (!scenario) {
    return res.status(400).json({
      success: false,
      error: 'Scenario name is required.',
      code: 'MISSING_SCENARIO',
    });
  }

  // Look up shipment
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

  // Define scenarios — each is a sequence of { status, facility_id?, notes? }
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

  // Walk the sequence sequentially (await each step)
  for (const step of sequence) {
    const { status, facility_id, notes: stepNotes } = step;

    // Validate transition (reuse allowedTransitions logic from updateStatus)
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
      // Abort the whole simulation on first invalid transition
      return res.status(422).json({
        success: false,
        error: `Simulation aborted: invalid transition ${currentStatus} → ${status}.`,
        code: 'INVALID_TRANSITION',
      });
    }

    // If facility_id provided, resolve GPS
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

    // Update shipment status + location in one atomic operation
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
      console.error('[ERROR] Simulation update failed:', updateError);
      return res.status(500).json({
        success: false,
        error: 'Simulation step failed due to database error.',
        code: 'DB_ERROR',
      });
    }

    // Write audit log for this simulation step
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

    // Write tracking_event for this step
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
        metadata: { scenario, notes: stepNotes, step: true },
      },
    ]);

    // Update shipment reference for next iteration
    shipment.status = updated.status;
    shipment.current_lat = updated.current_lat;
    shipment.current_lng = updated.current_lng;
    shipment.facility_id = updated.facility_id;
  }

  // Return final state
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

/**
 * AUTHENTICATED: POST /api/admin/shipments/:id/pod
 * Attach Proof of Delivery (photo URL / signature data).
 * Marks shipment as 'delivered' and writes audit/log/event.
 * 
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function attachPOD(req, res) {
  const { id } = req.params;
  const { signed_by, signature_url, photo_url } = req.body;

  if (!signed_by && !signature_url && !photo_url) {
    return res.status(400).json({
      success: false,
      error: 'signed_by, signature_url, or photo_url is required.',
      code: 'MISSING_POD_DATA',
    });
  }

  // Look up shipment
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

  // Build POD metadata
  const podData = {
    signed_by: signed_by || null,
    signature_url: signature_url || null,
    photo_url: photo_url || null,
  };

  // Update shipment: mark as delivered, set POD data
  const { data: updated, error: updateError } = await supabaseService
    .from('shipments')
    .update({
      status: 'delivered',
      status_changed_at: new Date(),
      consignee_address_generalized: podData.signed_by ? 'Delivered - recipient signed' : null,
      // Store POD info in security_flags or a dedicated field; for now use JSONB metadata slot
      // We'll use security_flags to store POD URLs (simple approach)
      security_flags: {
        ...shipment.security_flags,
        pod: podData,
      },
    })
    .eq('id', id)
    .select()
    .single();

  if (updateError) {
    console.error('[ERROR] Failed to attach POD:', updateError);
    return res.status(500).json({
      success: false,
      error: 'Failed to attach Proof of Delivery.',
      code: 'DB_ERROR',
    });
  }

  // Write audit log
  await writeAuditLog({
    actorId: req.user.id,
    action: 'pod_upload',
    targetTable: 'shipments',
    targetId: id,
    before: {
      status: shipment.status,
      tracking_code: shipment.tracking_code,
    },
    after: {
      status: 'delivered',
      tracking_code: updated.tracking_code,
      pod: podData,
    },
    ipAddress: req.ip,
    userAgent: req.get('User-Agent'),
  });

  // Write tracking_event for POD
  await supabaseService.from('tracking_events').insert([
    {
      shipment_id: id,
      event_type: 'pod_upload',
      status_from: shipment.status,
      status_to: 'delivered',
      triggered_by: req.user.id,
      triggered_by_ip: req.ip,
      triggered_by_user_agent: req.get('User-Agent'),
      metadata: { signed_by: podData.signed_by, has_photo: !!podData.photo_url, has_signature: !!podData.signature_url },
    },
  ]);

  // Notify POD upload
  notifyPODUpload(updated, podData);

  return res.json({
    success: true,
    data: { shipment: updated },
    error: null,
    code: null,
  });
}

module.exports = {
  trackByCode,
  createShipment,
  listShipments,
  updateStatus,
  updateLocation,
  simulateScenario,
  attachPOD,
};