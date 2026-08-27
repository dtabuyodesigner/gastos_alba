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
> nadie. Hasta que las 12 casillas esten marcadas, la aplicacion no esta validada.
>
> El push del navegador no entra en esta lista porque **no esta implementado**: ver el
> apartado "Push del navegador" mas abajo.

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

## Push del navegador — PENDIENTE, no operativo

**Estado actual: no llega ningun push, y no se ha probado ningun envio.** Lo unico que existe
es la infraestructura de recepcion:

- la tabla `push_subscriptions` con sus politicas RLS (creada en `0001` y `0002`);
- los manejadores `push` y `notificationclick` en `public/service-worker.js`.

Los avisos dentro de la aplicacion **no dependen de esto** y funcionan sin ello.

### Lo que falta, en orden

**1. Generar el par de claves VAPID.**

```bash
npx web-push generate-vapid-keys
```

La **publica** puede ir al frontend (es publica por definicion); la **privada** es de
servidor y no entra jamas en el repositorio ni en una variable `VITE_`.

| Variable | Donde vive |
|---|---|
| `VITE_VAPID_PUBLIC_KEY` | Frontend (Vercel, entorno del cliente) |
| `VAPID_PRIVATE_KEY` | Solo servidor (Supabase Edge Function secrets) |
| `VAPID_SUBJECT` | Solo servidor: `mailto:` de contacto que exige el estandar |

**2. Alta de la suscripcion desde el cliente.** Falta escribir: pedir permiso con
`Notification.requestPermission()`, suscribirse con
`registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })` y
guardar `endpoint`, `p256dh` y `auth` en `push_subscriptions`. La tabla y las politicas ya
lo admiten.

**3. Funcion servidor que envie.** Una Edge Function de Supabase que lea las suscripciones
activas del destinatario, firme con la clave privada VAPID y haga el envio (con `web-push` o
equivalente). Debe marcar `disabled_at` cuando el endpoint responda 404 o 410: una
suscripcion caducada no se borra, se desactiva.

**4. Disparador.** Un webhook de base de datos sobre `insert` en `notifications` que llame a
esa funcion. De este modo el push seria un canal adicional del aviso que ya existe, no un
camino paralelo que pueda desincronizarse.

### Checklist de permisos, para cuando se implemente

- **Android / Chrome:** funciona con la PWA instalada o desde el navegador. Requiere HTTPS.
- **iOS / Safari:** requiere iOS 16.4 o superior **y** que la aplicacion este anadida a la
  pantalla de inicio. Desde Safari, sin instalar, no hay push. Es la limitacion mas
  importante a tener en cuenta, porque afecta al caso real de uso.
- El permiso lo debe pedir un gesto de la persona (un boton), nunca al cargar la pagina: los
  navegadores penalizan lo segundo y algunos lo bloquean.
- Si alguien deniega el permiso, no se puede volver a preguntar desde la aplicacion: hay que
  cambiarlo en los ajustes del navegador. Conviene que la interfaz lo diga.
- Comprobar que el service worker esta registrado (`navigator.serviceWorker.getRegistration()`)
  antes de intentar suscribir.

### Como se comprobaria que funciona de verdad

No basta con que la suscripcion se guarde. Habria que verificar, con la aplicacion **cerrada**
en el movil: que Alba sube un ticket y al movil de Dani le llega la notificacion del sistema;
que al tocarla se abre el ticket correcto; y que una suscripcion revocada queda con
`disabled_at`. Hasta que eso se haya hecho al menos una vez, el push no esta hecho.

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
