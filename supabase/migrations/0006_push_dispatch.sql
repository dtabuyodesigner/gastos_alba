-- =============================================================================
-- Gastos Alba — 0006: disparador del push del navegador
--
-- PARA QUE SIRVE
-- Hasta ahora un aviso solo existia dentro de la aplicacion: habia que entrar
-- para ver el punto rojo. Esta migracion hace que, ademas, se envie un push al
-- movil. El aviso de la app sigue siendo la fuente de verdad; el push es un
-- canal adicional colgado del mismo insert, para que no puedan desincronizarse.
--
-- QUIEN LA NECESITA
-- Cualquier base que ya haya ejecutado 0001/0002 (y 0004 si venia de antiguo).
--
-- GARANTIAS
--   * Idempotente: ejecutarla dos veces no rompe nada.
--   * No borra ni una fila y no cambia ninguna tabla existente.
--   * Si el push no esta configurado (faltan los secretos), NO falla: el aviso
--     se guarda igual y simplemente no sale ningun envio. Nunca puede impedir
--     que se registre un ticket o un pago.
--
-- ANTES DE EJECUTARLA
-- Hay que desplegar la Edge Function `send-push` y guardar dos secretos en
-- Vault (Dashboard -> Project Settings -> Vault, o el SQL del punto 2).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. pg_net — llamadas HTTP desde la base de datos, sin bloquear la transaccion
--
-- net.http_post() encola la peticion y devuelve al instante. Es justo lo que
-- queremos: subir un ticket no debe esperar a que un servidor de push responda.
-- -----------------------------------------------------------------------------
create extension if not exists pg_net with schema extensions;


-- -----------------------------------------------------------------------------
-- 2. Secretos
--
-- La URL de la funcion y el secreto compartido NO se escriben en el cuerpo del
-- trigger: se leen de Vault, que los guarda cifrados. Ejecuta esto una vez,
-- sustituyendo los valores (el secreto, cualquier cadena larga al azar; la
-- misma que pongas en `supabase secrets set PUSH_HOOK_SECRET=...`):
--
--   select vault.create_secret(
--     'https://TU-REF.supabase.co/functions/v1/send-push', 'push_hook_url');
--   select vault.create_secret('CADENA_LARGA_AL_AZAR', 'push_hook_secret');
--
-- Para cambiarlos despues: select vault.update_secret(id, nuevo_valor);
-- -----------------------------------------------------------------------------


-- -----------------------------------------------------------------------------
-- 3. El disparador
-- -----------------------------------------------------------------------------
create or replace function public.notifications_dispatch_push()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, vault, pg_temp
as $$
declare
  hook_url    text;
  hook_secret text;
begin
  select decrypted_secret into hook_url
    from vault.decrypted_secrets where name = 'push_hook_url';
  select decrypted_secret into hook_secret
    from vault.decrypted_secrets where name = 'push_hook_secret';

  -- Push sin configurar: el aviso ya esta guardado, que es lo que importa.
  if hook_url is null or hook_secret is null then
    return null;
  end if;

  perform net.http_post(
    url     := hook_url,
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-push-secret', hook_secret),
    body    := jsonb_build_object('record', to_jsonb(new)),
    timeout_milliseconds := 5000
  );

  return null;
exception
  -- Un fallo enviando el push jamas debe tumbar la transaccion que creo el
  -- aviso. Se deja rastro en el log del servidor y se sigue.
  when others then
    raise warning 'No se ha podido encolar el push del aviso %: %', new.id, sqlerrm;
    return null;
end;
$$;

-- AFTER INSERT: solo se intenta enviar lo que de verdad ha quedado guardado.
drop trigger if exists notifications_push_dispatch on public.notifications;
create trigger notifications_push_dispatch
  after insert on public.notifications
  for each row execute function public.notifications_dispatch_push();


-- -----------------------------------------------------------------------------
-- 4. Permisos
--
-- La funcion la ejecuta el trigger, nunca una persona. Nadie la puede llamar.
-- -----------------------------------------------------------------------------
revoke all on function public.notifications_dispatch_push() from public, anon, authenticated;
