/* Un punto de venta tiene que seguir cobrando cuando se cae la señal.
   Lo delicado es lo que pasa DESPUÉS: que nada se pierda y que nada se
   cobre dos veces. */
module.exports = {
  titulo: 'Sin internet: la venta no se pierde ni se duplica',
  casos: {

    async 'sin señal la venta se cobra y se queda encolada'(t){
      // primero abre CON internet: un aparato que nunca se ha conectado no
      // tiene catálogo guardado y la app lo manda al login, a propósito
      const p = await t.abrir();
      const r = await p.evaluate(async () => {
        window.__falso.red = false;
        irVenta(); sumar('p1');
        irPago(); ESTADO.recibido = 100; pintarPago();
        await finalizarVenta(null);
        return { folio: ESTADO.ultimaVenta.folio, pendientes: ventasPendientes().length,
                 pantalla: !!document.querySelector('.cambio-vista') };
      });
      t.afirmar.igual(r.pendientes, 1, 'la venta sin señal no quedó encolada');
      t.afirmar.ok(String(r.folio).startsWith('L'), `el folio local debería empezar con L: ${r.folio}`);
      t.afirmar.ok(r.pantalla, 'no se llegó a la pantalla de cambio sin señal');
    },

    async 'al volver la señal las pendientes suben una sola vez'(t){
      const p = await t.abrir();
      const r = await p.evaluate(async () => {
        window.__falso.red = false;
        for(let i=0;i<3;i++){
          ESTADO.carro = {}; irVenta(); sumar('p1');
          irPago(); ESTADO.recibido = 100; pintarPago();
          await finalizarVenta(null);
        }
        const encoladas = ventasPendientes().length;
        window.__falso.red = true;
        // dos sincronizaciones al hilo, como si volviera y se fuera la señal
        await Promise.all([sincronizarPendientes(true), sincronizarPendientes(true)]);
        await new Promise(r => setTimeout(r, 400));
        const enBase = (await sb.from('ventas').select('*').eq('negocio_id','n1')).data;
        return { encoladas, quedan: ventasPendientes().length, enBase: enBase.length };
      });
      t.afirmar.igual(r.encoladas, 3, 'no se encolaron las 3 ventas');
      t.afirmar.igual(r.quedan, 0, 'quedaron ventas sin subir');
      // 1 del escenario + 3 encoladas, ni una de más
      t.afirmar.igual(r.enBase, 4, `se subieron ventas duplicadas: ${r.enBase} en vez de 4`);
    },

    async 'el total del día cuenta lo encolado y lo ya subido'(t){
      const p = await t.abrir();
      const r = await p.evaluate(async () => {
        window.__falso.red = false;
        ESTADO.carro = {}; irVenta(); sumar('p1');     // $45 sin señal
        irPago(); ESTADO.recibido = 100; pintarPago();
        await finalizarVenta(null);
        const v = await obtenerVentasDia(hoyLocal());
        return { n: v.length, suma: v.reduce((s,x)=>s+Number(x.total),0) };
      });
      // $45 de la venta del escenario + $45 de la encolada
      t.afirmar.igual(r.n, 2, 'el día no está contando las dos ventas');
      t.afirmar.cerca(r.suma, 90, 'el total del día se quedó corto sin señal');
    },

    async 'los folios locales no chocan entre sí'(t){
      const p = await t.abrir();
      const r = await p.evaluate(async () => {
        window.__falso.red = false;
        const folios = [];
        for(let i=0;i<4;i++){
          ESTADO.carro = {}; irVenta(); sumar('p1');
          irPago(); ESTADO.recibido = 100; pintarPago();
          await finalizarVenta(null);
          folios.push(ESTADO.ultimaVenta.folio);
        }
        return folios;
      });
      t.afirmar.igual(new Set(r).size, 4, `se repitió un folio local: ${JSON.stringify(r)}`);
    },

    async 'la cuenta suspendida no se salva con el modo avión'(t){
      const datos = t.escenario().datos;
      const p1 = await t.abrir({ datos });          // trabaja normal y deja caché
      t.afirmar.ok(await p1.evaluate(()=>!!document.querySelector('#p-app.activa')), 'no abrió normal al inicio');

      datos.negocios[0].activo = false;             // la suspendes
      const p2 = await t.abrir({ datos });
      t.afirmar.ok(await p2.evaluate(()=>!!document.querySelector('#p-suspendido.activa')), 'no salió la pantalla de suspendido con internet');

      const p3 = await t.abrir({ datos, red: false });   // el cliente pone modo avión
      t.afirmar.ok(await p3.evaluate(()=>!!document.querySelector('#p-suspendido.activa')), 'con modo avión se saltó la suspensión');

      datos.negocios[0].activo = true;              // le vuelves a activar
      const p4 = await t.abrir({ datos });
      t.afirmar.ok(await p4.evaluate(()=>!!document.querySelector('#p-app.activa')), 'reactivar no devolvió el acceso');
    },

  }
};
