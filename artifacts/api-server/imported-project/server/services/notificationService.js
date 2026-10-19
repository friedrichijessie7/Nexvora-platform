async function notifyShipmentStatusChange(shipment, status) {
  // Provider adapter boundary: replace with SendGrid/Twilio implementation.
  console.info(`[notification] ${shipment.tracking_code}: ${status}`);
  return { delivered: false, provider: 'log' };
}
module.exports = { notifyShipmentStatusChange };
