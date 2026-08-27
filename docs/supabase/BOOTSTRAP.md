# Puesta en marcha de Supabase

Guia para dejar operativo el backend de **Gastos Alba** desde cero.

> Este proyecto Supabase debe ser **nuevo y exclusivo** de Gastos Alba. No reutilices el
> proyecto de La Libreta de Marcos ni ningun otro: ni base de datos, ni usuarios, ni buckets.

## 1. Crear el proyecto

1. En [supabase.com](https://supabase.com) crea un proyecto nuevo llamado `gastos-alba`.
2. Elige region europea (`eu-west-*` o `eu-central-*`).
3. Guarda la contrasena de la base de datos en tu gestor de contrasenas.

En **Project Settings → API** copia:

- `Project URL` → `VITE_SUPABASE_URL`
- `anon` / `public` key → `VITE_SUPABASE_ANON_KEY`

La `service_role` key **no se usa en este proyecto**. No la copies a ningun `.env`.

## 2. Ejecutar las migraciones

En **SQL Editor**, ejecuta en este orden exacto el contenido de:

1. `supabase/migrations/0001_init.sql`
2. `supabase/migrations/0002_rls.sql`
3. `supabase/migrations/0003_storage.sql`

Si el paso 3 falla por permisos sobre `storage.objects`, crea el bucket `tickets` desde
**Storage → New bucket** con la opcion *Public* DESACTIVADA y anade las mismas politicas
desde **Storage → Policies**.

## 3. Cerrar el registro publico

En **Authentication → Providers → Email**:

- Deja activado `Email`.
- **Desactiva** `Enable sign-ups` (o "Allow new users to sign up").

Asi nadie puede crearse una cuenta desde fuera. Las cuentas se crean a mano, que para dos
personas es mas simple y mas seguro que montar un sistema de invitaciones.

Ademas, aunque alguien lograra registrarse, el trigger `handle_new_user()` crea su perfil
con `is_active = false` y rol `alba`: no veria absolutamente nada hasta que un admin lo
active. El rol nunca se toma de los metadatos que envia el cliente.

## 4. Crear las dos cuentas

En **Authentication → Users → Add user** crea:

| Email | Persona |
|---|---|
| el de Alba | Alba |
| el de Dani | Dani |

Marca *Auto Confirm User* para no depender del correo de confirmacion.

## 5. Activar los perfiles y asignar roles

El trigger ya ha creado una fila en `profiles` por cada usuario, desactivada. Actívalas
desde el **SQL Editor** sustituyendo los emails:

```sql
update public.profiles
   set display_name = 'Alba',
       role         = 'alba',
       is_active    = true
 where email = 'EMAIL_DE_ALBA';

update public.profiles
   set display_name = 'Dani',
       role         = 'dani',
       is_active    = true
 where email = 'EMAIL_DE_DANI';

-- Comprobacion
select display_name, email, role, is_active from public.profiles order by role;
```

Si quieres una cuenta de administracion, usa `role = 'admin'`. Con dos personas no hace
falta: el rol `dani` ya puede corregir y pagar cualquier ticket.

## 6. Comprobar que el candado cierra

Merece la pena dedicar cinco minutos a esto antes de compartir la URL.

```sql
-- 1. RLS activo en las cinco tablas (rowsecurity debe ser true en todas)
select tablename, rowsecurity
  from pg_tables
 where schemaname = 'public'
   and tablename in ('profiles','expenses','expense_photos','payments','payment_expenses');

-- 2. El bucket de fotos NO es publico (public debe ser false)
select id, public from storage.buckets where id = 'tickets';

-- 3. Politicas registradas
select tablename, policyname, cmd from pg_policies
 where schemaname in ('public','storage') order by tablename, policyname;
```

Y desde el navegador:

- Abre la app en una ventana privada sin iniciar sesion: no debe verse ningun gasto.
- Copia la URL firmada de una foto y abrela pasados mas de 5 minutos: debe caducar.
- Entra como Alba e intenta marcar un pago: el boton no aparece, y si se fuerza la
  llamada, `register_payment` responde `Solo Dani o un administrador pueden registrar pagos`.

## 7. Copias de seguridad

Supabase hace copias diarias en los planes de pago. En el plan gratuito conviene
exportar de vez en cuando:

```bash
supabase db dump --db-url "postgresql://..." -f copia-gastos-alba.sql
```

## Operaciones habituales

**Desactivar temporalmente a alguien** (deja de ver todo, sin borrar nada):

```sql
update public.profiles set is_active = false where email = 'EMAIL';
```

**Ver el estado de cuentas de un mes**:

```sql
select status, count(*), sum(dani_share_cents) as dani_cents
  from public.expenses
 where expense_date >= date_trunc('month', current_date)
 group by status;
```

**Corregir un pago mal registrado**: no hay interfaz para deshacerlo a proposito. Hazlo a
mano en SQL y deja constancia en `notes`, para que el historico siga cuadrando.
