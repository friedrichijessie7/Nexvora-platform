import assert from 'node:assert/strict';

const baseUrl = new URL(process.env.FedEx_SMOKE_BASE_URL ?? 'http://localhost:80');
const appOrigin = baseUrl.origin;

async function get(path) {
  return fetch(new URL(path, appOrigin), {
    headers: { accept: 'text/html,application/json' },
    signal: AbortSignal.timeout(10_000),
  });
}

async function verifyWebRoute(path) {
  const response = await get(path);
  assert.equal(response.status, 200, `${path} should return HTTP 200`);
  assert.match(
    response.headers.get('content-type') ?? '',
    /text\/html/i,
    `${path} should return HTML`,
  );

  const html = await response.text();
  assert.match(html, /<title>FedEx<\/title>/i, `${path} should serve the FedEx app`);
  assert.match(html, /<div id="root"><\/div>/i, `${path} should serve the React app shell`);
}

async function verifyHealthRoute() {
  const response = await get('/health');
  assert.equal(response.status, 200, '/health should return HTTP 200');
  assert.match(
    response.headers.get('content-type') ?? '',
    /application\/json/i,
    '/health should return JSON',
  );

  const body = await response.json();
  assert.equal(body.success, true, '/health should report success');
  assert.equal(body.data?.status, 'healthy', '/health should identify a healthy API');
  assert.equal(typeof body.data?.service, 'string', '/health should identify the API service');
  assert.ok(body.data.service.length > 0, '/health should return a non-empty service name');
  assert.ok(Number.isFinite(Date.parse(body.data?.timestamp)), '/health should include a valid timestamp');
}

async function verifyInvalidTrackingRoute() {
  const response = await get('/api/track/not-a-tracking-code');
  assert.equal(response.status, 400, 'invalid tracking codes should return HTTP 400');
  assert.match(
    response.headers.get('content-type') ?? '',
    /application\/json/i,
    'invalid tracking codes should return JSON',
  );

  const body = await response.json();
  assert.equal(body.success, false, 'invalid tracking codes should return a validation failure');
  assert.equal(body.code, 'INVALID_CODE_FORMAT', 'invalid tracking codes should use the API validation code');
  assert.equal(typeof body.error, 'string', 'validation failures should include an error message');
  assert.ok(body.error.length > 0, 'validation failures should include a non-empty error message');
}

await verifyWebRoute('/');
console.log('PASS / serves the FedEx web app');

await verifyWebRoute('/pages/admin.html');
console.log('PASS /pages/admin.html serves the FedEx web app');

await verifyHealthRoute();
console.log('PASS /health reaches the shipment API');

await verifyInvalidTrackingRoute();
console.log('PASS invalid /api/track/:code requests return the API JSON validation response');

console.log(`Routing smoke checks passed against ${appOrigin}`);
