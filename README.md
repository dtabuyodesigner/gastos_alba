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
- Todo queda en un historico consultable. Nada se borra: los tickets se anulan.
- Cada quien recibe un aviso **dentro de la aplicacion** de lo que hace la otra persona:
  Dani cuando Alba sube un ticket, Alba cuando Dani marca un pago. Con indicador de no
  leidos en la cabecera.

Anotar el metodo es solo eso: **una etiqueta de registro**. La aplicacion no mueve dinero, no
habla con Bizum ni con ningun banco, no hay pasarela de pago y no se guarda ningun dato
bancario. El dinero se mueve fuera, como siempre.

Los avisos **no salen de la aplicacion**: no hay email, ni WhatsApp, ni Telegram, y es
deliberado (ver `docs/DECISIONES.md`). El push del navegador esta preparado pero **no
operativo**: falta configurarlo, y el apartado "Push" de `docs/supabase/BOOTSTRAP.md` dice
exactamente que.

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

Ejecutalos en ese orden desde el SQL Editor de Supabase.

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
docs/             Decisiones tecnicas y guia de Supabase
```

## Notas de privacidad

- El bucket de fotos es privado. Las imagenes solo se sirven con URLs firmadas de 5 minutos.
- El service worker solo cachea recursos del propio origen; ninguna foto ni dato de gasto
  queda en el cache del navegador a traves de el.
- No se piden ni se guardan DNI, telefono, direccion, datos bancarios ni datos personales
  de la madre. La "otra parte" del reparto es solo un concepto economico.
- `robots.txt` desaconseja la indexacion y las paginas llevan `noindex`.
