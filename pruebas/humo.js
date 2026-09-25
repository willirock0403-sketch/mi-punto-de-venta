#!/usr/bin/env node
/* Prueba de humo: carga la app DE VERDAD, con la librería real de Supabase
   y con las cabeceras de _headers puestas (la CSP incluida).

   La suite normal no puede hacer esto: usa un Supabase falso y por eso
   bloquea la librería. Esta prueba es la que atraparía que el <script> de
   la librería apunte a un archivo que no existe, o que la CSP esté
   bloqueando algo que la app necesita. Sin ella, cambiar la CSP o mover la
   librería podía dejar la app muerta con la suite en verde.

     node pruebas/humo.js
*/
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const RAIZ = path.join(__dirname, '..');
const TIPOS = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css',
                '.json':'application/json', '.png':'image/png', '.webmanifest':'application/manifest+json' };

/* lee _headers y saca las cabeceras globales, para probar contra lo mismo
   que sirve Cloudflare y no contra una versión sin protecciones */
function cabecerasGlobales(){
  const txt = fs.readFileSync(path.join(RAIZ, '_headers'), 'utf8');
  const fuera = {};
  let dentro = false;
  for(const linea of txt.split('\n')){
    if(/^\S/.test(linea)){ dentro = linea.trim() === '/*'; continue; }
    if(!dentro) continue;
    const i = linea.indexOf(':');
    if(i > 0) fuera[linea.slice(0,i).trim()] = linea.slice(i+1).trim();
  }
  return fuera;
}

(async () => {
  const cabeceras = cabecerasGlobales();
  if(!cabeceras['Content-Security-Policy']){
    console.error('✗ No se encontró la CSP en _headers');
    process.exit(1);
  }

  const servidor = http.createServer((req, resp) => {
    const limpio = decodeURIComponent(req.url.split('?')[0]);
    const archivo = path.join(RAIZ, limpio === '/' ? 'index.html' : limpio);
    if(!archivo.startsWith(RAIZ) || !fs.existsSync(archivo) || fs.statSync(archivo).isDirectory()){
      resp.writeHead(404); return resp.end('no está');
    }
    resp.writeHead(200, { ...cabeceras, 'Content-Type': TIPOS[path.extname(archivo)] || 'application/octet-stream' });
    fs.createReadStream(archivo).pipe(resp);
  });
  await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${servidor.address().port}/index.html`;

  const navegador = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await navegador.newPage({ viewport:{width:420,height:950} });

  const problemas = [];
  page.on('pageerror', e => problemas.push('error en la página: ' + e.message));
  page.on('console', m => {
    const t = m.text();
    // la CSP avisa por consola cuando bloquea algo
    if(/Content Security Policy|Refused to/i.test(t)) problemas.push('CSP bloqueó: ' + t);
  });
  page.on('requestfailed', r => {
    const u = r.url();
    if(u.startsWith(url.split('/index.html')[0])) problemas.push('no cargó: ' + u + ' (' + (r.failure()||{}).errorText + ')');
  });

  await page.goto(url);
  await page.waitForTimeout(3000);

  const estado = await page.evaluate(() => ({
    libreria: typeof (window.supabase && window.supabase.createClient),
    // sb es const dentro del script: existe en el ámbito global pero NO
    // cuelga de window, así que hay que preguntarlo por su nombre
    cliente: (() => { try { return typeof sb.from; } catch(e){ return 'no existe'; } })(),
    pantalla: [...document.querySelectorAll('.pantalla.activa')].map(p => p.id).join(',') || '(ninguna)',
    origenLibreria: [...document.querySelectorAll('script[src]')].map(s => s.getAttribute('src')),
  }));

  await navegador.close();
  servidor.close();

  const checar = [
    ['la librería de Supabase se cargó',        estado.libreria === 'function'],
    ['el cliente quedó listo',                  estado.cliente === 'function'],
    ['la app llegó a una pantalla',             estado.pantalla !== '(ninguna)'],
    ['ningún script viene de un CDN externo',   estado.origenLibreria.every(s => !/^https?:/i.test(s))],
    ['nada quedó roto ni bloqueado',            problemas.length === 0],
  ];

  let mal = 0;
  console.log('\n\x1b[1mPrueba de humo: la app real, con la CSP puesta\x1b[0m');
  for(const [texto, bien] of checar){
    console.log(bien ? `  \x1b[32m✓\x1b[0m ${texto}` : `  \x1b[31m✗\x1b[0m ${texto}`);
    if(!bien) mal++;
  }
  console.log(`\n  scripts: ${JSON.stringify(estado.origenLibreria)}`);
  console.log(`  pantalla: ${estado.pantalla}`);
  if(problemas.length) problemas.forEach(p => console.log('  \x1b[31m·\x1b[0m ' + p));
  console.log('');
  process.exit(mal ? 1 : 0);
})();
