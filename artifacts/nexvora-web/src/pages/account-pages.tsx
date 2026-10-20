import { useEffect, useRef, type ReactNode } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { ArrowLeft, ArrowUpRight, Box, RefreshCw } from 'lucide-react';
import { useGetCurrentUser, useGetCustomerShipment, useListCustomerShipments, useLogout, useRefreshSession, getGetCurrentUserQueryKey, getGetCustomerShipmentQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';

function AccountNav({ email }: { email?: string }) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const logout = useLogout();
  async function signOut() {
    try { await logout.mutateAsync(); } finally {
      queryClient.clear();
      setLocation('/');
    }
  }
  return (
    <nav className="top-nav" aria-label="Account navigation">
      <Link href="/account" className="brand" aria-label="FedEx account home" data-testid="link-account-home">FedEx<span className="brand-mark">.</span></Link>
      <div className="admin-nav-actions">
        {email && <span className="account-toolbar" data-testid="text-account-email">{email}</span>}
        <button className="button-quiet" type="button" onClick={() => void signOut()} disabled={logout.isPending} data-testid="button-customer-logout">{logout.isPending ? 'Signing out…' : 'Sign out'}</button>
      </div>
    </nav>
  );
}

function useCustomerSession() {
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const current = useGetCurrentUser({ query: { retry: false, queryKey: getGetCurrentUserQueryKey() } });
  const refresh = useRefreshSession();
  const attempted = useRef(false);
  const authErrorStatus = (current.error as { status?: number } | null)?.status;
  useEffect(() => {
    if (current.isError && authErrorStatus === 401 && !attempted.current && !refresh.isPending) {
      attempted.current = true;
      void refresh.mutateAsync({ data: {} })
        .then(() => queryClient.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() }))
        .catch(() => setLocation('/login'));
    }
  }, [current.isError, authErrorStatus, refresh.isPending, refresh.mutateAsync, queryClient, setLocation]);
  useEffect(() => {
    const role = current.data?.data?.user?.role;
    if (role && role !== 'customer') setLocation('/pages/admin.html');
  }, [current.data, setLocation]);
  return {
    current,
    ready: !!current.data?.data?.user && current.data.data.user.role === 'customer',
    unavailable: current.isError && authErrorStatus !== 401,
  };
}

function CustomerSessionGate({ unavailable, retry }: { unavailable: boolean; retry: () => void }) {
  return (
    <main className="app-shell">
      <nav className="top-nav"><Link href="/" className="brand" aria-label="FedEx home">FedEx<span className="brand-mark">.</span></Link></nav>
      {unavailable ? (
        <section className="panel loading-block" role="alert" data-testid="status-account-session-error">
          <p className="eyebrow">Account connection</p>
          <h1 className="page-title">Your account could not be verified.</h1>
          <p className="result-meta">Please check your connection, then try again.</p>
          <button className="button-primary" type="button" onClick={retry} data-testid="button-retry-account-session">Try again</button>
        </section>
      ) : (
        <section className="panel loading-block" aria-label="Loading customer account" data-testid="status-account-loading"><div className="empty-skeleton" /><div className="empty-skeleton" /></section>
      )}
    </main>
  );
}

function CustomerFrame({ email, children }: { email?: string; children: ReactNode }) {
  return <main className="app-shell"><AccountNav email={email} />{children}<footer className="footer-note">FedEx · Customer shipment visibility</footer></main>;
}

function dateLabel(value?: string | null) {
  if (!value) return 'Not yet verified';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
function readable(value?: string | null) {
  return (value || 'pending').replaceAll('_', ' ');
}

export function AccountPage() {
  const session = useCustomerSession();
  if (!session.ready) return <CustomerSessionGate unavailable={session.unavailable} retry={() => void session.current.refetch()} />;
  return <CustomerFrame email={session.current.data?.data?.user?.email}><CustomerShipmentList /></CustomerFrame>;
}

function CustomerShipmentList() {
  const shipmentsQuery = useListCustomerShipments();
  const shipments = shipmentsQuery.data?.data?.shipments ?? [];
  return (
      <section className="account-main">
        <div className="account-head">
          <div><p className="eyebrow">Your account · Assigned shipments</p><h1>In your care.</h1></div>
          <div className="account-toolbar"><span>{shipments.length} {shipments.length === 1 ? 'shipment' : 'shipments'}</span><Link href="/" className="button-quiet" data-testid="link-public-tracking">Track a code</Link></div>
        </div>
        {shipmentsQuery.isLoading ? (
          <section className="panel loading-block" aria-label="Loading assigned shipments" data-testid="status-shipments-loading"><div className="empty-skeleton" /><div className="empty-skeleton" /><div className="empty-skeleton" /></section>
        ) : shipmentsQuery.isError ? (
          <section className="panel" role="alert" data-testid="status-customer-shipments-error"><p className="error-text">Assigned shipments could not be loaded. Please check your connection and try again.</p><button className="button-quiet" type="button" onClick={() => void shipmentsQuery.refetch()} data-testid="button-retry-shipments">Retry</button></section>
        ) : shipments.length === 0 ? (
          <section className="panel empty-card" data-testid="empty-customer-shipments"><Box size={25} color="#287a68" /><h2>No shipments assigned yet</h2><p>When a shipment is assigned to your account, its verified progress will appear here.</p></section>
        ) : (
          <div className="shipment-list" data-testid="list-customer-shipments">
            {shipments.map((shipment) => (
              <Link href={`/account/shipments/${encodeURIComponent(shipment.id)}`} className="customer-shipment" key={shipment.id} data-testid={`card-customer-shipment-${shipment.id}`}>
                <div><span className="fact-label">Visibility code</span><h2>{shipment.tracking_code}</h2></div>
                <span className="shipment-recipient">{shipment.consignee_name}</span>
                <span className="shipment-destination">{shipment.consignee_address_generalized || shipment.service_type}</span>
                <span className="status-pill">{readable(shipment.status)}</span>
                <span className="result-meta shipment-date" style={{ margin: 0 }}>Updated {dateLabel(shipment.status_changed_at)}</span>
                <ArrowUpRight size={17} aria-hidden="true" color="#68847b" />
              </Link>
            ))}
          </div>
        )}
      </section>
  );
}

export function CustomerShipmentPage() {
  const session = useCustomerSession();
  const params = useParams<{ id: string }>();
  const id = params.id || '';
  if (!session.ready) return <CustomerSessionGate unavailable={session.unavailable} retry={() => void session.current.refetch()} />;
  return <CustomerFrame email={session.current.data?.data?.user?.email}><CustomerShipmentContent id={id} /></CustomerFrame>;
}

function CustomerShipmentContent({ id }: { id: string }) {
  const shipmentQuery = useGetCustomerShipment(id, { query: { enabled: !!id, queryKey: getGetCustomerShipmentQueryKey(id) } });
  const result = shipmentQuery.data?.data;
  const shipment = result?.shipment;
  const events = result?.events ?? [];
  return (
      <section className="account-main">
        <Link href="/account" className="back-link" data-testid="link-back-shipments"><ArrowLeft size={15} /> All assigned shipments</Link>
        {shipmentQuery.isLoading ? <section className="panel loading-block" aria-label="Loading shipment detail" data-testid="status-shipment-detail-loading"><div className="empty-skeleton" /><div className="empty-skeleton" /></section>
          : shipmentQuery.isError ? <section className="panel" role="alert" data-testid="status-shipment-detail-error"><p className="error-text">This shipment could not be loaded from your assigned shipments. It may no longer be available to this account.</p><Link href="/account" className="button-quiet" data-testid="link-return-account">Return to your shipments</Link></section>
            : shipment ? <>
              <div className="account-head">
                <div><p className="eyebrow">Shipment detail · {shipment.service_type}</p><h1>{shipment.consignee_name}</h1><p className="result-meta" data-testid="text-shipment-address">{shipment.consignee_address_generalized || 'Destination details protected'}</p></div>
                <span className="status-pill" data-testid="status-private-shipment">{readable(shipment.status)}</span>
              </div>
              <section className="panel" data-testid="panel-shipment-summary">
                <div className="result-heading"><div><p className="eyebrow">Visibility code</p><h2 data-testid="text-private-tracking-code">{shipment.tracking_code}</h2></div><div className="account-toolbar"><RefreshCw size={14} /> Verified {dateLabel(shipment.last_verified_at)}</div></div>
                <div className="shipment-facts">
                  <div><span className="fact-label">Service</span><span className="fact-value">{shipment.service_type}</span></div>
                  <div><span className="fact-label">Shipment weight</span><span className="fact-value">{shipment.weight_kg} kg</span></div>
                  <div><span className="fact-label">Shipment created</span><span className="fact-value">{dateLabel(shipment.created_at)}</span></div>
                  <div><span className="fact-label">Status changed</span><span className="fact-value">{dateLabel(shipment.status_changed_at)}</span></div>
                </div>
              </section>
              <div className="shipment-detail-grid">
                <section className="panel"><div className="section-head"><h2>Movement history</h2><span className="result-meta" style={{ margin: 0 }}>{events.length} updates</span></div>
                  {events.length ? <ul className="timeline">{events.map((event, index) => <li key={event.id} data-testid={`private-event-${event.id || index}`}><div className="event-title">{readable(event.status_to || event.event_type)}</div><div className="event-detail">{event.public_message || event.facility_name || 'Movement verified'} · {dateLabel(event.created_at)}</div></li>)}</ul> : <p className="empty-state">Movement history will appear as this shipment is verified.</p>}
                </section>
                <section className="panel"><p className="eyebrow">Visibility standard</p><h2>Confirmed, not assumed.</h2><p className="result-meta">Updates are shown when a movement is recorded and verified. Location details may be generalized to protect operational security.</p></section>
              </div>
            </> : null}
      </section>
  );
}
