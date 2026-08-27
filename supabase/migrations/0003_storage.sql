-- =============================================================================
-- Gastos Alba — Storage privado para las fotos de tickets
--
-- El bucket es PRIVADO. No hay ninguna URL publica: la app pide URLs firmadas
-- de corta duracion, y Storage solo las concede si la politica de abajo deja
-- leer el objeto.
--
-- Nota: crear politicas sobre storage.objects requiere privilegios de owner.
-- En el SQL Editor de Supabase funciona. Si tu entorno lo rechaza, crea las
-- mismas reglas desde Dashboard -> Storage -> Policies.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'tickets',
  'tickets',
  false,
  15728640, -- 15 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists tickets_read_members on storage.objects;
create policy tickets_read_members on storage.objects
  for select to authenticated
  using (bucket_id = 'tickets' and public.is_active_member());

drop policy if exists tickets_upload_members on storage.objects;
create policy tickets_upload_members on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'tickets'
    and public.is_active_member()
    and owner = auth.uid()
  );

-- Sin UPDATE y sin DELETE, para nadie: una foto de ticket es un justificante y
-- no se sobrescribe ni se borra desde la aplicacion, igual que no se borra un
-- gasto (se anula). Ni siquiera un admin tiene politica de borrado.
--
-- La limpieza de ficheros huerfanos (subidas cuya alta de gasto fallo despues)
-- es una tarea de mantenimiento manual, deliberada y fuera de la app: se hace
-- desde el panel de Supabase o con la service_role key, nunca desde el cliente.
-- Ver docs/DECISIONES.md.
drop policy if exists tickets_delete_admin on storage.objects;
