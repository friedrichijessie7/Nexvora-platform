(() => {
  const form = document.getElementById('resend-form');
  const status = document.getElementById('resend-status');
  const email = document.getElementById('resend-email');
  if (!form) return;
  const queryEmail = new URLSearchParams(location.search).get('email');
  if (queryEmail) email.value = queryEmail;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.checkValidity()) return form.reportValidity();
    const button = form.querySelector('button'); button.disabled = true;
    try {
      const result = await NexvoraAPI.request('/api/auth/resend-verification', { method:'POST', body: JSON.stringify({ email: email.value }) });
      status.textContent = result.data?.message || 'If the account can receive email, a verification link will arrive shortly.';
    } catch (error) { status.textContent = error.message || 'Please try again later.'; }
    finally { button.disabled = false; }
  });
})();
