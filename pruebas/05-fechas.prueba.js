/* La base guarda en UTC y el negocio vive en hora local. Aquí ya hubo un
   error caro: el día se cortaba a las 6 de la tarde y las ventas de la
   noche no contaban. Estas pruebas corren con el reloj puesto de noche,
   que es justo cuando se rompía. */
const ZONA = 'America/Mexico_City';                  // UTC-6
const DE_NOCHE = '2026-09-22T05:20:00.000Z';         // = 21 sep, 11:20 pm

function ventasDeLaNoche(){
  //  6 de la noche del 21 (ya son 22 en UTC) + 1 de la mañana del 21
  const horas = ['04:35:34','04:35:44','04:36:04','04:36:32','05:13:06','05:13:32'];
  const v = horas.map((h,i)=>({
    id:'w'+i, negocio_id:'n1', folio:'0'+(i+2), creado_en:`2026-09-22T${h}Z`,
    articulos:[], total:[80,80,70,105,80,105][i], metodo_pago:'efectivo',
    empleado_nombre:'Rosa itzel', empleado_uid:'u-rosa', anulada:false }));
  v.unshift({ id:'m1', negocio_id:'n1', folio:'001', creado_en:'2026-09-21T16:00:00Z',
    articulos:[], total:35, metodo_pago:'efectivo', empleado_nombre:'Rosa itzel', empleado_uid:'u-rosa', anulada:false });
  // y una que YA es del día siguiente en hora local
  v.push({ id:'x1', negocio_id:'n1', folio:'001', creado_en:'2026-09-22T16:00:00Z',
    articulos:[], total:999, metodo_pago:'efectivo', empleado_nombre:'Rosa itzel', empleado_uid:'u-rosa', anulada:false });
  return v;
}

async function deNoche(t, sesion){
  const datos = t.escenario().datos;
  datos.ventas = ventasDeLaNoche();
  return t.abrir({ sesion, datos, zona: ZONA, reloj: DE_NOCHE });
}

module.exports = {
  titulo: 'Fechas: el día corta a medianoche, no a las 6 de la tarde',
  casos: {

    async 'las ventas de la noche cuentan en el día correcto'(t){
      const p = await deNoche(t, t.CUENTAS.dueno);
      const r = await p.evaluate(async () => {
        const v = await obtenerVentasDia(hoyLocal());
        return { hoy: hoyLocal(), n: v.length, suma: v.reduce((s,x)=>s+Number(x.total),0) };
      });
      t.afirmar.igual(r.hoy, '2026-09-21', 'la app cree que es otro día');
      t.afirmar.igual(r.n, 7, 'se cayeron ventas de la noche fuera del día');
      t.afirmar.cerca(r.suma, 555, 'el corte del día no cuadra');
    },

    async 'la venta del día siguiente no se cuela en el de hoy'(t){
      const p = await deNoche(t, t.CUENTAS.dueno);
      const ids = await p.evaluate(async () => (await obtenerVentasDia(hoyLocal())).map(v=>v.id));
      t.afirmar.noIncluye(ids, 'x1', 'se coló una venta del día siguiente');
    },

    async 'el contador de la empleada cuenta sus ventas de la noche'(t){
      const p = await deNoche(t, t.CUENTAS.rosa);
      const v = await p.evaluate(() => ({
        etiqueta: document.querySelector('.ch-lbl')?.textContent.trim(),
        numero: document.querySelector('.ch-total')?.textContent.trim(),
      }));
      t.afirmar.igual(v.numero, '7', 'la empleada no ve sus ventas de la noche');
      t.afirmar.ok((v.etiqueta||'').includes('ROSA'), `la etiqueta no trae su nombre: ${v.etiqueta}`);
    },

    async 'el historial agrupa por día local'(t){
      const p = await deNoche(t, t.CUENTAS.dueno);
      const r = await p.evaluate(async () => {
        const vs = await obtenerVentasRango('2026-09-20','2026-09-23');
        const porDia = {};
        vs.forEach(v => { const f = fechaLocalDe(v.creado_en); porDia[f] = (porDia[f]||0)+1; });
        return porDia;
      });
      t.afirmar.igual(r['2026-09-21'], 7, 'el historial no agrupa bien el día 21');
      t.afirmar.igual(r['2026-09-22'], 1, 'el historial no agrupa bien el día 22');
    },

    async 'el folio del día se pide con la fecha local'(t){
      const p = await deNoche(t, t.CUENTAS.dueno);
      const r = await p.evaluate(async () => {
        irVenta(); sumar('p1');
        irPago(); ESTADO.recibido = 100; pintarPago();
        await finalizarVenta(null);
        return { folios: Object.keys(window.__falso.bd.folios || {}) };
      });
      t.afirmar.incluye(r.folios, 'n1|2026-09-21', `el folio se pidió con otra fecha: ${JSON.stringify(r.folios)}`);
    },

  }
};
