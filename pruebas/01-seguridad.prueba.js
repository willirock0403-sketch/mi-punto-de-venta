/* Lo que el SERVIDOR debe negar, aunque la interfaz esconda el botón.
   Cada caso llama la función directo, como lo haría alguien con la consola
   del navegador abierta. */
module.exports = {
  titulo: 'Seguridad: qué puede tocar cada quien',
  casos: {

    async 'la empleada no puede crear ni editar productos'(t){
      const p = await t.abrir({ sesion: t.CUENTAS.rosa });
      const r = await p.evaluate(async () => ({
        crear:   await sb.from('productos').insert([{negocio_id:'n1', nombre:'Pirata', precio:1}]),
        editar:  await sb.from('productos').update({precio:0.01}).eq('id','p1'),
      }));
      t.afirmar.rechazado(r.crear,  'la empleada pudo crear un producto');
      t.afirmar.rechazado(r.editar, 'la empleada pudo cambiarle el precio a un producto');
    },

    async 'la empleada no puede cambiar el nombre del negocio'(t){
      const p = await t.abrir({ sesion: t.CUENTAS.rosa });
      const r = await p.evaluate(() => sb.from('negocios').update({nombre:'Hackeado'}).eq('id','n1'));
      t.afirmar.rechazado(r, 'la empleada pudo renombrar el negocio');
    },

    async 'la empleada no ve el corte de caja ni puede anular ventas'(t){
      const p = await t.abrir({ sesion: t.CUENTAS.rosa });
      const r = await p.evaluate(async () => ({
        corte:  await sb.from('cortes_caja').select('*').eq('negocio_id','n1'),
        anular: await sb.from('ventas').update({anulada:true}).eq('negocio_id','n1'),
      }));
      t.afirmar.mismo(r.corte.data, [], 'la empleada alcanzó a ver cortes de caja');
      t.afirmar.rechazado(r.anular, 'la empleada pudo anular una venta');
    },

    async 'nadie ve los datos de otro negocio'(t){
      const p = await t.abrir({ sesion: t.CUENTAS.rosa });
      const r = await p.evaluate(async () => ({
        negocios:  (await sb.from('negocios').select('*')).data.map(n=>n.id),
        productos: (await sb.from('productos').select('*')).data.map(x=>x.id),
      }));
      t.afirmar.mismo(r.negocios, ['n1'], 'se filtró un negocio ajeno');
      t.afirmar.noIncluye(r.productos, 'p9', 'se filtró un producto de otro negocio');
    },

    async 'el cliente no puede reactivarse solo ni regalarse el negocio'(t){
      // se parte de la cuenta YA suspendida: prenderla es justo lo que no debe poder
      const datos = t.escenario().datos;
      datos.negocios[0].activo = false;
      const p = await t.abrir({ sesion: t.CUENTAS.dueno, datos });
      const r = await p.evaluate(async () => ({
        prender: await sb.from('negocios').update({activo:true}).eq('id','n1'),
        robar:   await sb.from('negocios').update({dueno:'u-rosa'}).eq('id','n1'),
        nombre:  await sb.from('negocios').update({nombre:'Nuevo Nombre'}).eq('id','n1'),
      }));
      t.afirmar.rechazado(r.prender, 'el dueño pudo mover el interruptor del cobro');
      t.afirmar.rechazado(r.robar,   'el dueño pudo cambiar de dueño el negocio');
      t.afirmar.permitido(r.nombre,  'el dueño ya no puede ni cambiar el nombre de su negocio');
    },

    async 'la empleada no puede darse de alta a sí misma como admin'(t){
      const p = await t.abrir({ sesion: t.CUENTAS.rosa });
      const r = await p.evaluate(async () => ({
        ascender: await sb.from('empleados').update({rol:'admin'}).eq('id','e1'),
        invitar:  await sb.from('empleados').insert([{negocio_id:'n1', nombre:'Compa', email:'compa@test.com', rol:'admin'}]),
      }));
      t.afirmar.rechazado(r.ascender, 'la empleada se pudo ascender a admin');
      t.afirmar.rechazado(r.invitar,  'la empleada pudo dar de alta a alguien más');
    },

    async 'la empleada no puede robarle la invitación a otro'(t){
      const p = await t.abrir({ sesion: t.CUENTAS.rosa });
      // e2 es la invitación de nuevo@test.com, que no es su correo
      const r = await p.evaluate(() => sb.from('empleados').update({usuario_id:'u-rosa'}).eq('id','e2'));
      t.afirmar.rechazado(r, 'una cuenta pudo quedarse con la invitación de otra persona');
    },

    async 'la interfaz del empleado no enseña lo que no le toca'(t){
      const p = await t.abrir({ sesion: t.CUENTAS.rosa });
      const v = await p.evaluate(() => ({
        rol: ESTADO.rol,
        botones: [...document.querySelectorAll('#pos-root .mega')].map(b=>b.textContent.trim()),
        verCorteDelNegocio: !!document.querySelector('.ch-lbl')?.textContent.includes('CORTE'),
      }));
      t.afirmar.igual(v.rol, 'empleado', 'la empleada no quedó con rol de empleada');
      t.afirmar.mismo(v.botones, ['Nueva venta','Ajustes'], 'la empleada ve botones de más');
      t.afirmar.no(v.verCorteDelNegocio, 'la empleada alcanza a ver el corte del negocio');
    },

  }
};
