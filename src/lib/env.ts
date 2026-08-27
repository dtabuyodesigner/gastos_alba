/**
 * Lectura y validacion de la configuracion del cliente.
 *
 * Todo lo que hay aqui es publico por definicion (viaja al navegador). La
 * seguridad real la dan las politicas RLS de Supabase, no el secreto de la
 * clave anon. Por eso se comprueba de forma activa que nadie haya pegado por
 * error una `service_role` key en el frontend.
 */

export interface SupabaseConfig {
  url: string
  anonKey: string
  bucket: string
}

export type ConfigResult =
  | { ok: true; config: SupabaseConfig }
  | { ok: false; error: string }

/** Decodifica el payload de un JWT sin verificar firma (solo para diagnostico). */
function readJwtRole(token: string): string | null {
  const parts = token.split('.')
  if (parts.length !== 3 || !parts[1]) return null
  try {
    const json = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))
    const payload = JSON.parse(json) as { role?: unknown }
    return typeof payload.role === 'string' ? payload.role : null
  } catch {
    return null
  }
}

export function readSupabaseConfig(): ConfigResult {
  const url = (import.meta.env.VITE_SUPABASE_URL ?? '').trim()
  const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim()
  const bucket = (import.meta.env.VITE_SUPABASE_TICKETS_BUCKET ?? 'tickets').trim()

  if (!url || !anonKey) {
    return {
      ok: false,
      error:
        'Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY. Copia .env.example a .env.local y rellena los valores del proyecto Supabase de Gastos Alba.',
    }
  }

  if (!/^https:\/\/[^\s]+$/.test(url)) {
    return { ok: false, error: 'VITE_SUPABASE_URL debe ser una URL https valida.' }
  }

  if (readJwtRole(anonKey) === 'service_role') {
    return {
      ok: false,
      error:
        'VITE_SUPABASE_ANON_KEY contiene una clave service_role. Esa clave salta el RLS y NUNCA debe estar en el frontend. Sustituyela por la clave anon/public.',
    }
  }

  return { ok: true, config: { url, anonKey, bucket } }
}
