/* Casos límite y dedos nerviosos. Un punto de venta lo usa gente con
   prisa: doble toque, carrito vacío, cancelar a medias. */
module.exports = {
  titulo: 'Límites: dedos nerviosos y cuentas raras',
  casos: {

    async 'doble toque en Cobrar no cobra dos veces'(t){
      const p = await t.abrir();
      const r = await p.evaluate(async () => {
        irVenta(); sumar('p1');
        irPago(); ESTADO.recibido = 100; pintarPago();
        const boton = [...document.querySelectorAll('.mega.verde')].find(b => /cobr|confirmar/i.test(b.textContent));
        boton.click(); boton.click(); boton.click();        // tres toques seguidos, como un dedo nervioso
        await new Promise(r => setTimeout(r, 800));
        const enBase = (await sb.from('ventas').select('*').eq('negocio_id','n1')).data;
        return { total: enBase.length, folios: enBase.map(v=>v.folio) };
      });
      t.afirmar.igual(r.total, 2, `se cobró de más: ${r.total} ventas, folios ${JSON.stringify(r.folios)}`);
    },

    async 'si se pierde la respuesta, la venta no se cobra dos veces'(t){
      // El servidor guarda la venta y la señal se cae justo antes de que
      // llegue la confirmación. La app cree que falló, la encola, y al
      // volver la señal la vuelve a subir: la misma venta, dos veces.
      const p = await t.abrir();
      const r = await p.evaluate(async () => {
        window.__falso.perderRespuesta = true;
        irVenta(); sumar('p1');
        irPago(); ESTADO.recibido = 100; pintarPago();
        await finalizarVenta(null);
        const encoladas = ventasPendientes().length;
        await sincronizarPendientes(true);
        await new Promise(r => setTimeout(r, 400));
        const enBase = (await sb.from('ventas').select('*').eq('negocio_id','n1')).data;
        return { encoladas, total: enBase.length, totales: enBase.map(v=>v.total) };
      });
      // 1 del escenario + 1 de este cobro. Nunca 3.
      t.afirmar.igual(r.total, 2, `la misma venta se guardó dos veces: ${JSON.stringify(r.totales)}`);
    },

    async 'la pantalla no deja llegar al cobro con el carrito vacío'(t){
      const p = await t.abrir();
      const r = await p.evaluate(() => {
        ESTADO.carro = {}; irVenta();
        const boton = document.querySelector('.bc-btn');
        return { apagado: boton.classList.contains('off'), accion: boton.getAttribute('onclick') || '' };
      });
      t.afirmar.ok(r.apagado, 'el botón de Cobrar se ve activo con el carrito vacío');
      t.afirmar.no(r.accion.includes('irPago'), 'con el carrito vacío se puede llegar a la pantalla de cobro');
    },

    async 'no se puede cobrar con menos dinero del que cuesta'(t){
      const p = await t.abrir();
      const r = await p.evaluate(async () => {
        irVenta(); sumar('p1');                       // $45
        irPago(); ESTADO.recibido = 20; pintarPago(); // le dan $20
        const boton = [...document.querySelectorAll('.mega, .btn-grande')].find(b => /cobrar|finalizar/i.test(b.textContent));
        return { botonApagado: !boton || boton.disabled || boton.classList.contains('off') };
      });
      t.afirmar.ok(r.botonApagado, 'deja cobrar con menos dinero del que cuesta la venta');
    },

    async 'una venta anulada deja de contar en el día'(t){
      const p = await t.abrir();
      const r = await p.evaluate(async () => {
        const antes = await obtenerVentasDia(hoyLocal());
        await sb.from('ventas').update({anulada:true}).eq('id','v1');
        const despues = await obtenerVentasDia(hoyLocal());
        return { antes: antes.length, despues: despues.length };
      });
      t.afirmar.igual(r.antes, 1, 'el día no arrancó con la venta del escenario');
      t.afirmar.igual(r.despues, 0, 'una venta anulada sigue contando en el día');
    },

    async 'los precios con centavos no se desbaratan'(t){
      const datos = t.escenario().datos;
      datos.productos[0].precio = 10.10;
      datos.productos[1].precio = 0.20;
      const p = await t.abrir({ datos });
      const r = await p.evaluate(async () => {
        irVenta();
        for(let i=0;i<3;i++) sumar('p1');   // 3 x 10.10 = 30.30
        sumar('p2');                         // + 0.20     = 30.50
        const total = totalCarro();
        irPago(); ESTADO.recibido = 50; pintarPago();
        await finalizarVenta(null);
        return { total, guardado: ESTADO.ultimaVenta.total, cambio: ESTADO.ultimaVenta.cambio };
      });
      t.afirmar.cerca(r.total, 30.50, 'la suma con centavos no cuadra');
      t.afirmar.cerca(r.guardado, 30.50, 'lo guardado con centavos no cuadra');
      t.afirmar.cerca(r.cambio, 19.50, 'el cambio con centavos no cuadra');
    },

    async 'el corte de caja cuadra con lo cobrado en efectivo'(t){
      const p = await t.abrir();
      const r = await p.evaluate(async () => {
        ESTADO.carro = {}; irVenta(); sumar('p1');              // $45 efectivo
        irPago(); ESTADO.recibido = 100; pintarPago();
        await finalizarVenta(null);
        ESTADO.carro = {}; irVenta(); sumar('p2');              // $25 con tarjeta
        irPago(); elegirMetodoPago('tarjeta');
        await finalizarVenta(null);
        const v = await obtenerVentasDia(hoyLocal());
        const efectivo = v.filter(x => (x.metodo_pago||'efectivo')==='efectivo').reduce((s,x)=>s+Number(x.total),0);
        const todo = v.reduce((s,x)=>s+Number(x.total),0);
        return { efectivo, todo, n: v.length };
      });
      // escenario $45 efectivo + $45 efectivo + $25 tarjeta
      t.afirmar.igual(r.n, 3, 'no se registraron las tres ventas');
      t.afirmar.cerca(r.efectivo, 90, 'el efectivo del corte no cuadra');
      t.afirmar.cerca(r.todo, 115, 'el total del día no cuadra');
    },

    async 'volver de la pantalla de cambio deja el carrito limpio'(t){
      const p = await t.abrir();
      const r = await p.evaluate(async () => {
        irVenta(); sumar('p1'); sumar('p2');
        irPago(); ESTADO.recibido = 200; pintarPago();
        await finalizarVenta(null);
        const botones = [...document.querySelectorAll('.cambio-vista .mega')].map(b=>b.textContent.trim());
        nuevaVentaLimpia();
        const tras = { carro: Object.keys(ESTADO.carro).length, recibido: ESTADO.recibido };
        return { botones, tras };
      });
      t.afirmar.incluye(r.botones, 'Inicio', 'falta el botón de Inicio tras cobrar');
      t.afirmar.igual(r.tras.carro, 0, 'el carrito se quedó con productos de la venta anterior');
      t.afirmar.igual(r.tras.recibido, 0, 'el dinero recibido no se limpió');
    },

  }
};
