(function () {
  'use strict';
  const status = document.getElementById('account-status');
  const list = document.getElementById('shipments-list');
  const empty = document.getElementById('shipments-empty');
  document.getElementById('logout-button')?.addEventListener('click', async () => {
    try { await NexvoraAPI.request('/api/auth/logout', { method: 'POST' }); } catch (_) {}
    NexvoraAPI.clearToken();
    window.location.assign('/login.html');
  });
  function renderShipment(shipment) {
    const article = document.createElement('article');
    article.className = 'shipment-row';
    const code = encodeURIComponent(shipment.tracking_code || '');
    const details = document.createElement('div');
    const tracking = document.createElement('strong'); tracking.className = 'tracking-code'; tracking.textContent = shipment.tracking_code || 'Shipment';
    const description = document.createElement('p'); description.className = 'muted'; description.textContent = `${shipment.consignee_name || 'Customer shipment'} · ${shipment.service_type || 'Standard'}`;
    details.append(tracking, description);
    const actions = document.createElement('div');
    const pill = document.createElement('span'); pill.className = 'status-pill'; pill.textContent = shipment.status || 'Created';
    const link = document.createElement('a'); link.className = 'button button-secondary'; link.href = `/track.html?code=${code}`; link.textContent = 'Track';
    actions.append(pill, link); article.append(details, actions);
    return article;
  }
  (async function load() {
    try {
      const response = await NexvoraAPI.request('/api/customer/shipments');
      const shipments = response.data?.shipments || [];
      status.textContent = shipments.length ? 'Your current and completed shipments.' : 'Your account is ready for shipping.';
      empty.hidden = shipments.length > 0;
      shipments.forEach((shipment) => list.appendChild(renderShipment(shipment)));
    } catch (error) {
      status.textContent = error.status === 401 || error.status === 403 ? 'Please sign in with a verified customer account.' : 'We could not load your shipments.';
      if (error.status === 401 || error.status === 403) window.setTimeout(() => window.location.assign('/login.html'), 700);
    }
  })();
})();
