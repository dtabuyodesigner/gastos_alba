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

-- Sin UPDATE: una foto subida no se sobrescribe.
-- Solo un admin puede borrar un fichero, y siempre fuera del flujo normal.
drop policy if exists tickets_delete_admin on storage.objects;
create policy tickets_delete_admin on storage.objects
  for delete to authenticated
  using (bucket_id = 'tickets' and public.current_role_name() = 'admin');
