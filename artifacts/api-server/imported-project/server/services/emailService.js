const RESEND_ENDPOINT = 'https://api.resend.com/emails';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>\"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '\"': '&quot;',
    "'": '&#39;',
  }[character]));
}

function emailTemplate(kind, values = {}) {
  const title = kind === 'verification'
    ? 'Verify your FedEx account'
    : kind === 'password-reset'
      ? 'Reset your FedEx password'
      : kind === 'booking-confirmation'
        ? 'Your shipment is booked'
        : 'Shipment status update';
  const name = escapeHtml(values.name || 'there');
  const message = escapeHtml(values.message || '');
  const code = values.trackingCode ? `<p>Tracking code: <strong>${escapeHtml(values.trackingCode)}</strong></p>` : '';
  const link = values.link ? `<p><a href="${escapeHtml(values.link)}">Continue securely</a></p>` : '';
  return `<h1>${title}</h1><p>Hello ${name},</p><p>${message}</p>${code}${link}<p>FedEx logistics</p>`;
}

async function sendEmail({ to, subject, kind = 'status-update', values = {} }) {
  if (!to) return { sent: false, reason: 'missing-recipient' };
  const from = process.env.EMAIL_FROM || 'FedEx <noreply@localhost>';
  const html = emailTemplate(kind, values);
  if (!process.env.RESEND_API_KEY) {
    console.info('[email:dev]', JSON.stringify({ to, subject, kind, values }));
    return { sent: false, reason: 'missing-api-key' };
  }
  const response = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });
  if (!response.ok) throw new Error(`Email provider returned ${response.status}`);
  return { sent: true, data: await response.json() };
}

const sendVerificationEmail = (to, link, name) => sendEmail({ to, kind: 'verification', subject: 'Verify your FedEx account', values: { link, name, message: 'Confirm your email address to activate your account.' } });
const sendPasswordResetEmail = (to, link, name) => sendEmail({ to, kind: 'password-reset', subject: 'Reset your FedEx password', values: { link, name, message: 'Use this secure link to reset your password.' } });
const sendBookingConfirmation = (to, trackingCode, name) => sendEmail({ to, kind: 'booking-confirmation', subject: 'FedEx shipment confirmation', values: { trackingCode, name, message: 'Your shipment has been booked successfully.' } });
const sendStatusUpdateEmail = (to, trackingCode, status) => sendEmail({ to, kind: 'status-update', subject: `FedEx shipment ${status}`, values: { trackingCode, message: `Shipment status: ${status}.` } });

module.exports = { sendEmail, sendVerificationEmail, sendPasswordResetEmail, sendBookingConfirmation, sendStatusUpdateEmail };
