import { describe, it, expect } from 'vitest'
import initSql from '../../supabase/migrations/0001_init.sql?raw'
import rlsSql from '../../supabase/migrations/0002_rls.sql?raw'
import storageSql from '../../supabase/migrations/0003_storage.sql?raw'

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

  it('rechaza el alta sin ruta de foto', () => {
    expect(body).toMatch(/if v_path is null then\s*\n\s*raise exception/)
  })

  it('exige que la ruta corresponda al id del gasto', () => {
    // Sin esto se podria enlazar como justificante la foto de otro ticket.
    expect(body).toMatch(/v_path not like \(v_id::text \|\| '\/%'\)/)
  })

  it('comprueba que la foto existe de verdad en Storage y es de quien crea el gasto', () => {
    // El bypass que cerro esta guarda: llamar a la RPC con una ruta inventada.
    expect(body).toMatch(/from storage\.objects/)
    expect(body).toMatch(/o\.bucket_id = 'tickets'/)
    expect(body).toMatch(/o\.name = v_path/)
    expect(body).toMatch(/o\.owner = auth\.uid\(\)/)
  })

  it('comprueba la foto ANTES de insertar nada', () => {
    // El orden es lo que garantiza que un fallo no deje un gasto a medias.
    const storageCheck = body.indexOf('from storage.objects')
    const insertExpense = body.indexOf('insert into public.expenses')
    const insertPhoto = body.indexOf('insert into public.expense_photos')
    expect(storageCheck).toBeGreaterThan(-1)
    expect(storageCheck).toBeLessThan(insertExpense)
    expect(insertExpense).toBeLessThan(insertPhoto)
  })

  it('fuerza la autoria y el estado inicial, sin fiarse del cliente', () => {
    expect(body).toMatch(/v_id, auth\.uid\(\)/)
    expect(body).toMatch(/'pendiente'/)
  })
})

describe('permisos de las migraciones', () => {
  it('el alta de gastos y fotos solo pasa por create_expense', () => {
    expect(rlsSql).toMatch(/revoke insert on public\.expenses, public\.expense_photos from authenticated/)
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
    expect(rlsSql).toMatch(/create policy notifications_select_own[\s\S]*?recipient_profile_id = auth\.uid\(\)/)
    expect(rlsSql).toMatch(/create policy notifications_update_own[\s\S]*?recipient_profile_id = auth\.uid\(\)/)
  })

  it('el cliente no puede fabricar avisos ni borrarlos', () => {
    // Sin esto se podria inventar un aviso de "pago registrado" que no ocurrio.
    expect(rlsSql).toMatch(/revoke insert on public\.notifications from authenticated/)
    expect(rlsSql).toMatch(/revoke delete on[\s\S]*?public\.notifications/)
    expect(rlsSql).not.toMatch(/create policy notifications_insert/)
  })

  it('notify_role no es ejecutable por nadie desde fuera', () => {
    expect(rlsSql).toMatch(/revoke all on function public\.notify_role\([\s\S]*?from public, anon, authenticated/)
    expect(rlsSql).not.toMatch(/grant execute on function public\.notify_role/)
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
