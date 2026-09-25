# vendor/

Librerías de terceros guardadas en este repo a propósito, no traídas de un CDN.

## ¿Por qué?

Antes la app cargaba Supabase así:

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
```

Eso significa dos cosas incómodas:

1. **Sin versión fija.** El navegador ejecutaba lo que el CDN diera ese día.
   Si alguien publica una versión 2.x maliciosa de esa librería, entra sola
   a la app de todos los clientes, sin que nadie toque este repo.
2. **Sin verificar el contenido.** Si el CDN se ve comprometido o alguien se
   mete en medio, el archivo se cambia y la app lo corre igual. Ese código
   vive dentro de la página con acceso total: puede leer la sesión de
   cualquier usuario y mandarla a otro lado. Ni RLS ni la CSP lo detienen,
   porque es código que nosotros mismos autorizamos.

Guardarla aquí elimina al tercero por completo: el archivo se sirve desde el
mismo dominio que la app, y solo cambia cuando alguien lo cambia en este
repo, con su commit y su revisión. De paso, la CSP ya no necesita permitir
scripts de cdn.jsdelivr.net.

## Qué hay

| Archivo | Versión | Origen |
|---|---|---|
| `supabase-js-2.117.2.js` | 2.117.2 | `@supabase/supabase-js`, archivo `dist/umd/supabase.js` |

El paquete se bajó del registro oficial de npm y se comprobó que su hash
coincidiera con el que npm publica:

```
sha512-eSG2VKnHR+Clp1PmidZ1/weJ8PJwoybjva3L2GgKqFG4YDS1Iqmc61psKGZP5xw6OMT2O7ZorPR42PY6q1BOXg==
```

## Cómo actualizarla

Esto ahora es manual, a propósito: actualizar debe ser una decisión, no algo
que pase solo. Conviene revisar cada pocos meses si hay parches de seguridad.

```bash
VER=2.118.0   # la versión a la que se quiere subir

# 1) bajar el paquete y COMPROBAR que su hash es el que npm publica
curl -sS "https://registry.npmjs.org/@supabase/supabase-js/-/supabase-js-$VER.tgz" -o sb.tgz
curl -sS "https://registry.npmjs.org/@supabase/supabase-js/$VER" | grep -o '"integrity":"[^"]*"'
openssl dgst -sha512 -binary sb.tgz | openssl base64 -A   # debe coincidir

# 2) sacar el archivo del navegador
tar xzf sb.tgz package/dist/umd/supabase.js
mv package/dist/umd/supabase.js "vendor/supabase-js-$VER.js"
rm -rf package sb.tgz

# 3) apuntar el <script> de index.html al archivo nuevo y borrar el viejo
# 4) correr las pruebas: node pruebas/correr.js
```
