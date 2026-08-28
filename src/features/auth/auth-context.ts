import { createContext } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { Profile } from '../../lib/types'

export type AuthStatus =
  /** Todavia resolviendo la sesion persistida. */
  | 'loading'
  /** No hay sesion: hay que iniciar sesion. */
  | 'signed-out'
  /** Hay sesion y un perfil activo asociado. */
  | 'ready'
  /** Hay sesion valida pero el perfil no existe o esta desactivado. */
  | 'unauthorized'

export interface AuthContextValue {
  status: AuthStatus
  session: Session | null
  profile: Profile | null
  /** Mensaje del ultimo fallo al resolver el perfil, si lo hubo. */
  error: string | null
  signIn: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>
  requestPasswordReset: (email: string) => Promise<{ ok: boolean; error?: string }>
  updatePassword: (password: string) => Promise<{ ok: boolean; error?: string }>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
