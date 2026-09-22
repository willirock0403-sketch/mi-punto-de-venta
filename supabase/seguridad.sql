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
-- Row Level Security obliga a Postgres a filtrar SIEMPRE por quién
-- está autenticado, sin importar lo que pida el navegador.
--
-- MODELO DE ACCESO (cambió: antes era "solo el dueño"):
--   Cada persona que entra a la app pertenece a UN negocio, con un rol:
--     · admin    → el dueño y quien él decida. Puede todo.
--     · empleado → solo puede cobrar. No ve reportes, no toca productos,
--                  no entra a ajustes, no puede anular ventas.
--   El dueño original (negocios.dueno) siempre es admin, aunque no tenga
--   fila en "empleados" — así ningún negocio existente pierde su acceso.
-- ============================================================

-- 1) Columnas nuevas usadas por la app (no rompen nada si ya existen)
alter table public.negocios  add column if not exists activo   boolean not null default true;
alter table public.productos add column if not exists categoria text;
alter table public.productos add column if not exists stock integer;
alter table public.ventas    add column if not exists anulada    boolean not null default false;
alter table public.ventas    add column if not exists anulada_en timestamptz;
alter table public.ventas    add column if not exists metodo_pago text not null default 'efectivo';
alter table public.ventas    add column if not exists empleado_nombre text;
-- quién cobró, por id de cuenta. El nombre se guarda aparte solo para
-- imprimirlo en el ticket: los nombres se pueden cambiar y entonces las
-- ventas viejas dejarían de contar como suyas. El id nunca cambia.
alter table public.ventas    add column if not exists empleado_uid uuid;

-- Folios: un contador por negocio y por día. Antes el folio se calculaba
-- contando las ventas del día desde el navegador, lo que podía darle el
-- MISMO folio a dos dispositivos cobrando al mismo tiempo.
create table if not exists public.folios (
  negocio_id uuid not null references public.negocios(id) on delete cascade,
  fecha date not null,
  ultimo integer not null default 0,
  primary key (negocio_id, fecha)
);

-- Cortes de caja (arqueo): al cerrar el día se cuenta el efectivo físico y
-- se compara contra lo que debería haber (fondo inicial + ventas en
-- efectivo). Guarda la diferencia para poder rastrear faltantes.
create table if not exists public.cortes_caja (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references public.negocios(id) on delete cascade,
  fecha date not null,
  fondo_inicial numeric not null default 0,
  ventas_efectivo numeric not null default 0,
  esperado numeric not null default 0,
  contado numeric not null default 0,
  diferencia numeric not null default 0,
  num_ventas integer not null default 0,
  notas text,
  creado_en timestamptz not null default now()
);

-- Empleados: ahora son CUENTAS del negocio, no solo un nombre para el
-- historial. Cada uno entra con su propio correo y contraseña.
create table if not exists public.empleados (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references public.negocios(id) on delete cascade,
  nombre text not null,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

-- columnas del modelo de cuentas (los empleados viejos, que solo tenían
-- nombre, se quedan sin cuenta ligada hasta que el admin les ponga correo)
alter table public.empleados add column if not exists usuario_id uuid references auth.users(id) on delete set null;
alter table public.empleados add column if not exists email text;
alter table public.empleados add column if not exists rol text not null default 'empleado';

do $$ begin
  alter table public.empleados add constraint empleados_rol_valido check (rol in ('admin','empleado'));
exception when duplicate_object then null; end $$;

-- un correo no puede estar dos veces en el mismo negocio...
create unique index if not exists ux_empleados_negocio_email
  on public.empleados(negocio_id, lower(email)) where email is not null;
-- ...y una cuenta pertenece a un solo negocio
create unique index if not exists ux_empleados_usuario
  on public.empleados(usuario_id) where usuario_id is not null;

-- 2) Activar RLS en las tablas del negocio
alter table public.negocios    enable row level security;
alter table public.productos   enable row level security;
alter table public.ventas      enable row level security;
alter table public.empleados   enable row level security;
alter table public.folios      enable row level security;
alter table public.cortes_caja enable row level security;

-- ============================================================
-- 3) QUIÉN ES QUIÉN — las dos funciones en las que se apoya todo
--
-- Son SECURITY DEFINER a propósito, y es la parte más delicada del
-- archivo: si la política de "negocios" preguntara por "empleados" y la
-- de "empleados" preguntara por "negocios", Postgres entraría en
-- recursión infinita y TODO dejaría de funcionar. Al correr como dueñas
-- de la tabla, estas funciones no disparan las políticas y cortan ese
-- ciclo. Son seguras porque solo reciben el id de un negocio y contestan
-- sí/no sobre QUIEN ESTÁ PIDIENDO (auth.uid()): no pueden devolver datos
-- de nadie más ni ser usadas para espiar otro negocio.
-- ============================================================
create or replace function public.es_miembro(p_negocio uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.negocios n
    where n.id = p_negocio and n.dueno = auth.uid()
  ) or exists (
    select 1 from public.empleados e
    where e.negocio_id = p_negocio and e.usuario_id = auth.uid() and e.activo
  );
$$;

create or replace function public.es_admin(p_negocio uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.negocios n
    where n.id = p_negocio and n.dueno = auth.uid()
  ) or exists (
    select 1 from public.empleados e
    where e.negocio_id = p_negocio and e.usuario_id = auth.uid()
      and e.activo and e.rol = 'admin'
  );
$$;

-- 4) NEGOCIOS: lo ven todos sus miembros; solo un admin lo edita
drop policy if exists "negocios_select_propio" on public.negocios;
create policy "negocios_select_propio" on public.negocios
  for select using (public.es_miembro(id));

drop policy if exists "negocios_insert_propio" on public.negocios;
create policy "negocios_insert_propio" on public.negocios
  for insert with check (dueno = auth.uid());

drop policy if exists "negocios_update_propio" on public.negocios;
create policy "negocios_update_propio" on public.negocios
  for update using (public.es_admin(id)) with check (public.es_admin(id));

-- 5) PRODUCTOS: el empleado los ve para poder cobrar, pero no los toca
drop policy if exists "productos_select_propio" on public.productos;
create policy "productos_select_propio" on public.productos
  for select using (public.es_miembro(negocio_id));

drop policy if exists "productos_insert_propio" on public.productos;
create policy "productos_insert_propio" on public.productos
  for insert with check (public.es_admin(negocio_id));

drop policy if exists "productos_update_propio" on public.productos;
create policy "productos_update_propio" on public.productos
  for update using (public.es_admin(negocio_id)) with check (public.es_admin(negocio_id));

drop policy if exists "productos_delete_propio" on public.productos;
create policy "productos_delete_propio" on public.productos
  for delete using (public.es_admin(negocio_id));

-- 6) EMPLEADOS: los administra el admin. Cada quien puede ver y reclamar
--    la invitación hecha a SU correo (así se liga su cuenta al registrarse).
drop policy if exists "empleados_select_propio" on public.empleados;
create policy "empleados_select_propio" on public.empleados
  for select using (
    public.es_miembro(negocio_id)
    or lower(email) = lower(auth.jwt() ->> 'email')
  );

drop policy if exists "empleados_insert_propio" on public.empleados;
create policy "empleados_insert_propio" on public.empleados
  for insert with check (public.es_admin(negocio_id));

drop policy if exists "empleados_update_propio" on public.empleados;
create policy "empleados_update_propio" on public.empleados
  for update using (public.es_admin(negocio_id)) with check (public.es_admin(negocio_id));

-- Reclamar la invitación: solo sobre la fila que lleva MI correo y que
-- todavía no tiene cuenta ligada, y solo para ligarla a MÍ. No permite
-- cambiarse de negocio ni ascenderse solo: el rol ya venía puesto por el
-- admin y el "with check" obliga a que la fila siga siendo la misma.
drop policy if exists "empleados_reclamar_invitacion" on public.empleados;
create policy "empleados_reclamar_invitacion" on public.empleados
  for update using (
    usuario_id is null
    and email is not null
    and lower(email) = lower(auth.jwt() ->> 'email')
  ) with check (
    usuario_id = auth.uid()
    and lower(email) = lower(auth.jwt() ->> 'email')
  );

drop policy if exists "empleados_delete_propio" on public.empleados;
create policy "empleados_delete_propio" on public.empleados
  for delete using (public.es_admin(negocio_id));

-- 7) FOLIOS: el empleado necesita folio para poder cobrar
drop policy if exists "folios_select_propio" on public.folios;
create policy "folios_select_propio" on public.folios
  for select using (public.es_miembro(negocio_id));

drop policy if exists "folios_insert_propio" on public.folios;
create policy "folios_insert_propio" on public.folios
  for insert with check (public.es_miembro(negocio_id));

drop policy if exists "folios_update_propio" on public.folios;
create policy "folios_update_propio" on public.folios
  for update using (public.es_miembro(negocio_id)) with check (public.es_miembro(negocio_id));

-- 8) CORTES DE CAJA: es dinero, solo el admin
drop policy if exists "cortes_select_propio" on public.cortes_caja;
create policy "cortes_select_propio" on public.cortes_caja
  for select using (public.es_admin(negocio_id));

drop policy if exists "cortes_insert_propio" on public.cortes_caja;
create policy "cortes_insert_propio" on public.cortes_caja
  for insert with check (public.es_admin(negocio_id));

drop policy if exists "cortes_update_propio" on public.cortes_caja;
create policy "cortes_update_propio" on public.cortes_caja
  for update using (public.es_admin(negocio_id)) with check (public.es_admin(negocio_id));

drop policy if exists "cortes_delete_propio" on public.cortes_caja;
create policy "cortes_delete_propio" on public.cortes_caja
  for delete using (public.es_admin(negocio_id));

-- 9) VENTAS: el empleado puede registrar ventas (es su trabajo) y ver las
--    del negocio, pero ANULAR es de admin: es la forma de borrar dinero
--    del corte, así que no puede quedar en manos de quien cobra.
drop policy if exists "ventas_select_propio" on public.ventas;
create policy "ventas_select_propio" on public.ventas
  for select using (public.es_miembro(negocio_id));

drop policy if exists "ventas_insert_propio" on public.ventas;
create policy "ventas_insert_propio" on public.ventas
  for insert with check (public.es_miembro(negocio_id));

drop policy if exists "ventas_update_propio" on public.ventas;
create policy "ventas_update_propio" on public.ventas
  for update using (public.es_admin(negocio_id)) with check (public.es_admin(negocio_id));

-- 10) STORAGE: fotos de logo y de producto
--    Se guardan como "<negocio_id>/archivo.jpg", así que solo un admin de
--    ESE negocio puede subir/reemplazar, pero cualquiera puede VER la
--    imagen (son públicas: se muestran en tickets y en la pantalla de
--    venta sin iniciar sesión).
drop policy if exists "logos_lectura_publica" on storage.objects;
create policy "logos_lectura_publica" on storage.objects
  for select using (bucket_id = 'logos');

drop policy if exists "logos_escritura_propia" on storage.objects;
create policy "logos_escritura_propia" on storage.objects
  for insert with check (
    bucket_id = 'logos'
    and exists (
      select 1 from public.negocios n
      where n.id::text = (storage.foldername(name))[1] and public.es_admin(n.id)
    )
  );

drop policy if exists "logos_actualiza_propia" on storage.objects;
create policy "logos_actualiza_propia" on storage.objects
  for update using (
    bucket_id = 'logos'
    and exists (
      select 1 from public.negocios n
      where n.id::text = (storage.foldername(name))[1] and public.es_admin(n.id)
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
      where n.id::text = (storage.foldername(name))[1] and public.es_admin(n.id)
    )
  );

drop policy if exists "productos_fotos_actualiza_propia" on storage.objects;
create policy "productos_fotos_actualiza_propia" on storage.objects
  for update using (
    bucket_id = 'productos'
    and exists (
      select 1 from public.negocios n
      where n.id::text = (storage.foldername(name))[1] and public.es_admin(n.id)
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

-- un usuario nunca debería ser dueño de dos negocios (así arranca la app:
-- toma el primero que encuentra) — esto lo impide también a nivel de base
-- de datos, no solo en la pantalla de "crear negocio".
create unique index if not exists ux_negocios_dueno on public.negocios(dueno);

-- pantalla de venta: productos de un negocio, solo los activos, en su orden
create index if not exists idx_productos_negocio_activo_orden
  on public.productos(negocio_id, activo, orden);

-- pantalla de cobro y ajustes: empleados activos de un negocio, por nombre
create index if not exists idx_empleados_negocio_activo
  on public.empleados(negocio_id, activo);

-- corte de caja: el del día de un negocio
create index if not exists idx_cortes_negocio_fecha
  on public.cortes_caja(negocio_id, fecha);

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
  alter table public.empleados add constraint empleados_nombre_longitud check (char_length(trim(nombre)) between 1 and 60);
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

do $$ begin
  alter table public.ventas add constraint ventas_metodo_pago_valido
    check (metodo_pago in ('efectivo','tarjeta','transferencia'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.productos add constraint productos_stock_no_negativo check (stock is null or stock >= 0);
exception when duplicate_object then null; end $$;

-- ============================================================
-- CONTROL DE INVENTARIO — "stock" es opcional (null = sin control).
-- Descontar existencias al cerrar una venta necesita sumar/restar de forma
-- atómica para no perder cambios si dos cobros llegan casi al mismo tiempo;
-- un update normal desde el navegador (leer, restar, guardar) tiene ese
-- riesgo. Esta función lo hace en un solo paso dentro de la base de datos.
--
-- Va como SECURITY DEFINER porque editar productos ya es cosa de admin, y
-- un empleado cobrando SÍ tiene que poder bajar el inventario. Por eso
-- lleva su propio candado adentro: es_miembro() sobre el negocio dueño del
-- producto. Sin esa línea, cualquiera podría descontar stock ajeno.
-- ============================================================
create or replace function public.descontar_stock(p_producto_id uuid, p_cantidad integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.productos p
  set stock = greatest(p.stock - p_cantidad, 0)
  where p.id = p_producto_id
    and p.stock is not null
    and public.es_miembro(p.negocio_id);
end;
$$;

-- ============================================================
-- FOLIO DE VENTA — un número consecutivo por negocio y por día, asignado
-- por la base de datos en un solo paso. Es lo que evita que dos celulares
-- cobrando al mismo tiempo generen el mismo folio (antes se contaban las
-- ventas del día desde el navegador, que sí se puede duplicar).
-- No es SECURITY DEFINER: las políticas de RLS de "folios" son las que
-- impiden tocar el contador de otro negocio.
-- ============================================================
create or replace function public.siguiente_folio(p_negocio_id uuid, p_fecha date)
returns integer
language plpgsql
as $$
declare v_folio integer;
begin
  insert into public.folios (negocio_id, fecha, ultimo)
  values (p_negocio_id, p_fecha, 1)
  on conflict (negocio_id, fecha)
  do update set ultimo = public.folios.ultimo + 1
  returning ultimo into v_folio;
  return v_folio;
end;
$$;

-- ============================================================
-- ARCHIVOS SUBIDOS (logos y fotos de producto) — la app ya valida tipo
-- y tamaño en el navegador, pero eso se puede saltar llamando la API
-- directo. Esto lo hace cumplir el propio Storage de Supabase.
-- ============================================================
update storage.buckets
  set file_size_limit = 15728640, -- 15MB, igual que el límite del navegador
      allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif']
  where id in ('logos','productos');
