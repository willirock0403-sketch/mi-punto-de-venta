/* Supabase falso que aplica LAS MISMAS reglas que el servidor real:
   las políticas RLS de supabase/seguridad.sql y el disparador que protege
   el interruptor del cobro.

   Esto es lo que le da valor a la suite: si una prueba pasa solo porque la
   app escondió un botón, aquí igual se llama la función a mano y el falso
   la rechaza, igual que lo haría Postgres. Cuando cambien las políticas,
   este archivo tiene que cambiar con ellas.

   La función se serializa y corre DENTRO de la página, antes que el
   código de la app, así que no puede usar nada de Node. */

function instalarFalso(cfg){
  const BD = JSON.parse(JSON.stringify(cfg.datos));
  let sesion = cfg.sesion ? { ...cfg.sesion } : null;

  window.__falso = {
    bd: BD,
    red: cfg.red !== false,
    rechazos: [],           // [tabla.operacion] que el servidor negó
    consultas: [],          // para contar llamadas (duplicados, tormentas)
    entrarComo(u){ sesion = u ? { ...u } : null; },
  };

  const uid = () => sesion && sesion.id;
  const correo = () => ((sesion && sesion.email) || '').toLowerCase();

  function fichaMia(negocioId){
    return (BD.empleados || []).find(e =>
      e.negocio_id === negocioId && e.usuario_id === uid() && e.activo !== false);
  }
  function esDueno(negocioId){
    const n = (BD.negocios || []).find(x => x.id === negocioId);
    return !!n && n.dueno === uid();
  }
  const esMiembro = (negocioId) => esDueno(negocioId) || !!fichaMia(negocioId);
  const esAdmin = (negocioId) => {
    if(esDueno(negocioId)) return true;
    const f = fichaMia(negocioId);
    return !!f && f.rol === 'admin';
  };

  function ok(data){ return { data: data === undefined ? null : data, error: null }; }
  function negar(que){
    window.__falso.rechazos.push(que);
    return { data: null, error: { message:'new row violates row-level security policy', code:'42501' } };
  }
  function error(msg, code){ return { data:null, error:{ message: msg, code: code || 'P0001' } }; }

  const id = (p) => p + '-' + Math.random().toString(36).slice(2, 9);

  // valores que la base pone sola (DEFAULT en supabase/seguridad.sql)
  const POR_OMISION = {
    ventas:    { anulada: false, metodo_pago: 'efectivo' },
    negocios:  { activo: true },
    empleados: { activo: true, rol: 'empleado' },
    productos: { activo: true },
  };

  function cumple(fila, f){
    const v = fila[f.col];
    switch(f.op){
      case 'eq':    return String(v) === String(f.val);
      case 'neq':   return String(v) !== String(f.val);
      case 'is':    return f.val === null ? (v === null || v === undefined) : v === f.val;
      case 'ilike': return String(v || '').toLowerCase() === String(f.val || '').toLowerCase();
      case 'gte':   return new Date(v) >= comoPostgres(f.val);
      case 'lte':   return new Date(v) <= comoPostgres(f.val);
      case 'lt':    return new Date(v) <  comoPostgres(f.val);
      case 'in':    return (f.val || []).map(String).includes(String(v));
      default:      return true;
    }
  }
  // Postgres lee una fecha SIN zona como UTC, no como hora local del navegador.
  // Sin esto, una ventana de día mal armada pasaría la prueba por accidente.
  function comoPostgres(v){
    if(v instanceof Date) return v;
    const s = String(v);
    return new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : s + 'Z');
  }

  function tabla(nombre){
    const q = { filtros: [], orden: null, limite: null, ins: null, upd: null, devolver: false };
    const api = {
      select(){ q.devolver = true; return api; },
      eq(c,v){ q.filtros.push({col:c, op:'eq', val:v}); return api; },
      neq(c,v){ q.filtros.push({col:c, op:'neq', val:v}); return api; },
      is(c,v){ q.filtros.push({col:c, op:'is', val:v}); return api; },
      ilike(c,v){ q.filtros.push({col:c, op:'ilike', val:v}); return api; },
      gte(c,v){ q.filtros.push({col:c, op:'gte', val:v}); return api; },
      lte(c,v){ q.filtros.push({col:c, op:'lte', val:v}); return api; },
      lt(c,v){ q.filtros.push({col:c, op:'lt', val:v}); return api; },
      in(c,v){ q.filtros.push({col:c, op:'in', val:v}); return api; },
      order(c,o){ q.orden = {col:c, asc: !o || o.ascending !== false}; return api; },
      limit(n){ q.limite = n; return api; },
      insert(r){ q.ins = Array.isArray(r) ? r : [r]; return api; },
      update(v){ q.upd = v; return api; },
      then(res, rej){ ejecutar().then(res, rej); },
    };

    function visibles(){
      const todas = BD[nombre] || [];
      return todas.filter(f => {
        const neg = nombre === 'negocios' ? f.id : f.negocio_id;
        // cortes_caja solo los ve el admin; lo demás, cualquier miembro
        if(nombre === 'cortes_caja') return esAdmin(neg);
        return esMiembro(neg);
      });
    }

    async function ejecutar(){
      window.__falso.consultas.push(nombre + (q.ins ? '.insert' : q.upd ? '.update' : '.select'));
      if(!window.__falso.red) throw new Error('Failed to fetch');

      if(q.ins){
        const creadas = [];
        // "perderRespuesta": el servidor SÍ guarda, pero la respuesta no
        // llega (se cayó la señal justo después de mandar). Es el caso que
        // de verdad puede cobrar dos veces, no el doble toque.
        const perder = window.__falso.perderRespuesta;
        for(const fila of q.ins){
          const neg = nombre === 'negocios' ? null : fila.negocio_id;
          let permitido;
          if(nombre === 'negocios')        permitido = fila.dueno === uid();
          else if(nombre === 'ventas')     permitido = esMiembro(neg);
          else                             permitido = esAdmin(neg);   // productos, empleados, cortes
          if(!permitido) return negar(nombre + '.insert');
          // restricciones CHECK de la base
          if(nombre === 'ventas' && Number(fila.total) < 0) return error('ventas_total_no_negativo', '23514');
          // índice único ux_ventas_clave_cliente: la misma venta no se
          // puede guardar dos veces aunque se reintente
          if(nombre === 'ventas' && fila.clave_cliente &&
             (BD.ventas || []).some(v => v.clave_cliente === fila.clave_cliente)){
            return error('duplicate key value violates unique constraint "ux_ventas_clave_cliente"', '23505');
          }
          if(nombre === 'productos' && Number(fila.precio) < 0) return error('productos_precio_no_negativo', '23514');
          // la base pone sola las columnas con DEFAULT. Sin esto, una venta
          // recién hecha no traía "anulada" y los filtros .eq('anulada',false)
          // la dejaban fuera, que es algo que en Postgres no pasa.
          const nueva = { id: id(nombre.slice(0,3)), creado_en: new Date().toISOString(),
                          ...(POR_OMISION[nombre] || {}), ...fila };
          (BD[nombre] = BD[nombre] || []).push(nueva);
          creadas.push(nueva);
        }
        if(perder){ window.__falso.perderRespuesta = false; throw new Error('Failed to fetch'); }
        return ok(creadas);
      }

      if(q.upd){
        const candidatas = (BD[nombre] || []).filter(f => q.filtros.every(x => cumple(f, x)));
        const tocadas = [];
        for(const fila of candidatas){
          const neg = nombre === 'negocios' ? fila.id : fila.negocio_id;
          // empleados: el reclamo de invitación es el único update que un
          // no-admin puede hacer, y solo sobre SU fila por correo
          if(nombre === 'empleados' && !esAdmin(neg)){
            const suya = (fila.email || '').toLowerCase() === correo()
                      && (fila.usuario_id === null || fila.usuario_id === undefined)
                      && Object.keys(q.upd).length === 1 && q.upd.usuario_id === uid();
            if(!suya){ return negar('empleados.update'); }
          } else if(nombre !== 'empleados' && !esAdmin(neg)){
            return negar(nombre + '.update');
          }
          // el disparador: activo y dueno no se cambian desde la app
          if(nombre === 'negocios'){
            if('activo' in q.upd && q.upd.activo !== fila.activo)
              return error('El estado de la cuenta solo lo cambia el administrador de la app.', '42501');
            if('dueno' in q.upd && q.upd.dueno !== fila.dueno)
              return error('El dueño de la cuenta no se puede cambiar desde la app.', '42501');
          }
          Object.assign(fila, q.upd);
          tocadas.push(fila);
        }
        return ok(tocadas);
      }

      let filas = visibles().filter(f => q.filtros.every(x => cumple(f, x)));
      if(q.orden){
        const {col, asc} = q.orden;
        filas = filas.slice().sort((a,b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (asc ? 1 : -1));
      }
      if(q.limite != null) filas = filas.slice(0, q.limite);
      return ok(filas.map(f => ({ ...f })));
    }
    return api;
  }

  async function rpc(nombre, args){
    window.__falso.consultas.push('rpc.' + nombre);
    if(!window.__falso.red) throw new Error('Failed to fetch');
    if(nombre === 'siguiente_folio'){
      if(!esMiembro(args.p_negocio_id)) return negar('rpc.siguiente_folio');
      BD.folios = BD.folios || {};
      const k = args.p_negocio_id + '|' + args.p_fecha;
      BD.folios[k] = (BD.folios[k] || 0) + 1;
      return ok(BD.folios[k]);
    }
    if(nombre === 'descontar_stock'){
      const p = (BD.productos || []).find(x => x.id === args.p_producto_id);
      if(!p) return error('producto no encontrado');
      if(!esMiembro(p.negocio_id)) return negar('rpc.descontar_stock');
      if(p.stock !== null && p.stock !== undefined){
        p.stock = Math.max(0, p.stock - args.p_cantidad);   // la función real no deja stock negativo
      }
      return ok(null);
    }
    return ok(null);
  }

  window.supabase = { createClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: sesion ? { user: sesion } : null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }),
      signOut: async () => { sesion = null; return { error: null }; },
      signUp: async ({ email }) => {
        // el proyecto tiene la confirmación de correo APAGADA: quien se
        // registra entra de inmediato, sin comprobar que el buzón es suyo
        sesion = { id: id('u'), email };
        return { data: { user: sesion }, error: null };
      },
      signInWithPassword: async ({ email }) => {
        const u = (cfg.cuentas || []).find(x => x.email === email);
        if(!u) return { data: null, error: { message: 'Invalid login credentials' } };
        sesion = { ...u };
        return { data: { user: sesion }, error: null };
      },
    },
    from: tabla,
    rpc,
    storage: { from: () => ({
      upload: async () => ({ error: null }),
      getPublicUrl: () => ({ data: { publicUrl: 'https://ejemplo/foto.png' } }),
    })},
  })};
}

module.exports = { instalarFalso };
