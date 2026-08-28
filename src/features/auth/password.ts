export function validateNewPassword(password: string, repeated: string): string | null {
  if (!password) return 'Escribe la nueva contrasena.'
  if (password.length < 8) return 'La contrasena debe tener al menos 8 caracteres.'
  if (password !== repeated) return 'Las contrasenas no coinciden.'
  return null
}

export function buildPasswordRecoveryRedirect(origin: string): string {
  return `${origin.replace(/\/+$/, '')}/cambiar-contrasena`
}
