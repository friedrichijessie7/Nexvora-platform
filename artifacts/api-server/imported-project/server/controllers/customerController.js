const { supabaseAdmin } = require('../services/db');

const shipmentColumns = [
  'id',
  'tracking_code',
  'status',
  'status_changed_at',
  'consignee_name',
  'consignee_address_generalized',
  'service_type',
  'weight_kg',
  'last_verified_at',
  'created_at',
].join(',');

function customerSafeShipment(row) {
  return {
    ...row,
    weight_kg: Number(row.weight_kg),
  };
}

async function listCustomerShipments(req, res, next) {
  try {
    const { data, error } = await supabaseAdmin
      .from('shipments')
      .select(shipmentColumns)
      .eq('customer_id', req.user.id)
      .order('created_at', { ascending: false })
      .range(0, 99);
    if (error) throw error;

    res.json({ success: true, data: { shipments: (data || []).map(customerSafeShipment) } });
  } catch (error) {
    next(error);
  }
}

async function getCustomerShipment(req, res, next) {
  try {
    const shipmentId = String(req.params.id || '').trim();
    const { data: shipment, error } = await supabaseAdmin
      .from('shipments')
      .select(shipmentColumns)
      .eq('id', shipmentId)
      .eq('customer_id', req.user.id)
      .maybeSingle();
    if (error) throw error;
    if (!shipment) {
      res.status(404).json({ success: false, error: 'Shipment not found.', code: 'NOT_FOUND' });
      return;
    }

    const { data: events, error: eventError } = await supabaseAdmin
      .from('tracking_events')
      .select('id,event_type,status_from,status_to,facility_name,public_message,created_at')
      .eq('shipment_id', shipment.id)
      .order('created_at');
    if (eventError) throw eventError;

    res.json({
      success: true,
      data: {
        shipment: customerSafeShipment(shipment),
        events: events || [],
      },
    });
  } catch (error) {
    next(error);
  }
}

async function listAdminCustomers(req, res, next) {
  try {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('id,email')
      .eq('role', 'customer')
      .eq('is_active', true)
      .order('email', { ascending: true })
      .range(0, 199);
    if (error) throw error;

    res.json({ success: true, data: { customers: data || [] } });
  } catch (error) {
    next(error);
  }
}

module.exports = { listCustomerShipments, getCustomerShipment, listAdminCustomers };
