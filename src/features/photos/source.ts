/**
 * Decidir que origenes de foto se ofrecen.
 *
 * En un movil tiene sentido separar "Hacer foto" de "Elegir de Fotos": en iOS,
 * un input con `capture` va directo a la camara y no deja llegar a la
 * fototeca, asi que hacen falta dos inputs distintos.
 *
 * En un ordenador no: un boton "Hacer foto" abriria el mismo dialogo de
 * archivos que el otro y solo confundiria. Se detecta por el tipo de puntero,
 * que es lo mas fiable sin oler el user agent.
 */
export function shouldOfferCamera(matchMedia?: typeof window.matchMedia): boolean {
  if (typeof matchMedia !== 'function') return false
  try {
    return matchMedia('(pointer: coarse)').matches
  } catch {
    // Un navegador que no entienda la consulta no pierde nada: se queda con el
    // boton unico, que en iOS ya ofrece camara y fototeca en el mismo menu.
    return false
  }
}
