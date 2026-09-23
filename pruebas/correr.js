#!/usr/bin/env node
/* Corredor de la suite.
     node pruebas/correr.js            -> todas
     node pruebas/correr.js seguridad  -> solo los archivos que contengan eso

   Levanta un servidor estático sobre el repo, abre Chromium una sola vez y
   le da a cada prueba una página limpia con el Supabase falso ya puesto. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { afirmar } = require('./ayuda/afirmar');
const { instalarFalso } = require('./ayuda/falso');
const { escenario, CUENTAS } = require('./ayuda/escenario');

const RAIZ = path.join(__dirname, '..');
const TIPOS = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css',
                '.json':'application/json', '.png':'image/png', '.webmanifest':'application/manifest+json' };

function servir(){
  return new Promise(res => {
    const s = http.createServer((req, resp) => {
      const limpio = decodeURIComponent(req.url.split('?')[0]);
      const archivo = path.join(RAIZ, limpio === '/' ? 'index.html' : limpio);
      if(!archivo.startsWith(RAIZ) || !fs.existsSync(archivo) || fs.statSync(archivo).isDirectory()){
        resp.writeHead(404); return resp.end('no está');
      }
      resp.writeHead(200, { 'Content-Type': TIPOS[path.extname(archivo)] || 'application/octet-stream' });
      fs.createReadStream(archivo).pipe(resp);
    });
    s.listen(0, '127.0.0.1', () => res(s));
  });
}

(async () => {
  const filtro = process.argv[2];
  const archivos = fs.readdirSync(__dirname)
    .filter(f => f.endsWith('.prueba.js'))
    .filter(f => !filtro || f.includes(filtro))
    .sort();
  if(!archivos.length){ console.error('No hay pruebas que correr.'); process.exit(1); }

  const servidor = await servir();
  const url = `http://127.0.0.1:${servidor.address().port}/index.html`;
  const navegador = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  let pasaron = 0;
  const fallaron = [];

  for(const archivo of archivos){
    const modulo = require(path.join(__dirname, archivo));
    console.log(`\n\x1b[1m${modulo.titulo || archivo}\x1b[0m`);

    for(const [nombre, caso] of Object.entries(modulo.casos)){
      // contexto nuevo por caso: el localStorage no se contagia entre pruebas
      let ctx = await navegador.newContext({ viewport:{width:420,height:950} });
      const errores = [];
      const ayuda = {
        afirmar, CUENTAS, escenario,
        async abrir(opciones = {}){
          // una prueba puede pedir otra zona horaria; se rehace el contexto
          // conservando el localStorage, que es lo que el modo sin conexión usa
          if(opciones.zona && !ctx.__zona){
            const guardado = await ctx.storageState();
            await ctx.close();
            ctx = await navegador.newContext({ viewport:{width:420,height:950}, timezoneId: opciones.zona, storageState: guardado });
            ctx.__zona = opciones.zona;
          }
          const page = await ctx.newPage();
          if(opciones.reloj) await page.clock.install({ time: new Date(opciones.reloj) });
          page.on('pageerror', e => errores.push('PAGEERROR: ' + e.message));
          page.on('dialog', d => d.accept());
          const base = escenario();
          const cfg = {
            sesion: opciones.sesion === null ? null : (opciones.sesion || CUENTAS.dueno),
            datos: opciones.datos || base.datos,
            cuentas: base.cuentas,
            red: opciones.red !== false,
          };
          await page.addInitScript(instalarFalso, cfg);
          if(opciones.antes) await page.addInitScript(opciones.antes);
          await page.goto(url);
          await page.waitForFunction(() => window.__arranco === true || document.querySelector('.pantalla.activa'), null, { timeout: 15000 });
          await page.waitForTimeout(opciones.espera || 900);
          return page;
        },
        errores,
      };

      try{
        await caso(ayuda);
        if(errores.length) throw Object.assign(new Error('La página lanzó errores'), { detalle:{ esperado:'consola limpia', obtenido: errores.join(' | ') } });
        console.log(`  \x1b[32m✓\x1b[0m ${nombre}`);
        pasaron++;
      }catch(e){
        console.log(`  \x1b[31m✗\x1b[0m ${nombre}`);
        console.log(`      ${e.message}`);
        if(e.detalle){
          console.log(`      esperaba: ${e.detalle.esperado}`);
          console.log(`      obtuvo:   ${e.detalle.obtenido}`);
        } else if(e.stack){
          console.log('      ' + e.stack.split('\n')[1].trim());
        }
        fallaron.push(`${modulo.titulo || archivo} → ${nombre}`);
      }
      await ctx.close();
    }
  }

  await navegador.close();
  servidor.close();

  console.log(`\n${'─'.repeat(56)}`);
  console.log(`${pasaron} pasaron, ${fallaron.length} fallaron`);
  if(fallaron.length){
    console.log('\nFallaron:');
    fallaron.forEach(f => console.log('  · ' + f));
  }
  process.exit(fallaron.length ? 1 : 0);
})();
