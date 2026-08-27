import { supabase, TICKETS_BUCKET } from '../../lib/supabase'

/** Tipos aceptados para la foto del ticket. */
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
/** Tamano maximo aceptado ANTES de comprimir. */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024

const MAX_DIMENSION = 1600
const JPEG_QUALITY = 0.82

export function validatePhoto(file: File): string | null {
  if (file.size > MAX_UPLOAD_BYTES) return 'La foto es demasiado grande (maximo 15 MB).'
  const type = file.type.toLowerCase()
  // Algunos moviles no informan del tipo; en ese caso se deja pasar y decide el servidor.
  if (type && !ACCEPTED_IMAGE_TYPES.includes(type)) return 'El archivo debe ser una imagen.'
  return null
}

/**
 * Reescala la foto en el propio movil antes de subirla.
 * Si el navegador no puede procesarla (p. ej. HEIC sin soporte) se sube el
 * original: es preferible una foto grande que perder el ticket.
 */
export async function compressImage(file: File): Promise<File> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file

  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
    if (scale === 1 && file.size < 1024 * 1024) {
      bitmap.close()
      return file
    }

    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      bitmap.close()
      return file
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
    )
    if (!blob || blob.size >= file.size) return file

    return new File([blob], replaceExtension(file.name, 'jpg'), { type: 'image/jpeg' })
  } catch {
    return file
  }
}

function replaceExtension(name: string, extension: string): string {
  const base = name.replace(/\.[^.]+$/, '')
  return `${base || 'ticket'}.${extension}`
}

function extensionFor(file: File): string {
  const fromName = /\.([a-zA-Z0-9]+)$/.exec(file.name)?.[1]
  if (fromName) return fromName.toLowerCase()
  const fromType = file.type.split('/')[1]
  return (fromType || 'jpg').toLowerCase()
}

/**
 * Sube la foto al bucket PRIVADO y devuelve su ruta interna.
 * La ruta nunca es una URL publica: para verla hay que firmarla.
 */
export async function uploadTicketPhoto(expenseId: string, file: File): Promise<string> {
  const path = `${expenseId}/${crypto.randomUUID()}.${extensionFor(file)}`
  const { error } = await supabase.storage.from(TICKETS_BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || 'image/jpeg',
  })
  if (error) throw error
  return path
}

/** URL firmada temporal para mostrar la foto. Por defecto, 5 minutos. */
export async function getSignedPhotoUrl(storagePath: string, expiresInSeconds = 300): Promise<string> {
  const { data, error } = await supabase.storage
    .from(TICKETS_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds)
  if (error) throw error
  return data.signedUrl
}
