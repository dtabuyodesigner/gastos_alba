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

## 2. El redondeo del reparto va siempre a la parte de Dani

**Decision.** `dani = round_half_up(total × porcentaje / 100)` y `otra_parte = total − dani`.

**Por que.** Con 12,35 € al 50% tocan 617,5 centimos por cabeza y el centimo suelto tiene
que ir a algun sitio. Repartirlo de forma determinista y siempre igual es preferible a
alternarlo: es explicable en una frase y hace que `dani + otra = total` se cumpla por
construccion, no por comprobacion posterior.

**Consecuencia.** En importes impares Dani paga un centimo de mas. En un ticket de 12,35 €
eso es 0,00081 % del importe. Queda cubierto por tests y por un `CHECK` en la base de datos.

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

**Consecuencia.** Los gastos anulados siguen en la base de datos con `status = 'anulado'` y
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

## Anotado para mas adelante (no construido)

- OCR del ticket para prerrellenar importe y fecha, siempre corregible a mano.
- Invitacion de una segunda persona pagadora.
- Repartos por importe fijo, ademas de por porcentaje.
- Varios hijos o varios nucleos (`household_id`, ver decision 3).
- Avisos de tickets pendientes acumulados.
- Limpieza programada de ficheros huerfanos en el bucket (ver decision 9).
