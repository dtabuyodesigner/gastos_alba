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

## 6. Validacion obligatoria antes de produccion

> **Estado a dia de hoy: NADA DE ESTO SE HA EJECUTADO NUNCA.** Las migraciones, las
> politicas RLS, el bucket y las funciones RPC estan escritas y revisadas, pero no se han
> probado contra un Supabase real porque el proyecto todavia no existe. Esta seccion es la
> lista de comprobacion que hay que completar **entera** antes de compartir la URL con
> nadie. Hasta que las 11 casillas esten marcadas, la aplicacion no esta validada.

Necesitas dos navegadores o dos ventanas privadas para poder estar como Alba y como Dani a
la vez. Anota el resultado de cada punto.

### 1. Las tres migraciones se han ejecutado en orden

```sql
-- Deben aparecer las 5 tablas
select table_name from information_schema.tables
 where table_schema = 'public'
   and table_name in ('profiles','expenses','expense_photos','payments','payment_expenses')
 order by table_name;

-- Deben aparecer las 6 funciones
select routine_name, security_type from information_schema.routines
 where routine_schema = 'public'
   and routine_name in ('create_expense','register_payment','void_expense',
                        'is_active_member','current_role_name','can_register_payment')
 order by routine_name;
```

**Esperado:** 5 tablas y 6 funciones. `create_expense`, `register_payment` y `void_expense`
deben figurar como `DEFINER`. Si falta algo, alguna migracion no llego a completarse: revisa
el orden 0001 → 0002 → 0003 y vuelve a ejecutarla.

### 2. RLS activo en las cinco tablas

```sql
select tablename, rowsecurity from pg_tables
 where schemaname = 'public'
   and tablename in ('profiles','expenses','expense_photos','payments','payment_expenses')
 order by tablename;

-- Y las politicas registradas
select tablename, policyname, cmd from pg_policies
 where schemaname in ('public','storage') order by tablename, policyname;
```

**Esperado:** `rowsecurity = true` en las cinco. Y muy importante, **no debe aparecer
ninguna politica con `cmd = 'DELETE'`**, ni en `public` ni en `storage`: sin borrado
destructivo significa exactamente eso.

### 3. Alba y Dani entran, con su rol correcto

```sql
select display_name, email, role, is_active from public.profiles order by role;
```

**Esperado:** dos filas, `is_active = true`, roles `alba` y `dani`. Despues, en el navegador:
las dos personas inician sesion y ven la pantalla de inicio.

### 4. Un usuario no activo no ve absolutamente nada

Crea una tercera cuenta de prueba (`Add user`, con Auto Confirm) y **no la actives**.

**Esperado:** al entrar ve la pantalla "Cuenta sin autorizar" y ni un solo gasto. Comprueba
tambien que la API lo bloquea, no solo la interfaz: desde el navegador de esa sesion, en la
consola, `await (await fetch(SUPABASE_URL + '/rest/v1/expenses?select=*', { headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + TOKEN }})).json()`
debe devolver `[]`. Al terminar, borra la cuenta de prueba.

### 5. La foto es obligatoria de verdad

En la interfaz, como Alba: el boton de guardar aparece desactivado con el texto "Anade la
foto para guardar" mientras no haya foto.

Y la regla tambien tiene que sostenerse sin pasar por la interfaz. Como Alba, en la consola
del navegador:

```js
// Alta sin foto: debe fallar
await supabase.rpc('create_expense', {
  p_id: crypto.randomUUID(), p_concept: 'Prueba sin foto',
  p_expense_date: '2026-08-27', p_total_amount_cents: 1000,
  p_dani_percent: 50, p_storage_path: null,
})
// Insert directo saltandose la funcion: tambien debe fallar
await supabase.from('expenses').insert({ concept: 'x', expense_date: '2026-08-27',
  total_amount_cents: 1000, dani_share_cents: 500, other_share_cents: 500 })
```

**Esperado:** la primera responde `Un ticket necesita la foto del justificante`; la segunda
falla por permiso denegado (el `INSERT` directo esta revocado). Si la segunda funcionara, la
obligatoriedad de la foto seria solo decorativa.

### 6. Alta completa y reparto correcto

Como Alba, sube un ticket real de importe **impar**, por ejemplo 12,35 €, al 50%.

**Esperado:** parte de Dani 6,18 € y otra parte 6,17 € (el centimo suelto lo asume Dani, ver
`docs/DECISIONES.md`). Comprueba en SQL que cuadra y que la foto quedo enlazada:

```sql
select e.concept, e.total_amount_cents, e.dani_share_cents, e.other_share_cents,
       e.dani_share_cents + e.other_share_cents as suma, count(p.id) as fotos
  from public.expenses e
  left join public.expense_photos p on p.expense_id = e.id
 group by e.id order by e.created_at desc limit 5;
```

**Esperado:** `suma = total_amount_cents` y `fotos = 1` en todos los tickets.

### 7. Pago individual

Como Dani, abre un ticket pendiente y pulsa "Marcar mi parte como pagada".

```sql
select p.amount_cents, count(pe.expense_id) as tickets
  from public.payments p
  join public.payment_expenses pe on pe.payment_id = p.id
 group by p.id order by p.paid_at desc limit 5;
```

**Esperado:** el ticket pasa a `pagado`, se crea un pago con `amount_cents` igual a la parte
de Dani y una sola fila en `payment_expenses`.

Prueba tambien el bloqueo por rol: como **Alba**, en consola,
`await supabase.rpc('register_payment', { p_expense_ids: ['<id-de-un-ticket>'] })`.
**Esperado:** `Solo Dani o un administrador pueden registrar pagos`.

### 8. Pago agrupado

Como Dani, con el filtro "Pendientes", marca **tres** tickets y pulsa "Marcar como pagados".

**Esperado:** un unico pago cuyo `amount_cents` es la suma exacta de las tres partes de
Dani, y tres filas en `payment_expenses` apuntando a ese pago. Los tres tickets quedan
`pagado`. Repite la consulta del punto 7 para verificarlo.

Caso limite que conviene probar una vez: un ticket con **0% para Dani**. Debe poder cerrarse
(pasa a `pagado`) y **no** debe generar ningun pago de 0,00 EUR en el historico.

### 9. Anulacion sin borrado

Como Alba, anula un ticket pendiente.

```sql
select status, voided_at from public.expenses where id = '<id>';
select count(*) from public.expenses;  -- antes y despues: mismo numero
```

**Esperado:** `status = 'anulado'`, `voided_at` con fecha, y la fila **sigue existiendo**. El
recuento total de gastos no baja. Comprueba ademas que anular un ticket ya **pagado** se
rechaza (`Un ticket ya pagado no se puede anular`) y que la interfaz ni siquiera ofrece el
boton en ese caso.

### 10. El bucket es privado y las URLs firmadas caducan

```sql
select id, public, file_size_limit from storage.buckets where id = 'tickets';
```

**Esperado:** `public = false`.

Despues, en el navegador: abre el detalle de un ticket, copia la URL de la imagen (clic
derecho → copiar direccion) y:

1. Pegala en una **ventana privada sin sesion**, recien copiada. Deberia verse: la firma es
   valida durante 5 minutos y no depende de la sesion. Eso es lo esperado.
2. Espera **mas de 5 minutos** y vuelve a abrirla. **Esperado:** ya no carga; la firma ha
   caducado.
3. Prueba la ruta sin firmar, `.../storage/v1/object/public/tickets/<ruta>`. **Esperado:**
   error, porque el bucket no es publico.

Comprueba tambien que nadie puede borrar una foto: como Dani, en consola,
`await supabase.storage.from('tickets').remove(['<ruta>'])`. **Esperado:** no se borra (no
hay politica `DELETE`), y la foto sigue viendose en el detalle del ticket.

### 11. La service_role key no esta en el frontend

```bash
grep -rn "service_role" .env.local dist/ 2>/dev/null || echo "limpio"
```

**Esperado:** `limpio`. La aplicacion ademas se niega a arrancar si detecta una clave
`service_role` en `VITE_SUPABASE_ANON_KEY`, pero conviene comprobarlo tambien en el build.
Revisa por ultimo, en el panel de Vercel, que ninguna variable de entorno del proyecto
contenga esa clave.

### Extra: un perfil solo puede cambiarse el nombre

Como Alba, en consola del navegador:

```js
await supabase.from('profiles').update({ display_name: 'Alba T.' }).eq('id', MI_ID)  // debe funcionar
await supabase.from('profiles').update({ email: 'otro@example.com' }).eq('id', MI_ID) // debe fallar
await supabase.from('profiles').update({ role: 'admin' }).eq('id', MI_ID)             // debe fallar
await supabase.from('profiles').update({ is_active: true }).eq('id', OTRO_ID)         // debe fallar
```

**Esperado:** solo la primera funciona. Las otras responden `Solo puedes cambiar tu nombre
visible` o `Solo un administrador puede cambiar el rol o la activacion`.

### Cuando termines

Borra los tickets de prueba **anulandolos** (no hay otra via, y es intencionado), o vacia
las tablas desde el SQL Editor antes de empezar a usar la aplicacion de verdad:

```sql
-- Solo para dejar limpio tras las pruebas, nunca en uso normal.
truncate public.payment_expenses, public.payments, public.expense_photos, public.expenses;
```

Los ficheros de prueba del bucket hay que borrarlos a mano desde **Storage → tickets**, ya
que la aplicacion no borra fotos por diseno.

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
