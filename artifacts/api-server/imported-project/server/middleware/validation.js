const STATUSES = ['created','picked_up','in_transit','out_for_delivery','delivered','failed','cancelled'];
function cleanText(value, max = 255) { return typeof value === 'string' ? value.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max) : value; }
function coordinates(lat, lng) { return Number.isFinite(Number(lat)) && Number(lat) >= -90 && Number(lat) <= 90 && Number.isFinite(Number(lng)) && Number(lng) >= -180 && Number(lng) <= 180; }
function shipmentPayload(body = {}) {
  const errors = [];
  if (!cleanText(body.consignee_name)) errors.push('consignee_name is required');
  if (!Number.isFinite(Number(body.weight_kg)) || Number(body.weight_kg) <= 0) errors.push('weight_kg must be greater than zero');
  const customerId = body.customer_id || null;
  if (customerId !== null && (typeof customerId !== 'string' || customerId.length > 80)) errors.push('customer_id must identify a customer account');
  const address = body.consignee_address || {};
  return { errors, value: {
    consignee_name: cleanText(body.consignee_name), consignee_email: cleanText(body.consignee_email),
    weight_kg: Number(body.weight_kg), service_type: cleanText(body.service_type || 'standard', 50),
    customer_id: customerId, facility_id: body.facility_id || null,
    consignee_address: { city: cleanText(address.city || '', 120), country: cleanText(address.country || '', 2) },
    privacy_mode: body.privacy_mode !== false, security_flags: Array.isArray(body.security_flags) ? body.security_flags.slice(0, 12) : [],
  }};
}
module.exports = { STATUSES, cleanText, coordinates, shipmentPayload };
