import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, humanizeError } from '../../lib/supabase'
import type { Profile } from '../../lib/types'
import { AuthContext, type AuthStatus, type AuthContextValue } from './auth-context'
import { buildPasswordRecoveryRedirect } from './password'

/**
 * Resuelve la sesion de Supabase y el perfil asociado.
 *
 * Tener sesion NO basta para entrar: hace falta ademas una fila activa en
 * `profiles`. Asi, aunque alguien consiguiera crear una cuenta, no ve nada
 * hasta que un admin lo activa (ver docs/supabase/BOOTSTRAP.md). El servidor
 * aplica la misma regla via RLS; esto es solo la capa de interfaz.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)

  const loadProfile = useCallback(async (userId: string) => {
    const { data, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()

    if (!mounted.current) return

    if (profileError) {
      setError(humanizeError(profileError))
      setProfile(null)
      setStatus('unauthorized')
      return
    }

    const found = data as Profile | null
    if (!found || !found.is_active) {
      setProfile(null)
      setError(null)
      setStatus('unauthorized')
      return
    }

    setProfile(found)
    setError(null)
    setStatus('ready')
  }, [])

  useEffect(() => {
    mounted.current = true

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!mounted.current) return
        setSession(data.session)
        if (data.session?.user) void loadProfile(data.session.user.id)
        else setStatus('signed-out')
      })
      .catch((err: unknown) => {
        if (!mounted.current) return
        setError(humanizeError(err))
        setStatus('signed-out')
      })

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted.current) return
      setSession(nextSession)
      if (nextSession?.user) {
        setStatus((current) => (current === 'ready' ? current : 'loading'))
        void loadProfile(nextSession.user.id)
      } else {
        setProfile(null)
        setStatus('signed-out')
      }
    })

    return () => {
      mounted.current = false
      subscription.subscription.unsubscribe()
    }
  }, [loadProfile])

  const signIn = useCallback<AuthContextValue['signIn']>(async (email, password) => {
    setError(null)
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })
    if (signInError) return { ok: false, error: humanizeError(signInError) }
    return { ok: true }
  }, [])

  const requestPasswordReset = useCallback<AuthContextValue['requestPasswordReset']>(async (email) => {
    setError(null)
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: buildPasswordRecoveryRedirect(window.location.origin),
    })
    if (resetError) return { ok: false, error: humanizeError(resetError) }
    return { ok: true }
  }, [])

  const updatePassword = useCallback<AuthContextValue['updatePassword']>(async (password) => {
    setError(null)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    if (updateError) return { ok: false, error: humanizeError(updateError) }
    return { ok: true }
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    if (!mounted.current) return
    setProfile(null)
    setSession(null)
    setStatus('signed-out')
  }, [])

  const refreshProfile = useCallback(async () => {
    const userId = session?.user?.id
    if (userId) await loadProfile(userId)
  }, [loadProfile, session])

  const value = useMemo<AuthContextValue>(
    () => ({ status, session, profile, error, signIn, requestPasswordReset, updatePassword, signOut, refreshProfile }),
    [status, session, profile, error, signIn, requestPasswordReset, updatePassword, signOut, refreshProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
