-- =============================================================================
-- Gastos Alba — 0004: puesta al dia de una base ya inicializada
--
-- PARA QUE SIRVE
-- Si ejecutaste 0001, 0002 y 0003 antes de las revisiones del MVP, tu proyecto
-- Supabase se quedo por detras del repositorio: las migraciones anteriores usan
-- `create table if not exists`, asi que volver a ejecutarlas NO anade columnas
-- ni cambia tipos sobre tablas que ya existen.
--
-- Este fichero pone la base al dia de una sola pasada.
--
-- GARANTIAS
--   * Es idempotente: ejecutarlo dos veces no rompe nada.
--   * No borra ni una fila. No hay drop table, ni truncate, ni delete from, ni
--     borrado de fotos ni de tickets.
--   * Sobre una base recien creada con 0001+0002+0003 no cambia nada: todo lo
--     que hace ya esta aplicado.
--
-- COMO EJECUTARLO
-- Pegalo entero en el SQL Editor de Supabase y ejecutalo una vez. Si alguna
-- sentencia falla, para y revisa el mensaje antes de seguir: esta escrito para
-- ir de menos a mas riesgo, asi que un fallo temprano no deja nada a medias.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Tipos nuevos
-- -----------------------------------------------------------------------------
do $$ begin
  create type public.payment_method as enum ('bizum', 'transferencia', 'efectivo', 'otro');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.notification_type as enum ('ticket_created', 'payment_registered');
exception when duplicate_object then null; end $$;


-- -----------------------------------------------------------------------------
-- 2. expense_photos: historico de fotos sustituidas
--
-- Las columnas nuevas van vacias en las fotos existentes, que es exactamente lo
-- que significa "esta foto es la vigente". No se toca ninguna fila.
-- -----------------------------------------------------------------------------
alter table public.expense_photos add column if not exists replaced_at timestamptz;
alter table public.expense_photos add column if not exists replaced_by uuid references public.profiles (id);

do $$ begin
  alter table public.expense_photos
    add constraint expense_photos_replaced_consistency
    check ((replaced_at is null) = (replaced_by is null));
exception when duplicate_object then null; end $$;

-- Antes de crear el indice unico, comprobar que no hay ya un ticket con dos
-- fotos vigentes. No deberia haberlo (la version anterior insertaba una sola
-- por gasto), pero si lo hubiera es mejor un mensaje claro que un error de
-- indice duplicado sin contexto.
do $$
declare
  v_ids text;
begin
  select string_agg(expense_id::text, ', ') into v_ids
    from (
      select expense_id from public.expense_photos
       where replaced_at is null
       group by expense_id having count(*) > 1
    ) t;
  if v_ids is not null then
    raise exception 'Hay tickets con mas de una foto vigente: %. Revisalos a mano antes de seguir.', v_ids;
  end if;
end $$;

create unique index if not exists expense_photos_one_current_idx
  on public.expense_photos (expense_id) where replaced_at is null;


-- -----------------------------------------------------------------------------
-- 3. payments.method: de texto libre a enum, y obligatorio
--
-- Los pagos que ya existan pasan a 'otro' cuando no se sepa como se hicieron.
-- Es la unica forma de poner NOT NULL sin inventar informacion: 'otro' dice
-- literalmente "no consta". Revisalos despues si te importa afinarlos:
--   select id, paid_at, amount_cents, method from public.payments order by paid_at;
-- -----------------------------------------------------------------------------
do $$
declare
  v_tipo text;
begin
  select data_type into v_tipo
    from information_schema.columns
   where table_schema = 'public' and table_name = 'payments' and column_name = 'method';

  if v_tipo is null then
    alter table public.payments add column method public.payment_method;

  elsif v_tipo <> 'USER-DEFINED' then
    -- Todavia es text: se normaliza el contenido y despues se convierte el tipo.
    alter table public.payments drop constraint if exists payments_method_check;

    update public.payments
       set method = case
             when lower(btrim(coalesce(method, ''))) in ('bizum', 'transferencia', 'efectivo', 'otro')
               then lower(btrim(method))
             else 'otro'
           end;

    alter table public.payments
      alter column method type public.payment_method
      using method::public.payment_method;
  end if;
end $$;

update public.payments set method = 'otro' where method is null;
alter table public.payments alter column method set not null;


-- -----------------------------------------------------------------------------
-- 4. Tablas de avisos
-- -----------------------------------------------------------------------------
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


-- -----------------------------------------------------------------------------
-- 5. create_expense: hay que borrarla antes de recrearla
--
-- En la primera version los parametros `p_notes` y `p_storage_path` estaban en
-- orden inverso. Los tipos coinciden, asi que Postgres considera que es la misma
-- funcion y `create or replace` fallaria con "cannot change name of input
-- parameter". Se borra primero; los permisos se vuelven a conceder al final.
-- -----------------------------------------------------------------------------
drop function if exists public.create_expense(uuid, text, date, integer, numeric, text, text, text, text, bigint);


-- -----------------------------------------------------------------------------
-- 6. Funciones
--
-- Copia exacta de las definiciones de 0001_init.sql. `create or replace` es
-- idempotente, asi que se re-emiten todas: las que no han cambiado se quedan
-- igual, y no hay que adivinar por que version iba tu base de datos.
-- Un test del repositorio comprueba que estas copias no se separan del original.
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

create or replace function public.can_register_payment()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.current_role_name() in ('dani', 'admin');
$$;

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


-- -----------------------------------------------------------------------------
-- 7. Triggers
-- -----------------------------------------------------------------------------

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

drop trigger if exists expenses_touch_updated_at on public.expenses;
create trigger expenses_touch_updated_at
  before update on public.expenses
  for each row execute function public.touch_updated_at();

drop trigger if exists expenses_guard on public.expenses;
create trigger expenses_guard
  before update on public.expenses
  for each row execute function public.expenses_guard_update();

drop trigger if exists expense_photos_guard on public.expense_photos;
create trigger expense_photos_guard
  before update on public.expense_photos
  for each row execute function public.expense_photos_guard_update();

drop trigger if exists notifications_guard on public.notifications;
create trigger notifications_guard
  before update on public.notifications
  for each row execute function public.notifications_guard_update();

drop trigger if exists push_subscriptions_guard on public.push_subscriptions;
create trigger push_subscriptions_guard
  before update on public.push_subscriptions
  for each row execute function public.push_subscriptions_guard_update();


-- -----------------------------------------------------------------------------
-- 8. RLS, politicas y permisos
--
-- Copia exacta de 0002_rls.sql, que es idempotente de por si (drop policy if
-- exists + create policy, y revoke/grant).
-- -----------------------------------------------------------------------------

alter table public.profiles         enable row level security;
alter table public.expenses         enable row level security;
alter table public.expense_photos   enable row level security;
alter table public.payments         enable row level security;
alter table public.payment_expenses enable row level security;
alter table public.notifications     enable row level security;
alter table public.push_subscriptions enable row level security;

-- Defensa en profundidad: aunque no haya politica DELETE, se retira el permiso.
revoke delete on public.profiles, public.expenses, public.expense_photos,
                 public.payments, public.payment_expenses,
                 public.notifications, public.push_subscriptions
  from anon, authenticated;

-- El rol anonimo no tiene nada que hacer aqui.
revoke all on public.profiles, public.expenses, public.expense_photos,
               public.payments, public.payment_expenses,
               public.notifications, public.push_subscriptions
  from anon;

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------
drop policy if exists profiles_select_self_or_member on public.profiles;
create policy profiles_select_self_or_member on public.profiles
  for select to authenticated
  -- Cada quien ve su ficha (necesario para resolver su rol al entrar) y los
  -- miembros activos ven al resto, para poder mostrar "subido por".
  using (id = auth.uid() or public.is_active_member());

drop policy if exists profiles_update_own_name on public.profiles;
create policy profiles_update_own_name on public.profiles
  for update to authenticated
  using (id = auth.uid() and public.is_active_member())
  with check (id = auth.uid());

drop policy if exists profiles_admin_manage on public.profiles;
create policy profiles_admin_manage on public.profiles
  for update to authenticated
  using (public.current_role_name() = 'admin')
  with check (public.current_role_name() = 'admin');

-- Sin politica INSERT: los perfiles solo los crea el trigger handle_new_user().
-- Sin politica DELETE: los perfiles no se borran desde la app.

-- Nadie se auto-asciende: solo un admin puede tocar `role` o `is_active`.
create or replace function public.profiles_guard_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_is_admin boolean;
begin
  v_is_admin := coalesce(public.current_role_name()::text, '') = 'admin';

  -- Inmutables para todo el mundo, admin incluido.
  if old.id is distinct from new.id then
    raise exception 'El identificador no se puede cambiar.' using errcode = '42501';
  end if;
  if old.created_at is distinct from new.created_at then
    raise exception 'created_at no se puede cambiar.' using errcode = '42501';
  end if;

  -- El rol y la activacion son cosa exclusiva de un admin.
  if (old.role is distinct from new.role or old.is_active is distinct from new.is_active)
     and not v_is_admin then
    raise exception 'Solo un administrador puede cambiar el rol o la activacion.' using errcode = '42501';
  end if;

  -- Lista blanca para quien no es admin: `display_name` y nada mas.
  --
  -- Se compara la fila entera en JSON en vez de enumerar columnas, para que
  -- cualquier campo que se anada en el futuro quede protegido por omision en
  -- lugar de quedar abierto por descuido. `email` se incluye aqui: lo gestiona
  -- Supabase Auth, y dejar que el cliente lo reescriba desconectaria la fila de
  -- `profiles` de la cuenta real. `updated_at` se excluye porque lo reescribe
  -- siempre el trigger `profiles_touch_updated_at`.
  if not v_is_admin then
    if (to_jsonb(new) - 'display_name' - 'updated_at')
       is distinct from (to_jsonb(old) - 'display_name' - 'updated_at') then
      raise exception 'Solo puedes cambiar tu nombre visible.' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard
  before update on public.profiles
  for each row execute function public.profiles_guard_update();

-- -----------------------------------------------------------------------------
-- expenses
--
-- MVP de un unico nucleo familiar: cualquier miembro activo ve todos los
-- tickets. Si algun dia hay varios nucleos, el filtro pasaria a ser por
-- household_id (ver docs/DECISIONES.md).
-- -----------------------------------------------------------------------------
drop policy if exists expenses_select_members on public.expenses;
create policy expenses_select_members on public.expenses
  for select to authenticated
  using (public.is_active_member());

-- Sin politica INSERT: los gastos se dan de alta EXCLUSIVAMENTE con
-- create_expense(), que exige la foto del justificante. Un insert directo
-- permitiria saltarse esa regla y crear tickets sin foto.
drop policy if exists expenses_insert_members on public.expenses;

drop policy if exists expenses_update_scoped on public.expenses;
create policy expenses_update_scoped on public.expenses
  for update to authenticated
  using (
    public.is_active_member()
    and status <> 'anulado'
    and (
      public.current_role_name() in ('dani', 'admin')
      -- Alba corrige sus propios tickets mientras sigan pendientes.
      or (created_by = auth.uid() and status = 'pendiente')
    )
  )
  with check (public.is_active_member());

-- Sin politica DELETE: anular es la unica via (funcion void_expense).

-- -----------------------------------------------------------------------------
-- expense_photos
-- -----------------------------------------------------------------------------
drop policy if exists expense_photos_select_members on public.expense_photos;
create policy expense_photos_select_members on public.expense_photos
  for select to authenticated
  using (public.is_active_member());

-- Sin politica INSERT: las fotos se enlazan dentro de create_expense() y de
-- replace_expense_photo(). Sin UPDATE: marcar una foto como reemplazada solo
-- ocurre dentro de esa funcion. Sin DELETE: un justificante no se borra nunca,
-- ni siquiera al sustituirlo.
drop policy if exists expense_photos_insert_members on public.expense_photos;

-- -----------------------------------------------------------------------------
-- payments / payment_expenses
--
-- Se insertan exclusivamente desde register_payment() (SECURITY DEFINER), asi
-- que desde el cliente solo se permite leer.
-- -----------------------------------------------------------------------------
drop policy if exists payments_select_members on public.payments;
create policy payments_select_members on public.payments
  for select to authenticated
  using (public.is_active_member());

drop policy if exists payment_expenses_select_members on public.payment_expenses;
create policy payment_expenses_select_members on public.payment_expenses
  for select to authenticated
  using (public.is_active_member());

revoke insert, update on public.payments, public.payment_expenses from authenticated;

-- Alta de gastos: solo a traves de create_expense(). Alta y marcado de fotos:
-- solo a traves de create_expense() y replace_expense_photo().
revoke insert on public.expenses from authenticated;
revoke insert, update on public.expense_photos from authenticated;

-- -----------------------------------------------------------------------------
-- notifications
--
-- Buzon estrictamente personal: cada quien ve SOLO lo suyo. A diferencia de los
-- gastos, que son del nucleo familiar, un aviso va dirigido a una persona.
-- -----------------------------------------------------------------------------
drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select to authenticated
  using (recipient_profile_id = auth.uid() and public.is_active_member());

-- Sin politica UPDATE: marcar leido pasa exclusivamente por
-- mark_notification_read() y mark_all_notifications_read(). Con una politica de
-- UPDATE, el cliente podria escribir `read_at` directamente por PostgREST; no
-- rompe la privacidad, pero abre el contrato mas de lo necesario y deja la
-- puerta a que un cambio futuro del trigger permita algo mas.
drop policy if exists notifications_update_own on public.notifications;

-- Sin politica INSERT: los avisos los generan create_expense() y
-- register_payment(). Si el cliente pudiera insertar, podria fabricar un aviso
-- falso de "pago registrado".
revoke insert, update on public.notifications from authenticated;

-- Sin politica DELETE: un aviso se marca leido, no se borra.

-- -----------------------------------------------------------------------------
-- push_subscriptions — cada quien gestiona solo las suyas
--
-- La tabla esta PREPARADA pero no operativa (ver 0001_init.sql). Las politicas
-- se dejan puestas para que el dia que se configure el push no haya un hueco de
-- seguridad abierto por prisa.
-- -----------------------------------------------------------------------------
drop policy if exists push_subscriptions_select_own on public.push_subscriptions;
create policy push_subscriptions_select_own on public.push_subscriptions
  for select to authenticated
  using (profile_id = auth.uid() and public.is_active_member());

drop policy if exists push_subscriptions_insert_own on public.push_subscriptions;
create policy push_subscriptions_insert_own on public.push_subscriptions
  for insert to authenticated
  with check (profile_id = auth.uid() and public.is_active_member());

drop policy if exists push_subscriptions_update_own on public.push_subscriptions;
create policy push_subscriptions_update_own on public.push_subscriptions
  for update to authenticated
  using (profile_id = auth.uid() and public.is_active_member())
  with check (profile_id = auth.uid());

-- Sin politica DELETE: darse de baja es poner `disabled_at`, no borrar la fila.

-- -----------------------------------------------------------------------------
-- Permisos de ejecucion de las funciones
-- -----------------------------------------------------------------------------
revoke all on function public.mark_notification_read(uuid) from public, anon;
grant execute on function public.mark_notification_read(uuid) to authenticated;

revoke all on function public.mark_all_notifications_read() from public, anon;
grant execute on function public.mark_all_notifications_read() to authenticated;

-- payment_method_phrase solo la usan las funciones internas al componer el
-- texto del aviso; el cliente tiene sus propias etiquetas.
revoke all on function public.payment_method_phrase(public.payment_method)
  from public, anon, authenticated;

revoke all on function public.format_cents_es(integer) from public, anon;
grant execute on function public.format_cents_es(integer) to authenticated;

revoke all on function public.current_display_name() from public, anon;
grant execute on function public.current_display_name() to authenticated;

-- notify_role NO se concede a nadie: solo la llaman create_expense() y
-- register_payment(), que corren como su propietario. Si el cliente pudiera
-- ejecutarla, podria fabricar avisos falsos a nombre de otra persona.
revoke all on function public.notify_role(public.user_role, public.notification_type, text, text, uuid, uuid)
  from public, anon, authenticated;

revoke all on function public.replace_expense_photo(uuid, text, text, text, bigint) from public, anon;
grant execute on function public.replace_expense_photo(uuid, text, text, text, bigint) to authenticated;

-- assert_ticket_photo es de uso interno: la llaman create_expense() y
-- replace_expense_photo(), que corren como su propietario.
revoke all on function public.assert_ticket_photo(uuid, text)
  from public, anon, authenticated;

revoke all on function public.create_expense(uuid, text, date, integer, numeric, text, text, text, text, bigint) from public, anon;
grant execute on function public.create_expense(uuid, text, date, integer, numeric, text, text, text, text, bigint) to authenticated;

revoke all on function public.register_payment(uuid[], text, text, timestamptz) from public, anon;
grant execute on function public.register_payment(uuid[], text, text, timestamptz) to authenticated;

revoke all on function public.void_expense(uuid) from public, anon;
grant execute on function public.void_expense(uuid) to authenticated;

revoke all on function public.is_active_member() from public, anon;
grant execute on function public.is_active_member() to authenticated;

revoke all on function public.current_role_name() from public, anon;
grant execute on function public.current_role_name() to authenticated;

revoke all on function public.can_register_payment() from public, anon;
grant execute on function public.can_register_payment() to authenticated;


-- -----------------------------------------------------------------------------
-- 9. Storage: retirar el borrado de fotos
--
-- La primera version permitia a un admin borrar objetos del bucket. Se retiro:
-- una foto de ticket es un justificante y aplica el mismo criterio que a los
-- gastos. Esto solo quita la politica; NO borra ningun fichero.
-- -----------------------------------------------------------------------------
drop policy if exists tickets_delete_admin on storage.objects;
