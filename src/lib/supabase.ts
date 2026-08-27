import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { readSupabaseConfig } from './env'

const result = readSupabaseConfig()

export const configError: string | null = result.ok ? null : result.error
export const isSupabaseConfigured = result.ok

/** Bucket privado de fotos de tickets. */
export const TICKETS_BUCKET = result.ok ? result.config.bucket : 'tickets'

/**
 * Cliente unico de Supabase.
 *
 * Si la configuracion no es valida se crea igualmente contra un host inerte para
 * no romper los imports; la interfaz bloquea el acceso antes de emitir ninguna
 * consulta (ver `ConfigErrorScreen`).
 */
export const supabase: SupabaseClient = createClient(
  result.ok ? result.config.url : 'https://sin-configurar.invalid',
  result.ok ? result.config.anonKey : 'sin-configurar',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'gastos-alba-auth',
    },
  },
)

/** Traduce errores de Supabase a algo legible para Alba o Dani. */
export function humanizeError(error: unknown): string {
  if (!error) return 'Ha ocurrido un error inesperado.'
  const message = typeof error === 'string' ? error : ((error as { message?: string }).message ?? '')

  if (/Invalid login credentials/i.test(message)) return 'Email o contrasena incorrectos.'
  if (/Email not confirmed/i.test(message)) return 'Este email todavia no esta confirmado.'
  if (/rate limit|too many requests/i.test(message)) return 'Demasiados intentos. Prueba de nuevo en unos minutos.'
  if (/row-level security|violates row-level/i.test(message)) return 'No tienes permiso para hacer esto.'
  if (/Failed to fetch|NetworkError/i.test(message)) return 'Sin conexion con el servidor. Revisa la red.'
  if (/Bucket not found/i.test(message)) return 'Falta el bucket de fotos en Supabase. Revisa la configuracion.'
  return message || 'Ha ocurrido un error inesperado.'
}
