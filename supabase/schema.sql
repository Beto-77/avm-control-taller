create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text not null,
  role text not null default 'tecnico' check (role in ('admin', 'tecnico')),
  created_at timestamptz not null default now()
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  legacy_key text unique,
  legacy_customer_number text,
  full_name text,
  phone text,
  motorcycle text,
  plate text,
  last_visit date,
  customer_type text,
  source_row integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.work_orders (
  id uuid primary key default gen_random_uuid(),
  source_key text unique,
  order_number text,
  received_date date,
  weekday text,
  customer_id uuid references public.customers (id) on delete set null,
  customer_name text,
  phone text,
  motorcycle text,
  plate text,
  helmet text,
  repair_description text,
  location text,
  technician_name text,
  assigned_to uuid references public.profiles (id) on delete set null,
  status text,
  pickup_date date,
  parts_description text,
  parts_cost numeric(12, 2) not null default 0,
  advance numeric(12, 2) not null default 0,
  total_paid numeric(12, 2) not null default 0,
  net_profit numeric(12, 2) not null default 0,
  payment_status text,
  observations text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists work_orders_assigned_to_idx on public.work_orders (assigned_to);
create index if not exists work_orders_status_idx on public.work_orders (status);
create index if not exists work_orders_received_date_idx on public.work_orders (received_date desc);
create index if not exists work_orders_customer_id_idx on public.work_orders (customer_id);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

create or replace function public.is_tecnico()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'tecnico'
  );
$$;

create or replace function public.technician_can_view_customer(target_customer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select exists (
    select 1 from public.work_orders
    where customer_id = target_customer_id
      and assigned_to = (select auth.uid())
  );
$$;

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, email, display_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(coalesce(new.email, ''), '@', 1)),
    'tecnico'
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.create_profile_for_new_user();

create or replace function public.prevent_last_admin_removal()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if old.role = 'admin' then
    if tg_op = 'DELETE' then
      if (select count(*) from public.profiles where role = 'admin') <= 1 then
        raise exception 'No se puede quitar el último Administrador.';
      end if;
      return old;
    elsif new.role <> 'admin'
      and (select count(*) from public.profiles where role = 'admin') <= 1 then
      raise exception 'No se puede quitar el último Administrador.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_last_admin on public.profiles;
create trigger protect_last_admin
  before update of role or delete on public.profiles
  for each row execute function public.prevent_last_admin_removal();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists customers_set_updated_at on public.customers;
create trigger customers_set_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

drop trigger if exists work_orders_set_updated_at on public.work_orders;
create trigger work_orders_set_updated_at
  before update on public.work_orders
  for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.customers enable row level security;
alter table public.work_orders enable row level security;

drop policy if exists "profiles_read_self_or_admin" on public.profiles;
create policy "profiles_read_self_or_admin"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "profiles_admin_insert" on public.profiles;
create policy "profiles_admin_insert"
  on public.profiles for insert to authenticated
  with check ((select public.is_admin()));

drop policy if exists "profiles_admin_update" on public.profiles;
create policy "profiles_admin_update"
  on public.profiles for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "profiles_admin_delete" on public.profiles;
create policy "profiles_admin_delete"
  on public.profiles for delete to authenticated
  using ((select public.is_admin()));

drop policy if exists "customers_admin_all" on public.customers;
create policy "customers_admin_all"
  on public.customers for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "customers_technician_read_assigned" on public.customers;
create policy "customers_technician_read_assigned"
  on public.customers for select to authenticated
  using (
    (select public.is_tecnico())
    and (select public.technician_can_view_customer(customers.id))
  );

drop policy if exists "work_orders_admin_all" on public.work_orders;
create policy "work_orders_admin_all"
  on public.work_orders for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "work_orders_technician_read_assigned" on public.work_orders;

create or replace view public.technician_work_orders with (security_barrier = true) as
  select
    id, source_key, order_number, received_date, weekday, customer_id,
    customer_name, phone, motorcycle, plate, helmet, repair_description,
    location, technician_name, assigned_to, status, pickup_date,
    parts_description, observations, created_at, updated_at
  from public.work_orders
  where assigned_to = (select auth.uid())
    and (select public.is_tecnico());

grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_tecnico() to authenticated;
grant execute on function public.technician_can_view_customer(uuid) to authenticated;
revoke all on function public.is_admin() from public, anon;
revoke all on function public.is_tecnico() from public, anon;
revoke all on function public.technician_can_view_customer(uuid) from public, anon;
revoke all on function public.create_profile_for_new_user() from public, anon, authenticated;
revoke all on function public.prevent_last_admin_removal() from public, anon, authenticated;
revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on public.profiles, public.customers, public.work_orders from public, anon;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.customers to authenticated;
grant select, insert, update, delete on public.work_orders to authenticated;
revoke all on public.technician_work_orders from public, anon;
grant select on public.technician_work_orders to authenticated;
