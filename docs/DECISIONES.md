# Decisiones tecnicas

Registro de las decisiones con consecuencias. Lo que no esta aqui es convencion normal.

---

## 1. Dinero en centimos enteros, nunca en coma flotante

**Decision.** Todo importe se guarda y se calcula como `integer` de centimos, tanto en
Postgres (`total_amount_cents`, `dani_share_cents`, …) como en TypeScript.

**Por que.** `0.1 + 0.2 !== 0.3` en coma flotante. En una app cuya unica funcion es decir
cuanto debe alguien, un centimo perdido erosiona la confianza en todo lo demas.

**Consecuencia.** Los `number` en coma flotante solo aparecen al leer lo que teclea una
persona (`parseAmountToCents`) y al pintar (`formatCents`). Nunca en medio.

---

## 2. En un reparto impar, el centimo suelto lo asume Dani

**Decision.** `dani = round_half_up(total × porcentaje / 100)` y `otra_parte = total − dani`.
Dicho en una frase: **cuando el reparto no da un numero exacto de centimos, el que sobra se
lo lleva la parte de Dani**, siempre, sin alternancia ni excepciones.

**Por que.** Con 12,35 € al 50% tocan 617,5 centimos por cabeza y el centimo suelto tiene
que ir a algun sitio. Elegir un destino fijo es preferible a alternarlo: es explicable en
una frase, es reproducible, y hace que `dani + otra = total` se cumpla por construccion en
vez de por comprobacion posterior. Se elige la parte de Dani, y no la otra, porque Dani es
quien ve y valida los importes en la aplicacion: quien asume el redondeo es quien puede
comprobarlo.

**Consecuencia.** En importes impares Dani paga un centimo de mas: en un ticket de 12,35 €
son 6,18 € frente a 6,17 €, un 0,00081 % del importe. La regla esta fijada con valores
exactos en `src/lib/__tests__/split.test.ts`, replicada en la funcion `create_expense()` del
servidor y respaldada por el `CHECK` `expenses_shares_match_total`.

---

## 3. Un unico nucleo familiar, sin `household_id`

**Decision.** Cualquier perfil activo ve todos los gastos. No hay tabla de hogares.

**Por que.** El MVP tiene dos usuarios reales. Modelar multi-familia ahora seria construir
la parte dificil de un problema que todavia no existe.

**Consecuencia.** Si algun dia hay varios nucleos, la migracion es `alter table expenses
add column household_id uuid` con un valor por defecto y cambiar el `using` de las
politicas de `expenses`. No queda nada que impida ese camino.

---

## 4. Registro publico cerrado, cuentas creadas a mano

**Decision.** No hay pantalla de "crear cuenta". Las cuentas se crean desde el panel de
Supabase y un admin las activa (`docs/supabase/BOOTSTRAP.md`).

**Por que.** Dos usuarios. Un sistema de invitaciones seria mas codigo, mas superficie de
ataque y mas cosas que pueden fallar, para resolver un alta que ocurre dos veces en la vida
del proyecto.

**Consecuencia.** Triple cierre: registro desactivado en Supabase, perfil creado con
`is_active = false`, y rol nunca tomado de los metadatos del cliente (si se tomara,
cualquiera podria darse de alta como `admin`).

---

## 5. Los pagos se registran con una funcion RPC, no con inserts sueltos

**Decision.** `register_payment(uuid[], text, text, timestamptz)`, `SECURITY DEFINER`, hace
en una sola transaccion: validar el rol, bloquear las filas, crear el `payment`, crear las
filas de `payment_expenses` y pasar los gastos a `pagado`.

**Por que.** Hacerlo con tres llamadas desde el cliente permite que la segunda falle y deje
un gasto marcado como pagado sin pago asociado, o al reves. Ademas resuelve de una vez el
pago agrupado, que era el caso incomodo.

**Consecuencia.** Desde el cliente `payments` y `payment_expenses` son de solo lectura
(`revoke insert, update`). El importe del pago **lo calcula el servidor** sumando las
partes de Dani: el cliente no puede proponer una cantidad distinta de la que suman los
tickets.

---

## 6. El estado de un gasto no se cambia con un `update` normal

**Decision.** Un trigger (`expenses_guard_update`) rechaza cualquier cambio de `status` o
`voided_at` salvo que la transaccion haya activado `app.allow_status_change`, cosa que solo
hacen `register_payment()` y `void_expense()`.

**Por que.** Sin esto, la politica de `UPDATE` que permite a Alba corregir un ticket le
permitiria tambien marcarlo como pagado.

**Consecuencia.** El mismo trigger bloquea cambiar la autoria, el `created_at` y el importe
de un gasto ya pagado, que dejaria descuadrado el pago registrado.

---

## 7. Sin borrado destructivo, en ningun sitio

**Decision.** Ninguna tabla tiene politica `DELETE`, y ademas se revoca el permiso.
Anular es la unica via, mediante `void_expense()`.

**Por que.** Lo pide el documento de producto, y con razon: el valor de la app esta en el
historico. Un borrado accidental desde el movil no tendria vuelta atras.

**Consecuencia.** Tampoco hay borrado en Storage: el bucket de fotos no tiene politica
`DELETE`. Los gastos anulados siguen en la base de datos con `status = 'anulado'` y
`voided_at`. Solo se anula un ticket **pendiente**: uno ya pagado tiene un pago asociado, y
deshacerlo es una operacion deliberada en SQL. La interfaz aplica exactamente la misma
regla que `void_expense()`, para no ofrecer un boton que el servidor va a rechazar.

---

## 8. Bucket privado y URLs firmadas de 5 minutos

**Decision.** El bucket `tickets` es privado. La app pide una URL firmada de 300 segundos
cada vez que muestra una foto.

**Por que.** Las fotos de tickets llevan comercio, fecha, hora, forma de pago y a veces los
ultimos digitos de una tarjeta. Es el dato mas sensible de la aplicacion.

**Consecuencia.** Una URL filtrada caduca sola. A cambio, si alguien deja el detalle de un
ticket abierto mas de cinco minutos y recarga la imagen, hay que volver a firmarla.

**Y tampoco se borran.** El bucket no tiene ninguna politica `DELETE`, para nadie: ni para un
admin. Una foto de ticket es un justificante, y aplica el mismo criterio que a los gastos
(decision 7). La limpieza de ficheros huerfanos es mantenimiento manual desde el panel de
Supabase, deliberado y fuera de la aplicacion; no un flujo operativo.

---

## 9. La foto se sube antes de crear el gasto, y el gasto se crea de forma atomica

**Decision.** El identificador del gasto se genera en el cliente (`crypto.randomUUID()`), la
foto se sube a `tickets/{id}/...` y despues una funcion `create_expense()` inserta la fila del
gasto y la de la foto **en una sola transaccion**.

**Por que.** Subir la foto al final deja tickets sin justificante cuando la subida falla, que
en movil con mala cobertura es justo lo que mas falla. Y hacer los dos `insert` por separado
desde el cliente permite que el segundo falle y deje un ticket visible cuya foto, ya subida,
no esta enlazada a nada.

**Detalle.** `create_expense()` es `SECURITY INVOKER`, no `DEFINER`: no necesita elevar
privilegios, solo atomicidad, asi que las politicas RLS siguen aplicandose a los dos inserts.
Ademas recalcula el reparto en el servidor a partir del total y del porcentaje, de modo que
el cliente no puede proponer unas partes que no cuadren con el importe.

**Consecuencia asumida.** Si la subida va bien pero la transaccion falla, queda un fichero
huerfano en el bucket. Es invisible para las dos personas que usan la app y no cuesta dinero
apreciable. Limpiarlo automaticamente exigiria una funcion programada; queda anotado como
tarea de mantenimiento, no como bug.

---

## 9 bis. Un ticket con 0% para Dani se cierra sin registrar un pago

**Decision.** Si el lote de tickets a liquidar suma cero, `register_payment()` marca los
tickets como pagados y **no** crea ninguna fila en `payments`. Devuelve `null`.

**Por que.** El reparto admite 0% para Dani (el documento de producto contempla
explicitamente el caso 100/0). Sin este camino, un ticket que Dani no paga se quedaba
`pendiente` para siempre: el importe del pago habria sido 0 y el `CHECK` de
`payments.amount_cents > 0` lo rechazaba. Era un callejon sin salida en la interfaz.

**Consecuencia.** `payment_expenses.amount_applied_cents` admite 0, para que un ticket de 0
que se liquida junto a otros quede igualmente enlazado al pago y el rastro no se rompa. Un
pago de 0,00 EUR nunca aparece en el historico, porque no ha movido dinero.

---

## 9 ter. La foto del ticket es obligatoria

**Decision.** No se puede dar de alta un gasto sin foto. La regla se aplica en tres capas: el
boton de guardar esta desactivado sin foto, `createExpense` exige `photo: File` (no
opcional, no nullable), y `create_expense()` rechaza en el servidor cualquier alta sin
`p_storage_path`.

**Por que.** El MVP existe para sustituir un flujo de WhatsApp por un registro con
justificante. Un ticket sin foto es una cifra que nadie puede comprobar despues: justo lo
que ya se tenia. Permitirlo "por comodidad" habria erosionado el unico rasgo que hace util
la aplicacion.

**Detalle importante.** Para que la regla del servidor no sea decorativa, `create_expense()`
es la **unica** via de alta: se ha revocado el permiso de `INSERT` directo sobre `expenses`
y `expense_photos`, y se han retirado sus politicas de insercion. Sin eso, cualquiera con la
clave anon podria crear un ticket sin foto llamando a PostgREST a mano, saltandose la
comprobacion. Como contrapartida, la funcion pasa a ser `SECURITY DEFINER` y asume ella
misma las comprobaciones que antes hacian las politicas: perfil activo y `created_by`
forzado a `auth.uid()`.

**Y no basta con recibir una ruta.** Comprobar solo que `p_storage_path` no viene vacio deja
otro hueco: una llamada manual a la RPC con una ruta inventada crea un ticket con metadatos
de foto pero **sin foto real**. El justificante seria una ficcion, y el detalle del gasto
mostraria un error de carga donde deberia estar la imagen. Antes de insertar nada,
`create_expense()` comprueba tres cosas:

1. que la ruta empiece por `{id-del-gasto}/`, la convencion que usa el cliente, de modo que
   no se pueda enlazar como justificante la foto de otro ticket;
2. que exista una fila en `storage.objects` con ese `name` en el bucket `tickets`;
3. que su `owner` sea `auth.uid()`, es decir, que la subiera quien esta creando el gasto.

Si falla cualquiera de las tres, no se crea ni el gasto ni la fila de la foto. Que la
comprobacion vaya **antes** de los `insert` es parte de la decision, no un detalle de
estilo. Como efecto secundario, `p_id` pasa a ser obligatorio: sin el no hay con que
contrastar la ruta.

**Contrapartida.** El nombre del bucket queda escrito en la funcion. Si algun dia cambia,
hay que tocarlo en tres sitios a la vez: esta funcion, `0003_storage.sql` y
`VITE_SUPABASE_TICKETS_BUCKET`. Esta anotado en el propio SQL.

**Consecuencia.** El caso "gasto sin justificante" (un pago del que no hay ticket, o un
ticket perdido) **no existe** en esta version, y es deliberado. Si algun dia hace falta,
entra como excepcion explicita y visible —con su propio estado o marca—, nunca como un campo
opcional que se cuela por descuido.

---

## 9 quater. Un perfil solo puede cambiarse el nombre visible

**Decision.** El trigger `profiles_guard_update()` usa lista blanca: quien no es admin solo
puede modificar `display_name`. Cualquier otra columna, incluida `email`, queda bloqueada.
`role` e `is_active` siguen siendo exclusivos de un admin, y `id` y `created_at` son
inmutables para todo el mundo.

**Por que.** La politica de RLS permite a cada persona actualizar su propia fila, pero eso es
demasiado grueso: `email` lo gestiona Supabase Auth, y dejar que el cliente lo reescriba
desconectaria la fila de `profiles` de la cuenta real, con la que se resuelve el acceso.

**Detalle.** La comprobacion no enumera columnas: compara la fila entera convertida a JSON
quitando `display_name` y `updated_at`. Asi, cualquier campo que se anada en el futuro queda
protegido por omision en lugar de quedar abierto por descuido.

---

## 10. Sin libreria de estado ni de consultas

**Decision.** Un hook propio de 30 lineas (`useAsyncData`) y `useState`. Nada de Redux,
Zustand ni TanStack Query.

**Por que.** Siete pantallas, dos usuarios y ninguna pantalla que necesite datos en vivo.
Una libreria de consultas resolveria un problema de cache que aqui no existe.

**Consecuencia.** No hay cache entre pantallas: volver al listado vuelve a consultar. Con
este volumen de datos es imperceptible. Si algun dia molesta, TanStack Query entra sin
tocar nada mas que los hooks.

---

## 11. PWA con service worker escrito a mano

**Decision.** Manifiesto y service worker propios en `public/`, sin `vite-plugin-pwa`.

**Por que.** El plugin trae Workbox y una capa de generacion para una cache que aqui cabe
en cuarenta lineas. Y el detalle importante —que las respuestas de Supabase no se cacheen
jamas— se ve mejor escrito de forma explicita que configurado.

**Consecuencia.** El service worker solo toca peticiones `GET` del mismo origen. Ni fotos
ni datos de gastos quedan en el cache del navegador a traves de el.

---

## 12. CSS plano

**Decision.** Un unico `index.css` con variables, sin Tailwind ni libreria de componentes.

**Por que.** La app tiene siete pantallas. Un framework de CSS pesaria mas que el problema
que resuelve y anadiria una cadena de build extra.

**Consecuencia.** El modo claro y el oscuro se definen con `prefers-color-scheme` sobre
las mismas variables. Todo el diseno cabe en un fichero legible de una sentada.

---

## 13. Los avisos viven dentro de la aplicacion. Nada de email

**Decision.** Cuando Alba sube un ticket, Dani recibe un aviso; cuando Dani marca un pago,
lo recibe Alba. Ese aviso es una fila en la tabla `notifications`, visible en la propia
aplicacion, con indicador de no leidos en la cabecera.

**Fuera de alcance, y no por olvido:** email, WhatsApp y Telegram. Cada uno de esos canales
significa un proveedor externo, credenciales que guardar, datos de contacto que almacenar y
un sitio mas donde acaban apareciendo conceptos de tickets. Para dos personas que ya abren
la aplicacion, no compensa.

**Por que se generan en el servidor.** Los avisos los crea `notify_role()`, llamada desde
`create_expense()` y `register_payment()`, dentro de la misma transaccion que el hecho que
notifican. Asi no puede existir un aviso de un pago que no ocurrio, ni un pago del que nadie
se entera. El cliente no tiene `INSERT` sobre `notifications`, y `notify_role()` no tiene
`EXECUTE` concedido a nadie: si lo tuviera, cualquiera podria fabricar un aviso falso a
nombre de otra persona.

**Detalles decididos.**

- Se avisa a **todos** los perfiles activos con el rol destinatario, no a uno concreto. Con
  dos cuentas da igual, pero definirlo evita que el dia que haya una tercera el aviso se
  pierda en silencio.
- **Nadie se avisa a si mismo.** Si Dani corrige y sube el un ticket, no recibe un aviso de
  su propia accion.
- Un aviso **se marca leido, no se borra**: sin politica `DELETE`, igual que los gastos.
- De una fila de `notifications` solo puede cambiar `read_at`. El texto y el enlace quedan
  congelados: son el registro de lo que se dijo en su momento.
- El buzon es **estrictamente personal**. Es la unica tabla del proyecto que no comparte el
  nucleo familiar: los gastos son de los dos, pero un aviso va dirigido a una persona.

**Sondeo, no tiempo real.** El contador de no leidos se refresca cada minuto y al volver a
la pestana. Supabase Realtime funcionaria, pero es una conexion permanente y mas
configuracion para ganar un minuto en un aviso domestico.

---

## 14. El push del navegador queda preparado, no operativo

**Decision.** Existen la tabla `push_subscriptions` con sus politicas y los manejadores
`push` y `notificationclick` en el service worker. **No existe** ni el alta de la suscripcion
desde el cliente ni nada que envie un push. Hoy no llega ninguno, y la aplicacion no depende
de ello: el aviso in-app funciona por su cuenta.

**Por que no esta terminado.** Un push real necesita cuatro piezas, y tres de ellas no se
pueden dejar hechas ni verificadas sin credenciales del proyecto: un par de claves VAPID, el
alta de la suscripcion en el navegador, una funcion servidor que firme y envie, y un
disparador desde la base de datos. Escribir ese codigo sin poder ejecutarlo una sola vez
seria dejar algo que parece hecho y no lo esta, que es peor que dejarlo pendiente.

**Lo que falta, exactamente,** esta en el apartado "Push" de `docs/supabase/BOOTSTRAP.md`. La
parte que si esta escrita —el service worker— es correcta y funcionara el dia que llegue un
push, pero **no se ha podido probar** porque no hay nada que envie.

**Sin secretos en el cliente.** La clave privada VAPID es de servidor. En el frontend solo
entraria la clave publica, que es publica por definicion. La `service_role` no aparece por
ningun lado, ni aparecera.

---

## 15. Se registra COMO se pagó, pero aquí no se paga

**Decision.** Al marcar un ticket como pagado hay que elegir metodo: Bizum, transferencia,
efectivo u otro. Es un enum de Postgres (`payment_method`) y la columna `payments.method` es
obligatoria.

**Que NO es esto.** No hay pago dentro de la aplicacion. No hay integracion con Bizum, ni con
ningun banco, ni pasarela de pago. El dinero se mueve fuera, como siempre; aqui solo se anota
con que medio, para que el historico tenga sentido dentro de un mes. Tampoco se piden ni se
guardan IBAN, telefono, referencia de operacion ni justificante bancario: para saber que algo
se pago por Bizum no hace falta ninguno de esos datos.

**Enum y no texto libre.** Con texto libre acabarian conviviendo "bizum", "Bizum", "BIZUM" y
"por bizum", y el historico dejaria de poder agruparse. Cuatro valores cubren el caso real;
`otro` recoge lo demas y `notes` sigue siendo texto libre para aclarar.

**Elegir es obligatorio, sin valor por defecto.** Se decidio obligar en lugar de caer en
`otro`: si el formulario viniera preseleccionado, se registraria "Bizum" en todo por inercia
y el dato dejaria de servir. El servidor tambien lo exige, no solo la interfaz: la funcion
rechaza cualquier valor fuera del conjunto.

**Excepcion coherente.** Un lote que suma cero (tickets con 0% para Dani) no crea fila en
`payments`, asi que no pide metodo: no se ha movido dinero que describir.

**En los avisos.** El texto lo incluye cuando aporta: "Dani ha marcado como pagado el ticket
Farmacia por Bizum". La preposicion va dentro de la etiqueta (`payment_method_phrase`) para
que la frase se lea bien sin encadenar casos en cada sitio que la componga.

---

## 16. Marcar un aviso como leido pasa solo por las funciones

**Decision.** Se ha revocado el `UPDATE` sobre `notifications` y retirado su politica. La
unica via es `mark_notification_read()` y `mark_all_notifications_read()`, que pasan a ser
`SECURITY DEFINER`.

**Por que.** Con una politica de `UPDATE`, el cliente podia escribir `read_at` directamente
por PostgREST. No rompia la privacidad —el trigger impedia tocar el resto de campos y la
politica limitaba a las filas propias—, pero dejaba el contrato mas abierto de lo necesario:
dos defensas encadenadas donde basta una puerta.

**Contrapartida, y por que importa.** Al ser `DEFINER`, esas funciones ya no estan protegidas
por RLS: el filtro `recipient_profile_id = auth.uid()` que llevan dentro es ahora lo unico que
impide marcar como leidos los avisos de la otra persona. Por eso comprueban ademas que quien
llama tenga un perfil activo, y por eso hay un test estatico que verifica que ese filtro sigue
escrito.

**No cambia.** Sigue sin poder tocarse `title`, `body`, `type`, `expense_id`, `payment_id`,
`recipient_profile_id` ni `actor_profile_id` —el trigger sigue puesto—, y sigue sin haber
`DELETE`.

---

## 17. La foto se puede sustituir, pero la anterior no se borra

**Decision.** En un ticket **pendiente** se puede cambiar la foto. La anterior no desaparece:
se queda en la tabla y en el bucket con `replaced_at` y `replaced_by` puestos, y deja de ser
la vigente. No existe "borrar la foto" a secas.

**Por que hacia falta.** Alba fotografia tickets con el movil, a veces con prisa y a
contraluz. Si sale movida o es la equivocada, hasta ahora la unica salida era anular el ticket
y volver a crearlo entero. Eso es fricción real en el uso diario, y ademas ensuciaba el
historico con anulaciones que no eran anulaciones de verdad.

**Solo pendientes, y esto es mas estricto que editar.** Un ticket pagado o anulado no cambia
de foto ni siquiera para Dani, que si puede corregirle el importe (decision 7). La razon: una
vez pagado, el justificante forma parte de lo acordado; cambiarlo despues seria reescribir la
prueba de algo ya cerrado. `canReplacePhoto` en el cliente y `replace_expense_photo()` en el
servidor aplican exactamente la misma regla.

**El invariante vive en la base de datos.** Un indice unico parcial
(`expense_photos_one_current_idx`, sobre `expense_id where replaced_at is null`) garantiza que
un ticket no pueda tener dos fotos vigentes. No depende de que la funcion de sustitucion sea
correcta: aunque tuviera un fallo, Postgres lo impediria.

**Y la regla del justificante esta en un solo sitio.** `create_expense()` y
`replace_expense_photo()` comparten `assert_ticket_photo()`: ruta con la convencion del
ticket, objeto que existe de verdad en Storage y `owner = auth.uid()`. Si cada una llevara su
copia, bastaria con que un camino se quedara atras para poder colar una foto inexistente por
la puerta nueva. Es de uso interno y no tiene `EXECUTE` para nadie.

**Sin marcha atras.** Una foto ya reemplazada no se puede des-reemplazar: el trigger lo
impide. El historico de justificantes es de solo avance.

---

## 18. Un pago se puede deshacer, y el pago deshecho se queda

**Decision.** Dani (o un admin) puede deshacer un pago registrado por error. El pago **no se
borra**: se marca con `voided_at`, `voided_by` y un motivo opcional, conserva importe, metodo,
notas y sus filas de `payment_expenses`, y los tickets que cubria vuelven a `pendiente`.

**Que NO es esto.** No se devuelve dinero. No hay banco, ni Bizum, ni pasarela. Se corrige el
estado registrado en la aplicacion, igual que el metodo de pago es solo una etiqueta
(decision 15). Si el dinero ya se movio de verdad, eso se arregla fuera.

**Por que hacia falta.** Marcar pagado es un boton, y los botones se pulsan mal. Sin deshacer,
la unica salida era editar la base de datos a mano. Ahora hay un camino en la aplicacion, con
rastro.

**Solo Dani y admin.** Alba no deshace pagos: es quien registra los gastos, no quien los paga.
`canVoidPayment` en el cliente y `void_payment()` en el servidor aplican la misma regla, y la
funcion comprueba el rol por dentro porque es `SECURITY DEFINER`.

**Se deshace el pago ENTERO, tambien el agrupado.** Si un pago cubria tres tickets, al
deshacerlo vuelven los tres. Deshacer solo uno obligaria a recalcular `amount_cents` del pago,
que es justo el dato que no debe tocarse: es lo que se transfirio. La alternativa —dejar el
importe y descuadrarlo respecto a los tickets que cubre— seria peor. Si algun dia hace falta,
el camino limpio es deshacer el pago entero y volver a registrar los que si tocaban. La
interfaz avisa del alcance antes de confirmar, porque es la parte que mas se malinterpreta.

**Es idempotente.** Deshacer dos veces no falla ni avisa dos veces. Un doble clic no debe
mostrar un error cuando la operacion ya salio bien. Se aparta a proposito de la alternativa
—fallar con "ya estaba deshecho"— porque el caso real es el doble clic, no el intento
malicioso.

**Solo revierte los tickets que siguen pagados.** Un ticket puede pagarse, deshacerse y
volverse a pagar con otro pago. Al deshacer el primero, el `update` filtra por
`status = 'pagado'`, asi que no toca los que ya cubre un pago posterior.

**Los totales no mienten.** El resumen mira el estado del gasto, no la tabla de pagos, asi que
se corrige solo. En el historico los pagos deshechos siguen viendose, tachados y marcados, y
quedan fuera del total.

---

## 19. Camara y fototeca son dos botones, no uno

En iOS, un `<input type="file">` con el atributo `capture` va DIRECTO a la camara. No es que
la ofrezca primero: es que la fototeca deja de ser alcanzable. Los dos inputs de la aplicacion
llevaban `capture="environment"`, asi que desde el iPhone solo se podia fotografiar el ticket
en ese momento; una foto ya guardada no habia manera de subirla.

**Dos inputs, dos botones.** Uno con `capture` para "Hacer foto" y otro sin el para "Elegir de
Fotos". El segundo, en iOS, abre el menu propio del sistema (Fototeca / Hacer foto / Elegir
archivo), asi que aunque el primero fallara la fototeca seguiria estando a mano.

**En el ordenador solo se muestra uno.** Alli `capture` se ignora y los dos botones abririan el
mismo dialogo de archivos, que es peor que no tener eleccion. Se distingue por
`(pointer: coarse)`, no por user agent: un portatil tactil vera los dos botones y ninguno de
los dos hara nada raro.

El almacenamiento no cambia: la foto sigue comprimiendose en el movil y subiendose al bucket
privado igual que antes.

---

## 20. El badge del icono va detras del contador de dentro

La Badging API existe en iOS desde 16.4, pero solo para la PWA instalada en la pantalla de
inicio, solo con permiso de notificaciones concedido, y solo se actualiza mientras la
aplicacion esta abierta o mientras el service worker atiende un push. Sin push, un cambio que
haga la otra persona no puede pintar el numero en un icono cerrado: no hay nadie ejecutando
codigo.

**Asi que el badge no es una fuente de verdad, es un reflejo.** Se pinta el mismo numero de
avisos sin leer que ya calcula `NotificationsProvider`, sin estado propio que pueda
desincronizarse, y se limpia solo cuando el contador baja a cero. Donde la API no existe
(ordenador, Chrome en Android) no hace nada y el aviso sigue siendo la campana de la cabecera.

**El permiso se pide con un boton, no al entrar.** Un prompt de notificaciones nada mas abrir
es la forma mas rapida de que alguien pulse "No permitir" y deje el badge inservible para
siempre. Va en la pagina de notificaciones y solo aparece si la API esta y el permiso sigue sin
decidir.

El push real sigue siendo lo que falta para que el numero aparezca con la aplicacion cerrada.
Sigue sin construirse (decision 14).

## Anotado para mas adelante (no construido)

- OCR del ticket para prerrellenar importe y fecha, siempre corregible a mano.
- Invitacion de una segunda persona pagadora.
- Repartos por importe fijo, ademas de por porcentaje.
- Varios hijos o varios nucleos (`household_id`, ver decision 3).
- Push real del navegador: claves VAPID, alta de suscripcion y funcion de envio (decision 14).
- Avisos de tickets pendientes acumulados, y resumen mensual.
- Email, WhatsApp y Telegram como canales de aviso: descartados, no pendientes (decision 13).
- Limpieza programada de ficheros huerfanos en el bucket (ver decision 9). Hoy es una tarea
  manual desde el panel de Supabase, no un flujo de la aplicacion. Las fotos sustituidas
  (decision 17) NO son huerfanas: se conservan a proposito y no deben limpiarse.
- Ver en la interfaz las fotos anteriores de un ticket. Hoy se guardan y son consultables por
  SQL, pero el detalle solo muestra la vigente, que es lo que hace falta para decidir un pago.
- Excepcion "gasto sin justificante", para un ticket perdido o un pago sin comprobante (ver
  decision 9 ter). Fuera de alcance a proposito en esta version.
- Pago real dentro de la aplicacion, integracion con Bizum, con un banco o con una pasarela:
  descartado, no pendiente (decision 15). Aqui solo se registra lo que ocurre fuera.
- Deshacer un unico ticket de un pago agrupado (decision 18). Hoy se deshace el pago entero.
