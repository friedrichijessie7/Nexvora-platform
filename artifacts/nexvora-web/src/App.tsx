import { useEffect, useRef, useState, type FormEvent } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ArrowDownRight, ArrowUpRight, LoaderCircle, RefreshCw, Route as RouteIcon } from 'lucide-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { trackEvent } from '@/lib/analytics';
import NotFound from '@/pages/not-found';
import { AccountPage, CustomerShipmentPage } from '@/pages/account-pages';
import { AuthPage, ForgotPasswordPage } from '@/pages/auth-pages';
import { useGetCurrentUser, useListAdminCustomers, useLogin, useLogout, useRefreshSession, getGetCurrentUserQueryKey, getListAdminCustomersQueryKey } from '@workspace/api-client-react';
import { Link, Route, Switch, Router as WouterRouter, useLocation } from 'wouter';

const queryClient = new QueryClient();
type AnyRecord = Record<string, any>;

async function parseResponse(response: Response): Promise<AnyRecord> {
  let body: AnyRecord;
  try { body = await response.json(); } catch { throw new Error('Request failed. Please try again.'); }
  if (!response.ok) throw new Error(body.error || 'Request failed');
  return body;
}

function BrandNav({ admin = false, onSignOut }: { admin?: boolean; onSignOut?: () => void }) {
  return (
    <nav className="top-nav" aria-label="Main navigation">
      <Link className="brand" href="/" aria-label="NEXVORA home" data-testid="link-brand-home">NEXVORA<span className="brand-mark">.</span></Link>
      {admin ? <div className="admin-nav-actions"><Link href="/" className="nav-link" data-testid="link-public-tracking">Public tracking</Link><button className="button-quiet" type="button" onClick={onSignOut} data-testid="button-logout">Sign out</button></div>
        : <div className="admin-nav-actions"><Link className="nav-link" href="/login" data-testid="link-login">Sign in</Link><Link className="button-primary" href="/signup" data-testid="link-create-account">Create account</Link></div>}
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
    setCode(normalizedCode); setLoading(true); setError(''); setShipment(null); setEvents([]);
    try {
      const response = await fetch(`/api/track/${encodeURIComponent(normalizedCode)}`, { credentials: 'same-origin' });
      const result = await parseResponse(response);
      const trackedShipment = result.data?.shipment;
      if (!trackedShipment || typeof trackedShipment !== 'object') throw new Error('Visibility unavailable.');
      setShipment(trackedShipment);
      setEvents(Array.isArray(result.data.events) ? result.data.events : []);
      trackEvent('shipment_tracking_succeeded', { surface: 'public_tracking' });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Visibility unavailable.');
    } finally { setLoading(false); }
  }
  return (
    <main className="app-shell">
      <BrandNav />
      <section className="hero">
        <p className="eyebrow">Supply chain visibility · NEXVORA</p>
        <h1>Movement clarity,<br />without the noise.</h1>
        <p className="hero-copy">Every shipment has a story. See the last confirmed point in its journey, with verified updates and the details that matter.</p>
        <form className="form-block" onSubmit={track}>
          <label className="field-label" htmlFor="tracking-code">Enter your visibility code</label>
          <div className="search-row">
            <input className="field" id="tracking-code" value={code} onChange={(event) => setCode(event.target.value)} placeholder="NXV-A7X9M2KP4R-07" autoComplete="off" required data-testid="input-tracking-code" />
            <button className="button-primary" disabled={loading} data-testid="button-track">{loading ? <><LoaderCircle size={16} className="spin-icon" /> Verifying</> : <>View movement <ArrowUpRight size={15} style={{ verticalAlign: 'middle', marginLeft: 5 }} /></>}</button>
          </div>
        </form>
      </section>
      {loading && <section className="result-panel" aria-live="polite" data-testid="status-tracking-loading"><p className="eyebrow">Checking visibility</p><div className="empty-skeleton" /><div className="empty-skeleton" /></section>}
      {error && !loading && <section className="result-panel" role="alert" data-testid="status-tracking-error"><p className="eyebrow">Unable to verify</p><p className="error-text">{error}</p><button className="button-quiet" type="button" onClick={(event) => { event.preventDefault(); const form = document.querySelector<HTMLFormElement>('.form-block'); form?.requestSubmit(); }} data-testid="button-retry-tracking">Try again</button></section>}
      {shipment && !loading && <section className="result-panel" aria-live="polite" data-testid="result-tracking">
        <div className="result-heading"><div><p className="eyebrow">{String(shipment.status || '').replaceAll('_', ' ')}</p><h2>{shipment.tracking_code}</h2><p className="result-meta">Last verified: {shipment.location?.label || 'Location protected'} · {shipment.last_verified_at ? new Date(shipment.last_verified_at).toLocaleString() : 'Awaiting verification'}</p></div><span className="status-pill">{String(shipment.status || 'pending').replaceAll('_', ' ')}</span></div>
        {events.length ? <ul className="timeline">{events.map((item, index) => <li key={item.id ?? `${item.created_at}-${index}`} data-testid={`event-movement-${index}`}><div className="event-title">{String(item.status_to || item.event_type || '').replaceAll('_', ' ')}</div><div className="event-detail">{item.public_message || item.facility_name || 'Movement verified'} · {item.created_at ? new Date(item.created_at).toLocaleString() : 'Time unavailable'}</div></li>)}</ul> : <p className="empty-state">No movement events are available yet.</p>}
      </section>}
      <section className="console-grid" style={{ paddingBottom: 58 }}>
        <article className="panel"><p className="eyebrow">Stay in control</p><h2>Visibility that belongs to you.</h2><p className="result-meta">A customer account brings every shipment assigned to you into one private, organized view.</p><Link href="/signup" className="nav-link" data-testid="link-create-customer-account">Create your customer account <ArrowUpRight size={15} /></Link></article>
        <article className="panel"><p className="eyebrow">Recorded in motion</p><h2>Verified updates, useful context.</h2><p className="result-meta">Follow key status changes without exposing sensitive operational coordinates or unnecessary noise.</p><div className="account-toolbar"><RouteIcon size={17} color="#237965" /> Confirmed movement · protected location detail</div></article>
      </section>
      <footer className="footer-note">NEXVORA · Supply chain visibility</footer>
    </main>
  );
}

function AdminPage() {
  const current = useGetCurrentUser({ query: { retry: false, queryKey: getGetCurrentUserQueryKey() } });
  const loginMutation = useLogin();
  const logoutMutation = useLogout();
  const refreshSession = useRefreshSession();
  const refreshAttempted = useRef(false);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [loginError, setLoginError] = useState('');
  const [shipments, setShipments] = useState<AnyRecord[]>([]);
  const [selected, setSelected] = useState<string | number | null>(null);
  const [selectedCode, setSelectedCode] = useState('');
  const [listError, setListError] = useState('');
  const [listLoading, setListLoading] = useState(false);
  const [actionOutput, setActionOutput] = useState('');
  const [createMessage, setCreateMessage] = useState('');
  const [busyAction, setBusyAction] = useState('');
  const role = current.data?.data?.user?.role;
  const isStaff = role === 'operator' || role === 'viewer' || role === 'superadmin';
  const canOperate = role === 'operator' || role === 'superadmin';
  const customersQuery = useListAdminCustomers({ query: { enabled: canOperate, queryKey: getListAdminCustomersQueryKey() } });
  const customers = customersQuery.data?.data?.customers || [];
  const authErrorStatus = (current.error as { status?: number } | null)?.status;
  useEffect(() => {
    if (!current.isError || authErrorStatus !== 401 || refreshAttempted.current || refreshSession.isPending) return;
    refreshAttempted.current = true;
    void refreshSession.mutateAsync({ data: {} })
      .then(() => queryClient.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() }))
      .catch(() => undefined);
  }, [current.isError, authErrorStatus, refreshSession.isPending, refreshSession.mutateAsync, queryClient]);
  useEffect(() => { if (role === 'customer') setLocation('/account'); }, [role, setLocation]);

  async function api(path: string, options: RequestInit = {}) {
    const response = await fetch(`/api${path}`, { ...options, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...options.headers } });
    return parseResponse(response);
  }
  async function loadShipments() {
    setListLoading(true); setListError('');
    try { const result = await api('/admin/shipments'); setShipments(Array.isArray(result.data.shipments) ? result.data.shipments : []); }
    catch (requestError) { setListError(requestError instanceof Error ? requestError.message : 'Unable to load asset movements.'); }
    finally { setListLoading(false); }
  }
  useEffect(() => { if (isStaff) void loadShipments(); }, [role]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoginError(''); setBusyAction('login');
    const fields = new FormData(event.currentTarget);
    try {
      const response = await loginMutation.mutateAsync({ data: { email: String(fields.get('email') || ''), password: String(fields.get('password') || '') } });
      await queryClient.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });
      if (response.data.user.role === 'customer') setLocation('/account');
    } catch (requestError) { setLoginError(requestError instanceof Error ? requestError.message : 'Authentication failed'); }
    finally { setBusyAction(''); }
  }
  async function createShipment(event: FormEvent<HTMLFormElement>) {
    if (!canOperate) return;
    event.preventDefault(); setBusyAction('create'); setCreateMessage('');
    const form = event.currentTarget; const fields = new FormData(form);
    try {
      const result = await api('/admin/shipments', { method: 'POST', body: JSON.stringify({
        consignee_name: fields.get('consignee_name'), weight_kg: fields.get('weight_kg'), service_type: fields.get('service_type'),
        consignee_address: { city: fields.get('city'), country: fields.get('country') }, customer_id: fields.get('customer_id'),
      }) });
      setCreateMessage(`Created ${result.data.shipment.tracking_code} and assigned to customer`);
      form.reset(); await loadShipments();
    } catch (requestError) { setCreateMessage(requestError instanceof Error ? requestError.message : 'Unable to create asset movement.'); }
    finally { setBusyAction(''); }
  }
  async function performAction(path: string, method: string, payload: AnyRecord) {
    if (!selected || !canOperate) return;
    setBusyAction('action'); setActionOutput('');
    try { const result = await api(`/admin/shipments/${selected}${path}`, { method, body: JSON.stringify(payload) }); setActionOutput(JSON.stringify(result, null, 2)); await loadShipments(); }
    catch (requestError) { setActionOutput(requestError instanceof Error ? requestError.message : 'Request failed'); }
    finally { setBusyAction(''); }
  }
  async function signOut() {
    try { await logoutMutation.mutateAsync(); } finally {
      setShipments([]); setSelected(null); setActionOutput('');
      queryClient.clear();
      setLocation('/');
    }
  }

  if (current.isLoading || current.isFetching && !current.data) return <main className="app-shell"><BrandNav admin /><section className="panel loading-block" aria-label="Checking operator access" data-testid="status-operator-auth-loading"><div className="empty-skeleton" /><div className="empty-skeleton" /></section></main>;
  if (role === 'customer') return null;
  if (!isStaff) {
    return <main className="app-shell"><BrandNav /><section className="panel admin-login">
      <p className="eyebrow">Restricted network access</p><h1>Operator sign in</h1><p className="result-meta">The movement console is available only to approved operators and authorized staff.</p>
      <form className="login-form" onSubmit={login}>
        <label className="field-label" htmlFor="operator-email">Work email</label><input className="field" id="operator-email" name="email" type="email" placeholder="name@organization.com" required autoComplete="username" data-testid="input-email" />
        <label className="field-label" htmlFor="operator-password">Password</label><input className="field" id="operator-password" name="password" type="password" placeholder="Password" required autoComplete="current-password" data-testid="input-password" />
        <button className="button-primary" disabled={busyAction === 'login'} data-testid="button-authenticate">{busyAction === 'login' ? 'Authenticating…' : 'Authenticate'}</button>
      </form>
      {loginError && <p className="error-text" role="alert" data-testid="status-login-error">{loginError}</p>}
      <p className="result-meta">Customer access? <Link href="/login" className="text-link" data-testid="link-customer-signin">Use customer sign in</Link></p>
      <footer className="footer-note" style={{ marginTop: 28 }}>NEXVORA · Operator access</footer>
    </section></main>;
  }
  return (
    <main className="app-shell">
      <BrandNav admin onSignOut={() => void signOut()} />
      <section className="console">
        <div className="console-head"><div><p className="eyebrow">Network operations · {role}</p><h1 className="page-title">Asset movement console</h1></div><button className="button-quiet" type="button" onClick={() => void loadShipments()} disabled={listLoading} data-testid="button-refresh"><RefreshCw size={15} className={listLoading ? 'spin-icon' : ''} /> Refresh</button></div>
        <div className={canOperate ? 'console-grid' : 'console-grid console-grid-readonly'}>
          {canOperate && <article className="panel"><h2>Create asset movement</h2>
            <form className="create-form" onSubmit={createShipment}>
              <label className="field-label" htmlFor="consignee-name">Consignee name</label><input className="field" id="consignee-name" name="consignee_name" placeholder="Consignee name" required data-testid="input-consignee-name" />
              <label className="field-label" htmlFor="weight-kg">Weight (kg)</label><input className="field" id="weight-kg" name="weight_kg" type="number" min=".01" step=".01" placeholder="e.g. 12.5" required data-testid="input-weight-kg" />
              <label className="field-label" htmlFor="destination-city">Destination</label><div className="inline-form"><input className="field" id="destination-city" name="city" placeholder="City" data-testid="input-city" /><input className="field" name="country" maxLength={2} placeholder="Country code" aria-label="Country code" data-testid="input-country" /></div>
              <label className="field-label" htmlFor="service-type">Service level</label><select className="select-field" id="service-type" name="service_type" defaultValue="standard" data-testid="select-service-type"><option value="standard">Standard</option><option value="express">Express</option><option value="economy">Economy</option></select>
              <label className="field-label" htmlFor="customer-assignment">Assign customer</label>
              <select className="select-field" id="customer-assignment" name="customer_id" required defaultValue="" disabled={customersQuery.isLoading || customers.length === 0} data-testid="select-customer-assignment">
                <option value="" disabled>{customersQuery.isLoading ? 'Loading customer accounts…' : customers.length ? 'Choose a customer account' : 'No active customer accounts'}</option>
                {customers.map((customer: AnyRecord) => <option value={customer.id} key={customer.id}>{customer.email}</option>)}
              </select>
              {customersQuery.isError && <p className="error-text" role="alert" data-testid="status-customer-list-error">Customer accounts could not load. Try refreshing this page.</p>}
              {customers.length === 0 && !customersQuery.isLoading && !customersQuery.isError && <p className="result-meta">Create a customer account before assigning this shipment.</p>}
              <button className="button-primary" disabled={busyAction === 'create' || customers.length === 0} data-testid="button-create-shipment">{busyAction === 'create' ? 'Creating…' : 'Create and assign shipment'}</button>
            </form>
            {createMessage && <p className={createMessage.startsWith('Created ') ? 'result-meta' : 'error-text'} role="status" data-testid="status-create-result">{createMessage}</p>}
          </article>}
          <article className="panel map-panel"><h2>Network map</h2><div className="map-visual" id="map"><div className="map-copy"><strong>Aggregated active movements</strong><small>Exact locations remain protected.</small></div></div></article>
        </div>
        <section className="panel">
          <div className="section-head"><h2>Active asset movements</h2>{listLoading && <span className="result-meta">Updating network…</span>}</div>
          {listError ? <div role="alert"><p className="error-text" data-testid="status-shipments-error">{listError}</p><button className="button-quiet" type="button" onClick={() => void loadShipments()} data-testid="button-retry-admin-list">Retry</button></div>
            : listLoading && shipments.length === 0 ? <div aria-label="Loading asset movements"><div className="empty-skeleton" /><div className="empty-skeleton" /></div>
              : shipments.length === 0 ? <p className="empty-state">No asset movements yet. Create a shipment to start its verified journey.</p>
                 : <div className="table" id="shipments">{shipments.map((item) => <div className="shipment-row" key={item.id} data-testid={`row-shipment-${item.id}`}><strong className="tracking-code">{item.tracking_code}</strong><span className="badge">{String(item.status || '').replaceAll('_', ' ')}</span><span className="shipment-consignee">{item.consignee_name}</span>{canOperate && <button className="button-quiet" type="button" onClick={() => { setSelected(item.id); setSelectedCode(item.tracking_code); setActionOutput(''); }} data-testid={`button-control-${item.id}`}>Control</button>}</div>)}</div>}
        </section>
        {selected !== null && <section className="panel action-panel" id="action-panel"><div className="section-head"><h2>Manual override · {selectedCode}</h2><button className="button-quiet" type="button" onClick={() => { setSelected(null); setActionOutput(''); }} data-testid="button-close-control">Close</button></div>
          <form className="inline-form" onSubmit={(event) => { event.preventDefault(); const status = new FormData(event.currentTarget).get('new_status'); void performAction('/status', 'PATCH', { new_status: status }); }}>
            <select className="select-field" name="new_status" defaultValue="picked_up" aria-label="New shipment status" data-testid="select-new-status"><option value="picked_up">Picked up</option><option value="in_transit">In transit</option><option value="out_for_delivery">Out for delivery</option><option value="delivered">Delivered</option><option value="failed">Failed</option><option value="cancelled">Cancelled</option></select>
            <button className="button-primary" disabled={busyAction === 'action'} data-testid="button-apply-status">{busyAction === 'action' ? 'Applying…' : 'Apply status'}</button>
            <button className="button-quiet" type="button" disabled={busyAction === 'action'} onClick={() => void performAction('/simulate', 'POST', { scenario: 'international_demo' })} data-testid="button-simulate"><ArrowDownRight size={14} /> Run demo sequence</button>
          </form>
          <form className="inline-form" onSubmit={(event) => { event.preventDefault(); const fields = new FormData(event.currentTarget); void performAction('/location', 'PATCH', { lat: fields.get('lat'), lng: fields.get('lng') }); }}>
            <input className="field" name="lat" type="number" step="any" placeholder="Latitude" aria-label="Latitude" required data-testid="input-latitude" /><input className="field" name="lng" type="number" step="any" placeholder="Longitude" aria-label="Longitude" required data-testid="input-longitude" /><button className="button-primary" disabled={busyAction === 'action'} data-testid="button-set-location">{busyAction === 'action' ? 'Updating…' : 'Set verified location'}</button>
          </form>
          {actionOutput && <pre className="action-output" id="action-output" aria-live="polite" data-testid="status-action-output">{actionOutput}</pre>}
        </section>}
      </section>
      <footer className="footer-note">NEXVORA · Network operations</footer>
    </main>
  );
}

function Router() {
  return <ErrorBoundary><Switch>
    <Route path="/" component={TrackingPage} />
    <Route path="/signup"><AuthPage mode="signup" /></Route>
    <Route path="/login"><AuthPage mode="login" /></Route>
    <Route path="/forgot-password" component={ForgotPasswordPage} />
    <Route path="/account" component={AccountPage} />
    <Route path="/account/shipments/:id" component={CustomerShipmentPage} />
    <Route path="/pages/admin.html" component={AdminPage} />
    <Route component={NotFound} />
  </Switch></ErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;
