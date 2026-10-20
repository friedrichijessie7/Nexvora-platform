(function () {
  'use strict';
  const form = document.getElementById('signup-form');
  if (!form) return;
  const type = document.getElementById('account-type');
  const companyWrap = document.getElementById('company-wrap');
  const status = document.getElementById('signup-status');
  function syncCompany() { companyWrap.hidden = type.value !== 'business'; }
  type.addEventListener('change', syncCompany);
  syncCompany();
  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    status.textContent = '';
    const data = Object.fromEntries(new FormData(form));
    if (data.password !== data.confirm_password) { status.textContent = 'Passwords do not match.'; return; }
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await NexvoraAPI.request('/api/auth/register', { method: 'POST', body: JSON.stringify(data) });
      form.reset(); syncCompany();
      status.textContent = 'Check your email to verify your account.';
      NexvoraAPI.toast('Verification email sent.', 'success');
    } catch (error) {
      status.textContent = error.message || 'We could not create your account. Please try again.';
    } finally { button.disabled = false; }
  });
})();
