(function () {
  'use strict';
  const TOKEN_KEY = 'nexvora_access_token';
  function token() { return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY) || ''; }
  async function request(path, options) {
    const opts = options || {};
    const headers = new Headers(opts.headers || {});
    headers.set('Accept', 'application/json');
    if (opts.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const accessToken = token();
    if (accessToken) headers.set('Authorization', 'Bearer ' + accessToken);
    const response = await fetch(path, { ...opts, headers, credentials: 'include' });
    let payload = null;
    try { payload = await response.json(); } catch (_) { payload = { success: false, error: 'Unexpected server response.' }; }
    if (!response.ok || payload.success === false) {
      const error = new Error(payload.error || 'Request failed.');
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }
  function remember(data, persist) {
    if (!data || !data.token) return;
    (persist ? localStorage : sessionStorage).setItem(TOKEN_KEY, data.token);
  }
  function clearToken() { localStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(TOKEN_KEY); }
  function toast(message, type) {
    let node = document.querySelector('[data-toast]');
    if (!node) { node = document.createElement('div'); node.dataset.toast = ''; node.className = 'toast'; document.body.append(node); }
    node.textContent = message; node.dataset.type = type || 'info'; node.classList.add('is-visible');
    window.setTimeout(() => node.classList.remove('is-visible'), 3600);
  }
  function validTrackingCode(value) { return /^[A-Z]{2,5}-[A-HJ-NP-Z2-9]{10}-\d{2}$/.test(String(value || '').trim().toUpperCase()); }
  window.NexvoraAPI = { request, remember, clearToken, toast, validTrackingCode };
})();
