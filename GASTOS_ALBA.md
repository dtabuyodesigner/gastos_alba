# Gastos Alba

Documento de contexto y arranque para continuar el desarrollo en un proyecto independiente llamado **Gastos Alba**.

Este documento no pertenece a la aplicacion de Marcos ni debe implicar mezclar repositorios, usuarios, datos, bases de datos ni despliegues. La idea es reutilizar aprendizajes, patrones y arquitectura de **La Libreta de Marcos** como referencia tecnica y de producto, pero crear una aplicacion separada.

## Resumen

**Gastos Alba** es una aplicacion sencilla para registrar tickets de gastos compartidos relacionados con Alba.

El objetivo inicial es sustituir el flujo disperso por WhatsApp por un registro ordenado:

1. Alba sube una foto del ticket.
2. Alba indica importe, concepto y fecha.
3. La aplicacion calcula automaticamente el reparto, por defecto 50/50.
4. Dani consulta los tickets, ve su parte y marca pagos.
5. Queda un historico claro de tickets, importes, estados y justificantes.

La madre no necesita cuenta ni datos personales para el MVP. La otra parte puede existir solo como concepto economico: "otra parte". Una segunda persona pagadora o invitada puede plantearse mas adelante, pero no es requisito inicial.

## Vision

Crear una herramienta privada, ligera y mobile-first para gestionar gastos compartidos con justificante fotografico.

La aplicacion debe ser:

- facil de usar desde movil;
- privada por defecto;
- clara en importes y estados;
- resistente a errores;
- sin borrados destructivos;
- preparada para evolucionar sin sobredimensionar el MVP.

La prioridad no es crear una app financiera compleja, sino resolver bien un flujo familiar concreto: ticket, importe, reparto, consulta y pago.

## Principios

- Proyecto independiente de La Libreta de Marcos.
- Reutilizar aprendizajes, no datos.
- No mezclar Supabase, usuarios ni buckets con la app de Marcos.
- Mobile-first.
- Minimos datos personales.
- Fotos privadas.
- Importes guardados en centimos.
- Registro controlado, no publico indiscriminado.
- Sin borrado destructivo por defecto.
- Estados simples y auditables.

## MVP

El MVP debe permitir:

- iniciar sesion con usuarios autorizados;
- crear un gasto con foto del ticket;
- introducir importe total;
- introducir concepto;
- introducir o ajustar fecha del gasto;
- aplicar reparto 50/50 por defecto;
- permitir cambiar el reparto de forma excepcional;
- ver listado de gastos;
- ver detalle de cada gasto con foto;
- ver la parte correspondiente a Dani;
- marcar la parte de Dani como pagada;
- agrupar pagos para liquidar varios tickets juntos;
- conservar historico de gastos y pagos.

## Roles

### Alba

Rol orientado a captura de gastos.

Puede:

- iniciar sesion;
- subir foto de ticket;
- crear gasto;
- editar datos basicos de un gasto si todavia no esta liquidado;
- consultar sus tickets;
- ver si la parte de Dani esta pendiente o pagada.

No necesita:

- gestionar usuarios;
- ver configuracion avanzada;
- acceder a datos tecnicos;
- introducir datos de la madre.

### Dani

Rol orientado a consulta, validacion y pago.

Puede:

- iniciar sesion;
- ver todos los gastos de Alba;
- abrir la foto del ticket;
- comprobar importe, concepto, fecha y reparto;
- ver su parte calculada;
- marcar un gasto como pagado;
- crear pagos agrupados para varios tickets;
- corregir o ajustar un gasto si hace falta;
- consultar historico.

### Otra parte

En el MVP no es una cuenta de usuario.

Existe solo como parte conceptual del reparto:

- otra parte 50%;
- otra parte 30%;
- otra parte 0%;
- etc.

No se deben guardar datos personales de la madre para el MVP. No email, no telefono, no nombre completo, no perfil.

## Flujo Principal

### Alta de gasto

1. Alba abre la app desde el movil.
2. Pulsa una accion clara tipo "Nuevo ticket".
3. Hace foto o selecciona imagen del ticket.
4. Introduce importe total.
5. Introduce concepto.
6. Confirma o cambia la fecha.
7. La app propone reparto 50/50.
8. Alba guarda.

Resultado:

- ticket registrado;
- foto privada asociada;
- parte de Dani calculada;
- estado inicial pendiente.

### Revision de Dani

1. Dani entra en la app.
2. Ve listado de tickets pendientes.
3. Abre un ticket.
4. Revisa foto, importe, concepto, fecha y reparto.
5. Marca su parte como pagada cuando corresponda.

### Pago agrupado

Debe existir o preverse un flujo para pagar varios tickets juntos.

Ejemplo:

- Ticket A: parte Dani 12,30 EUR.
- Ticket B: parte Dani 8,50 EUR.
- Ticket C: parte Dani 19,20 EUR.
- Pago agrupado: 40,00 EUR.

La aplicacion debe poder reflejar que un unico pago cubre varios gastos.

## Estados

Estados recomendados para un gasto:

- `pendiente_revision`: gasto subido, pendiente de revisar o asumir.
- `pendiente_pago`: gasto valido, parte de Dani pendiente.
- `pagado`: la parte de Dani esta pagada.
- `anulado`: gasto descartado sin eliminarlo fisicamente.

Para el MVP puede simplificarse a:

- `pendiente`;
- `pagado`;
- `anulado`.

La decision final debe favorecer claridad visual para Alba y Dani.

## Modelo De Datos Conceptual

Modelo orientativo, no implementacion cerrada.

### users / profiles

Usuarios autenticados.

Campos conceptuales:

- id;
- nombre visible;
- email;
- rol: `alba`, `dani`, `admin`;
- activo;
- created_at;
- updated_at.

### expenses

Gastos o tickets.

Campos conceptuales:

- id;
- created_by;
- expense_date;
- concept;
- total_amount_cents;
- currency;
- dani_share_cents;
- other_share_cents;
- dani_share_percent;
- other_share_percent;
- split_type;
- status;
- notes;
- created_at;
- updated_at;
- deleted_at nullable para soft delete o anulacion logica.

Notas:

- Guardar importes en centimos, nunca como float.
- `dani_share_cents + other_share_cents` debe cuadrar con `total_amount_cents`, salvo reglas explicitas de redondeo.
- El reparto por defecto es 50/50.
- El reparto debe poder ser configurable por gasto.

### expense_photos

Fotos privadas de tickets.

Campos conceptuales:

- id;
- expense_id;
- storage_path;
- original_filename opcional;
- mime_type;
- size_bytes;
- uploaded_by;
- created_at.

Notas:

- Las fotos deben almacenarse en un bucket privado.
- El acceso debe resolverse mediante URLs firmadas o una capa segura equivalente.
- No hacer publico el bucket.

### payments

Pagos realizados por Dani.

Campos conceptuales:

- id;
- paid_by;
- paid_at;
- amount_cents;
- method opcional;
- notes;
- created_at.

### payment_expenses

Relacion entre pagos y gastos.

Campos conceptuales:

- payment_id;
- expense_id;
- amount_applied_cents.

Permite que un pago cubra varios tickets y que el historico sea trazable.

## Seguridad, Auth Y RLS

La app debe usar autenticacion real, preferiblemente Supabase Auth si se mantiene el patron de La Libreta de Marcos.

Requisitos:

- registro no abierto al publico sin control;
- usuarios autorizados previamente o mediante invitacion/codigo;
- sesiones seguras;
- politicas RLS activas;
- separacion estricta por proyecto;
- bucket privado para tickets;
- ningun acceso anonimo a fotos o gastos;
- no exponer claves de servicio en frontend;
- no confiar en controles solo de interfaz.

Politicas orientativas:

- Alba puede crear y ver sus gastos.
- Dani puede ver y gestionar los gastos vinculados al nucleo familiar configurado.
- Solo roles autorizados pueden marcar pagos.
- Nadie puede acceder a fotos sin permiso.

## Privacidad

Datos minimos del MVP:

- nombre visible de Alba;
- email de acceso;
- foto del ticket;
- importe;
- concepto;
- fecha;
- estado de pago.

No pedir ni guardar en el MVP:

- DNI;
- telefono;
- direccion;
- datos personales de la madre;
- informacion bancaria;
- documentos no necesarios.

Las fotos de tickets pueden contener datos sensibles o rastros personales, por lo que deben tratarse como privadas.

## Decisiones Iniciales

- Nombre provisional del proyecto: **Gastos Alba**.
- Aplicacion independiente de **La Libreta de Marcos**.
- Reutilizar arquitectura y aprendizajes, no repositorio ni datos en produccion.
- MVP con dos usuarios reales: Alba y Dani.
- La madre no tiene cuenta en el MVP.
- Reparto por defecto: 50/50.
- Reparto configurable por gasto.
- Importes en centimos.
- Fotos en storage privado.
- Sin borrado destructivo; usar anulacion o soft delete.
- PWA desplegable en Vercel.
- Backend y datos en Supabase, si se mantiene el patron validado.

## Fuera De Alcance Inicial

No incluir en el MVP:

- OCR automatico de tickets;
- invitaciones a terceros;
- cuenta para la madre;
- chat interno;
- notificaciones complejas;
- conciliacion bancaria;
- pagos reales dentro de la app;
- integracion con Bizum, banco o pasarela;
- multi-familia;
- multiples hijos;
- estadisticas avanzadas;
- exportaciones fiscales;
- gestion documental compleja.

## Fases Futuras

### OCR

Leer automaticamente importe, fecha y comercio desde la foto del ticket.

Debe ser una mejora, no una dependencia del MVP. El usuario siempre debe poder corregir los datos.

### Invitaciones

Permitir invitar a una segunda persona pagadora si algun dia interesa.

Debe ser opcional y controlado, nunca obligatorio.

### Repartos Distintos

Soportar casos como:

- 50/50;
- 70/30;
- 100/0;
- importe fijo para Dani;
- importe fijo para otra parte.

### Grupos E Hijos

Evolucion futura para soportar:

- varios hijos;
- varios grupos familiares;
- distintos porcentajes por hijo o categoria.

No debe condicionar el MVP salvo en evitar decisiones que bloqueen esta evolucion.

### Notificaciones

Avisos opcionales:

- nuevo ticket subido;
- pago marcado;
- tickets pendientes acumulados;
- resumen mensual.

## PWA, Vercel Y Supabase

Propuesta tecnica inicial:

- PWA mobile-first.
- Despliegue en Vercel.
- Supabase para Auth, base de datos y Storage.
- RLS desde el primer dia.
- Variables de entorno separadas.
- Proyecto Supabase propio, no compartido con Marcos.
- Buckets propios.
- Dominio o subdominio propio si procede.

La aplicacion debe funcionar bien instalada en el movil, con acceso rapido a crear ticket.

## Criterios De Validacion

Antes de dar el MVP por cerrado, validar:

- Alba puede iniciar sesion.
- Dani puede iniciar sesion.
- Un usuario no autorizado no puede entrar.
- Alba puede crear un gasto con foto, importe, concepto y fecha.
- El reparto 50/50 se calcula correctamente.
- Un reparto distinto puede guardarse correctamente.
- Los importes se guardan y calculan en centimos.
- Dani ve su parte exacta.
- Dani puede marcar un ticket como pagado.
- Un pago agrupado puede asociarse a varios tickets, si esta funcionalidad entra en el MVP.
- La foto del ticket no es publica.
- RLS impide leer datos sin permiso.
- No hay claves privadas expuestas en frontend.
- Anular un gasto no lo borra fisicamente.
- El historico sigue siendo consultable.
- La aplicacion funciona correctamente en movil.

## Primeros Pasos Recomendados

1. Crear un repositorio nuevo para **Gastos Alba**.
2. Crear un proyecto Supabase nuevo y separado.
3. Definir roles iniciales: Alba y Dani.
4. Diseñar el modelo minimo de tablas.
5. Activar RLS desde el inicio.
6. Crear bucket privado para fotos de tickets.
7. Implementar autenticacion controlada.
8. Construir pantalla mobile-first de "Nuevo ticket".
9. Construir listado y detalle de tickets.
10. Implementar calculo 50/50 con importes en centimos.
11. Implementar marcado de pago.
12. Validar seguridad antes de compartir la URL.

## Nota De Handoff

Este archivo esta pensado para copiarse o moverse al nuevo proyecto **Gastos Alba** y servir como punto de partida para Claude, Codex/ChatGPT o cualquier otro agente de desarrollo.

La tarea inicial no es ampliar La Libreta de Marcos, sino crear una nueva aplicacion inspirada en sus aprendizajes. Cualquier decision tecnica debe preservar esa separacion.
