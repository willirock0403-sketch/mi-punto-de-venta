# Pruebas automatizadas

Suite que abre la app de verdad en un navegador y la usa como la usaría una
persona: toca botones, cobra, cierra sesión, apaga el internet. No hay paso
de compilación ni configuración: solo Node y Playwright.

## Cómo correrlas

```bash
node pruebas/correr.js            # todas
node pruebas/correr.js seguridad  # solo las que traigan "seguridad" en el nombre
node pruebas/humo.js              # la app REAL, con la CSP puesta
```

Termina en 0 si todo pasó y en 1 si algo falló, así que sirve tal cual para
un gancho de pre-push o para CI.

## Por qué se puede confiar en ellas

El corazón de la suite es `ayuda/falso.js`: un Supabase simulado que aplica
**las mismas reglas que el servidor real**, no una versión permisiva.
Reproduce:

- Las políticas RLS de `supabase/seguridad.sql` (quién ve y quién toca qué).
- El disparador que protege el interruptor del cobro (`activo` y `dueno`).
- Los valores por omisión de las columnas y los índices únicos.
- Que Postgres lee una fecha **sin zona horaria como UTC**, no como hora
  local del navegador. Sin esto, el error del corte que se cerraba a las 6
  de la tarde habría pasado inadvertido.

Por eso una prueba no pasa solo porque la app escondió un botón: cada caso
de seguridad llama la función a mano, igual que alguien con la consola del
navegador abierta, y comprueba que el servidor lo niegue.

**Si cambian las políticas en `supabase/seguridad.sql`, hay que cambiar
`ayuda/falso.js` con ellas.** Si no, la suite seguiría en verde probando
reglas que ya no existen.

## Qué cubre

| Archivo | Qué vigila |
|---|---|
| `01-seguridad` | Qué puede tocar cada rol, aunque se salte la interfaz |
| `02-ventas` | Cuentas del carrito, cambio, existencias, folios, firma |
| `03-inyeccion` | Nombres con código adentro, nombres larguísimos |
| `04-sin-internet` | Cola de ventas, sincronización, suspensión con modo avión |
| `05-fechas` | Que el día corte a medianoche local y no a las 6 de la tarde |
| `06-cuentas` | Registro, roles, invitaciones, primer login |
| `07-limites` | Doble toque, respuesta perdida, carrito vacío, centavos |

## La prueba de humo

`humo.js` va aparte y hace lo único que la suite normal no puede: carga la
app **de verdad**, con la librería real de Supabase y con las cabeceras de
`_headers` puestas (la CSP incluida). La suite normal usa un Supabase falso
y por eso bloquea la librería.

Es la que atrapa que el `<script>` apunte a un archivo que no existe, o que
la CSP esté bloqueando algo que la app necesita. Sin ella se podía dejar la
app muerta con las 46 pruebas en verde.

Córrela siempre que toques `_headers`, el `<script>` de la librería o
`vendor/`.

## Lo que estas pruebas NO cubren

Conviene tenerlo claro para no confiarse de más:

- **No tocan tu Supabase de verdad.** El falso imita las reglas, pero si el
  SQL nunca se corrió en producción, aquí igual sale verde. Los cambios de
  `supabase/seguridad.sql` hay que correrlos y comprobarlos a mano.
- **No prueban la configuración de Supabase.** En particular, el flujo de
  invitación se apoya en que la **confirmación de correo esté encendida**
  (Authentication → Sign In / Providers → Confirm email). Si está apagada,
  cualquiera que adivine un correo invitado puede tomar ese lugar sin tener
  acceso al buzón. La suite deja fijado el comportamiento, pero la
  protección vive en la configuración.
- **No prueban la impresora térmica.** Web Bluetooth necesita un aparato de
  verdad. Sí se prueba el texto del ticket y que no se salga del rollo.
- **Un solo navegador.** Corren en Chromium. Safari de iPhone, que es donde
  más se usa la app, se revisa a mano.
