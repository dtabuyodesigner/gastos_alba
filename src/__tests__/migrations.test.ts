import { describe, it, expect } from 'vitest'
import initSql from '../../supabase/migrations/0001_init.sql?raw'
import rlsSql from '../../supabase/migrations/0002_rls.sql?raw'
import storageSql from '../../supabase/migrations/0003_storage.sql?raw'
import updateSql from '../../supabase/migrations/0004_update_after_mvp_reviews.sql?raw'
import voidPaymentsSql from '../../supabase/migrations/0005_void_payments.sql?raw'
import { PAYMENT_METHODS } from '../features/payments/methods'

/**
 * Guardas sobre el TEXTO de las migraciones.
 *
 * ESTO NO EJECUTA POSTGRES. No prueba que el SQL sea valido, ni que las
 * politicas funcionen, ni que las funciones hagan lo que dicen: para eso esta
 * la checklist de docs/supabase/BOOTSTRAP.md, que hay que pasar contra un
 * Supabase real antes de produccion.
 *
 * Lo que si hace es detectar que alguien retire por descuido una de las
 * defensas que costo razonar. Cada comprobacion de aqui corresponde a una
 * decision documentada en docs/DECISIONES.md.
 */

/** Cuerpo de una funcion plpgsql, de su cabecera hasta el cierre `$$;`. */
function functionBody(sql: string, name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`)
  expect(start, `no se encuentra la funcion ${name}`).toBeGreaterThan(-1)
  const end = sql.indexOf('\n$$;', start)
  expect(end, `no se encuentra el final de ${name}`).toBeGreaterThan(start)
  return sql.slice(start, end)
}

describe('create_expense', () => {
  const body = functionBody(initSql, 'create_expense')

  it('es SECURITY DEFINER con search_path fijado', () => {
    // DEFINER porque el INSERT directo esta revocado; el search_path fijo evita
    // que se pueda secuestrar a que tablas apunta.
    expect(body).toMatch(/security definer/)
    expect(body).toMatch(/set search_path = public, pg_temp/)
  })

  it('exige el identificador del ticket, sin el no hay con que contrastar la ruta', () => {
    expect(body).toMatch(/if p_id is null then\s*\n\s*raise exception/)
  })

  it('delega la regla del justificante en el helper compartido', () => {
    // Extraida a assert_ticket_photo() para que create_expense() y
    // replace_expense_photo() no puedan divergir: si cada una llevara su copia,
    // bastaria con que un camino se quedara atras.
    expect(body).toMatch(/public\.assert_ticket_photo\(v_id, p_storage_path\)/)
  })

  it('comprueba la foto ANTES de insertar nada', () => {
    // El orden es lo que garantiza que un fallo no deje un gasto a medias.
    const check = body.indexOf('assert_ticket_photo')
    const insertExpense = body.indexOf('insert into public.expenses')
    const insertPhoto = body.indexOf('insert into public.expense_photos')
    expect(check).toBeGreaterThan(-1)
    expect(check).toBeLessThan(insertExpense)
    expect(insertExpense).toBeLessThan(insertPhoto)
  })

  it('fuerza la autoria y el estado inicial, sin fiarse del cliente', () => {
    expect(body).toMatch(/v_id, auth\.uid\(\)/)
    expect(body).toMatch(/'pendiente'/)
  })
})

describe('permisos de las migraciones', () => {
  it('el alta de gastos y fotos solo pasa por create_expense', () => {
    expect(rlsSql).toMatch(/revoke insert on public\.expenses from authenticated/)
    expect(rlsSql).toMatch(/revoke insert, update on public\.expense_photos from authenticated/)
    expect(rlsSql).not.toMatch(/create policy expenses_insert_members/)
    expect(rlsSql).not.toMatch(/create policy expense_photos_insert_members/)
  })

  it('create_expense solo la puede ejecutar un usuario autenticado', () => {
    expect(rlsSql).toMatch(/revoke all on function public\.create_expense\([^)]*\) from public, anon/)
    expect(rlsSql).toMatch(/grant execute on function public\.create_expense\([^)]*\) to authenticated/)
  })

  it('ninguna tabla permite borrar', () => {
    expect(rlsSql).toMatch(/revoke delete on public\.profiles/)
    expect(rlsSql).not.toMatch(/for delete/)
  })
})

describe('storage', () => {
  it('el bucket de tickets es privado', () => {
    expect(storageSql).toMatch(/'tickets',\s*\n\s*false,/)
    expect(storageSql).toMatch(/set public\s*=\s*false/)
  })

  it('no hay ninguna politica de borrado de fotos, ni para un admin', () => {
    // Una foto es un justificante: mismo criterio que con los gastos.
    expect(storageSql).not.toMatch(/create policy[\s\S]*for delete/)
  })
})

describe('reparto', () => {
  it('el servidor replica el redondeo half-up hacia la parte de Dani', () => {
    const body = functionBody(initSql, 'create_expense')
    expect(body).toMatch(/floor\(\(p_total_amount_cents \* v_percent\) \/ 100 \+ 0\.5\)/)
    expect(body).toMatch(/v_other := p_total_amount_cents - v_dani/)
  })

  it('el invariante del reparto esta como CHECK en la tabla', () => {
    expect(initSql).toMatch(/dani_share_cents \+ other_share_cents = total_amount_cents/)
  })
})

describe('notificaciones', () => {
  it('el buzon es estrictamente personal', () => {
    // Solo hay politica de lectura, y limitada al destinatario. La escritura va
    // por las funciones (ver el test de marcar leido).
    expect(rlsSql).toMatch(/create policy notifications_select_own[\s\S]*?recipient_profile_id = auth\.uid\(\)/)
  })

  it('el cliente no puede fabricar avisos ni borrarlos', () => {
    // Sin esto se podria inventar un aviso de "pago registrado" que no ocurrio.
    expect(rlsSql).toMatch(/revoke insert, update on public\.notifications from authenticated/)
    expect(rlsSql).toMatch(/revoke delete on[\s\S]*?public\.notifications/)
    expect(rlsSql).not.toMatch(/create policy notifications_insert/)
  })

  it('notify_role no es ejecutable por nadie desde fuera', () => {
    expect(rlsSql).toMatch(/revoke all on function public\.notify_role\([\s\S]*?from public, anon, authenticated/)
    expect(rlsSql).not.toMatch(/grant execute on function public\.notify_role/)
  })

  it('marcar leido solo pasa por las funciones, no por PostgREST', () => {
    expect(rlsSql).toMatch(/revoke insert, update on public\.notifications from authenticated/)
    expect(rlsSql).not.toMatch(/create policy notifications_update_own/)
    for (const fn of ['mark_notification_read', 'mark_all_notifications_read']) {
      const body = functionBody(initSql, fn)
      expect(body).toMatch(/security definer/)
      expect(body).toMatch(/set search_path = public, pg_temp/)
      // Al ser DEFINER, sin este filtro se podrian marcar los avisos ajenos.
      expect(body).toMatch(/recipient_profile_id = auth\.uid\(\)/)
      expect(body).toMatch(/is_active_member\(\)/)
    }
  })

  it('de un aviso solo se puede cambiar si esta leido', () => {
    const guard = functionBody(initSql, 'notifications_guard_update')
    expect(guard).toMatch(/to_jsonb\(new\) - 'read_at'/)
  })

  it('nadie se avisa a si mismo de lo que acaba de hacer', () => {
    const notify = functionBody(initSql, 'notify_role')
    expect(notify).toMatch(/p\.id is distinct from auth\.uid\(\)/)
    expect(notify).toMatch(/p\.is_active/)
  })

  it('los avisos se generan dentro de las funciones de alta y de pago', () => {
    expect(functionBody(initSql, 'create_expense')).toMatch(/notify_role\(\s*\n?\s*'dani'/)
    expect(functionBody(initSql, 'register_payment')).toMatch(/'alba'/)
  })
})

describe('suscripciones push', () => {
  it('cada usuario solo ve y toca las suyas', () => {
    for (const policy of ['select', 'insert', 'update']) {
      expect(rlsSql).toMatch(
        new RegExp(`create policy push_subscriptions_${policy}_own[\\s\\S]*?profile_id = auth\\.uid\\(\\)`),
      )
    }
    expect(rlsSql).not.toMatch(/create policy push_subscriptions_delete/)
  })
})

describe('metodo de pago', () => {
  it('el enum del SQL coincide con la lista de la interfaz', () => {
    expect(initSql).toMatch(
      /create type public\.payment_method as enum \('bizum', 'transferencia', 'efectivo', 'otro'\)/,
    )
    expect([...PAYMENT_METHODS]).toEqual(['bizum', 'transferencia', 'efectivo', 'otro'])
  })

  it('la columna es del enum y obligatoria', () => {
    expect(initSql).toMatch(/method\s+public\.payment_method not null/)
  })

  it('register_payment rechaza un metodo fuera del conjunto', () => {
    const body = functionBody(initSql, 'register_payment')
    expect(body).toMatch(/not in \('bizum', 'transferencia', 'efectivo', 'otro'\)/)
    // La validacion va dentro del if de importe positivo: un lote que suma cero
    // no crea pago y por tanto no necesita metodo.
    const guard = body.indexOf("not in ('bizum'")
    const insert = body.indexOf('insert into public.payments')
    expect(guard).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(insert)
  })
})

describe('assert_ticket_photo', () => {
  const body = functionBody(initSql, 'assert_ticket_photo')

  it('exige ruta, que corresponda al ticket, y que la foto exista y sea tuya', () => {
    expect(body).toMatch(/v_path is null/)
    expect(body).toMatch(/v_path not like \(p_expense_id::text \|\| '\/%'\)/)
    expect(body).toMatch(/from storage\.objects/)
    expect(body).toMatch(/o\.bucket_id = 'tickets'/)
    expect(body).toMatch(/o\.name = v_path/)
    expect(body).toMatch(/o\.owner = auth\.uid\(\)/)
  })

  it('es interna: nadie puede ejecutarla desde fuera', () => {
    expect(rlsSql).toMatch(/revoke all on function public\.assert_ticket_photo\([\s\S]*?from public, anon, authenticated/)
    expect(rlsSql).not.toMatch(/grant execute on function public\.assert_ticket_photo/)
  })
})

describe('sustituir la foto de un ticket', () => {
  const body = functionBody(initSql, 'replace_expense_photo')

  it('solo en tickets pendientes', () => {
    expect(body).toMatch(/v_expense\.status <> 'pendiente'/)
  })

  it('comprueba el permiso sobre ese ticket concreto', () => {
    expect(body).toMatch(/v_role not in \('dani', 'admin'\) and v_expense\.created_by <> auth\.uid\(\)/)
  })

  it('reutiliza la regla del justificante', () => {
    expect(body).toMatch(/public\.assert_ticket_photo\(p_expense_id, p_storage_path\)/)
  })

  it('marca la anterior como reemplazada en vez de borrarla', () => {
    expect(body).toMatch(/set replaced_at = now\(\)/)
    expect(body).not.toMatch(/delete from/)
    // Y la marca ANTES de insertar la nueva, para no romper el indice unico.
    expect(body.indexOf('set replaced_at')).toBeLessThan(body.indexOf('insert into public.expense_photos'))
  })

  it('es SECURITY DEFINER, con search_path fijado y solo para authenticated', () => {
    expect(body).toMatch(/security definer/)
    expect(body).toMatch(/set search_path = public, pg_temp/)
    expect(rlsSql).toMatch(/grant execute on function public\.replace_expense_photo\([^)]*\) to authenticated/)
    expect(rlsSql).toMatch(/revoke all on function public\.replace_expense_photo\([^)]*\) from public, anon/)
  })
})

describe('historico de fotos', () => {
  it('un ticket no puede tener dos fotos vigentes', () => {
    expect(initSql).toMatch(
      /create unique index if not exists expense_photos_one_current_idx[\s\S]*?where replaced_at is null/,
    )
  })

  it('de una foto solo se puede marcar que fue reemplazada, y una sola vez', () => {
    const guard = functionBody(initSql, 'expense_photos_guard_update')
    expect(guard).toMatch(/to_jsonb\(new\) - 'replaced_at' - 'replaced_by'/)
    expect(guard).toMatch(/old\.replaced_at is not null/)
  })

  it('el cliente no puede insertar ni marcar fotos por su cuenta', () => {
    expect(rlsSql).toMatch(/revoke insert, update on public\.expense_photos from authenticated/)
    expect(rlsSql).toMatch(/revoke delete on[\s\S]*?public\.expense_photos/)
  })
})

describe('0004: puesta al dia de una base ya inicializada', () => {
  /** El SQL sin lineas de comentario, para no confundir lo dicho con lo hecho. */
  const codigo = updateSql
    .split('\n')
    .filter((linea) => !linea.trimStart().startsWith('--'))
    .join('\n')

  /** Nombres de todas las funciones definidas en un fichero SQL, en orden. */
  function functionNames(sql: string): string[] {
    return [...sql.matchAll(/create or replace function public\.(\w+)\s*\(/g)].map((m) => m[1] as string)
  }

  it('no contiene ninguna sentencia destructiva', () => {
    // Se ejecuta sobre la base real de Dani, con sus tickets y sus fotos dentro.
    expect(codigo).not.toMatch(/drop table/i)
    expect(codigo).not.toMatch(/truncate/i)
    expect(codigo).not.toMatch(/delete from/i)
    expect(codigo).not.toMatch(/drop column/i)
    expect(codigo).not.toMatch(/drop schema|drop database/i)
  })

  it('copia las funciones sin separarse del original', () => {
    // Esta es la guarda que hace viable tener las definiciones por duplicado:
    // si alguien cambia una funcion en 0001 y se olvida del parche, la base ya
    // inicializada se quedaria con la version antigua sin que nadie lo notara.
    const original = [...functionNames(initSql), ...functionNames(rlsSql)]
    const enParches = [...functionNames(updateSql), ...functionNames(voidPaymentsSql)]

    // Entre 0004 y 0005 deben estar todas: quien va al dia ejecuta los dos.
    expect([...new Set(enParches)].sort()).toEqual([...new Set(original)].sort())

    for (const [fichero, sql] of [
      ['0004', updateSql],
      ['0005', voidPaymentsSql],
    ] as const) {
      for (const nombre of functionNames(sql)) {
        const fuente = initSql.includes(`create or replace function public.${nombre}(`) ? initSql : rlsSql
        expect(functionBody(sql, nombre), `la copia de ${nombre} en ${fichero} ha divergido`).toBe(
          functionBody(fuente, nombre),
        )
      }
    }
  })

  it('aplica los cambios que un create table if not exists no puede aplicar', () => {
    expect(codigo).toMatch(/alter table public\.expense_photos add column if not exists replaced_at/)
    expect(codigo).toMatch(/alter table public\.expense_photos add column if not exists replaced_by/)
    expect(codigo).toMatch(/add constraint expense_photos_replaced_consistency/)
    expect(codigo).toMatch(/create unique index if not exists expense_photos_one_current_idx/)
    expect(codigo).toMatch(/alter column method type public\.payment_method/)
    expect(codigo).toMatch(/alter table public\.payments alter column method set not null/)
    expect(codigo).toMatch(/create table if not exists public\.notifications/)
    expect(codigo).toMatch(/create table if not exists public\.push_subscriptions/)
  })

  it('borra create_expense antes de recrearla', () => {
    // Los parametros p_notes y p_storage_path se intercambiaron de posicion.
    // Los tipos coinciden, asi que create or replace fallaria con
    // "cannot change name of input parameter".
    // Sobre el codigo, no sobre el fichero: una linea comentada no cuenta.
    const drop = codigo.indexOf('drop function if exists public.create_expense(')
    const create = codigo.indexOf('create or replace function public.create_expense(')
    expect(drop).toBeGreaterThan(-1)
    expect(drop).toBeLessThan(create)
  })

  it('retira el borrado de fotos que permitia la version antigua de 0003', () => {
    expect(codigo).toMatch(/drop policy if exists tickets_delete_admin on storage\.objects/)
    expect(codigo).not.toMatch(/create policy tickets_delete_admin/)
  })

  it('se puede ejecutar dos veces: todo es idempotente', () => {
    for (const m of codigo.matchAll(/^create (?:unique )?index (?!if not exists)/gm)) {
      throw new Error(`indice sin "if not exists": ${codigo.slice(m.index, m.index + 80)}`)
    }
    for (const m of codigo.matchAll(/^create table (?!if not exists)/gm)) {
      throw new Error(`tabla sin "if not exists": ${codigo.slice(m.index, m.index + 80)}`)
    }
    // Toda politica creada se borra antes, para poder reejecutar el fichero.
    for (const m of codigo.matchAll(/create policy (\w+)/g)) {
      expect(codigo, `falta el drop previo de la politica ${m[1]}`).toContain(
        `drop policy if exists ${m[1]}`,
      )
    }
  })
})

describe('deshacer pagos', () => {
  const body = functionBody(initSql, 'void_payment')

  it('solo Dani o un admin, y comprobado en el servidor', () => {
    expect(body).toMatch(/v_role not in \('dani', 'admin'\)/)
    expect(body).toMatch(/security definer/)
    expect(body).toMatch(/set search_path = public, pg_temp/)
    expect(rlsSql).toMatch(/grant execute on function public\.void_payment\(uuid, text\) to authenticated/)
    expect(rlsSql).toMatch(/revoke all on function public\.void_payment\(uuid, text\) from public, anon/)
  })

  it('no borra nada: marca el pago y devuelve los tickets a pendiente', () => {
    expect(body).not.toMatch(/delete from/)
    expect(body).toMatch(/set voided_at\s+= now\(\)/)
    expect(body).toMatch(/set status = 'pendiente'/)
    // Solo revierte los que siguen pagados: si el ticket ya se pago de nuevo
    // con otro pago, no se le toca.
    expect(body).toMatch(/and status = 'pagado'/)
  })

  it('usa el mismo candado de estado que register_payment', () => {
    expect(body).toMatch(/set_config\('app\.allow_status_change', 'on', true\)/)
    expect(body).toMatch(/set_config\('app\.allow_status_change', 'off', true\)/)
  })

  it('bloquea los tickets antes de tocarlos', () => {
    const lock = body.indexOf('for update')
    const update = body.indexOf("set status = 'pendiente'")
    expect(lock).toBeGreaterThan(-1)
    expect(lock).toBeLessThan(update)
  })

  it('es idempotente: deshacer dos veces no avisa dos veces', () => {
    const early = body.indexOf('return; -- idempotente')
    const notify = body.indexOf('notify_role')
    expect(early).toBeGreaterThan(-1)
    expect(early).toBeLessThan(notify)
  })

  it('avisa a Alba de que el ticket vuelve a pendiente', () => {
    expect(body).toMatch(/'alba',\s*\n\s*'payment_voided'/)
  })

  it('de un pago solo puede marcarse que se ha deshecho, y una vez', () => {
    const guard = functionBody(initSql, 'payments_guard_update')
    expect(guard).toMatch(/to_jsonb\(new\) - 'voided_at' - 'voided_by' - 'void_reason'/)
    expect(guard).toMatch(/old\.voided_at is not null/)
  })

  it('el cliente no puede tocar payments directamente', () => {
    expect(rlsSql).toMatch(/revoke insert, update on public\.payments/)
    expect(rlsSql).toMatch(/revoke delete on[\s\S]*?public\.payments/)
  })
})

describe('0005: deshacer pagos sobre una base ya en marcha', () => {
  const codigo = voidPaymentsSql
    .split('\n')
    .filter((linea) => !linea.trimStart().startsWith('--'))
    .join('\n')

  it('no contiene ninguna sentencia destructiva', () => {
    expect(codigo).not.toMatch(/drop table/i)
    expect(codigo).not.toMatch(/truncate/i)
    expect(codigo).not.toMatch(/delete from/i)
    expect(codigo).not.toMatch(/drop column/i)
  })

  it('anade lo que falta de forma reejecutable', () => {
    expect(codigo).toMatch(/alter type public\.notification_type add value if not exists 'payment_voided'/)
    expect(codigo).toMatch(/add column if not exists voided_at/)
    expect(codigo).toMatch(/add column if not exists voided_by/)
    expect(codigo).toMatch(/add column if not exists void_reason/)
    expect(codigo).toMatch(/add constraint payments_voided_consistency/)
    expect(codigo).toMatch(/create index if not exists payments_active_idx/)
    expect(codigo).toMatch(/grant execute on function public\.void_payment/)
  })
})
