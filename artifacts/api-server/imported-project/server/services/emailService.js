const RESEND_ENDPOINT = 'https://api.resend.com/emails';

function emailTemplate(kind, values = {}) {
  const code = values.trackingCode ? `Tracking code: ${values.trackingCode}` : '';
  const link = values.link ? `<p><a href="${values.link}">${values.link}</a></p>` : '';
  const title = kind === 'verification' ? 'Verify your NEXVORA account' : kind === 'password-reset' ? 'Reset your NEXVORA password' : kind === 'booking-confirmation' ? 'Your shipment is booked' : 'Shipment status update';
  return `<h1>${title}</h1><p>Hello ${values.name || 'there'},</p><p>${values.message || ''}</p>${code}${link}<p>NEXVORA logistics</p>`;
}

export async function sendEmail({ to, subject, kind = 'status-update', values = {} }) {
  if (!to) return { sent: false, reason: 'missing-recipient' };
  const from = process.env.EMAIL_FROM || 'NEXVORA <noreply@localhost>';
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

export const sendVerificationEmail = (to, link, name) => sendEmail({ to, kind: 'verification', subject: 'Verify your NEXVORA account', values: { link, name, message: 'Confirm your email address to activate your account.' } });
export const sendPasswordResetEmail = (to, link, name) => sendEmail({ to, kind: 'password-reset', subject: 'Reset your NEXVORA password', values: { link, name, message: 'Use this secure link to reset your password.' } });
export const sendBookingConfirmation = (to, trackingCode, name) => sendEmail({ to, kind: 'booking-confirmation', subject: 'NEXVORA shipment confirmation', values: { trackingCode, name, message: 'Your shipment has been booked successfully.' } });
export const sendStatusUpdateEmail = (to, trackingCode, status) => sendEmail({ to, kind: 'status-update', subject: `NEXVORA shipment ${status}`, values: { trackingCode, message: `Shipment status: ${status}.` } });
