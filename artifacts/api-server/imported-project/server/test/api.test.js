'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const { after, before, test } = require('node:test');

// Override any workspace credentials before loading app configuration. These
// values are test-only; all database access below is backed by fake memory.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://regression-test.invalid/test';
process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_KEY = 'test-only-service-key';
process.env.JWT_SECRET = 'test-only-jwt-secret-for-isolated-api-regressions'.padEnd(64, 'x');
process.env.ALLOWED_ORIGINS = 'http://localhost:3000';

const tables = {
  users: [],
  shipments: [],
  tracking_events: [],
  audit_logs: [],
  facilities: [],
};
let rowSequence = 0;
let databaseReads = 0;
let databaseWrites = 0;

class FakeQuery {
  constructor(table) {
    this.table = table;
    this.operation = 'select';
    this.filters = [];
    this.columns = null;
    this.cardinality = null;
    this.offset = 0;
    this.limit = Infinity;
    this.sort = null;
  }

  select(columns) {
    this.columns = columns || null;
    return this;
  }

  insert(values) {
    this.operation = 'insert';
    this.values = Array.isArray(values) ? values : [values];
    return this;
  }

  update(values) {
    this.operation = 'update';
    this.values = values;
    return this;
  }

  eq(column, value) {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  gte(column, value) {
    this.filters.push((row) => row[column] >= value);
    return this;
  }

  lte(column, value) {
    this.filters.push((row) => row[column] <= value);
    return this;
  }

  order(column, { ascending = true } = {}) {
    this.sort = { column, ascending };
    return this;
  }

  range(from, to) {
    this.offset = from;
    this.limit = Math.max(0, to - from + 1);
    return this;
  }

  single() {
    this.cardinality = 'single';
    return this.execute();
  }

  maybeSingle() {
    this.cardinality = 'maybeSingle';
    return this.execute();
  }

  project(row) {
    if (!this.columns || this.columns === '*') return { ...row };
    const selected = this.columns.split(',').map((column) => column.trim());
    return Object.fromEntries(selected.filter((column) => column in row).map((column) => [column, row[column]]));
  }

  execute() {
    const rows = tables[this.table];
    if (!rows) throw new Error(`Unexpected table in isolated API test: ${this.table}`);

    let result;
    if (this.operation === 'insert') {
      databaseWrites += 1;
      if (this.table === 'users' && this.values.some((value) => rows.some((row) => row.email === value.email))) {
        return { data: null, error: { code: '23505', message: 'duplicate email' }, count: 0 };
      }
      result = this.values.map((value) => ({
        id: value.id || `test-row-${++rowSequence}`,
        created_at: value.created_at || new Date().toISOString(),
        ...value,
        ...(this.table === 'users' ? {
          is_active: value.is_active ?? true,
          failed_attempts: value.failed_attempts ?? 0,
        } : {}),
      }));
      rows.push(...result);
    } else {
      result = rows.filter((row) => this.filters.every((filter) => filter(row)));
      if (this.operation === 'update') {
        databaseWrites += 1;
        result.forEach((row) => Object.assign(row, this.values));
      } else {
        databaseReads += 1;
      }

      if (this.sort) {
        const { column, ascending } = this.sort;
        result = [...result].sort((left, right) => {
          const comparison = left[column] < right[column] ? -1 : left[column] > right[column] ? 1 : 0;
          return ascending ? comparison : -comparison;
        });
      }
    }

    const count = result.length;
    if (this.operation === 'select') result = result.slice(this.offset, this.offset + this.limit);
    result = result.map((row) => this.project(row));

    if (this.cardinality) {
      const data = result[0] || null;
      if (this.cardinality === 'single' && !data) {
        return { data: null, error: { message: 'Expected one row in fake database.' } };
      }
      return { data, error: null, count };
    }
    return { data: result, error: null, count };
  }

  then(resolve, reject) {
    return Promise.resolve().then(() => this.execute()).then(resolve, reject);
  }
}

const supabaseAdmin = {
  from(table) {
    return new FakeQuery(table);
  },
};

function installMock(relativePath, exports) {
  const filename = require.resolve(relativePath);
  const mock = new Module(filename, module);
  mock.filename = filename;
  mock.loaded = true;
  mock.exports = exports;
  require.cache[filename] = mock;
}

installMock('../services/db', { supabaseAdmin });
installMock('../services/notificationService', {
  notifyShipmentStatusChange: async () => ({ delivered: false, provider: 'test' }),
});

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const app = require('../server');
const { generateTrackingCode, validateTrackingCode } = require('../services/trackingCodeGenerator');

const password = 'test-password-for-isolated-api-regressions';
const roles = ['superadmin', 'operator', 'viewer', 'customer'];
const usersByRole = {};
const tokensByRole = {};
let httpServer;
let baseUrl;
let publicTrackingCode;
let adminRequestAddress = 0;

function request(path, { method = 'GET', body, token, cookie, address } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  if (cookie) headers.cookie = cookie;
  // Keep these integration tests independent from the production rate limits.
  headers['x-forwarded-for'] = address || `198.51.100.${++adminRequestAddress}`;
  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function makeShipment(id, status, overrides = {}) {
  return {
    id,
    tracking_code: `NX-${String(id).replace(/[^A-Z2-9]/gi, 'A').toUpperCase().padEnd(10, 'A').slice(0, 10)}-00`,
    status,
    service_type: 'standard',
    consignee_address_generalized: 'Portland, US',
    privacy_mode: true,
    current_lat: 45.5152,
    current_lng: -122.6784,
    last_verified_at: '2026-01-01T00:00:00.000Z',
    delivered_at: null,
    proof_of_delivery: null,
    facility_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function tokenFor(user) {
  return jwt.sign(
    { role: user.role, email: user.email },
    process.env.JWT_SECRET,
    { subject: user.id, issuer: 'dynamic-supply-chain-os', expiresIn: '10m' },
  );
}

async function readJson(response) {
  return { status: response.status, body: await response.json() };
}

before(async () => {
  const passwordHash = await bcrypt.hash(password, 4);
  for (const [index, role] of roles.entries()) {
    const user = {
      id: `test-user-${index + 1}`,
      email: `${role}@nexvora.test`,
      password_hash: passwordHash,
      role,
      security_clearance: 'standard',
      is_active: true,
      failed_attempts: 0,
      locked_until: null,
    };
    usersByRole[role] = user;
    tokensByRole[role] = tokenFor(user);
    tables.users.push(user);
  }
  tables.users.push({
    id: 'test-user-inactive',
    email: 'inactive@nexvora.test',
    password_hash: passwordHash,
    role: 'operator',
    security_clearance: 'standard',
    is_active: false,
    failed_attempts: 0,
    locked_until: null,
  });

  publicTrackingCode = await generateTrackingCode('NX');
  assert.ok(validateTrackingCode(publicTrackingCode), 'fixture uses a valid public tracking code');
  const publicShipment = makeShipment('public-fixture', 'in_transit', {
    tracking_code: publicTrackingCode,
  });
  tables.shipments.push(publicShipment);
  tables.tracking_events.push({
    id: 'public-event',
    shipment_id: publicShipment.id,
    actor_id: 'private-actor-id',
    event_type: 'status_change',
    status_from: 'picked_up',
    status_to: 'in_transit',
    facility_name: 'Portland Hub',
    latitude: 45.5152,
    longitude: -122.6784,
    public_message: 'Shipment is moving.',
    created_at: '2026-01-02T00:00:00.000Z',
  });

  const allowedTransitions = [
    ['created', 'picked_up'],
    ['created', 'cancelled'],
    ['picked_up', 'in_transit'],
    ['picked_up', 'cancelled'],
    ['in_transit', 'out_for_delivery'],
    ['in_transit', 'failed'],
    ['in_transit', 'cancelled'],
    ['out_for_delivery', 'delivered'],
    ['out_for_delivery', 'failed'],
    ['failed', 'cancelled'],
  ];
  allowedTransitions.forEach(([from, to], index) => {
    tables.shipments.push(makeShipment(`transition-fixture-${index}`, from));
    tables.expectedTransitionCases = tables.expectedTransitionCases || [];
    tables.expectedTransitionCases.push({ id: `transition-fixture-${index}`, from, to });
  });
  tables.shipments.push(makeShipment('invalid-transition-fixture', 'created'));

  httpServer = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    httpServer.once('listening', resolve);
    httpServer.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${httpServer.address().port}`;
});

after(async () => {
  if (httpServer) await new Promise((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve()));
});

test('public tracking returns a privacy-filtered shipment without requiring a login', async () => {
  const { status, body } = await readJson(await request(`/api/track/${publicTrackingCode}`));
  assert.equal(status, 200);
  assert.equal(body.success, true);
  assert.equal(body.data.shipment.tracking_code, publicTrackingCode);
  assert.equal(body.data.shipment.status, 'in_transit');
  assert.deepEqual(body.data.shipment.location, {
    label: 'Portland, US',
    latitude: null,
    longitude: null,
  });
  assert.equal(body.data.events.length, 1);
  assert.equal(body.data.events[0].public_message, 'Shipment is moving.');
  assert.equal('actor_id' in body.data.events[0], false);
  assert.equal('latitude' in body.data.events[0], false);
  assert.equal('longitude' in body.data.events[0], false);

  const invalidCode = await readJson(await request('/api/track/not-a-tracking-code'));
  assert.equal(invalidCode.status, 400);
  assert.equal(invalidCode.body.code, 'INVALID_CODE_FORMAT');
});

test('admin authentication issues usable tokens and rejects bad, inactive, and missing credentials', async () => {
  assert.equal(process.env.SUPABASE_URL, 'http://127.0.0.1:54321');

  const login = await readJson(await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'SUPERADMIN@NEXVORA.TEST', password },
  }));
  assert.equal(login.status, 200);
  assert.equal(login.body.success, true);
  assert.equal(login.body.data.user.role, 'superadmin');
  assert.ok(login.body.data.token);
  assert.ok(login.body.data.refreshToken);

  const profile = await readJson(await request('/api/auth/me', { token: login.body.data.token }));
  assert.equal(profile.status, 200);
  assert.equal(profile.body.data.user.id, usersByRole.superadmin.id);

  const refreshed = await readJson(await request('/api/auth/refresh', {
    method: 'POST',
    body: { refreshToken: login.body.data.refreshToken },
  }));
  assert.equal(refreshed.status, 200);
  assert.ok(refreshed.body.data.token);
  const invalidRefresh = await readJson(await request('/api/auth/refresh', {
    method: 'POST',
    body: { refreshToken: login.body.data.token },
  }));
  assert.equal(invalidRefresh.status, 401);
  assert.equal(invalidRefresh.body.code, 'INVALID_REFRESH_TOKEN');

  const badPassword = await readJson(await request('/api/auth/login', {
    method: 'POST',
    body: { email: usersByRole.superadmin.email, password: 'wrong-password' },
  }));
  assert.equal(badPassword.status, 401);
  assert.equal(badPassword.body.code, 'INVALID_CREDENTIALS');
  assert.equal(usersByRole.superadmin.failed_attempts, 1);

  const inactive = await readJson(await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'inactive@nexvora.test', password },
  }));
  assert.equal(inactive.status, 401);
  assert.equal(inactive.body.code, 'INVALID_CREDENTIALS');
  const inactiveSession = await readJson(await request('/api/auth/me', {
    token: tokenFor(tables.users.find((user) => user.id === 'test-user-inactive')),
  }));
  assert.equal(inactiveSession.status, 401);
  assert.equal(inactiveSession.body.code, 'ACCOUNT_UNAVAILABLE');

  const missingToken = await readJson(await request('/api/auth/me'));
  assert.equal(missingToken.status, 401);
  assert.equal(missingToken.body.code, 'AUTH_REQUIRED');
  const invalidToken = await readJson(await request('/api/auth/me', { token: 'not.a.valid.token' }));
  assert.equal(invalidToken.status, 401);
  assert.equal(invalidToken.body.code, 'INVALID_TOKEN');

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const failedLogin = await readJson(await request('/api/auth/login', {
      method: 'POST',
      body: { email: usersByRole.operator.email, password: 'wrong-password' },
    }));
    assert.equal(failedLogin.status, 401);
  }
  assert.equal(usersByRole.operator.failed_attempts, 5);
  assert.ok(new Date(usersByRole.operator.locked_until).getTime() > Date.now());
  const lockedAccount = await readJson(await request('/api/auth/login', {
    method: 'POST',
    body: { email: usersByRole.operator.email, password },
  }));
  assert.equal(lockedAccount.status, 401);
});

test('customer self-signup creates a customer-only session and scopes shipment access', async () => {
  const weakPassword = await readJson(await request('/api/auth/signup', {
    method: 'POST',
    body: { email: 'new-customer@nexvora.test', password: 'short' },
  }));
  assert.equal(weakPassword.status, 400);
  assert.equal(weakPassword.body.code, 'VALIDATION_ERROR');

  const signupResponse = await request('/api/auth/signup', {
    method: 'POST',
    body: {
      email: 'NEW-CUSTOMER@NEXVORA.TEST',
      password: 'customer-password-long-enough',
      role: 'superadmin',
    },
  });
  const signup = await readJson(signupResponse);
  assert.equal(signup.status, 201);
  assert.equal(signup.body.data.user.email, 'new-customer@nexvora.test');
  assert.equal(signup.body.data.user.role, 'customer');
  assert.ok(signup.body.data.token);
  assert.ok(signup.body.data.refreshToken);
  const setCookie = signupResponse.headers.get('set-cookie') || '';
  assert.match(setCookie, /nexvora_access=.*HttpOnly/i);
  assert.match(setCookie, /nexvora_refresh=.*HttpOnly/i);

  const duplicate = await readJson(await request('/api/auth/signup', {
    method: 'POST',
    body: { email: 'new-customer@nexvora.test', password: 'customer-password-long-enough' },
  }));
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.code, 'EMAIL_EXISTS');

  const customer = tables.users.find((user) => user.email === 'new-customer@nexvora.test');
  assert.ok(customer);
  assert.equal(customer.role, 'customer');
  assert.equal(customer.security_clearance, 'standard');
  const cookie = `nexvora_access=${signup.body.data.token}; nexvora_refresh=${signup.body.data.refreshToken}`;
  const ownedId = 'customer-owned-shipment';
  const otherId = 'other-customer-shipment';
  const timestamp = '2026-10-20T12:00:00.000Z';
  tables.shipments.push(
    makeShipment(ownedId, 'in_transit', {
      customer_id: customer.id,
      consignee_name: 'Customer order',
      weight_kg: 3.5,
      status_changed_at: timestamp,
    }),
    makeShipment(otherId, 'picked_up', {
      customer_id: usersByRole.customer.id,
      consignee_name: 'Another customer order',
      weight_kg: 1.25,
      status_changed_at: timestamp,
    }),
  );
  tables.tracking_events.push({
    id: 'customer-owned-event',
    shipment_id: ownedId,
    event_type: 'status_change',
    status_from: 'created',
    status_to: 'in_transit',
    facility_name: 'Regional hub',
    public_message: 'Movement verified.',
    created_at: timestamp,
    actor_id: 'staff-private-id',
    latitude: 45.5,
    longitude: -122.6,
  });

  const profile = await readJson(await request('/api/auth/me', { cookie }));
  assert.equal(profile.status, 200);
  assert.deepEqual(profile.body.data.user, {
    id: customer.id,
    email: customer.email,
    role: 'customer',
  });

  const shipments = await readJson(await request('/api/customer/shipments', { cookie }));
  assert.equal(shipments.status, 200);
  assert.deepEqual(shipments.body.data.shipments.map((item) => item.id), [ownedId]);
  assert.equal(shipments.body.data.shipments[0].weight_kg, 3.5);
  assert.equal('customer_id' in shipments.body.data.shipments[0], false);
  assert.equal('current_lat' in shipments.body.data.shipments[0], false);

  const detail = await readJson(await request(`/api/customer/shipments/${ownedId}`, { cookie }));
  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.shipment.id, ownedId);
  assert.equal(detail.body.data.events[0].public_message, 'Movement verified.');
  assert.equal('actor_id' in detail.body.data.events[0], false);
  assert.equal('latitude' in detail.body.data.events[0], false);

  const otherCustomerDetail = await readJson(await request(`/api/customer/shipments/${otherId}`, { cookie }));
  assert.equal(otherCustomerDetail.status, 404);

  const customerAdminDirectory = await readJson(await request('/api/admin/customers', { cookie }));
  assert.equal(customerAdminDirectory.status, 403);
  const operatorDirectory = await readJson(await request('/api/admin/customers', {
    token: tokensByRole.operator,
  }));
  assert.equal(operatorDirectory.status, 200);
  assert.ok(operatorDirectory.body.data.customers.some((item) => item.id === customer.id));

  const refreshed = await readJson(await request('/api/auth/refresh', { method: 'POST', cookie }));
  assert.equal(refreshed.status, 200);
  assert.ok(refreshed.body.data.token);
  const loggedOutResponse = await request('/api/auth/logout', { method: 'POST', cookie });
  const loggedOut = await readJson(loggedOutResponse);
  assert.equal(loggedOut.status, 200);
  assert.match(loggedOutResponse.headers.get('set-cookie') || '', /Expires=Thu, 01 Jan 1970/i);
});

test('role restrictions protect shipment creation and superadmin-only data', async () => {
  const shipmentPayload = {
    consignee_name: 'Test Recipient',
    consignee_email: 'recipient@nexvora.test',
    consignee_address: { city: 'Portland', country: 'US' },
    weight_kg: 2.5,
    service_type: 'express',
  };

  const unauthenticated = await readJson(await request('/api/admin/shipments'));
  assert.equal(unauthenticated.status, 401);

  const viewerList = await readJson(await request('/api/admin/shipments', {
    token: tokensByRole.viewer,
  }));
  assert.equal(viewerList.status, 200);

  const viewerCreate = await readJson(await request('/api/admin/shipments', {
    method: 'POST',
    token: tokensByRole.viewer,
    body: shipmentPayload,
  }));
  assert.equal(viewerCreate.status, 403);
  assert.equal(viewerCreate.body.code, 'FORBIDDEN');

  const customerList = await readJson(await request('/api/admin/shipments', {
    token: tokensByRole.customer,
  }));
  assert.equal(customerList.status, 403);

  for (const role of ['operator', 'superadmin']) {
    const created = await readJson(await request('/api/admin/shipments', {
      method: 'POST',
      token: tokensByRole[role],
      body: shipmentPayload,
    }));
    assert.equal(created.status, 201, `${role} can create shipments`);
    assert.equal(created.body.data.shipment.status, 'created');
    assert.equal(created.body.data.shipment.operator_id, usersByRole[role].id);
    assert.ok(validateTrackingCode(created.body.data.shipment.tracking_code));
  }

  const invalidCreate = await readJson(await request('/api/admin/shipments', {
    method: 'POST',
    token: tokensByRole.operator,
    body: { consignee_name: 'Missing weight' },
  }));
  assert.equal(invalidCreate.status, 400);
  assert.equal(invalidCreate.body.code, 'VALIDATION_ERROR');

  const viewerAudit = await readJson(await request('/api/admin/audit-logs', {
    token: tokensByRole.viewer,
  }));
  assert.equal(viewerAudit.status, 403);
  const superadminAudit = await readJson(await request('/api/admin/audit-logs', {
    token: tokensByRole.superadmin,
  }));
  assert.equal(superadminAudit.status, 200);
});

test('every documented shipment transition succeeds and invalid transitions leave status unchanged', async () => {
  for (const { id, from, to } of tables.expectedTransitionCases) {
    const { status, body } = await readJson(await request(`/api/admin/shipments/${id}/status`, {
      method: 'PATCH',
      token: tokensByRole.operator,
      body: { new_status: to },
    }));
    assert.equal(status, 200, `${from} -> ${to} is allowed`);
    assert.equal(body.data.shipment.status, to);
  }

  const invalid = await readJson(await request('/api/admin/shipments/invalid-transition-fixture/status', {
    method: 'PATCH',
    token: tokensByRole.operator,
    body: { new_status: 'delivered' },
  }));
  assert.equal(invalid.status, 422);
  assert.equal(invalid.body.code, 'INVALID_TRANSITION');
  assert.equal(tables.shipments.find((shipment) => shipment.id === 'invalid-transition-fixture').status, 'created');

  const unknownStatus = await readJson(await request('/api/admin/shipments/invalid-transition-fixture/status', {
    method: 'PATCH',
    token: tokensByRole.operator,
    body: { new_status: 'teleported' },
  }));
  assert.equal(unknownStatus.status, 422);
  assert.equal(unknownStatus.body.code, 'INVALID_STATUS');
  assert.ok(databaseReads > 0, 'routes queried only the in-memory database fake');
  assert.ok(databaseWrites > 0, 'mutations were confined to the in-memory database fake');
});
