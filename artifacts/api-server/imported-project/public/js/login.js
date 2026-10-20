(function () {
  'use strict';
  const form = document.getElementById('login-form');
  if (!form) return;
  const status = document.getElementById('login-status');
  const banner = document.getElementById('login-banner');
  const params = new URLSearchParams(window.location.search);
  if (params.get('verified') === '1') banner.textContent = 'Email verified. You can now sign in.';
  if (params.get('error') === 'expired') banner.textContent = 'That verification link expired. Create a new verification email from your account flow.';
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    status.textContent = '';
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const data = Object.fromEntries(new FormData(form));
      const response = await NexvoraAPI.request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: data.email, password: data.password }) });
      NexvoraAPI.remember(response.data, form.remember.checked);
      window.location.assign('/account.html');
    } catch (error) {
      status.textContent = error.code === 'EMAIL_NOT_VERIFIED' || error.payload?.code === 'EMAIL_NOT_VERIFIED' ? 'Please verify your email before signing in.' : (error.message || 'We could not sign you in.');
    } finally { button.disabled = false; }
  });
})();
