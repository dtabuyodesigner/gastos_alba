-- =============================================================================
-- Gastos Alba — esquema inicial
--
-- Proyecto INDEPENDIENTE. Este SQL debe ejecutarse en un proyecto Supabase
-- propio de Gastos Alba, nunca sobre el proyecto de La Libreta de Marcos.
--
-- Principios que codifica este fichero:
--   * El dinero se guarda SIEMPRE en centimos enteros. Nunca float.
--   * dani_share_cents + other_share_cents = total_amount_cents (CHECK).
--   * Sin borrado destructivo: no hay politica DELETE y ademas se revoca.
--   * RLS activo en todas las tablas desde el minuto uno.
--   * Registrarse NO da acceso: hace falta un perfil activo.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Tipos
-- -----------------------------------------------------------------------------
do $$ begin
  create type public.user_role as enum ('alba', 'dani', 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.expense_status as enum ('pendiente', 'pagado', 'anulado');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.split_type as enum ('mitad', 'porcentaje');
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- updated_at automatico
-- -----------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 80),
  email        text,
  role         public.user_role not null default 'alba',
  -- Por defecto FALSE: crear una cuenta no da acceso a nada. Un admin activa.
  is_active    boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

create index if not exists profiles_role_idx on public.profiles (role) where is_active;

-- -----------------------------------------------------------------------------
-- Helpers de autorizacion
--
-- SECURITY DEFINER a proposito: las politicas de `profiles` necesitan consultar
-- `profiles`, y sin esto Postgres entraria en recursion infinita de RLS.
-- Son de solo lectura y no aceptan parametros del cliente.
-- -----------------------------------------------------------------------------
create or replace function public.is_active_member()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active
  );
$$;

create or replace function public.current_role_name()
returns public.user_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.role from public.profiles p
  where p.id = auth.uid() and p.is_active;
$$;

-- Solo Dani (o un admin) registra pagos.
create or replace function public.can_register_payment()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.current_role_name() in ('dani', 'admin');
$$;

-- -----------------------------------------------------------------------------
-- Alta de usuarios: se crea el perfil DESACTIVADO
--
-- El rol nunca se toma de los metadatos que envia el cliente: si se hiciera,
-- cualquiera podria darse de alta como 'admin'.
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, display_name, email, role, is_active)
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1)),
    new.email,
    'alba',
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- expenses
-- -----------------------------------------------------------------------------
create table if not exists public.expenses (
  id                   uuid primary key default gen_random_uuid(),
  created_by           uuid not null references public.profiles (id),
  expense_date         date not null,
  concept              text not null check (char_length(btrim(concept)) between 1 and 200),
  total_amount_cents   integer not null check (total_amount_cents > 0 and total_amount_cents <= 100000000),
  currency             text not null default 'EUR' check (currency = 'EUR'),
  dani_share_cents     integer not null check (dani_share_cents >= 0),
  other_share_cents    integer not null check (other_share_cents >= 0),
  dani_share_percent   numeric(5, 2) not null default 50 check (dani_share_percent between 0 and 100),
  other_share_percent  numeric(5, 2) not null default 50 check (other_share_percent between 0 and 100),
  split_type           public.split_type not null default 'mitad',
  status               public.expense_status not null default 'pendiente',
  notes                text check (notes is null or char_length(notes) <= 1000),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  voided_at            timestamptz,
  -- Invariantes de dinero: el reparto SIEMPRE cuadra con el total.
  constraint expenses_shares_match_total
    check (dani_share_cents + other_share_cents = total_amount_cents),
  constraint expenses_percents_match
    check (dani_share_percent + other_share_percent = 100),
  constraint expenses_voided_consistency
    check ((status = 'anulado') = (voided_at is not null)),
  -- No se aceptan tickets con fecha futura absurda (margen de 1 dia por husos horarios).
  constraint expenses_date_not_future
    check (expense_date <= (current_date + 1))
);

drop trigger if exists expenses_touch_updated_at on public.expenses;
create trigger expenses_touch_updated_at
  before update on public.expenses
  for each row execute function public.touch_updated_at();

create index if not exists expenses_status_date_idx on public.expenses (status, expense_date desc);
create index if not exists expenses_created_by_idx on public.expenses (created_by);
create index if not exists expenses_date_idx on public.expenses (expense_date desc);

-- -----------------------------------------------------------------------------
-- Guardia de actualizacion de gastos
--
-- Impide que el cliente cambie a mano el estado o la autoria. Los cambios de
-- estado solo se permiten dentro de register_payment() / void_expense(), que
-- activan una marca local de transaccion antes de tocar la fila.
-- -----------------------------------------------------------------------------
create or replace function public.expenses_guard_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.created_by is distinct from new.created_by then
    raise exception 'La autoria de un gasto no se puede cambiar.' using errcode = '42501';
  end if;
  if old.created_at is distinct from new.created_at then
    raise exception 'created_at no se puede cambiar.' using errcode = '42501';
  end if;

  if old.status = 'anulado' and new.status = 'anulado' then
    raise exception 'Un gasto anulado no se puede modificar.' using errcode = '42501';
  end if;

  if (old.status is distinct from new.status or old.voided_at is distinct from new.voided_at)
     and coalesce(current_setting('app.allow_status_change', true), 'off') <> 'on' then
    raise exception 'El estado solo se cambia registrando un pago o anulando el gasto.' using errcode = '42501';
  end if;

  -- Un gasto ya pagado no cambia de importe: el pago registrado dejaria de cuadrar.
  if old.status = 'pagado'
     and coalesce(current_setting('app.allow_status_change', true), 'off') <> 'on'
     and (old.total_amount_cents is distinct from new.total_amount_cents
          or old.dani_share_cents is distinct from new.dani_share_cents) then
    raise exception 'No se puede cambiar el importe de un gasto ya pagado.' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists expenses_guard on public.expenses;
create trigger expenses_guard
  before update on public.expenses
  for each row execute function public.expenses_guard_update();

-- -----------------------------------------------------------------------------
-- expense_photos — metadatos de las fotos del bucket PRIVADO
-- -----------------------------------------------------------------------------
create table if not exists public.expense_photos (
  id                uuid primary key default gen_random_uuid(),
  expense_id        uuid not null references public.expenses (id) on delete cascade,
  storage_path      text not null unique check (char_length(storage_path) between 1 and 500),
  original_filename text check (original_filename is null or char_length(original_filename) <= 255),
  mime_type         text,
  size_bytes        bigint check (size_bytes is null or size_bytes >= 0),
  uploaded_by       uuid not null references public.profiles (id),
  created_at        timestamptz not null default now()
);

create index if not exists expense_photos_expense_idx on public.expense_photos (expense_id);

-- -----------------------------------------------------------------------------
-- payments / payment_expenses — un pago puede cubrir varios tickets
-- -----------------------------------------------------------------------------
create table if not exists public.payments (
  id           uuid primary key default gen_random_uuid(),
  paid_by      uuid not null references public.profiles (id),
  paid_at      timestamptz not null default now(),
  amount_cents integer not null check (amount_cents > 0),
  method       text check (method is null or char_length(method) <= 60),
  notes        text check (notes is null or char_length(notes) <= 1000),
  created_at   timestamptz not null default now()
);

create index if not exists payments_paid_at_idx on public.payments (paid_at desc);

create table if not exists public.payment_expenses (
  payment_id           uuid not null references public.payments (id) on delete cascade,
  expense_id           uuid not null references public.expenses (id),
  amount_applied_cents integer not null check (amount_applied_cents > 0),
  primary key (payment_id, expense_id)
);

create index if not exists payment_expenses_expense_idx on public.payment_expenses (expense_id);

-- -----------------------------------------------------------------------------
-- register_payment — pago (agrupado o individual) en UNA transaccion
-- -----------------------------------------------------------------------------
create or replace function public.register_payment(
  p_expense_ids uuid[],
  p_method      text        default null,
  p_notes       text        default null,
  p_paid_at     timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids        uuid[];
  v_payment_id uuid;
  v_total      integer;
  v_count      integer;
begin
  if not public.can_register_payment() then
    raise exception 'Solo Dani o un administrador pueden registrar pagos.' using errcode = '42501';
  end if;

  select array_agg(distinct t.id) into v_ids
  from unnest(coalesce(p_expense_ids, '{}'::uuid[])) as t(id)
  where t.id is not null;

  if v_ids is null or cardinality(v_ids) = 0 then
    raise exception 'No se ha indicado ningun ticket.' using errcode = '22023';
  end if;
  if cardinality(v_ids) > 200 then
    raise exception 'Demasiados tickets en un mismo pago.' using errcode = '22023';
  end if;

  -- Bloqueo de las filas para que dos pagos simultaneos no cubran el mismo ticket.
  perform 1 from public.expenses where id = any (v_ids) for update;

  select coalesce(sum(e.dani_share_cents), 0), count(*)
    into v_total, v_count
  from public.expenses e
  where e.id = any (v_ids) and e.status = 'pendiente';

  if v_count <> cardinality(v_ids) then
    raise exception 'Algun ticket no existe o ya no esta pendiente.' using errcode = '22023';
  end if;
  if v_total <= 0 then
    raise exception 'El importe del pago debe ser mayor que cero.' using errcode = '22023';
  end if;

  insert into public.payments (paid_by, paid_at, amount_cents, method, notes)
  values (
    auth.uid(),
    coalesce(p_paid_at, now()),
    v_total,
    nullif(btrim(coalesce(p_method, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), '')
  )
  returning id into v_payment_id;

  insert into public.payment_expenses (payment_id, expense_id, amount_applied_cents)
  select v_payment_id, e.id, e.dani_share_cents
  from public.expenses e
  where e.id = any (v_ids);

  perform set_config('app.allow_status_change', 'on', true);
  update public.expenses set status = 'pagado' where id = any (v_ids);
  perform set_config('app.allow_status_change', 'off', true);

  return v_payment_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- void_expense — anulacion logica. NUNCA se borra fisicamente.
-- -----------------------------------------------------------------------------
create or replace function public.void_expense(p_expense_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_expense public.expenses%rowtype;
  v_role    public.user_role;
begin
  v_role := public.current_role_name();
  if v_role is null then
    raise exception 'Sin permiso.' using errcode = '42501';
  end if;

  select * into v_expense from public.expenses where id = p_expense_id for update;
  if not found then
    raise exception 'El ticket no existe.' using errcode = '22023';
  end if;

  if v_expense.status = 'anulado' then
    return; -- idempotente
  end if;
  if v_expense.status = 'pagado' then
    raise exception 'Un ticket ya pagado no se puede anular.' using errcode = '22023';
  end if;

  if v_role not in ('dani', 'admin') and v_expense.created_by <> auth.uid() then
    raise exception 'Solo puedes anular tus propios tickets.' using errcode = '42501';
  end if;

  perform set_config('app.allow_status_change', 'on', true);
  update public.expenses
     set status = 'anulado', voided_at = now()
   where id = p_expense_id;
  perform set_config('app.allow_status_change', 'off', true);
end;
$$;
