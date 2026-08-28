-- =============================================================================
-- Gastos Alba — 0005: deshacer pagos
--
-- PARA QUE SIRVE
-- Si Dani marca un ticket como pagado por error, hasta ahora no habia forma de
-- corregirlo. Esta migracion anade "deshacer pago", sin borrar nada: el pago se
-- marca como deshecho y los tickets que cubria vuelven a pendiente.
--
-- QUIEN LA NECESITA
-- Cualquier base que ya haya ejecutado 0001/0002/0003 (y 0004 si venia de una
-- version antigua). En una instalacion nueva desde cero, 0001 y 0002 ya lo
-- traen todo y esta migracion no cambia nada.
--
-- GARANTIAS
--   * Idempotente: ejecutarla dos veces no rompe nada.
--   * No borra ni una fila: sin drop table, sin truncate, sin delete from.
--   * No toca pagos, tickets ni fotos existentes; solo anade columnas vacias.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Tipo de aviso nuevo
--
-- Nota: `alter type ... add value` no puede usarse en la misma transaccion en la
-- que se anade. Aqui solo se declara; quien lo usa es void_payment(), que se
-- ejecuta despues. Si tu editor SQL se quejara de "cannot be executed in a
-- transaction block", ejecuta esta unica linea por separado y sigue.
-- -----------------------------------------------------------------------------
alter type public.notification_type add value if not exists 'payment_voided';


-- -----------------------------------------------------------------------------
-- 2. payments: marcar un pago como deshecho sin borrarlo
--
-- Las columnas nuevas quedan vacias en los pagos existentes, que es exactamente
-- lo que significa "este pago sigue vigente". No se modifica ninguna fila.
-- -----------------------------------------------------------------------------
alter table public.payments add column if not exists voided_at   timestamptz;
alter table public.payments add column if not exists voided_by   uuid references public.profiles (id);
alter table public.payments add column if not exists void_reason text;

do $$ begin
  alter table public.payments
    add constraint payments_void_reason_length
    check (void_reason is null or char_length(void_reason) <= 500);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.payments
    add constraint payments_voided_consistency
    check ((voided_at is null) = (voided_by is null));
exception when duplicate_object then null; end $$;

create index if not exists payments_active_idx
  on public.payments (paid_at desc) where voided_at is null;


-- -----------------------------------------------------------------------------
-- 3. Guarda de pagos
--
-- Copia exacta de 0001_init.sql. Un test del repositorio comprueba que esta
-- copia no se separa del original.
-- -----------------------------------------------------------------------------

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


-- -----------------------------------------------------------------------------
-- 4. void_payment
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
-- 5. Permisos
--
-- El cliente ya tenia revocados INSERT y UPDATE sobre payments; se repite por si
-- vienes de una base donde no llego a aplicarse. Deshacer un pago pasa
-- exclusivamente por void_payment(), que comprueba el rol por dentro.
-- -----------------------------------------------------------------------------
revoke insert, update on public.payments, public.payment_expenses from authenticated;
revoke delete on public.payments, public.payment_expenses from anon, authenticated;

revoke all on function public.void_payment(uuid, text) from public, anon;
grant execute on function public.void_payment(uuid, text) to authenticated;
