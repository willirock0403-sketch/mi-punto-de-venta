-- ============================================================
-- VentaFácil — seguridad multi-negocio (Row Level Security)
--
-- CÓMO USARLO:
-- 1. Entra a tu proyecto en https://supabase.com/dashboard
-- 2. Ve a "SQL Editor" → "New query"
-- 3. Pega TODO este archivo y dale "Run"
-- 4. Puedes correrlo las veces que quieras: está escrito para no
--    duplicar columnas ni políticas si ya existían.
--
-- QUÉ HACE:
-- Sin estas reglas, cualquier persona que use la app (con la llave
-- pública que ya está en el código) podría, en teoría, leer o
-- modificar productos/ventas de OTRO negocio con el ID correcto.
-- Row Level Security obliga a Postgres a filtrar SIEMPRE por el
-- dueño autenticado, sin importar lo que pida el navegador.
-- ============================================================

-- 1) Columnas nuevas usadas por la app (no rompen nada si ya existen)
alter table public.negocios  add column if not exists activo   boolean not null default true;
alter table public.productos add column if not exists categoria text;

-- 2) Activar RLS en las tablas del negocio
alter table public.negocios  enable row level security;
alter table public.productos enable row level security;
alter table public.ventas    enable row level security;

-- 3) NEGOCIOS: cada quien solo ve y edita el suyo
drop policy if exists "negocios_select_propio" on public.negocios;
create policy "negocios_select_propio" on public.negocios
  for select using (dueno = auth.uid());

drop policy if exists "negocios_insert_propio" on public.negocios;
create policy "negocios_insert_propio" on public.negocios
  for insert with check (dueno = auth.uid());

drop policy if exists "negocios_update_propio" on public.negocios;
create policy "negocios_update_propio" on public.negocios
  for update using (dueno = auth.uid()) with check (dueno = auth.uid());

-- 4) PRODUCTOS: solo del negocio del usuario autenticado
drop policy if exists "productos_select_propio" on public.productos;
create policy "productos_select_propio" on public.productos
  for select using (
    exists (select 1 from public.negocios n where n.id = productos.negocio_id and n.dueno = auth.uid())
  );

drop policy if exists "productos_insert_propio" on public.productos;
create policy "productos_insert_propio" on public.productos
  for insert with check (
    exists (select 1 from public.negocios n where n.id = productos.negocio_id and n.dueno = auth.uid())
  );

drop policy if exists "productos_update_propio" on public.productos;
create policy "productos_update_propio" on public.productos
  for update using (
    exists (select 1 from public.negocios n where n.id = productos.negocio_id and n.dueno = auth.uid())
  ) with check (
    exists (select 1 from public.negocios n where n.id = productos.negocio_id and n.dueno = auth.uid())
  );

drop policy if exists "productos_delete_propio" on public.productos;
create policy "productos_delete_propio" on public.productos
  for delete using (
    exists (select 1 from public.negocios n where n.id = productos.negocio_id and n.dueno = auth.uid())
  );

-- 5) VENTAS: solo del negocio del usuario autenticado
drop policy if exists "ventas_select_propio" on public.ventas;
create policy "ventas_select_propio" on public.ventas
  for select using (
    exists (select 1 from public.negocios n where n.id = ventas.negocio_id and n.dueno = auth.uid())
  );

drop policy if exists "ventas_insert_propio" on public.ventas;
create policy "ventas_insert_propio" on public.ventas
  for insert with check (
    exists (select 1 from public.negocios n where n.id = ventas.negocio_id and n.dueno = auth.uid())
  );

-- (No se permite editar ni borrar ventas ya registradas: son el
--  historial contable del negocio. Si necesitas poder corregirlas,
--  dilo y agregamos una política de update/delete a propósito.)

-- 6) STORAGE: fotos de logo y de producto
--    Se guardan como "<negocio_id>/archivo.jpg", así que solo el
--    dueño de ESE negocio puede subir/reemplazar/borrar ahí, pero
--    cualquiera puede VER la imagen (son públicas: se muestran en
--    tickets y en la pantalla de venta sin iniciar sesión).
drop policy if exists "logos_lectura_publica" on storage.objects;
create policy "logos_lectura_publica" on storage.objects
  for select using (bucket_id = 'logos');

drop policy if exists "logos_escritura_propia" on storage.objects;
create policy "logos_escritura_propia" on storage.objects
  for insert with check (
    bucket_id = 'logos'
    and exists (
      select 1 from public.negocios n
      where n.id::text = (storage.foldername(name))[1] and n.dueno = auth.uid()
    )
  );

drop policy if exists "logos_actualiza_propia" on storage.objects;
create policy "logos_actualiza_propia" on storage.objects
  for update using (
    bucket_id = 'logos'
    and exists (
      select 1 from public.negocios n
      where n.id::text = (storage.foldername(name))[1] and n.dueno = auth.uid()
    )
  );

drop policy if exists "productos_fotos_lectura_publica" on storage.objects;
create policy "productos_fotos_lectura_publica" on storage.objects
  for select using (bucket_id = 'productos');

drop policy if exists "productos_fotos_escritura_propia" on storage.objects;
create policy "productos_fotos_escritura_propia" on storage.objects
  for insert with check (
    bucket_id = 'productos'
    and exists (
      select 1 from public.negocios n
      where n.id::text = (storage.foldername(name))[1] and n.dueno = auth.uid()
    )
  );

drop policy if exists "productos_fotos_actualiza_propia" on storage.objects;
create policy "productos_fotos_actualiza_propia" on storage.objects
  for update using (
    bucket_id = 'productos'
    and exists (
      select 1 from public.negocios n
      where n.id::text = (storage.foldername(name))[1] and n.dueno = auth.uid()
    )
  );

-- ============================================================
-- CÓMO ACTIVAR/DESACTIVAR UN NEGOCIO MANUALMENTE (para el cobro):
--   update public.negocios set activo = false where id = 'ID-DEL-NEGOCIO';
--   update public.negocios set activo = true  where id = 'ID-DEL-NEGOCIO';
-- El id de cada negocio lo ves en Table Editor → negocios.
-- ============================================================
