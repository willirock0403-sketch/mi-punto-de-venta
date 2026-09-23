/* El cobro: cuentas, cambio, inventario y firma de la venta.
   Aquí es donde un error cuesta dinero de verdad. */
module.exports = {
  titulo: 'Ventas: cuentas, cambio e inventario',
  casos: {

    async 'la cuenta del carrito sale bien'(t){
      const p = await t.abrir();
      const r = await p.evaluate(() => {
        irVenta();
        sumar('p1'); sumar('p1'); sumar('p2');   // 2 elotes de $45 + 1 refresco de $25
        return { total: totalCarro(), carro: ESTADO.carro };
      });
      t.afirmar.cerca(r.total, 115, 'el total del carrito no cuadra');
      t.afirmar.mismo(r.carro, { p1:2, p2:1 }, 'el carrito no guardó lo que se tocó');
    },

    async 'el desglose del cambio suma exactamente el cambio'(t){
      const p = await t.abrir();
      const r = await p.evaluate(() => {
        const casos = [7, 33, 88, 137, 499, 1234];
        return casos.map(c => ({ cambio:c, suma: desglosaCambio(c).reduce((s,d)=>s+d.n*d.v, 0) }));
      });
      r.forEach(c => t.afirmar.igual(c.suma, c.cambio, `el desglose de $${c.cambio} no suma lo mismo`));
    },

    async 'no se puede vender más de lo que hay en existencia'(t){
      const p = await t.abrir();
      // p2 tiene 3 de existencia
      const r = await p.evaluate(() => {
        irVenta();
        for(let i=0;i<8;i++) sumar('p2');
        return ESTADO.carro.p2;
      });
      t.afirmar.igual(r, 3, 'el carrito dejó pasar más piezas de las que hay');
    },

    async 'la existencia baja al cobrar y nunca queda en negativo'(t){
      const p = await t.abrir();
      const r = await p.evaluate(async () => {
        irVenta(); sumar('p2'); sumar('p2');
        irPago(); ESTADO.recibido = 100; pintarPago();
        await finalizarVenta(null);
        const enBase = (await sb.from('productos').select('*').eq('id','p2')).data[0];
        return { enBase: enBase.stock, enPantalla: ESTADO.productos.find(x=>x.id==='p2').stock };
      });
      t.afirmar.igual(r.enBase, 1, 'la existencia en la base no bajó bien');
      t.afirmar.igual(r.enPantalla, 1, 'la existencia en pantalla no bajó bien');
    },

    async 'la venta queda firmada con la cuenta que cobró'(t){
      const p = await t.abrir({ sesion: t.CUENTAS.rosa });
      const r = await p.evaluate(async () => {
        irVenta(); sumar('p1');
        irPago(); ESTADO.recibido = 50; pintarPago();
        await finalizarVenta(null);
        return { uid: ESTADO.ultimaVenta.empleado_uid, nombre: ESTADO.ultimaVenta.empleado_nombre };
      });
      t.afirmar.igual(r.uid, 'u-rosa', 'la venta no quedó firmada con la cuenta');
      t.afirmar.igual(r.nombre, 'Rosa itzel', 'la venta no quedó firmada con el nombre de la ficha');
    },

    async 'dos cobros seguidos no repiten folio'(t){
      const p = await t.abrir();
      const r = await p.evaluate(async () => {
        const folios = [];
        for(let i=0;i<3;i++){
          ESTADO.carro = {}; irVenta(); sumar('p1');
          irPago(); ESTADO.recibido = 100; pintarPago();
          await finalizarVenta(null);
          folios.push(ESTADO.ultimaVenta.folio);
        }
        return folios;
      });
      t.afirmar.igual(new Set(r).size, 3, `se repitió un folio: ${JSON.stringify(r)}`);
    },

    async 'el cambio que se enseña es el que se guarda'(t){
      const p = await t.abrir();
      const r = await p.evaluate(async () => {
        irVenta(); sumar('p1'); sumar('p2');      // $70
        irPago(); ESTADO.recibido = 200; pintarPago();
        await finalizarVenta(null);
        const v = ESTADO.ultimaVenta;
        const enPantalla = document.querySelector('.cb-monto')?.textContent;
        return { total:v.total, recibido:v.recibido, cambio:v.cambio, enPantalla };
      });
      t.afirmar.cerca(r.total, 70, 'el total guardado no cuadra');
      t.afirmar.cerca(r.cambio, 130, 'el cambio guardado no cuadra');
      t.afirmar.ok((r.enPantalla||'').includes('130'), `la pantalla no muestra el cambio: ${r.enPantalla}`);
    },

    async 'pagar con tarjeta no pide efectivo recibido'(t){
      const p = await t.abrir();
      const r = await p.evaluate(async () => {
        irVenta(); sumar('p1');
        irPago(); elegirMetodoPago('tarjeta');
        await finalizarVenta(null);
        const v = ESTADO.ultimaVenta;
        return { metodo:v.metodo_pago, cambio:v.cambio, recibido:v.recibido };
      });
      t.afirmar.igual(r.metodo, 'tarjeta', 'no se guardó el método de pago');
      t.afirmar.cerca(r.cambio, 0, 'una venta con tarjeta salió con cambio');
    },

  }
};
