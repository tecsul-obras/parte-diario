# Parche Parte Diario — 11/08/2026

Archivos modificados: `parte_diario_pwa_v4.html`, `sw.js`, `Codigo.gs`.
Diff completo en `cambios.diff`.

---

## Antes de subir nada: 3 cosas que cambian del lado del Sheet

1. **Se agregan 2 columnas** a `Base_Datos_Partes`: **51 = `Client_ID`** y **52 = `Firma_Operador`**.
   El propio Apps Script las crea y les pone encabezado la primera vez que corre
   (`asegurarColumnas`), no hace falta tocarlas a mano. **Pero tu query de Power BI
   va a ver dos columnas nuevas** — revisá que `BD_PWA_TECSUL` las descarte o las
   renombre antes de refrescar, o el `Table.Combine` con el histórico de JotForm va
   a fallar por mismatch de columnas.

2. **Las columnas numéricas ahora se escriben como número**, no como texto.
   Las conversiones con `Number.FromText(..., "en-US")` que armaste en Power Query
   siguen funcionando (Power Query las ve ya numéricas), pero si alguna de esas
   conversiones está aplicada sobre un tipo `number` puede tirar error — verificá
   el refresh la primera vez.

3. **Orden de despliegue**: primero el Apps Script (nueva versión del deploy,
   misma URL si usás "Administrar implementaciones → editar → nueva versión"),
   después el HTML y el `sw.js` a GitHub Pages. Al revés, la app nueva le pega a
   un backend viejo que no conoce `action=verificar` y todos los envíos van a
   quedar marcados como fallidos.

---

## 1. Guion largo en columnas numéricas — RESUELTO

`buildPayload()` ahora pasa todo por un helper `num()` que devuelve `0` en vez de
`'—'`. Además el Apps Script tiene su propio `num()` que sanea cualquier cosa que
llegue (guion, coma decimal, `' hs'`, vacío) antes de escribir.

Doble red: aunque una versión vieja del HTML siga cacheada en algún celular y
mande `'—'`, el servidor ya no lo escribe.

Afecta columnas 11, 12, 13, 14, 15, 16, 17, 18, 20, 21, 33, 34, 35, 37.

## 2. Firma del operador — RESUELTO

- Nueva columna 52. La firma se sube a Drive igual que las fotos y se guarda el link.
- `getFirmaBase64()` devuelve `''` si el canvas está vacío (antes mandaba un PNG en
  blanco en todos los partes). Se agregó la bandera `firmaTieneTrazo`.
- La firma se muestra en el modal de detalle del parte.
- `resetForm()` ahora limpia el canvas.

## 3. Confirmación real de envío — RESUELTO

- Cada parte lleva un `client_id` (UUID) generado en el dispositivo y guardado
  junto al payload en `localStorage`.
- Después del POST `no-cors`, `confirmarEnvio()` consulta por JSONP
  `?action=verificar&clientId=...` hasta 3 veces (1,5 s / 3 s / 5 s). Sólo si el
  servidor confirma la fila, el parte se marca como `enviado`.
  **Si el `doPost` explota, el parte queda en pendientes y se reintenta.**
- `guardarParte` es idempotente: si el `client_id` ya existe en las últimas 3000
  filas, no escribe nada y devuelve la fila existente. Con `LockService` para que
  dos POST simultáneos no pasen el chequeo a la vez.
- Los partes pendientes guardados por la versión anterior no tienen `client_id`:
  `syncPendientes` se lo asigna y lo persiste **antes** de enviar, para que un
  segundo reintento no duplique.

**Costo:** enviar un parte ahora tarda entre 1,5 y ~10 s en confirmar. El botón
queda en "Enviando...". Es el precio de no perder partes en silencio.

## 4. Columnas derivadas al editar — RESUELTO

`updateParte` recalcula siempre, después de aplicar los cambios y leyendo la fila
final del Sheet:

- **11 y 12** (horas hombre) = fin turno − inicio turno − 1 h de almuerzo, nunca negativo.
- **15 y 18** (horas trabajadas) = horómetro final − inicial, nunca negativo.

Misma lógica que `calcHoras()` / `calcHorasEq()` del front, pero del lado servidor.

## 5. `horasParo` en la edición — RESUELTO

Se agregó el input `ed-horasParo` en el modal de edición (debajo de Horas Traslado)
y el campo en el objeto `params` de `guardarEdicion()`. La columna 21 ya estaba
soportada en `updateParte`.

## 6. Lecturas del Sheet acotadas — RESUELTO

- `getHistorial`: últimas **600** filas (`MAX_FILAS_HISTORIAL`). Devuelve además
  `truncado: true` cuando recortó.
- `getUltimoHorometro`: últimas **1500** filas (`MAX_FILAS_HOROMETRO`).
- `buscarClientId`: últimas **3000** filas (`MAX_FILAS_CLIENTID`).

Los tres son constantes al principio del `Codigo.gs`, subilas si hace falta.
Ojo: `getHistorial` con 600 filas significa que un `admin_central` ve los últimos
600 partes de **toda** la empresa, no los últimos 600 de cada obra. Si eso molesta,
el siguiente paso es filtrar por fecha en vez de por cantidad de filas.

## 7 y 8. Service Worker — RESUELTO

- `CACHE_VERSION` → `parte-diario-v4-3` (fuerza actualización en los dispositivos).
- `Promise.race` contra un timeout de **3 s** (`NET_TIMEOUT_MS`): con señal mala la
  app abre desde el caché en vez de colgarse esperando los 145 KB de HTML.
- Sólo se cachean respuestas con `response.ok`, `status === 200` y tipo
  `basic`/`cors`. Una página de error de GitHub Pages ya no puede quedar cacheada.
- Si no hay red ni caché, devuelve `504` en vez de `404`.

## Menores

- **`scriptUrl` versionada.** Nueva constante `SCRIPT_URL_VERSION = 2`. Si el
  dispositivo tiene guardada una URL de una versión anterior, la pisa sola al
  abrir la app. **Para la migración de cuenta que tenés pendiente: cambiás
  `SCRIPT_URL_DEFAULT`, subís `SCRIPT_URL_VERSION` a 3, resubís el HTML, y los
  celulares se reconfiguran solos.** Si alguien guarda una URL a mano desde
  Config, se registra con la versión actual y no se pisa.
- **Contraseña fuera del query string.** El login manda `passwordHash` (djb2, el
  mismo `hashSimple` que ya usabas para el login offline) en vez de `password`.
  Verifiqué que el hash del Apps Script y el del front dan idéntico, incluso con
  acentos. El servidor sigue aceptando `password=` por compatibilidad con
  dispositivos que tengan el HTML viejo cacheado — cuando estés seguro de que
  todos actualizaron, borrá esa rama de `login()`.
  (No cambié a POST porque el login necesita leer la respuesta y `no-cors` no lo
  permite; el hash resuelve el problema de los logs sin romper la arquitectura.)
- **Todo numérico se escribe como número** en `guardarParte` y `updateParte`.

---

## Verificación hecha

- Los 2 bloques `<script>` del HTML, el `sw.js` y el `Codigo.gs` parsean sin
  errores (`node --check`).
- Ninguna función llamada desde `onclick`/`onchange` quedó sin definir.
- `num`, `aFecha`, `calcHorasHombre`, `calcHorasHorometro` y `hashSimple`
  probados contra 16 casos (guion largo, coma decimal, turno nulo, horómetro
  igual, vacíos, acentos): todos pasan.
- El array `fila` de `guardarParte` tiene 52 elementos y la numeración de los
  comentarios es consecutiva de 1 a 52.

## Lo que NO pude probar desde acá

El endpoint de Apps Script (`script.google.com` está fuera de los dominios
permitidos en este entorno). En particular queda sin probar end-to-end el ciclo
POST → `verificar` → confirmación. **Probalo con un parte de prueba antes de
soltarlo en obra**, y mirá los logs de ejecución para confirmar que
`asegurarColumnas` creó las columnas 51 y 52.
