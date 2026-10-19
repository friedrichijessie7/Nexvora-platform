create extension if not exists pgcrypto;

do $$ begin
 create type app_role as enum ('superadmin','operator','viewer','customer');
exception when duplicate_object then null; end $$;
do $$ begin
 create type shipment_status as enum ('created','picked_up','in_transit','out_for_delivery','delivered','failed','cancelled');
exception when duplicate_object then null; end $$;

create table if not exists users (
 id uuid primary key default gen_random_uuid(), email text not null unique check (email = lower(email)), password_hash text not null,
 role app_role not null default 'customer', security_clearance text not null default 'standard', is_active boolean not null default true,
 failed_attempts integer not null default 0, locked_until timestamptz, last_login_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists facilities (
 id uuid primary key default gen_random_uuid(), code text not null unique, name text not null, type text not null default 'hub', city text, country text,
 latitude double precision not null check(latitude between -90 and 90), longitude double precision not null check(longitude between -180 and 180),
 created_by uuid references users(id), is_active boolean not null default true, created_at timestamptz not null default now()
);
create table if not exists shipments (
 id uuid primary key default gen_random_uuid(), tracking_code text not null unique, customer_id uuid references users(id), operator_id uuid references users(id), facility_id uuid references facilities(id),
 status shipment_status not null default 'created', status_changed_at timestamptz not null default now(), consignee_name text not null, consignee_email text,
 consignee_address_generalized text, weight_kg numeric(10,2) not null check(weight_kg > 0), service_type text not null default 'standard', security_flags jsonb not null default '[]', privacy_mode boolean not null default true,
 current_lat double precision check(current_lat between -90 and 90), current_lng double precision check(current_lng between -180 and 180), last_verified_at timestamptz,
 proof_of_delivery jsonb, delivered_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists tracking_events (
 id uuid primary key default gen_random_uuid(), shipment_id uuid not null references shipments(id), actor_id uuid references users(id), event_type text not null,
 status_from shipment_status, status_to shipment_status, facility_id uuid references facilities(id), facility_name text, latitude double precision, longitude double precision,
 public_message text, metadata jsonb not null default '{}', created_at timestamptz not null default now()
);
create table if not exists audit_logs (
 id uuid primary key default gen_random_uuid(), actor_id uuid not null references users(id), action text not null, target_table text not null, target_id uuid not null,
 action_before jsonb, action_after jsonb, ip_address inet, user_agent text, created_at timestamptz not null default now()
);
create index if not exists shipment_code_idx on shipments(tracking_code); create index if not exists event_shipment_idx on tracking_events(shipment_id,created_at); create index if not exists audit_target_idx on audit_logs(target_table,target_id,created_at desc);

-- Deny direct browser access by default. Server-side service-role operations are additionally protected by JWT/RBAC middleware.
alter table users enable row level security; alter table facilities enable row level security; alter table shipments enable row level security; alter table tracking_events enable row level security; alter table audit_logs enable row level security;
create policy "public_facility_summary" on facilities for select to anon using (is_active);
-- Public visibility must use the server endpoint, which whitelists non-sensitive fields; no anon shipment/event rows are exposed.
create policy "customer_own_shipments" on shipments for select to authenticated using (customer_id = auth.uid());
create policy "customer_own_events" on tracking_events for select to authenticated using (exists(select 1 from shipments s where s.id=shipment_id and s.customer_id=auth.uid()));
create policy "audit_superadmin_only" on audit_logs for select to authenticated using ((auth.jwt()->>'role')='superadmin');
-- Do not add UPDATE/DELETE policies for event/audit tables: these records are immutable at database level.
revoke update, delete on tracking_events, audit_logs from anon, authenticated;

-- Defense in depth: even privileged application mistakes cannot alter historical rows.
create or replace function reject_immutable_change() returns trigger language plpgsql as $$
begin
  raise exception 'Immutable ledger rows cannot be modified or deleted';
end; $$;
drop trigger if exists tracking_events_immutable on tracking_events;
create trigger tracking_events_immutable before update or delete on tracking_events for each row execute function reject_immutable_change();
drop trigger if exists audit_logs_immutable on audit_logs;
create trigger audit_logs_immutable before update or delete on audit_logs for each row execute function reject_immutable_change();
