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

**Hay dos situaciones distintas. Mira cual es la tuya antes de pegar nada.**

### Caso A: proyecto nuevo, desde cero

En **SQL Editor**, ejecuta en este orden exacto el contenido de:

1. `supabase/migrations/0001_init.sql`
2. `supabase/migrations/0002_rls.sql`
3. `supabase/migrations/0003_storage.sql`

Con eso ya tienes el esquema completo. **`0004` y `0005` no hacen falta**, aunque ejecutarlos
no rompe nada: sobre una base recien creada no cambian absolutamente nada, porque todo lo que
hacen ya esta aplicado.

Si el paso 3 falla por permisos sobre `storage.objects`, crea el bucket `tickets` desde
**Storage → New bucket** con la opcion *Public* DESACTIVADA y anade las mismas politicas
desde **Storage → Policies**.

### Caso B: tu proyecto ya existe

Ejecuta **solo los parches que te falten**, en orden:

| Si tu base viene de… | Ejecuta |
|---|---|
| 0001/0002/0003 de antes de las revisiones del MVP | `0004` y despues `0005` |
| ya aplicaste `0004` | solo `0005` |

**Nunca vuelvas a ejecutar 0001.**

#### `0004_update_after_mvp_reviews.sql`

El motivo por el que hay parches y no se reejecuta 0001 es concreto: 0001 crea las tablas con
`create table if not exists`, asi que sobre una base que ya las tiene **no anade las columnas
nuevas ni cambia el tipo de `payments.method`**. Se ejecutaria entera sin dar un solo error y
te dejaria la base a medias, que es lo peor de todo: parece que fue bien y no fue.

`0004` esta escrito justo para eso:

- anade lo que falta con `alter table ... add column if not exists`;
- convierte `payments.method` de texto a enum, conservando lo que hubiera;
- crea las tablas de avisos si no existen;
- vuelve a definir **todas** las funciones (`create or replace` es idempotente), asi que da
  igual por que version exacta ibas;
- vuelve a aplicar todas las politicas y permisos;
- retira la politica que permitia a un admin borrar fotos del bucket.

**No borra ni una fila.** No hay `drop table`, ni `truncate`, ni `delete from`, ni borrado de
fotos ni de tickets; hay un test en el repositorio que lo comprueba. Y es idempotente: si lo
ejecutas dos veces, la segunda no hace nada.

Una cosa que si cambia datos, y conviene que la sepas: **`payments.method` pasa a ser
obligatorio**. Los pagos que ya existieran sin metodo quedan como `otro`, que significa "no
consta". Si tenias pagos registrados y quieres afinarlos:

```sql
select id, paid_at, amount_cents, method, notes from public.payments order by paid_at;
-- Y si recuerdas como se hizo alguno:
-- update public.payments set method = 'bizum' where id = '<id>';
```

#### `0005_void_payments.sql`

Anade "deshacer pago": si Dani marca un ticket como pagado por error, puede corregirlo. El
pago no se borra, se marca como deshecho y los tickets vuelven a pendiente.

Es igual de conservadora que la anterior: solo anade columnas vacias a `payments`, un indice,
una guarda y la funcion `void_payment()`. **No modifica ningun pago existente**, y tambien es
idempotente.

Un detalle del que avisa el propio fichero: la primera linea es
`alter type public.notification_type add value if not exists 'payment_voided'`. En Postgres 12
y posteriores funciona dentro de una transaccion, que es lo que usa Supabase. Si tu editor se
quejara con *"cannot be executed in a transaction block"*, ejecuta esa unica linea por
separado y despues el resto del fichero.

#### Y despues, siempre

Pasa la validacion del apartado 6: es la unica forma de confirmar que la base quedo como debe.

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
> nadie. Hasta que las 14 casillas esten marcadas, la aplicacion no esta validada.
>
> El push del navegador no entra en esta lista: esta implementado pero requiere sus propias
> claves y su propia comprobacion, en el apartado "Push del navegador" mas abajo.

Necesitas dos navegadores o dos ventanas privadas para poder estar como Alba y como Dani a
la vez. Anota el resultado de cada punto.

### 1. Las tres migraciones se han ejecutado en orden

Las tres consultas de este punto **se comparan solas** con lo que deberia haber: cada una
devuelve una columna `veredicto`, y basta con que no haya ninguna fila distinta de `ok`. Se
han escrito asi, y no con un recuento a mano, porque un numero fijo se queda obsoleto en
cuanto el esquema crece, que es justo lo que le paso a esta seccion.

**1.a Tablas.**

```sql
with esperado(nombre) as (values
  ('profiles'), ('expenses'), ('expense_photos'), ('payments'), ('payment_expenses'),
  ('notifications'), ('push_subscriptions')
)
select e.nombre,
       case when t.table_name is null then 'FALTA' else 'ok' end as veredicto
  from esperado e
  left join information_schema.tables t
         on t.table_schema = 'public' and t.table_name = e.nombre
 order by veredicto, e.nombre;
```

**1.b Funciones, con su tipo de seguridad y quien puede ejecutarlas.**

```sql
with esperado(nombre, seguridad, authenticated_puede) as (values
  -- Llamables desde la aplicacion
  ('create_expense',              'DEFINER', true),
  ('register_payment',            'DEFINER', true),
  ('void_expense',                'DEFINER', true),
  ('mark_notification_read',      'DEFINER', true),
  ('mark_all_notifications_read', 'DEFINER', true),
  ('replace_expense_photo',        'DEFINER', true),
  ('void_payment',                 'DEFINER', true),
  -- Ayudantes de autorizacion y de texto
  ('is_active_member',            'DEFINER', true),
  ('current_role_name',           'DEFINER', true),
  ('can_register_payment',        'DEFINER', true),
  ('current_display_name',        'DEFINER', true),
  ('format_cents_es',             'INVOKER', true),
  -- Uso interno: NO deben ser ejecutables por el cliente
  ('notify_role',                 'DEFINER', false),
  ('assert_ticket_photo',         'DEFINER', false),
  ('payment_method_phrase',       'INVOKER', false),
  -- Alta de usuario y guardas (funciones de trigger)
  ('handle_new_user',             'DEFINER', true),
  ('touch_updated_at',            'INVOKER', true),
  ('expenses_guard_update',       'INVOKER', true),
  ('profiles_guard_update',       'INVOKER', true),
  ('notifications_guard_update',  'INVOKER', true),
  ('expense_photos_guard_update', 'INVOKER', true),
  ('payments_guard_update',       'INVOKER', true),
  ('push_subscriptions_guard_update', 'INVOKER', true)
)
select e.nombre,
       coalesce(r.security_type, 'NO EXISTE') as seguridad_real,
       e.seguridad                            as seguridad_esperada,
       coalesce(p.puede, false)               as puede_authenticated,
       e.authenticated_puede                  as deberia_poder,
       case
         when r.security_type is null                                   then 'FALTA'
         when r.security_type <> e.seguridad                            then 'SEGURIDAD DISTINTA'
         when coalesce(p.puede, false) <> e.authenticated_puede         then 'PERMISO DISTINTO'
         else 'ok'
       end as veredicto
  from esperado e
  left join information_schema.routines r
         on r.routine_schema = 'public' and r.routine_name = e.nombre
  left join lateral (
    select bool_or(has_function_privilege('authenticated', pr.oid, 'EXECUTE')) as puede
      from pg_proc pr
      join pg_namespace n on n.oid = pr.pronamespace
     where n.nspname = 'public' and pr.proname = e.nombre
  ) p on true
 order by (veredicto <> 'ok') desc, e.nombre;
```

**Dos filas hay que mirar con mas atencion: `notify_role` y `assert_ticket_photo`.** Ambas son
internas y deben salir con `puede_authenticated = false`.

**Sobre `notify_role`:** Es la que fabrica los avisos:
si `puede_authenticated` sale `true`, cualquiera con la clave anon podria inventarse un aviso
de "pago registrado" a nombre de otra persona. Debe salir `false`.

Las funciones de trigger (`touch_updated_at`, `*_guard_update`, `handle_new_user`) figuran con
`puede_authenticated = true` porque conservan el permiso que Postgres concede a `PUBLIC` por
defecto. No es un problema: devuelven `trigger` y Postgres no deja invocarlas fuera del
contexto de un trigger, asi que no son un vector de ataque.

**1.c ¿Ha crecido el esquema por detras de esta guia?**

```sql
select 'tabla' as tipo, t.table_name as nombre
  from information_schema.tables t
 where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
   and t.table_name not in ('profiles','expenses','expense_photos','payments',
                            'payment_expenses','notifications','push_subscriptions')
union all
select 'funcion', p.proname
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname not in ('create_expense','register_payment','void_expense',
                         'mark_notification_read','mark_all_notifications_read',
                         'is_active_member','current_role_name','can_register_payment',
                         'current_display_name','format_cents_es','notify_role',
                         'payment_method_phrase','handle_new_user','touch_updated_at',
                         'expenses_guard_update','profiles_guard_update',
                         'notifications_guard_update','push_subscriptions_guard_update',
                         'replace_expense_photo','assert_ticket_photo',
                         'expense_photos_guard_update','void_payment',
                         'payments_guard_update')
 order by 1, 2;
```

**Esperado: ninguna fila.** Si aparece algo, no es necesariamente un error: significa que el
esquema ha crecido y que **esta seccion se ha quedado atras**. Anade lo nuevo a las listas de
1.a y 1.b antes de seguir, o la validacion dejara de cubrir el proyecto entero.

Si en 1.a o 1.b falta algo, alguna migracion no llego a completarse: revisa el orden
0001 → 0002 → 0003 y vuelve a ejecutarla.

### 2. RLS activo en todas las tablas

```sql
with esperado(nombre) as (values
  ('profiles'), ('expenses'), ('expense_photos'), ('payments'), ('payment_expenses'),
  ('notifications'), ('push_subscriptions')
)
select e.nombre,
       coalesce(t.rowsecurity, false) as rls_activo,
       case when coalesce(t.rowsecurity, false) then 'ok' else 'RLS DESACTIVADO' end as veredicto
  from esperado e
  left join pg_tables t on t.schemaname = 'public' and t.tablename = e.nombre
 order by veredicto, e.nombre;
```

**Esperado:** `ok` en todas. Una tabla sin RLS en un proyecto de Supabase queda **legible por
cualquiera con la clave anon**, que es publica.

```sql
-- Politicas registradas
select tablename, policyname, cmd from pg_policies
 where schemaname in ('public','storage') order by tablename, policyname;
```

Aqui hay dos cosas que comprobar:

1. **No debe aparecer ninguna politica con `cmd = 'DELETE'`**, ni en `public` ni en `storage`:
   sin borrado destructivo significa exactamente eso, y tampoco para un admin.
2. **`notifications` solo debe tener politica de `SELECT`.** Si aparece una de `UPDATE`, es que
   se ha reintroducido el camino directo por PostgREST para marcar leido, que se cerro a
   proposito (ver decision 16 en `docs/DECISIONES.md`).

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

### 5. La foto es obligatoria de verdad, y tiene que existir

En la interfaz, como Alba: el boton de guardar aparece desactivado con el texto "Anade la
foto para guardar" mientras no haya foto.

Pero la regla tiene que sostenerse tambien **sin pasar por la interfaz**. Estas cinco
llamadas son el nucleo de esta comprobacion. Ejecutalas como Alba, desde la consola del
navegador con la sesion abierta.

```js
const id = crypto.randomUUID()
const base = { p_concept: 'Prueba', p_expense_date: '2026-08-27',
               p_total_amount_cents: 1000, p_dani_percent: 50 }

// 5.1 Sin ruta de foto -> debe fallar
await supabase.rpc('create_expense', { ...base, p_id: id, p_storage_path: null })

// 5.2 Ruta inventada, sin fichero detras -> debe fallar
await supabase.rpc('create_expense', { ...base, p_id: id, p_storage_path: `${id}/falsa.jpg` })

// 5.3 Insert directo saltandose la funcion -> debe fallar
await supabase.from('expenses').insert({ concept: 'x', expense_date: '2026-08-27',
  total_amount_cents: 1000, dani_share_cents: 500, other_share_cents: 500 })
```

**Esperado:**

| Caso | Respuesta esperada |
|---|---|
| 5.1 | `Un ticket necesita la foto del justificante` |
| 5.2 | `La foto del ticket no existe o no la has subido tu` |
| 5.3 | Permiso denegado: el `INSERT` directo esta revocado |

Ahora sube un fichero de verdad y prueba los dos casos que quedan:

```js
const otroId = crypto.randomUUID()
const blob = new Blob([new Uint8Array([255,216,255,224,0,16,74,70,73,70,0])], { type: 'image/jpeg' })
await supabase.storage.from('tickets').upload(`${otroId}/prueba.jpg`, blob)

// 5.4 Foto real, pero la ruta pertenece a OTRO ticket -> debe fallar
await supabase.rpc('create_expense', { ...base, p_id: crypto.randomUUID(),
  p_storage_path: `${otroId}/prueba.jpg` })

// 5.5 Foto real y ruta correcta -> debe funcionar
await supabase.rpc('create_expense', { ...base, p_id: otroId,
  p_storage_path: `${otroId}/prueba.jpg` })
```

**Esperado:**

| Caso | Respuesta esperada |
|---|---|
| 5.4 | `La ruta de la foto no corresponde a este ticket` |
| 5.5 | Devuelve el UUID del gasto creado |

> **Si 5.5 falla, mira esto antes que nada.** `create_expense()` comprueba
> `storage.objects.owner = auth.uid()`. En algunas versiones de Supabase Storage esa columna
> convive con `owner_id` (texto) y `owner` puede quedar a null. Si 5.5 devuelve
> `La foto del ticket no existe o no la has subido tu` **aun subiendo tu la foto**, comprueba
> que columna se rellena en tu proyecto:
>
> ```sql
> select name, owner, owner_id from storage.objects
>  where bucket_id = 'tickets' order by created_at desc limit 3;
> ```
>
> Si `owner` viene a null y `owner_id` tiene el uuid, hay que cambiar la comprobacion de
> `create_expense()` (y la politica `tickets_upload_members` de `0003_storage.sql`, que usa
> el mismo criterio) a `o.owner_id = auth.uid()::text`. No lo cambies a ciegas: hazlo solo si
> esta consulta lo confirma.

Comprueba ademas que **la comprobacion ocurre antes de crear nada**: despues de los fallos
5.1, 5.2, 5.3 y 5.4, no debe haber aparecido ningun gasto ni ninguna fila de foto.

```sql
select count(*) as gastos from public.expenses;
select count(*) as fotos  from public.expense_photos;
```

**Esperado:** un unico gasto (el de 5.5) con una unica foto. Si hubiera mas, la funcion esta
insertando antes de validar.

Una comprobacion mas, esta como **Dani**, para verificar que la foto tiene que haberla
subido quien crea el gasto: pidele a Alba la ruta de una foto suya recien subida e intenta
crear un gasto con ella desde la sesion de Dani. **Esperado:** `La foto del ticket no existe
o no la has subido tu`.

> Estas comprobaciones tienen una guarda estatica en `src/__tests__/migrations.test.ts`, que
> verifica que las defensas siguen escritas en el SQL y en el orden correcto. Pero ese test
> **no ejecuta Postgres**: solo lee el texto de las migraciones. Lo unico que demuestra que
> las reglas funcionan es esta seccion, ejecutada contra el proyecto real.

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

### 7. Pago individual, con metodo

Como Dani, abre un ticket pendiente, pulsa "Marcar mi parte como pagada", elige **Bizum** y
confirma. El boton no debe dejar confirmar mientras no haya metodo elegido.

```sql
select p.amount_cents, count(pe.expense_id) as tickets
  from public.payments p
  join public.payment_expenses pe on pe.payment_id = p.id
 group by p.id order by p.paid_at desc limit 5;
```

**Esperado:** el ticket pasa a `pagado`, se crea un pago con `amount_cents` igual a la parte
de Dani, `method = 'bizum'` y una sola fila en `payment_expenses`. Compruebalo:

```sql
select amount_cents, method, notes from public.payments order by paid_at desc limit 1;
```

Prueba tambien que el metodo se valida en el servidor, no solo en la interfaz. Como Dani, en
consola:

```js
await supabase.rpc('register_payment', { p_expense_ids: ['<id-pendiente>'], p_method: 'paypal' })
await supabase.rpc('register_payment', { p_expense_ids: ['<id-pendiente>'], p_method: null })
```

**Esperado:** las dos fallan con `Indica como se ha pagado: bizum, transferencia, efectivo u
otro`, y el ticket **sigue pendiente**.

Prueba tambien el bloqueo por rol: como **Alba**, en consola,
`await supabase.rpc('register_payment', { p_expense_ids: ['<id-de-un-ticket>'] })`.
**Esperado:** `Solo Dani o un administrador pueden registrar pagos`.

### 8. Pago agrupado

Como Dani, con el filtro "Pendientes", marca **tres** tickets, pulsa "Marcar como pagados",
elige **Transferencia** y confirma.

**Esperado:** un unico pago con `method = 'transferencia'`, cuyo `amount_cents` es la suma
exacta de las tres partes de Dani, y tres filas en `payment_expenses` apuntando a ese pago.
Los tres tickets quedan `pagado`. Repite la consulta del punto 7 para verificarlo.

Comprueba ademas que **Alba no puede registrar pagos aunque mande un metodo valido**. Como
Alba, en consola:

```js
await supabase.rpc('register_payment', { p_expense_ids: ['<id-pendiente>'], p_method: 'bizum' })
```

**Esperado:** `Solo Dani o un administrador pueden registrar pagos`.

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

### 12. Notificaciones dentro de la aplicacion

Con las dos sesiones abiertas a la vez, una como Alba y otra como Dani.

**12.1 Alba sube un ticket → Dani recibe aviso.** Como Alba, crea un ticket. Como Dani,
recarga: el indicador de la cabecera debe mostrar un numero, y en Notificaciones debe
aparecer `Alba ha subido un ticket de 12,35 €` con el concepto debajo. Al pulsarlo, debe
abrirse ese ticket y el aviso quedar leido.

**12.2 Pago individual → Alba recibe aviso, con el metodo.** Como Dani, marca un ticket como
pagado por Bizum. Como Alba: `Dani ha marcado como pagado el ticket Farmacia por Bizum`, con
el importe en el cuerpo y enlace al ticket.

**12.3 Pago agrupado → Alba recibe aviso, con el metodo.** Como Dani, marca tres tickets a la
vez por transferencia. Como Alba: `Dani ha marcado como pagados 3 tickets: 40,00 € por
transferencia`, con los conceptos en el cuerpo. Al pulsarlo lleva al historico, porque un
pago agrupado no tiene un unico ticket.

**12.4 Nadie se avisa a si mismo.** Como Dani, sube tu un ticket. Dani **no** debe recibir
aviso de su propia accion; Alba tampoco, porque el aviso de ticket va dirigido al rol `dani`.

```sql
select type, title, recipient_profile_id, expense_id, payment_id, read_at
  from public.notifications order by created_at desc limit 10;
```

**12.5 El buzon es personal.** Como Alba, en consola:

```js
await supabase.from('notifications').select('*')
```

**Esperado:** solo salen las suyas. Compara el recuento con el total real:

```sql
select count(*) from public.notifications;  -- suele ser mayor que lo que ve Alba
```

**12.6 Nadie fabrica ni borra avisos.** Como Alba, en consola:

```js
// Inventar un aviso -> debe fallar
await supabase.from('notifications').insert({ recipient_profile_id: MI_ID,
  type: 'payment_registered', title: 'Falso', body: 'Falso' })

// Borrar un aviso -> debe fallar
await supabase.from('notifications').delete().eq('id', UN_ID)

// Llamar al generador interno -> debe fallar
await supabase.rpc('notify_role', { p_role: 'alba', p_type: 'payment_registered',
  p_title: 'Falso', p_body: 'Falso', p_expense_id: null, p_payment_id: null })

// Reescribir el texto de un aviso propio -> debe fallar
await supabase.from('notifications').update({ title: 'Otra cosa' }).eq('id', MI_AVISO)

// Marcar leido por PostgREST, saltandose la funcion -> debe fallar
await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', MI_AVISO)
```

**Esperado:** las cinco fallan. Las dos ultimas por permiso denegado: el `UPDATE` sobre
`notifications` esta revocado y marcar leido pasa solo por las funciones.

**12.7 Marcar leido funciona, y solo sobre lo propio.** Primero comprueba que la via buena
funciona: como Alba, pulsa "Marcar leido" en un aviso suyo y confirma que el contador de la
cabecera baja. Despues intenta marcar un aviso de Dani:

```js
await supabase.rpc('mark_notification_read', { p_notification_id: AVISO_DE_DANI })
```

**Esperado:** la llamada no da error (no encuentra fila que actualizar), pero el aviso de
Dani **sigue sin leer**. Esto es lo que impide que, al ser la funcion `SECURITY DEFINER`,
se puedan marcar los avisos ajenos. Compruebalo en SQL:

```sql
select id, recipient_profile_id, read_at from public.notifications where id = 'AVISO_DE_DANI';
```

**12.8 Suscripciones push ajenas.** La tabla esta vacia (el push no esta operativo), pero las
politicas deben cerrar igual. Como Alba, en consola:

```js
await supabase.from('push_subscriptions').select('*')            // solo las suyas: hoy, ninguna
await supabase.from('push_subscriptions').insert({ profile_id: ID_DE_DANI,
  endpoint: 'https://ejemplo/x', p256dh: 'x', auth: 'y' })       // debe fallar
await supabase.from('push_subscriptions').delete().eq('id', UN_ID) // debe fallar
```

**Esperado:** la primera devuelve vacio; las otras dos fallan.

### 13. Sustituir la foto de un ticket

**13.1 Cambiar la foto de un pendiente funciona.** Como Alba, abre un ticket pendiente, pulsa
"Cambiar foto", elige otra imagen y guarda. El detalle debe mostrar **solo la nueva**.

**13.2 La anterior sigue existiendo.** Esto es lo importante: no se ha borrado nada.

```sql
select storage_path, created_at, replaced_at, replaced_by
  from public.expense_photos
 where expense_id = '<id-del-ticket>'
 order by created_at;
```

**Esperado:** dos filas. La antigua con `replaced_at` y `replaced_by` puestos; la nueva con
ambos a null. Y el fichero antiguo debe seguir en el bucket:

```sql
select name from storage.objects
 where bucket_id = 'tickets' and name like '<id-del-ticket>/%'
 order by created_at;
```

**Esperado:** los dos ficheros, el viejo incluido. Si falta alguno, algo esta borrando fotos y
eso no debe ocurrir nunca.

**13.3 Un ticket no puede tener dos fotos vigentes.** El indice unico parcial lo impide:

```sql
select expense_id, count(*)
  from public.expense_photos where replaced_at is null
 group by expense_id having count(*) > 1;
```

**Esperado:** ninguna fila.

**13.4 En un ticket pagado no se puede.** Como Dani, marca un ticket como pagado y comprueba
que el boton "Cambiar foto" **ya no aparece**. Y que tampoco funciona por RPC:

```js
await supabase.rpc('replace_expense_photo', { p_expense_id: ID_PAGADO,
  p_storage_path: `${ID_PAGADO}/loquesea.jpg` })
```

**Esperado:** `Solo se puede cambiar la foto de un ticket pendiente`. Repitelo con un ticket
anulado: mismo resultado.

**13.5 Sin permiso sobre ese ticket, no.** Crea un ticket como Dani y, desde la sesion de
Alba, intenta cambiarle la foto por RPC.

**Esperado:** `Solo puedes cambiar la foto de tus propios tickets`.

**13.6 Ruta falsa o ajena, tampoco.** Como Alba, sobre un ticket pendiente suyo:

```js
// Ruta que no existe en Storage
await supabase.rpc('replace_expense_photo', { p_expense_id: ID,
  p_storage_path: `${ID}/inventada.jpg` })

// Ruta real pero de otro ticket
await supabase.rpc('replace_expense_photo', { p_expense_id: ID,
  p_storage_path: 'OTRO_ID/prueba.jpg' })
```

**Esperado:** la primera responde `La foto del ticket no existe o no la has subido tu`; la
segunda, `La ruta de la foto no corresponde a este ticket`. En ambos casos el ticket debe
**conservar su foto original**, sin quedar a medias:

```sql
select count(*) from public.expense_photos
 where expense_id = '<ID>' and replaced_at is null;
```

**Esperado:** exactamente 1.

**13.7 El cliente no puede marcar fotos por su cuenta.** Como Alba, en consola:

```js
await supabase.from('expense_photos').update({ replaced_at: new Date().toISOString() }).eq('id', UNA_FOTO)
await supabase.from('expense_photos').delete().eq('id', UNA_FOTO)
await supabase.rpc('assert_ticket_photo', { p_expense_id: ID, p_storage_path: 'x' })
```

**Esperado:** las tres fallan por permiso denegado.

### 14. Deshacer un pago

**14.1 Pago individual.** Como Dani, marca un ticket como pagado por Bizum. Vuelve a abrirlo:
debe verse "Pagado por Bizum" y un boton **Deshacer pago**. Pulsalo, escribe un motivo y
confirma.

**Esperado:** el ticket vuelve a `pendiente` y reaparece el boton de marcarlo como pagado.

```sql
select status from public.expenses where id = '<id-del-ticket>';
select id, amount_cents, method, voided_at, voided_by, void_reason from public.payments
 order by paid_at desc limit 3;
```

**Esperado:** el gasto en `pendiente`; el pago **sigue existiendo**, con `voided_at`,
`voided_by` y el motivo. `amount_cents` y `method` intactos.

**14.2 Las relaciones tampoco se borran.**

```sql
select pe.payment_id, pe.expense_id, pe.amount_applied_cents
  from public.payment_expenses pe
 where pe.payment_id = '<id-del-pago-deshecho>';
```

**Esperado:** las filas siguen ahi. Deshacer no borra nada.

**14.3 Pago agrupado: vuelven todos.** Como Dani, paga tres tickets juntos. Abre uno: debe
avisar de que el pago cubre 3 tickets y de que al deshacerlo vuelven todos. Confirma.

**Esperado:** los tres pasan a `pendiente`.

```sql
select e.concept, e.status
  from public.expenses e
  join public.payment_expenses pe on pe.expense_id = e.id
 where pe.payment_id = '<id-del-pago>';
```

**Esperado:** los tres en `pendiente`.

**14.4 Alba no puede deshacer.** En la sesion de Alba, el boton no aparece. Y por RPC:

```js
await supabase.rpc('void_payment', { p_payment_id: ID_PAGO })
```

**Esperado:** `Solo Dani o un administrador pueden deshacer pagos`, y el pago sigue vigente.

**14.5 Deshacer dos veces es inocuo.** Como Dani, llama otra vez sobre el mismo pago:

```js
await supabase.rpc('void_payment', { p_payment_id: ID_YA_DESHECHO })
```

**Esperado:** **no da error** — la funcion es idempotente a proposito, para que un doble clic
no muestre un fallo cuando la operacion ya salio bien. Comprueba que no ha pasado nada nuevo:
`voided_at` conserva la fecha original y Alba **no** recibe un segundo aviso.

**14.6 Alba recibe el aviso.** En la sesion de Alba, tras 14.1: `Dani ha deshecho el pago del
ticket Farmacia`, con el importe y "vuelve a pendiente" en el cuerpo. En el agrupado:
`Dani ha deshecho un pago de 3 tickets: 40,00 €`.

**14.7 El cliente no puede tocar payments a mano.** Como Dani, en consola:

```js
await supabase.from('payments').update({ voided_at: new Date().toISOString() }).eq('id', ID)
await supabase.from('payments').update({ amount_cents: 1 }).eq('id', ID)
await supabase.from('payments').delete().eq('id', ID)
await supabase.from('payment_expenses').delete().eq('payment_id', ID)
```

**Esperado:** las cuatro fallan por permiso denegado.

**14.8 En el historico se ve, no desaparece.** Abre Historico: el pago deshecho debe seguir en
la lista, atenuado, con el importe tachado y la etiqueta **Deshecho**, y **fuera** del total
de la cabecera.

### Cuando termines

Borra los tickets de prueba **anulandolos** (no hay otra via, y es intencionado), o vacia
las tablas desde el SQL Editor antes de empezar a usar la aplicacion de verdad:

```sql
-- Solo para dejar limpio tras las pruebas, nunca en uso normal.
truncate public.notifications, public.payment_expenses, public.payments,
         public.expense_photos, public.expenses;
```

Los ficheros de prueba del bucket hay que borrarlos a mano desde **Storage → tickets**, ya
que la aplicacion no borra fotos por diseno.

## 7. Copias de seguridad

Supabase hace copias diarias en los planes de pago. En el plan gratuito conviene
exportar de vez en cuando:

```bash
supabase db dump --db-url "postgresql://..." -f copia-gastos-alba.sql
```
## Push del navegador — implementado, pendiente de configurar

**El codigo esta completo; sin los pasos de abajo no sale ni un envio.** Mientras tanto la
aplicacion funciona igual: el aviso vive en la tabla `notifications` y no depende de esto.

Piezas ya escritas:

| Pieza | Donde |
|---|---|
| Recepcion en el navegador | `public/service-worker.js` (`push`, `notificationclick`) |
| Alta y baja de la suscripcion | `src/features/notifications/push.ts` |
| Boton en la interfaz | `src/features/notifications/PushSetup.tsx`, dentro de Notificaciones |
| Envio | Edge Function `supabase/functions/send-push` |
| Disparador | Trigger `notifications_push_dispatch` (migracion `0006`) |

### Puesta en marcha, en orden

**1. Generar el par de claves VAPID.**

```bash
npx web-push generate-vapid-keys
```

La **publica** va al frontend (lo es por definicion); la **privada** es de servidor y no
entra jamas en el repositorio ni en una variable `VITE_`.

**2. Variables y secretos.**

| Variable | Donde vive |
|---|---|
| `VITE_VAPID_PUBLIC_KEY` | Vercel, entorno del cliente (y `.env.local` en local) |
| `VAPID_PUBLIC_KEY` | Secreto de la Edge Function (la misma clave) |
| `VAPID_PRIVATE_KEY` | Secreto de la Edge Function, solo servidor |
| `VAPID_SUBJECT` | Secreto de la Edge Function: `mailto:` de contacto que exige el estandar |
| `PUSH_HOOK_SECRET` | Secreto compartido entre el trigger y la funcion |

```bash
supabase secrets set \
  VAPID_PUBLIC_KEY='...' \
  VAPID_PRIVATE_KEY='...' \
  VAPID_SUBJECT='mailto:tu@correo.com' \
  PUSH_HOOK_SECRET="$(openssl rand -hex 32)"
```

**3. Desplegar la funcion.**

```bash
supabase functions deploy send-push --no-verify-jwt
```

`--no-verify-jwt` porque quien llama es el trigger de la base de datos, no una persona con
sesion. La funcion no queda abierta: rechaza con 403 todo lo que no traiga la cabecera
`x-push-secret` correcta.

**4. Guardar la URL y el secreto en Vault** (SQL, una sola vez; el secreto tiene que ser
exactamente el mismo `PUSH_HOOK_SECRET` del paso 2):

```sql
select vault.create_secret(
  'https://TU-REF.supabase.co/functions/v1/send-push', 'push_hook_url');
select vault.create_secret('EL_MISMO_PUSH_HOOK_SECRET', 'push_hook_secret');
```

**5. Ejecutar la migracion `0006_push_dispatch.sql`.**

**6. Instalar la app en cada movil.** En iPhone es obligatorio: Compartir → «Anadir a
pantalla de inicio». Luego, abriendo la app **desde ese icono**, entrar en Notificaciones y
pulsar «Activar avisos».

### Limitaciones que hay que tener presentes

- **iOS / Safari:** requiere iOS 16.4 o superior **y** la app anadida a la pantalla de
  inicio. Desde Safari, sin instalar, no hay push: no es un fallo, es como funciona iOS. La
  interfaz lo explica en vez de ofrecer un boton que no haria nada.
- **Android / Chrome:** funciona instalada o desde el navegador. Requiere HTTPS.
- El permiso lo pide un gesto de la persona (el boton), nunca la carga de la pagina.
- Si alguien **deniega** el permiso, no se puede volver a preguntar desde la aplicacion: hay
  que cambiarlo en los ajustes del dispositivo. La interfaz lo dice.
- La suscripcion es **por dispositivo**: activarla en el movil no la activa en el portatil.
- Una suscripcion revocada (app desinstalada, permiso retirado) no se borra: la funcion la
  marca `disabled_at` al recibir un 404 o un 410.

### Como se comprueba que funciona de verdad

No basta con que la suscripcion se guarde. Con la aplicacion **cerrada** en el movil:

1. Alba sube un ticket y al movil de Dani le llega la notificacion del sistema.
2. Al tocarla se abre el ticket correcto.
3. Dani marca un pago y a Alba le llega el suyo.
4. Desinstalar la app en un movil y comprobar que su fila queda con `disabled_at` tras el
   siguiente envio.

Hasta que eso se haya hecho al menos una vez, el push no esta hecho.

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
