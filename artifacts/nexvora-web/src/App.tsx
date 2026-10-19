import { useEffect, useState, type FormEvent } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ArrowUpRight, LoaderCircle, RefreshCw } from 'lucide-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, Router as WouterRouter } from 'wouter';

const queryClient = new QueryClient();

type AnyRecord = Record<string, any>;

async function parseResponse(response: Response): Promise<AnyRecord> {
  let body: AnyRecord;
  try {
    body = await response.json();
  } catch {
    throw new Error('Request failed. Please try again.');
  }
  if (!response.ok) throw new Error(body.error || 'Request failed');
  return body;
}

function BrandNav({ admin = false, onSignOut }: { admin?: boolean; onSignOut?: () => void }) {
  return (
    <nav className="top-nav" aria-label="Main navigation">
      <a className="brand" href="/" aria-label="NEXVORA home">
        NEXVORA<span className="brand-mark">.</span>
      </a>
      {admin ? (
        <div className="admin-nav-actions">
          <button className="button-quiet" type="button" onClick={onSignOut} data-testid="button-logout">Sign out</button>
        </div>
      ) : (
        <a className="nav-link" href="/pages/admin.html">Control Center <ArrowUpRight size={14} /></a>
      )}
    </nav>
  );
}

function TrackingPage() {
  const [code, setCode] = useState('');
  const [shipment, setShipment] = useState<AnyRecord | null>(null);
  const [events, setEvents] = useState<AnyRecord[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function track(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedCode = code.trim().toUpperCase();
    if (!normalizedCode) return;
    setCode(normalizedCode);
    setLoading(true);
    setError('');
    setShipment(null);
    setEvents([]);
    try {
      const response = await fetch(`/api/track/${encodeURIComponent(normalizedCode)}`);
      const result = await parseResponse(response);
      setShipment(result.data.shipment);
      setEvents(Array.isArray(result.data.events) ? result.data.events : []);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Visibility unavailable.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <BrandNav />
      <section className="hero">
        <p className="eyebrow">Supply chain visibility</p>
        <h1>Movement clarity,<br />without the noise.</h1>
        <p className="hero-copy">Verify the last confirmed point in an asset’s journey.</p>
        <form className="form-block" onSubmit={track}>
          <label className="field-label" htmlFor="tracking-code">Visibility code</label>
          <div className="search-row">
            <input
              className="field"
              id="tracking-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="NXV-A7X9M2KP4R-07"
              autoComplete="off"
              required
              data-testid="input-tracking-code"
            />
            <button className="button-primary" disabled={loading} data-testid="button-track">
              {loading ? <><LoaderCircle size={16} className="spin-icon" /> Verifying</> : 'View movement'}
            </button>
          </div>
        </form>
      </section>
      {loading && (
        <section className="result-panel" aria-live="polite" data-testid="status-tracking-loading">
          <p className="eyebrow">Visibility check</p>
          <div className="empty-skeleton" />
          <div className="empty-skeleton" />
        </section>
      )}
      {error && !loading && (
        <section className="result-panel" role="alert" data-testid="status-tracking-error">
          <p className="eyebrow">Unable to verify</p>
          <p className="error-text">{error}</p>
        </section>
      )}
      {shipment && !loading && (
        <section className="result-panel" aria-live="polite" data-testid="result-tracking">
          <div className="result-heading">
            <div>
              <p className="eyebrow">{String(shipment.status || '').replaceAll('_', ' ')}</p>
              <h2>{shipment.tracking_code}</h2>
              <p className="result-meta">
                Last verified: {shipment.location?.label || 'Location protected'} ·{' '}
                {shipment.last_verified_at ? new Date(shipment.last_verified_at).toLocaleString() : 'Awaiting verification'}
              </p>
            </div>
          </div>
          {events.length > 0 ? (
            <ul className="timeline">
              {events.map((item, index) => (
                <li key={item.id ?? `${item.created_at}-${index}`} data-testid={`event-movement-${index}`}>
                  <div className="event-title">{String(item.status_to || item.event_type || '').replaceAll('_', ' ')}</div>
                  <div className="event-detail">
                    {item.public_message || item.facility_name || 'Movement verified'} ·{' '}
                    {item.created_at ? new Date(item.created_at).toLocaleString() : 'Time unavailable'}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-state">No movement events are available yet.</p>
          )}
        </section>
      )}
      <footer className="footer-note">NEXVORA · Supply chain visibility</footer>
    </main>
  );
}

function AdminPage() {
  const [token, setToken] = useState(() => sessionStorage.getItem('nexvora_token') || '');
  const [loginError, setLoginError] = useState('');
  const [shipments, setShipments] = useState<AnyRecord[]>([]);
  const [selected, setSelected] = useState<string | number | null>(null);
  const [selectedCode, setSelectedCode] = useState('');
  const [listError, setListError] = useState('');
  const [listLoading, setListLoading] = useState(false);
  const [actionOutput, setActionOutput] = useState('');
  const [createMessage, setCreateMessage] = useState('');
  const [busyAction, setBusyAction] = useState('');

  async function api(path: string, options: RequestInit = {}) {
    const response = await fetch(`/api${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    });
    return parseResponse(response);
  }

  async function loadShipments() {
    setListLoading(true);
    setListError('');
    try {
      const result = await api('/admin/shipments');
      setShipments(Array.isArray(result.data.shipments) ? result.data.shipments : []);
    } catch (requestError) {
      setListError(requestError instanceof Error ? requestError.message : 'Unable to load asset movements.');
    } finally {
      setListLoading(false);
    }
  }

  useEffect(() => {
    if (token) void loadShipments();
  }, [token]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginError('');
    setBusyAction('login');
    const formData = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: formData.get('email'),
          password: formData.get('password'),
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'Authentication failed');
      const nextToken = result.data.token;
      sessionStorage.setItem('nexvora_token', nextToken);
      setToken(nextToken);
      setBusyAction('');
    } catch (requestError) {
      setLoginError(requestError instanceof Error ? requestError.message : 'Authentication failed');
      setBusyAction('');
    }
  }

  async function createShipment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusyAction('create');
    setCreateMessage('');
    const form = event.currentTarget;
    const fields = new FormData(form);
    try {
      const result = await api('/admin/shipments', {
        method: 'POST',
        body: JSON.stringify({
          consignee_name: fields.get('consignee_name'),
          weight_kg: fields.get('weight_kg'),
          service_type: fields.get('service_type'),
          consignee_address: { city: fields.get('city'), country: fields.get('country') },
        }),
      });
      setCreateMessage(`Created ${result.data.shipment.tracking_code}`);
      form.reset();
      await loadShipments();
    } catch (requestError) {
      setCreateMessage(requestError instanceof Error ? requestError.message : 'Unable to create asset movement.');
    } finally {
      setBusyAction('');
    }
  }

  async function performAction(path: string, method: string, payload: AnyRecord) {
    if (!selected) return;
    setBusyAction('action');
    setActionOutput('');
    try {
      const result = await api(`/admin/shipments/${selected}${path}`, { method, body: JSON.stringify(payload) });
      setActionOutput(JSON.stringify(result, null, 2));
      await loadShipments();
    } catch (requestError) {
      setActionOutput(requestError instanceof Error ? requestError.message : 'Request failed');
    } finally {
      setBusyAction('');
    }
  }

  function signOut() {
    sessionStorage.removeItem('nexvora_token');
    setToken('');
    setShipments([]);
    setSelected(null);
    setActionOutput('');
  }

  if (!token) {
    return (
      <main className="app-shell">
        <BrandNav admin />
        <section className="panel admin-login">
          <p className="eyebrow">Secure control center</p>
          <h1>Operator access</h1>
          <form className="login-form" onSubmit={login}>
            <input className="field" name="email" type="email" placeholder="Work email" required autoComplete="username" data-testid="input-email" />
            <input className="field" name="password" type="password" placeholder="Password" required minLength={12} autoComplete="current-password" data-testid="input-password" />
            <button className="button-primary" disabled={busyAction === 'login'} data-testid="button-authenticate">
              {busyAction === 'login' ? 'Authenticating…' : 'Authenticate'}
            </button>
          </form>
          {loginError && <p className="error-text" role="alert" data-testid="status-login-error">{loginError}</p>}
        </section>
        <footer className="footer-note">NEXVORA · Operator access</footer>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <BrandNav admin onSignOut={signOut} />
      <section className="console">
        <div className="console-head">
          <div>
            <p className="eyebrow">Network operations</p>
            <h1 className="page-title">Asset movement console</h1>
          </div>
          <button className="button-quiet" type="button" onClick={() => void loadShipments()} disabled={listLoading} data-testid="button-refresh">
            <RefreshCw size={15} className={listLoading ? 'spin-icon' : ''} /> Refresh
          </button>
        </div>
        <div className="console-grid">
          <article className="panel">
            <h2>Create asset movement</h2>
            <form className="create-form" onSubmit={createShipment}>
              <input className="field" name="consignee_name" placeholder="Consignee name" required data-testid="input-consignee-name" />
              <input className="field" name="weight_kg" type="number" min=".01" step=".01" placeholder="Weight (kg)" required data-testid="input-weight-kg" />
              <input className="field" name="city" placeholder="Destination city" data-testid="input-city" />
              <input className="field" name="country" maxLength={2} placeholder="Country code" data-testid="input-country" />
              <select className="select-field" name="service_type" defaultValue="standard" data-testid="select-service-type">
                <option value="standard">standard</option>
                <option value="express">express</option>
                <option value="economy">economy</option>
              </select>
              <button className="button-primary" disabled={busyAction === 'create'} data-testid="button-create-shipment">
                {busyAction === 'create' ? 'Creating…' : 'Create visibility code'}
              </button>
            </form>
            {createMessage && <p className={createMessage.startsWith('Created ') ? 'result-meta' : 'error-text'} role="status" data-testid="status-create-result">{createMessage}</p>}
          </article>
          <article className="panel map-panel">
            <h2>Network map</h2>
            <div className="map-visual" id="map">
              <div className="map-copy">
                <strong>Aggregated active movements</strong>
                <small>Exact locations remain protected.</small>
              </div>
            </div>
          </article>
        </div>
        <section className="panel">
          <div className="section-head">
            <h2>Active asset movements</h2>
            {listLoading && <span className="result-meta">Updating network…</span>}
          </div>
          {listError ? (
            <div role="alert">
              <p className="error-text" data-testid="status-shipments-error">{listError}</p>
              <button className="button-quiet" type="button" onClick={() => void loadShipments()}>Retry</button>
            </div>
          ) : listLoading && shipments.length === 0 ? (
            <div aria-label="Loading asset movements"><div className="empty-skeleton" /><div className="empty-skeleton" /></div>
          ) : shipments.length === 0 ? (
            <p className="empty-state">No asset movements yet.</p>
          ) : (
            <div className="table" id="shipments">
              {shipments.map((item) => (
                <div className="shipment-row" key={item.id} data-testid={`row-shipment-${item.id}`}>
                  <strong className="tracking-code">{item.tracking_code}</strong>
                  <span className="badge">{String(item.status || '').replaceAll('_', ' ')}</span>
                  <span className="shipment-consignee">{item.consignee_name}</span>
                  <button
                    className="button-quiet"
                    type="button"
                    onClick={() => {
                      setSelected(item.id);
                      setSelectedCode(item.tracking_code);
                      setActionOutput('');
                    }}
                    data-testid={`button-control-${item.id}`}
                  >Control</button>
                </div>
              ))}
            </div>
          )}
        </section>
        {selected !== null && (
          <section className="panel action-panel" id="action-panel">
            <h2>Manual override · {selectedCode}</h2>
            <form className="inline-form" onSubmit={(event) => {
              event.preventDefault();
              const status = new FormData(event.currentTarget).get('new_status');
              void performAction('/status', 'PATCH', { new_status: status });
            }}>
              <select className="select-field" name="new_status" defaultValue="picked_up" data-testid="select-new-status">
                <option value="picked_up">picked_up</option>
                <option value="in_transit">in_transit</option>
                <option value="out_for_delivery">out_for_delivery</option>
                <option value="delivered">delivered</option>
                <option value="failed">failed</option>
                <option value="cancelled">cancelled</option>
              </select>
              <button className="button-primary" disabled={busyAction === 'action'} data-testid="button-apply-status">Apply status</button>
              <button className="button-quiet" type="button" disabled={busyAction === 'action'} onClick={() => void performAction('/simulate', 'POST', { scenario: 'international_demo' })} data-testid="button-simulate">Run demo sequence</button>
            </form>
            <form className="inline-form" onSubmit={(event) => {
              event.preventDefault();
              const fields = new FormData(event.currentTarget);
              void performAction('/location', 'PATCH', { lat: fields.get('lat'), lng: fields.get('lng') });
            }}>
              <input className="field" name="lat" type="number" step="any" placeholder="Latitude" data-testid="input-latitude" />
              <input className="field" name="lng" type="number" step="any" placeholder="Longitude" data-testid="input-longitude" />
              <button className="button-primary" disabled={busyAction === 'action'} data-testid="button-set-location">Set verified location</button>
            </form>
            {actionOutput && <pre className="action-output" id="action-output" aria-live="polite" data-testid="status-action-output">{actionOutput}</pre>}
          </section>
        )}
      </section>
      <footer className="footer-note">NEXVORA · Network operations</footer>
    </main>
  );
}

function Router() {
  return (
    <ErrorBoundary>
      <Switch>
        <Route path="/" component={TrackingPage} />
        <Route path="/pages/admin.html" component={AdminPage} />
        <Route component={NotFound} />
      </Switch>
    </ErrorBoundary>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
