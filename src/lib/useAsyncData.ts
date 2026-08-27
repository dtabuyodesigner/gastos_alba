import { useCallback, useEffect, useState } from 'react'
import { humanizeError } from './supabase'

interface AsyncState<T> {
  data: T | null
  loading: boolean
  error: string | null
}

/**
 * Carga de datos minima y suficiente para el MVP: sin cache ni cliente de
 * consultas. `loader` debe venir memorizado con `useCallback`.
 */
export function useAsyncData<T>(loader: () => Promise<T>) {
  const [state, setState] = useState<AsyncState<T>>({ data: null, loading: true, error: null })

  const run = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }))
    try {
      const data = await loader()
      setState({ data, loading: false, error: null })
    } catch (error) {
      setState({ data: null, loading: false, error: humanizeError(error) })
    }
  }, [loader])

  useEffect(() => {
    let cancelled = false
    setState((prev) => ({ ...prev, loading: true, error: null }))
    loader()
      .then((data) => {
        if (!cancelled) setState({ data, loading: false, error: null })
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ data: null, loading: false, error: humanizeError(error) })
      })
    return () => {
      cancelled = true
    }
  }, [loader])

  return { ...state, reload: run }
}
