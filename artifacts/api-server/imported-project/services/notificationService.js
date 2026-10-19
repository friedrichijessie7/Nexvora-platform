/**
 * Dynamic Supply Chain Operating System — Notification Service
 * Stubbed email/SMS hooks. Log-only for now, interface ready for SendGrid/Twilio later.
 * 
 * All methods are synchronous no-ops in the default configuration. In production,
 * replace the console.log stubs with actual API calls (SendGrid, Twilio, etc.).
 * 
 * Interface contract:
 * - notifyShipmentCreated(shipment) — called when a new shipment is created
 * - notifyStatusChange(shipment, oldStatus, newStatus) — called on status transition
 * - notifyPODUpload(shipment, podInfo) — called when proof of delivery is uploaded
 * - notifyGeolocationOverride(shipment, oldCoords, newCoords) — called on location change
 */

const shipmentModel = require('../models/shipment'); // placeholder; will be created later

function notifyShipmentCreated(shipment) {
  console.log(`[NOTIF] Shipment created: ${shipment.tracking_code} — ${shipment.consignee_name}`);
}

function notifyStatusChange(shipment, oldStatus, newStatus) {
  console.log(
    `[NOTIF] Status change: ${shipment.tracking_code} — ${oldStatus} → ${newStatus}`
  );
}

function notifyPODUpload(shipment, podInfo) {
  console.log(
    `[NOTIF] POD uploaded: ${shipment.tracking_code} — signed by ${podInfo.signed_by}`
  );
}

function notifyGeolocationOverride(shipment, oldCoords, newCoords) {
  console.log(
    `[NOTIF] Geolocation override: ${shipment.tracking_code} — ${oldCoords.lat},${oldCoords.lng} → ${newCoords.lat},${newCoords.lng}`
  );
}

// Export stubbed functions; ready for SendGrid/Twilio integration
module.exports = {
  notifyShipmentCreated,
  notifyStatusChange,
  notifyPODUpload,
  notifyGeolocationOverride,
};