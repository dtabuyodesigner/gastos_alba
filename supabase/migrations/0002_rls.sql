-- =============================================================================
-- Gastos Alba — Row Level Security
--
-- Regla general: sin sesion no se ve NADA, y tener sesion tampoco basta: hace
-- falta una fila activa en `profiles`. La interfaz repite estas reglas por
-- comodidad, pero la fuente de verdad es esto.
-- =============================================================================

alter table public.profiles         enable row level security;
alter table public.expenses         enable row level security;
alter table public.expense_photos   enable row level security;
alter table public.payments         enable row level security;
alter table public.payment_expenses enable row level security;

-- Defensa en profundidad: aunque no haya politica DELETE, se retira el permiso.
revoke delete on public.profiles, public.expenses, public.expense_photos,
                 public.payments, public.payment_expenses
  from anon, authenticated;

-- El rol anonimo no tiene nada que hacer aqui.
revoke all on public.profiles, public.expenses, public.expense_photos,
               public.payments, public.payment_expenses
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

-- Sin politica INSERT: las fotos se enlazan dentro de create_expense(), en la
-- misma transaccion que el gasto. Sin UPDATE ni DELETE: un justificante no se
-- reescribe ni se borra.
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

-- Alta de gastos y de fotos: solo a traves de create_expense().
revoke insert on public.expenses, public.expense_photos from authenticated;

-- -----------------------------------------------------------------------------
-- Permisos de ejecucion de las funciones
-- -----------------------------------------------------------------------------
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
