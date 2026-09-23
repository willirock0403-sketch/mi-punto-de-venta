/* Los nombres de producto, de negocio y de empleado son texto que escribe
   el usuario y que después se mete en el HTML de la app. Si no se escapa,
   un cliente puede guardar un nombre con código adentro y que se ejecute
   cada vez que alguien abra esa pantalla. */
const VENENO = '<img src=x onerror="window.__colado=1">';

function conVeneno(escenario){
  const d = escenario().datos;
  d.negocios[0].nombre    = 'Snack ' + VENENO;
  d.productos[0].nombre   = 'Elote ' + VENENO;
  d.productos[0].categoria= 'Cat ' + VENENO;
  d.empleados[0].nombre   = 'Rosa ' + VENENO;
  return d;
}

module.exports = {
  titulo: 'Inyección: nombres con código adentro',
  casos: {

    async 'un nombre con código no se ejecuta en la pantalla de venta'(t){
      const p = await t.abrir({ datos: conVeneno(t.escenario) });
      await p.evaluate(() => irVenta());
      await p.waitForTimeout(300);
      const r = await p.evaluate(() => ({
        colado: window.__colado,
        imgs: document.querySelectorAll('img[src="x"]').length,
        seLeeLiteral: document.body.innerText.includes('<img src=x'),
      }));
      t.afirmar.no(r.colado, 'se ejecutó código metido en el nombre de un producto');
      t.afirmar.igual(r.imgs, 0, 'el nombre creó etiquetas HTML de verdad');
      t.afirmar.ok(r.seLeeLiteral, 'el nombre con código no se está mostrando como texto');
    },

    async 'tampoco en el inicio ni en el encabezado'(t){
      const p = await t.abrir({ datos: conVeneno(t.escenario) });
      const r = await p.evaluate(() => ({
        colado: window.__colado,
        imgs: document.querySelectorAll('img[src="x"]').length,
      }));
      t.afirmar.no(r.colado, 'se ejecutó código metido en el nombre del negocio');
      t.afirmar.igual(r.imgs, 0, 'el nombre del negocio creó etiquetas HTML');
    },

    async 'tampoco en ajustes, que es donde se listan productos y equipo'(t){
      const p = await t.abrir({ datos: conVeneno(t.escenario) });
      await p.evaluate(() => irConfig());
      await p.waitForTimeout(400);
      const r = await p.evaluate(() => ({
        colado: window.__colado,
        imgs: document.querySelectorAll('img[src="x"]').length,
      }));
      t.afirmar.no(r.colado, 'se ejecutó código en la pantalla de ajustes');
      t.afirmar.igual(r.imgs, 0, 'ajustes creó etiquetas HTML desde un nombre');
    },

    async 'tampoco al cobrar y ver el ticket'(t){
      const p = await t.abrir({ sesion: t.CUENTAS.rosa, datos: conVeneno(t.escenario) });
      const texto = await p.evaluate(async () => {
        irVenta(); sumar('p1');
        irPago(); ESTADO.recibido = 100; pintarPago();
        await finalizarVenta(null);
        return ticketTexto(ESTADO.ultimaVenta, 32);
      });
      const r = await p.evaluate(() => ({ colado: window.__colado, imgs: document.querySelectorAll('img[src="x"]').length }));
      t.afirmar.no(r.colado, 'se ejecutó código al cobrar');
      t.afirmar.igual(r.imgs, 0, 'la pantalla de cambio creó etiquetas HTML');
      t.afirmar.ok(texto.length > 50, 'el ticket salió vacío con un nombre raro');
    },

    async 'un nombre larguísimo no rompe la pantalla ni el ticket'(t){
      const d = t.escenario().datos;
      d.productos[0].nombre = 'Ñ'.repeat(400);
      d.negocios[0].nombre  = 'Negocio '.repeat(40);
      const p = await t.abrir({ datos: d });
      const r = await p.evaluate(async () => {
        irVenta(); sumar('p1');
        irPago(); ESTADO.recibido = 100; pintarPago();
        await finalizarVenta(null);
        const t32 = ticketTexto(ESTADO.ultimaVenta, 32);
        return {
          anchoMax: Math.max(...t32.split('\n').map(l => l.length)),
          desbordeH: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
        };
      });
      t.afirmar.ok(r.anchoMax <= 32, `el ticket se salió del rollo: ${r.anchoMax} columnas`);
      t.afirmar.no(r.desbordeH, 'la pantalla quedó con barra horizontal por un nombre largo');
    },

  }
};
