/* Afirmaciones mínimas. Cada una lanza si falla; el corredor atrapa y
   reporta. No se usa ninguna librería para que la suite corra con solo
   Node y Playwright instalados. */

class Fallo extends Error {}

function fallar(mensaje, esperado, obtenido){
  const e = new Fallo(mensaje);
  e.detalle = { esperado, obtenido };
  throw e;
}

const afirmar = {
  ok(valor, mensaje){
    if(!valor) fallar(mensaje, 'algo verdadero', valor);
  },
  no(valor, mensaje){
    if(valor) fallar(mensaje, 'algo falso', valor);
  },
  igual(obtenido, esperado, mensaje){
    if(obtenido !== esperado) fallar(mensaje, esperado, obtenido);
  },
  mismo(obtenido, esperado, mensaje){
    const a = JSON.stringify(obtenido), b = JSON.stringify(esperado);
    if(a !== b) fallar(mensaje, b, a);
  },
  incluye(lista, valor, mensaje){
    if(!(lista || []).includes(valor)) fallar(mensaje, `que incluyera ${valor}`, JSON.stringify(lista));
  },
  noIncluye(lista, valor, mensaje){
    if((lista || []).includes(valor)) fallar(mensaje, `que NO incluyera ${valor}`, JSON.stringify(lista));
  },
  // para dinero: dos decimales de tolerancia
  cerca(obtenido, esperado, mensaje){
    if(Math.abs(Number(obtenido) - Number(esperado)) > 0.005) fallar(mensaje, esperado, obtenido);
  },
  rechazado(resultado, mensaje){
    if(!resultado || !resultado.error) fallar(mensaje, 'que el servidor lo rechazara', 'lo permitió');
  },
  permitido(resultado, mensaje){
    if(resultado && resultado.error) fallar(mensaje, 'que el servidor lo permitiera', resultado.error.message);
  },
};

module.exports = { afirmar, Fallo };
