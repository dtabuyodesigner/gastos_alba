# Gastos Alba

Aplicacion privada y mobile-first para registrar tickets de gastos compartidos y saber
en todo momento que parte le toca pagar a Dani.

Proyecto **independiente**. No comparte repositorio, base de datos, usuarios, buckets ni
despliegue con La Libreta de Marcos. El contexto de producto vive en
[`GASTOS_ALBA.md`](GASTOS_ALBA.md).

## Que hace

- Alba entra desde el movil y sube la foto de un ticket con importe, concepto y fecha.
  La foto es obligatoria: sin justificante no se puede guardar un ticket.
- El reparto por defecto es 50/50 y se puede ajustar por gasto. Cuando el reparto no da un
  numero exacto de centimos, **el centimo suelto lo asume siempre Dani** (en un ticket de
  12,35 € al 50%: 6,18 € Dani y 6,17 € la otra parte). Es una simplificacion deliberada;
  el razonamiento esta en `docs/DECISIONES.md`.
- Dani ve los tickets, su parte exacta y la marca como pagada, de una en una o en grupo,
  anotando como pago: Bizum, transferencia, efectivo u otro.
- Si marca un pago por error puede deshacerlo: los tickets vuelven a pendiente y el pago
  queda en el historico como deshecho. No se borra nada, y no se devuelve dinero: se corrige
  el estado registrado en la aplicacion.
- Si la foto sale movida o es la equivocada, se puede sustituir mientras el ticket siga
  pendiente. La anterior no se borra: se conserva marcada como reemplazada.
- Todo queda en un historico consultable. Nada se borra: los tickets se anulan.
- Cada quien recibe un aviso **dentro de la aplicacion** de lo que hace la otra persona:
  Dani cuando Alba sube un ticket, Alba cuando Dani marca un pago. Con indicador de no
  leidos en la cabecera.
- Si alguien olvida la contrasena, puede pedir un enlace desde la pantalla de entrada y
  guardar una nueva desde la propia app.

Anotar el metodo es solo eso: **una etiqueta de registro**. La aplicacion no mueve dinero, no
habla con Bizum ni con ningun banco, no hay pasarela de pago y no se guarda ningun dato
bancario. El dinero se mueve fuera, como siempre.

No hay avisos por email, ni WhatsApp, ni Telegram, y es deliberado (ver
`docs/DECISIONES.md`). El unico canal fuera de la aplicacion es el **push del navegador**,
operativo desde el 2026-09-07: la notificacion salta en el movil con la aplicacion cerrada, y
el contador del icono se actualiza con ella. Requiere configuracion propia —claves VAPID, la
Edge Function desplegada y la app instalada en la pantalla de inicio de cada movil—, y sin
ella los avisos siguen viviendo solo dentro de la aplicacion, que funciona igual. Los pasos,
y que mirar cuando no llega nada, estan en el apartado "Push del navegador" de
`docs/supabase/BOOTSTRAP.md`.

## Stack

| Pieza | Eleccion |
|---|---|
| Interfaz | React 19 + TypeScript, Vite 7 |
| Rutas | react-router-dom 7 |
| Backend | Supabase (Auth + Postgres + Storage) |
| Estilos | CSS plano con variables, sin framework |
| Tests | Vitest |
| Despliegue | Vercel (pendiente) |

La app es una PWA instalable: manifiesto en `public/manifest.webmanifest` y un service
worker propio en `public/service-worker.js` que **nunca** cachea respuestas de Supabase.

## Puesta en marcha

Requisitos: Node.js 20.19 o superior.

```bash
npm install
cp .env.example .env.local   # y rellena los valores
npm run dev                  # http://localhost:5173
```

### Variables de entorno

Todas son publicas por definicion: viajan al navegador. La seguridad real la dan las
politicas RLS, no el secreto de la clave.

| Variable | Que es |
|---|---|
| `VITE_SUPABASE_URL` | URL del proyecto Supabase de Gastos Alba |
| `VITE_SUPABASE_ANON_KEY` | Clave `anon` / public del proyecto |
| `VITE_SUPABASE_TICKETS_BUCKET` | Nombre del bucket privado de fotos (por defecto `tickets`) |

**Nunca** pongas aqui la `service_role` key. La app comprueba activamente que no lo hayas
hecho y se niega a arrancar si detecta una.

### Supabase

Antes de que la app funcione hay que preparar el proyecto Supabase. Los pasos estan en
[`docs/supabase/BOOTSTRAP.md`](docs/supabase/BOOTSTRAP.md) y el SQL en
[`supabase/migrations/`](supabase/migrations/):

1. `0001_init.sql` — tablas, constraints, indices, funciones y triggers.
2. `0002_rls.sql` — Row Level Security y permisos.
3. `0003_storage.sql` — bucket privado de fotos y sus politicas.
4. `0004_update_after_mvp_reviews.sql` — parche idempotente **solo para bases que ya
   ejecutaron los tres anteriores en una version antigua**.
5. `0005_void_payments.sql` — deshacer pagos. Necesario en cualquier base ya en marcha.
6. `0006_push_dispatch.sql` — disparador del push del navegador. Solo hace algo si has
   completado la configuracion del push; si no, es inofensivo.

En un proyecto nuevo ejecuta 1, 2 y 3 en ese orden desde el SQL Editor; el 4 y el 5 no hacen
falta (y tampoco estorban), y el 6 va cuando montes el push. Si tu proyecto ya estaba creado, ejecuta los parches que te
falten: reejecutar el 1 no aplicaria los cambios, porque crea las tablas con
`create table if not exists`. El detalle esta en `docs/supabase/BOOTSTRAP.md`.

## Comandos

| Comando | Que hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Comprobacion de tipos y build de produccion |
| `npm run preview` | Sirve el build en local |
| `npm run test` | Tests unitarios (Vitest) |
| `npm run lint` | ESLint |
| `npm run typecheck` | Solo comprobacion de tipos |
| `npm run validate` | lint + test + build, todo seguido |
| `npm run icons` | Regenera los iconos de la PWA |

## Estructura

```
src/
  lib/            Dominio puro y sin React: dinero, reparto, fechas, tipos, cliente Supabase
  features/
    auth/         Sesion, perfil, login y puerta de acceso
    expenses/     Alta, listado, detalle y edicion de tickets
    notifications/ Buzon de avisos dentro de la app
    payments/     Registro de pagos (individuales y agrupados)
    photos/       Subida, compresion y URLs firmadas
  components/     Piezas de interfaz compartidas
  pages/          Inicio, historico y 404
supabase/
  migrations/     SQL a ejecutar en orden
  functions/      Edge Functions (send-push: envio del push del navegador)
docs/             Decisiones tecnicas y guia de Supabase
```

## Notas de privacidad

- El bucket de fotos es privado. Las imagenes solo se sirven con URLs firmadas de 5 minutos.
- El service worker solo cachea recursos del propio origen; ninguna foto ni dato de gasto
  queda en el cache del navegador a traves de el.
- No se piden ni se guardan DNI, telefono, direccion, datos bancarios ni datos personales
  de la madre. La "otra parte" del reparto es solo un concepto economico.
- `robots.txt` desaconseja la indexacion y las paginas llevan `noindex`.
