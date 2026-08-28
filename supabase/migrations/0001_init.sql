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

-- Como se hizo el pago FUERA de la aplicacion. Es una etiqueta de registro y
-- nada mas: aqui no se mueve dinero, no hay integracion con Bizum ni con ningun
-- banco, y no se guarda ningun dato bancario.
do $$ begin
  create type public.payment_method as enum ('bizum', 'transferencia', 'efectivo', 'otro');
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
  created_at        timestamptz not null default now(),
  -- Si Alba se equivoca de foto puede sustituirla, pero la anterior NO se borra:
  -- se queda aqui y en el bucket, marcada con quien y cuando la reemplazo.
  -- Una foto con `replaced_at` puesto deja de ser la vigente del ticket.
  replaced_at       timestamptz,
  replaced_by       uuid references public.profiles (id),
  constraint expense_photos_replaced_consistency
    check ((replaced_at is null) = (replaced_by is null))
);

create index if not exists expense_photos_expense_idx on public.expense_photos (expense_id);

-- Un ticket tiene como mucho UNA foto vigente. El invariante vive aqui y no en
-- la aplicacion: asi no depende de que la funcion de sustitucion sea correcta.
create unique index if not exists expense_photos_one_current_idx
  on public.expense_photos (expense_id) where replaced_at is null;

-- De una foto solo puede marcarse que ha sido reemplazada, y solo una vez. El
-- resto de columnas son inmutables: un justificante no se reescribe.
create or replace function public.expense_photos_guard_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if (to_jsonb(new) - 'replaced_at' - 'replaced_by')
     is distinct from (to_jsonb(old) - 'replaced_at' - 'replaced_by') then
    raise exception 'De una foto solo se puede marcar que ha sido reemplazada.' using errcode = '42501';
  end if;
  if old.replaced_at is not null then
    raise exception 'Una foto ya reemplazada no vuelve a cambiar.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists expense_photos_guard on public.expense_photos;
create trigger expense_photos_guard
  before update on public.expense_photos
  for each row execute function public.expense_photos_guard_update();

-- -----------------------------------------------------------------------------
-- assert_ticket_photo — la regla del justificante, en un unico sitio
--
-- La usan create_expense() y replace_expense_photo(). Esta extraida a proposito:
-- si cada una llevara su propia copia, bastaria con que uno de los dos caminos
-- se quedara atras para poder colar un ticket con una foto que no existe.
--
-- Uso interno: no se concede EXECUTE a nadie.
-- -----------------------------------------------------------------------------
create or replace function public.assert_ticket_photo(p_expense_id uuid, p_storage_path text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_path text;
begin
  v_path := nullif(btrim(coalesce(p_storage_path, '')), '');
  if v_path is null then
    raise exception 'Un ticket necesita la foto del justificante.' using errcode = '22023';
  end if;
  if p_expense_id is null then
    raise exception 'Falta el identificador del ticket.' using errcode = '22023';
  end if;

  -- La ruta sigue la convencion {id-del-gasto}/{fichero}. Sin esto se podria
  -- enlazar como justificante la foto de otro ticket.
  if v_path not like (p_expense_id::text || '/%') then
    raise exception 'La ruta de la foto no corresponde a este ticket.' using errcode = '22023';
  end if;

  -- Y la foto tiene que EXISTIR de verdad y haberla subido quien esta actuando.
  -- Sin esta comprobacion bastaria con inventarse una ruta para tener un ticket
  -- con metadatos de foto pero sin foto.
  --
  -- El nombre del bucket va fijo: debe coincidir con 0003_storage.sql y con
  -- VITE_SUPABASE_TICKETS_BUCKET en el cliente.
  if not exists (
    select 1
      from storage.objects o
     where o.bucket_id = 'tickets'
       and o.name = v_path
       and o.owner = auth.uid()
  ) then
    raise exception 'La foto del ticket no existe o no la has subido tu.' using errcode = '22023';
  end if;

  return v_path;
end;
$$;

-- -----------------------------------------------------------------------------
-- replace_expense_photo — sustituir la foto sin borrar la anterior
--
-- Solo en tickets PENDIENTES: una vez pagado o anulado, el justificante forma
-- parte del acuerdo y no se toca. La foto anterior se conserva en la tabla y en
-- el bucket, marcada con `replaced_at` y `replaced_by`, coherente con el "sin
-- borrado destructivo" del resto del proyecto.
-- -----------------------------------------------------------------------------
create or replace function public.replace_expense_photo(
  p_expense_id        uuid,
  p_storage_path      text,
  p_original_filename text   default null,
  p_mime_type         text   default null,
  p_size_bytes        bigint default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_expense  public.expenses%rowtype;
  v_role     public.user_role;
  v_path     text;
  v_photo_id uuid;
begin
  v_role := public.current_role_name();
  if v_role is null then
    raise exception 'Sin permiso.' using errcode = '42501';
  end if;

  select * into v_expense from public.expenses where id = p_expense_id for update;
  if not found then
    raise exception 'El ticket no existe.' using errcode = '22023';
  end if;

  if v_expense.status <> 'pendiente' then
    raise exception 'Solo se puede cambiar la foto de un ticket pendiente.' using errcode = '22023';
  end if;

  -- Mismo criterio que para editar el gasto: Dani y admin, cualquiera;
  -- quien lo subio, el suyo.
  if v_role not in ('dani', 'admin') and v_expense.created_by <> auth.uid() then
    raise exception 'Solo puedes cambiar la foto de tus propios tickets.' using errcode = '42501';
  end if;

  v_path := public.assert_ticket_photo(p_expense_id, p_storage_path);

  -- La anterior NO se borra: deja de ser la vigente y se queda como historico.
  update public.expense_photos
     set replaced_at = now(),
         replaced_by = auth.uid()
   where expense_id = p_expense_id
     and replaced_at is null;

  insert into public.expense_photos (
    expense_id, storage_path, original_filename, mime_type, size_bytes, uploaded_by
  )
  values (
    p_expense_id, v_path, left(nullif(btrim(coalesce(p_original_filename, '')), ''), 255),
    nullif(btrim(coalesce(p_mime_type, '')), ''), p_size_bytes, auth.uid()
  )
  returning id into v_photo_id;

  return v_photo_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- payments / payment_expenses — un pago puede cubrir varios tickets
-- -----------------------------------------------------------------------------
create table if not exists public.payments (
  id           uuid primary key default gen_random_uuid(),
  paid_by      uuid not null references public.profiles (id),
  paid_at      timestamptz not null default now(),
  amount_cents integer not null check (amount_cents > 0),
  -- Obligatorio: un historico de pagos sin saber como se pagaron sirve de poco.
  -- Los tickets con 0% para Dani no llegan a crear una fila aqui, asi que no
  -- necesitan metodo.
  method       public.payment_method not null,
  notes        text check (notes is null or char_length(notes) <= 1000),
  created_at   timestamptz not null default now(),
  -- Deshacer un pago no lo borra: se marca aqui y los tickets que cubria
  -- vuelven a pendiente. El importe, el metodo, las notas y las relaciones se
  -- conservan intactos, porque el pago ocurrio y forma parte del historico.
  voided_at    timestamptz,
  voided_by    uuid references public.profiles (id),
  void_reason  text constraint payments_void_reason_length
                 check (void_reason is null or char_length(void_reason) <= 500),
  constraint payments_voided_consistency
    check ((voided_at is null) = (voided_by is null))
);

create index if not exists payments_paid_at_idx on public.payments (paid_at desc);
create index if not exists payments_active_idx on public.payments (paid_at desc) where voided_at is null;

-- De un pago solo puede marcarse que se ha deshecho, y una sola vez. El importe,
-- el metodo y la fecha son inmutables: reescribirlos falsearia el historico.
create or replace function public.payments_guard_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if (to_jsonb(new) - 'voided_at' - 'voided_by' - 'void_reason')
     is distinct from (to_jsonb(old) - 'voided_at' - 'voided_by' - 'void_reason') then
    raise exception 'De un pago solo se puede marcar que ha sido deshecho.' using errcode = '42501';
  end if;
  if old.voided_at is not null then
    raise exception 'Un pago ya deshecho no vuelve a cambiar.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists payments_guard on public.payments;
create trigger payments_guard
  before update on public.payments
  for each row execute function public.payments_guard_update();

create table if not exists public.payment_expenses (
  payment_id           uuid not null references public.payments (id) on delete cascade,
  expense_id           uuid not null references public.expenses (id),
  -- Puede ser 0: un ticket reparte 0% a Dani y aun asi queda cubierto por el pago.
  amount_applied_cents integer not null check (amount_applied_cents >= 0),
  primary key (payment_id, expense_id)
);

create index if not exists payment_expenses_expense_idx on public.payment_expenses (expense_id);

-- =============================================================================
-- Notificaciones dentro de la aplicacion
--
-- Alcance deliberado (ver docs/DECISIONES.md): el aviso vive DENTRO de la app.
-- Nada de email, WhatsApp ni Telegram. El push del navegador queda preparado
-- pero NO operativo: falta configurarlo (ver "Push" en BOOTSTRAP.md).
--
-- Las notificaciones no las crea nunca el cliente: se generan dentro de
-- create_expense() y register_payment(), que ya son SECURITY DEFINER.
-- =============================================================================

do $$ begin
  create type public.notification_type as enum ('ticket_created', 'payment_registered', 'payment_voided');
exception when duplicate_object then null; end $$;

-- Importe en formato espanol para el texto del aviso: 1235 -> "12,35 €".
-- Sin separador de miles a proposito: en un ticket domestico no aporta, y
-- to_char depende de la configuracion regional del servidor.
create or replace function public.format_cents_es(p_cents integer)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case when p_cents < 0 then '-' else '' end
      || (abs(p_cents) / 100)::text
      || ','
      || lpad((abs(p_cents) % 100)::text, 2, '0')
      || ' €';
$$;

-- "por Bizum", "en efectivo"… La preposicion va en la etiqueta para que la
-- frase del aviso se lea bien sin encadenar casos en cada sitio que la use.
create or replace function public.payment_method_phrase(p_method public.payment_method)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case p_method
    when 'bizum'         then 'por Bizum'
    when 'transferencia' then 'por transferencia'
    when 'efectivo'      then 'en efectivo'
    else 'por otro medio'
  end;
$$;

create table if not exists public.notifications (
  id                   uuid primary key default gen_random_uuid(),
  recipient_profile_id uuid not null references public.profiles (id) on delete cascade,
  -- Quien lo provoco. Nullable porque un aviso futuro podria no tener autor.
  actor_profile_id     uuid references public.profiles (id),
  type                 public.notification_type not null,
  title                text not null check (char_length(btrim(title)) between 1 and 200),
  body                 text not null check (char_length(btrim(body)) between 1 and 500),
  expense_id           uuid references public.expenses (id),
  payment_id           uuid references public.payments (id),
  read_at              timestamptz,
  created_at           timestamptz not null default now()
);

create index if not exists notifications_inbox_idx
  on public.notifications (recipient_profile_id, created_at desc);
create index if not exists notifications_unread_idx
  on public.notifications (recipient_profile_id) where read_at is null;

-- De una notificacion solo se puede marcar que se ha leido. Ni el texto, ni el
-- destinatario, ni el enlace al gasto se pueden reescribir despues.
create or replace function public.notifications_guard_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if (to_jsonb(new) - 'read_at') is distinct from (to_jsonb(old) - 'read_at') then
    raise exception 'De una notificacion solo se puede cambiar si esta leida.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists notifications_guard on public.notifications;
create trigger notifications_guard
  before update on public.notifications
  for each row execute function public.notifications_guard_update();

-- -----------------------------------------------------------------------------
-- push_subscriptions — PREPARADO, NO OPERATIVO
--
-- La tabla existe para que el dia que se configure el push del navegador no
-- haya que migrar datos. Hoy NADA escribe aqui: faltan las claves VAPID, el
-- alta de la suscripcion desde el cliente y la funcion servidor que envie.
-- Ver docs/DECISIONES.md y el apartado "Push" de docs/supabase/BOOTSTRAP.md.
-- -----------------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  endpoint    text not null unique check (char_length(endpoint) between 1 and 1000),
  p256dh      text not null,
  auth        text not null,
  user_agent  text check (user_agent is null or char_length(user_agent) <= 400),
  created_at  timestamptz not null default now(),
  -- Baja logica, coherente con el resto del proyecto: no se borra, se desactiva.
  disabled_at timestamptz
);

create index if not exists push_subscriptions_profile_idx
  on public.push_subscriptions (profile_id) where disabled_at is null;

create or replace function public.push_subscriptions_guard_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.profile_id is distinct from new.profile_id
     or old.endpoint is distinct from new.endpoint
     or old.created_at is distinct from new.created_at then
    raise exception 'De una suscripcion solo se puede cambiar su estado.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists push_subscriptions_guard on public.push_subscriptions;
create trigger push_subscriptions_guard
  before update on public.push_subscriptions
  for each row execute function public.push_subscriptions_guard_update();

-- -----------------------------------------------------------------------------
-- notify_role — uso interno
--
-- No se concede EXECUTE a nadie: solo la llaman create_expense() y
-- register_payment(), que corren como su propietario. Asi el cliente no puede
-- fabricar avisos falsos.
-- -----------------------------------------------------------------------------
create or replace function public.notify_role(
  p_role       public.user_role,
  p_type       public.notification_type,
  p_title      text,
  p_body       text,
  p_expense_id uuid,
  p_payment_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  insert into public.notifications (
    recipient_profile_id, actor_profile_id, type, title, body, expense_id, payment_id
  )
  select p.id, auth.uid(), p_type,
         left(btrim(p_title), 200),
         left(btrim(p_body), 500),
         p_expense_id, p_payment_id
    from public.profiles p
   where p.role = p_role
     and p.is_active
     -- Nadie se avisa a si mismo de lo que acaba de hacer.
     and p.id is distinct from auth.uid();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Nombre visible de quien actua, para el texto del aviso.
create or replace function public.current_display_name()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select p.display_name from public.profiles p where p.id = auth.uid() and p.is_active),
    'Alguien'
  );
$$;

-- -----------------------------------------------------------------------------
-- Marcar avisos como leidos
--
-- Estas dos funciones son la UNICA via: el permiso de UPDATE sobre
-- `notifications` esta revocado (ver 0002_rls.sql). Por eso son SECURITY
-- DEFINER y comprueban ellas mismas lo que antes comprobaba la politica: que
-- quien llama tiene un perfil activo y que la notificacion es suya.
--
-- El filtro por `recipient_profile_id = auth.uid()` no es decorativo: sin el,
-- al ser DEFINER, se podrian marcar como leidos los avisos de la otra persona.
-- -----------------------------------------------------------------------------
create or replace function public.mark_notification_read(p_notification_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_active_member() then
    raise exception 'Sin permiso.' using errcode = '42501';
  end if;

  update public.notifications
     set read_at = coalesce(read_at, now())
   where id = p_notification_id
     and recipient_profile_id = auth.uid();
end;
$$;

create or replace function public.mark_all_notifications_read()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  if not public.is_active_member() then
    raise exception 'Sin permiso.' using errcode = '42501';
  end if;

  update public.notifications
     set read_at = now()
   where recipient_profile_id = auth.uid()
     and read_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- create_expense — alta de gasto y foto en UNA transaccion
--
-- Es la UNICA via para dar de alta un gasto: el permiso de INSERT directo sobre
-- `expenses` y `expense_photos` esta revocado (ver 0002_rls.sql). Por eso la
-- funcion es SECURITY DEFINER y hace ella misma las comprobaciones que antes
-- delegaba en las politicas: perfil activo y autoria forzada a auth.uid().
--
-- La foto del ticket es OBLIGATORIA en el MVP: un gasto sin justificante no se
-- puede dar de alta por ninguna via. Y no basta con recibir una ruta: la funcion
-- comprueba que el objeto EXISTE en Storage, que lo subio quien crea el gasto y
-- que su ruta corresponde a este ticket. De lo contrario, una llamada manual a
-- la RPC con una ruta inventada crearia un ticket cuyo justificante no existe.
-- Si algun dia hace falta la excepcion "gasto sin justificante", entra por aqui
-- y de forma explicita.
--
-- El reparto lo calcula el SERVIDOR a partir del total y del porcentaje: el
-- cliente no puede proponer unas partes que no cuadren con el importe.
-- -----------------------------------------------------------------------------
create or replace function public.create_expense(
  p_id                 uuid,
  p_concept            text,
  p_expense_date       date,
  p_total_amount_cents integer,
  p_dani_percent       numeric,
  p_storage_path       text,
  p_notes              text   default null,
  p_original_filename  text   default null,
  p_mime_type          text   default null,
  p_size_bytes         bigint default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id      uuid;
  v_path    text;
  v_percent numeric(5, 2);
  v_dani    integer;
  v_other   integer;
begin
  if not public.is_active_member() then
    raise exception 'Sin permiso.' using errcode = '42501';
  end if;

  -- El identificador lo genera el cliente antes de subir la foto, porque la
  -- ruta en Storage se agrupa por gasto. Sin el no se puede comprobar que la
  -- ruta corresponda a ESTE ticket, asi que aqui es obligatorio.
  if p_id is null then
    raise exception 'Falta el identificador del ticket.' using errcode = '22023';
  end if;
  v_id := p_id;

  -- La foto es obligatoria, tiene que existir de verdad en Storage y ser de
  -- este ticket. La regla completa vive en assert_ticket_photo().
  v_path := public.assert_ticket_photo(v_id, p_storage_path);

  v_percent := round(least(100, greatest(0, coalesce(p_dani_percent, 50))), 2);

  -- Mismo redondeo que el cliente (half-up sobre la parte de Dani); la otra
  -- parte es siempre el resto, de modo que la suma cuadra por construccion.
  v_dani  := least(p_total_amount_cents, floor((p_total_amount_cents * v_percent) / 100 + 0.5)::integer);
  v_other := p_total_amount_cents - v_dani;

  insert into public.expenses (
    id, created_by, expense_date, concept, total_amount_cents,
    dani_share_cents, other_share_cents, dani_share_percent, other_share_percent,
    split_type, status, notes
  )
  values (
    v_id, auth.uid(), p_expense_date, btrim(p_concept), p_total_amount_cents,
    v_dani, v_other, v_percent, 100 - v_percent,
    (case when v_percent = 50 then 'mitad' else 'porcentaje' end)::public.split_type,
    'pendiente', nullif(btrim(coalesce(p_notes, '')), '')
  );

  insert into public.expense_photos (
    expense_id, storage_path, original_filename, mime_type, size_bytes, uploaded_by
  )
  values (
    v_id, v_path, left(nullif(btrim(coalesce(p_original_filename, '')), ''), 255),
    nullif(btrim(coalesce(p_mime_type, '')), ''), p_size_bytes, auth.uid()
  );

  -- Aviso dentro de la app para quien paga. Va en la misma transaccion: si el
  -- alta se deshace, el aviso no queda colgado.
  perform public.notify_role(
    'dani',
    'ticket_created',
    public.current_display_name() || ' ha subido un ticket de '
      || public.format_cents_es(p_total_amount_cents),
    btrim(p_concept),
    v_id,
    null
  );

  return v_id;
end;
$$;

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
  v_concept    text;
  v_method     public.payment_method;
  v_phrase     text;
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
  -- Un lote que suma cero (tickets con 0% para Dani) se cierra sin registrar pago:
  -- no hay dinero que mover, y crear un pago de 0,00 EUR ensuciaria el historico.
  if v_total > 0 then
    -- El metodo es obligatorio cuando hay dinero de por medio. Se acepta como
    -- texto y se valida aqui para poder dar un error legible en vez del error
    -- de conversion de tipo que daria Postgres.
    if lower(btrim(coalesce(p_method, ''))) not in ('bizum', 'transferencia', 'efectivo', 'otro') then
      raise exception 'Indica como se ha pagado: bizum, transferencia, efectivo u otro.'
        using errcode = '22023';
    end if;
    v_method := lower(btrim(p_method))::public.payment_method;
    v_phrase := ' ' || public.payment_method_phrase(v_method);

    insert into public.payments (paid_by, paid_at, amount_cents, method, notes)
    values (
      auth.uid(),
      coalesce(p_paid_at, now()),
      v_total,
      v_method,
      nullif(btrim(coalesce(p_notes, '')), '')
    )
    returning id into v_payment_id;

    insert into public.payment_expenses (payment_id, expense_id, amount_applied_cents)
    select v_payment_id, e.id, e.dani_share_cents
    from public.expenses e
    where e.id = any (v_ids);
  end if;

  perform set_config('app.allow_status_change', 'on', true);
  update public.expenses set status = 'pagado' where id = any (v_ids);
  perform set_config('app.allow_status_change', 'off', true);

  -- Aviso dentro de la app para quien subio los tickets. El texto distingue el
  -- pago suelto del agrupado, porque en la practica se leen muy distinto.
  if v_count = 1 then
    select e.concept into v_concept from public.expenses e where e.id = v_ids[1];
    perform public.notify_role(
      'alba',
      'payment_registered',
      public.current_display_name() || ' ha marcado como pagado el ticket '
        || v_concept || coalesce(v_phrase, ''),
      public.format_cents_es(v_total),
      v_ids[1],
      v_payment_id
    );
  else
    -- En un pago agrupado el enlace va al pago, no a un ticket concreto, pero el
    -- cuerpo lista los conceptos: es lo que Alba necesita para reconocerlos.
    select string_agg(e.concept, ', ' order by e.expense_date desc)
      into v_concept
      from public.expenses e
     where e.id = any (v_ids);

    perform public.notify_role(
      'alba',
      'payment_registered',
      public.current_display_name() || ' ha marcado como pagados ' || v_count
        || ' tickets: ' || public.format_cents_es(v_total) || coalesce(v_phrase, ''),
      coalesce(v_concept, v_count || ' tickets'),
      null,
      v_payment_id
    );
  end if;

  return v_payment_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- void_payment — deshacer un pago registrado por error
--
-- No devuelve dinero ni habla con ningun banco: corrige el estado registrado en
-- la aplicacion. El pago NO se borra: se marca con `voided_at` y `voided_by`,
-- conserva importe, metodo, notas y sus filas de `payment_expenses`, y los
-- tickets que cubria vuelven a `pendiente`.
--
-- En el MVP se deshace el pago ENTERO. Si cubria tres tickets, vuelven los tres.
-- Deshacer solo uno de un pago agrupado obligaria a recalcular el importe del
-- pago, que es precisamente el dato que no se debe tocar (ver DECISIONES.md).
--
-- Es idempotente: deshacer dos veces no falla ni avisa dos veces. Un doble clic
-- no debe mostrar un error cuando la operacion ya salio bien.
-- -----------------------------------------------------------------------------
create or replace function public.void_payment(p_payment_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_payment public.payments%rowtype;
  v_role    public.user_role;
  v_ids     uuid[];
  v_count   integer;
  v_concept text;
begin
  v_role := public.current_role_name();
  if v_role is null then
    raise exception 'Sin permiso.' using errcode = '42501';
  end if;
  if v_role not in ('dani', 'admin') then
    raise exception 'Solo Dani o un administrador pueden deshacer pagos.' using errcode = '42501';
  end if;

  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found then
    raise exception 'El pago no existe.' using errcode = '22023';
  end if;
  if v_payment.voided_at is not null then
    return; -- idempotente
  end if;

  select array_agg(pe.expense_id) into v_ids
    from public.payment_expenses pe
   where pe.payment_id = p_payment_id;
  v_ids := coalesce(v_ids, '{}'::uuid[]);

  -- Bloqueo de los tickets para que no se paguen a la vez que se deshacen.
  perform 1 from public.expenses where id = any (v_ids) for update;

  update public.payments
     set voided_at   = now(),
         voided_by   = auth.uid(),
         void_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where id = p_payment_id;

  perform set_config('app.allow_status_change', 'on', true);
  update public.expenses
     set status = 'pendiente'
   where id = any (v_ids)
     and status = 'pagado';
  perform set_config('app.allow_status_change', 'off', true);

  v_count := cardinality(v_ids);

  if v_count = 1 then
    select e.concept into v_concept from public.expenses e where e.id = v_ids[1];
    perform public.notify_role(
      'alba',
      'payment_voided',
      public.current_display_name() || ' ha deshecho el pago del ticket ' || v_concept,
      public.format_cents_es(v_payment.amount_cents) || ', vuelve a pendiente',
      v_ids[1],
      p_payment_id
    );
  else
    select string_agg(e.concept, ', ' order by e.expense_date desc)
      into v_concept
      from public.expenses e
     where e.id = any (v_ids);

    perform public.notify_role(
      'alba',
      'payment_voided',
      public.current_display_name() || ' ha deshecho un pago de ' || v_count
        || ' tickets: ' || public.format_cents_es(v_payment.amount_cents),
      coalesce(v_concept, v_count || ' tickets') || ', vuelven a pendiente',
      null,
      p_payment_id
    );
  end if;
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
