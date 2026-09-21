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


-- ============================================================
-- ÍNDICES — aceleran las consultas que la app hace todo el tiempo
-- y evitan que se pongan lentas según crecen tus datos.
-- ============================================================

-- un usuario nunca debería tener dos negocios (así arranca la app: toma el
-- primero que encuentra) — esto lo impide también a nivel de base de datos,
-- no solo en la pantalla de "crear negocio", y de paso sirve como índice.
create unique index if not exists ux_negocios_dueno on public.negocios(dueno);

-- pantalla de venta: productos de un negocio, solo los activos, en su orden
create index if not exists idx_productos_negocio_activo_orden
  on public.productos(negocio_id, activo, orden);

-- historial y cortes: ventas de un negocio, por rango de fecha
create index if not exists idx_ventas_negocio_creado
  on public.ventas(negocio_id, creado_en);

-- ============================================================
-- LÍMITES DE INTEGRIDAD — el navegador ya limita esto, pero alguien
-- podría saltarse la app y llamar la API directamente con la llave
-- pública; estas reglas protegen la base de datos pase lo que pase.
-- ============================================================

do $$ begin
  alter table public.negocios add constraint negocios_nombre_longitud check (char_length(trim(nombre)) between 1 and 120);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.productos add constraint productos_nombre_longitud check (char_length(trim(nombre)) between 1 and 120);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.productos add constraint productos_categoria_longitud check (categoria is null or char_length(categoria) <= 60);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.productos add constraint productos_precio_no_negativo check (precio >= 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.ventas add constraint ventas_total_no_negativo check (total >= 0);
exception when duplicate_object then null; end $$;

-- ============================================================
-- ARCHIVOS SUBIDOS (logos y fotos de producto) — la app ya valida tipo
-- y tamaño en el navegador, pero eso se puede saltar llamando la API
-- directo. Esto lo hace cumplir el propio Storage de Supabase.
-- ============================================================
update storage.buckets
  set file_size_limit = 15728640, -- 15MB, igual que el límite del navegador
      allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif']
  where id in ('logos','productos');
