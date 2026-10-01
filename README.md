# Parte Diario de Maquinaria — Tecsul S.A.E.

Sistema de carga de partes diarios de equipos. Reemplaza el formulario
de JotForm + Google Sheets por una PWA propia sobre Supabase.

**Última actualización de esta carpeta: 01/10/2026**

---

## Cómo está armado

```
Operador (celular)  →  PWA  →  Supabase (Postgres + Storage)
                                    │
                                    ├─→ Apps Script (cada hora) → Google Sheet espejo → Power BI
                                    └─→ Apps Script (semanal)   → Google Drive (fotos de +3 meses)
```

**Supabase es la fuente de verdad.** Ahí carga la PWA, ahí están las
reglas y los permisos, ahí está el panel de control.

**Por qué hay un espejo en Google Sheets y no una conexión directa:**
la red de Tecsul bloquea los puertos de base de datos (5432 y 6543), y
el servicio web de Power BI además no valida el certificado del pooler
de Supabase. El espejo va por HTTPS (puerto 443), que sí pasa. Si algún
día sistemas abre el puerto, la conexión directa vuelve a ser mejor y el
espejo se retira sin tocar nada más que esa consulta de Power Query.

---

## Los archivos SQL, en orden

Se corren en el **SQL Editor de Supabase**, uno por vez, en este orden.
Si alguno da error, no sigas con el siguiente.

| # | Archivo | Qué hace |
|---|---|---|
| 00 | `00_verificar_o_reset.sql` | Diagnóstico, y el reset total (comentado) |
| 01 | `01_esquema.sql` | Tablas, columnas calculadas, funciones, auditoría |
| 02 | `02_rls.sql` | Permisos por rol (RLS) y bucket privado de imágenes |
| 03 | `03_vista_powerbi.sql` | Vistas con los nombres de columna de JotForm |
| 04 | `04_formulario.sql` | El constructor: secciones, campos y reglas |
| 05 | `05_mejoras.sql` | Familia de equipo, viajes de camiones, m³ de hormigón |
| 06 | `06_cambio_clave.sql` | Cambio de contraseña obligatorio en el primer ingreso |
| 07 | `07_regla_remision.sql` | Exigir remisión cuando se carga combustible |
| 08 | `08_horometro.sql` | **Arregla el último horómetro** (ver abajo) |
| 09 | `09_panel_control.sql` | Panel: faltantes, cumplimiento, anomalías |
| 10 | `10_vista_powerbi_anexo.sql` | Vista que alimenta el espejo de Power BI |
| 11 | `11_archivo_fotos.sql` | Archivado de fotos a Drive |
| 11b | `11b_archivo_fotos_correccion.sql` | Filtro más estricto + diagnóstico de datos |
| 12 | `12_componente_falla_catalogo.sql` | Componente de falla desde el catálogo |
| 13 | `13_rol_taller.sql` | Rol nuevo `taller`. **Solo, en su propia pestaña** |
| 14 | `14_flota.sql` | Flota: ficha técnica, estado, historial, documentos, mantenimiento, seguros, alquileres, personal |
| 15 | `15_ordenes_trabajo.sql` | Órdenes de trabajo de taller (ex JotForm "Reportes - Taller") |
| 16 | `16_combustible.sql` | Control de combustible (ex JotForm "Control Combustible") |

Si alguna vez se vuelve a correr `14_flota.sql`, correr `15` después:
el 15 reemplaza la función del parte que cambia el estado del equipo.

`05_constraints.sql` quedó de una versión anterior: **no se usa**, su
contenido está dentro de `01_esquema.sql`.

---

## Flota (lo que estaba en Monday)

`14_flota.sql` suma a la misma base los tableros de taller de Monday.
No hay un maestro paralelo: se amplía la tabla `equipos` que ya usa el
parte diario, así el CV-05 del parte y el del taller son la misma fila.

| Monday | Supabase |
|---|---|
| Maestro de Equipos | `equipos` (columnas nuevas de ficha técnica) |
| Estado de Equipos | `equipo_estado` + `equipo_estado_historial` |
| Inventario Contenedores, Tanques, Básculas | `equipos` con `categoria` contenedor / tanque / bascula |
| Tanques de Combustible | `equipos` (categoría tanque, datos extra en `atributos`) |
| Operadores y Mecánicos | `operadores` (+ especialidad, teléfono, ubicación) |
| Mantenimiento preventivo | `planes_mantenimiento` (por días, horas o km) + `mantenimientos` |
| Seguro de Vehículos y camiones | `seguros` |
| Equipos Alquilados a Terceros | `alquiler_contratos`, `alquiler_equipos`, `alquiler_facturacion` |
| Archivos (Dinatran, cédula verde…) | `documentos` + bucket `documentos` → Drive |

**Reglas que corren solas:**
- Un parte con falla que *impidió* trabajar pasa el equipo a Inoperativo
  (y disponibilidad En Reparación); si no impidió, a Fallando. Solo
  empeora el estado, nunca lo mejora: volver a Operativo es de taller.
  Solo partes de los últimos 3 días.
- Todo cambio de estado queda en `equipo_estado_historial` con quién,
  cuándo y si vino de la app, de un parte o del sistema.
- Registrar un mantenimiento de un plan reinicia el plan.
- La liquidación de alquileres (`v_alquiler_liquidacion`) no se guarda:
  se calcula con el horómetro de los partes, horas mínimas prorrateadas
  por los días del mes.
- `v_alertas_flota` junta vencimientos de Dinatran, habilitación
  municipal, seguros, mantenimientos y equipos con la salida de taller
  atrasada.

**Permisos:** el operador no ve nada nuevo (y en su desplegable solo
aparecen equipos con `en_parte_diario`). `admin_obra` ve toda la flota y
cambia la disponibilidad de cualquier equipo. `taller` edita todo lo de
flota y lee todos los partes. Seguros y alquileres: solo taller y
admin_central.

### Migración desde Monday

Carpeta `migracion_monday/`. Necesita `pip install requests`.

```
py migrar_monday.py descargar   ← baja Monday a monday_dump.json
py migrar_monday.py preparar    ← arma los mapeos para revisar
py migrar_monday.py cargar      ← carga (reejecutable)
py migrar_monday.py archivos    ← PDFs e imágenes a Storage
```

La primera vez crea `config_migracion.json` para completar con el token
de Monday y la URL y clave secreta de Supabase. **Ese archivo tiene la
clave secreta: no se sube a GitHub ni se comparte.**

`preparar` genera tres CSV que hay que revisar antes de cargar (mirar la
columna `nota`): `mapeo_equipos.csv` (códigos que no coinciden, ej.
AM-02 vs AM-2), `mapeo_asignaciones.csv` (qué obra es "San Juan") y
`mapeo_responsables.csv` (qué usuario es cada responsable). Si ya
existen no los pisa.

---

## Órdenes de trabajo (lo que era "Reportes - Taller")

Se mantiene la estructura del formulario: cada envío es un **registro**
con su "Condición de Carga" (Diagnóstico Inicial, Registro de Trabajos,
Reporte de Fallas, Cierre de OT), y varios registros cuelgan de una
**OT** con número. La numeración sigue la de JotForm.

| Tabla | |
|---|---|
| `ordenes_trabajo` | La OT: máquina, fallas, líder, tipo (Taller / Pista), ingreso, estado |
| `ot_registros` | Cada envío: técnico, fecha, lectura, estado de la máquina, boletas, cierre |
| `ot_registro_items` | Las matrices "Reporte Diario - SISTEMA" (horas y estado por componente) |
| `ot_checklist` | Los checklists respondidos |
| `ot_catalogo_trabajos`, `ot_checklist_plantillas` | Las filas de las matrices, editables |

**Reglas:** abrir una OT pone el equipo Inoperativo/Fallando y En
Reparación; "Trabajo Finalizado = SI" la cierra, y con "Reparado" el
equipo vuelve a Operativo y A Disposición (si no tiene otra OT
abierta). El cierre queda en `mantenimientos` y, si fue preventivo,
reinicia el plan. Un parte con falla crea una OT **Solicitada** si el
equipo no tiene ninguna abierta.

Vistas: `v_ot` (bandeja de taller) y `v_ot_horas` (horas por técnico).

## Combustible (lo que era "Control Combustible")

Una fila por envío en `combustible_movimientos`, con los mismos campos
del formulario. Actividades: Despacho, Ingreso de combustible, Medición
de tanque, Prueba de desviación. Los tanques son equipos (categoría
tanque).

| Vista | |
|---|---|
| `v_stock_tanques` | Stock estimado: última medición + ingresos − despachos |
| `v_combustible_conciliacion` | Despacho contra lo declarado en el parte, por equipo y día |
| `v_combustible_consumo` | Litros/hora por equipo y mes contra la ficha técnica |
| `v_combustible_anomalias` | Contador que no cierra, horómetro que retrocede, boleta repetida |

### Migración desde JotForm

En la misma carpeta `migracion_monday/`, con el mismo
`config_migracion.json` más la clave `jotform_api_key` (JotForm →
Configuración → API, de la cuenta dueña de los formularios):

```
py migrar_jotform.py descargar
py migrar_jotform.py preparar    ← revisar mapeo_obras_jotform.csv y mapeo_tanques_jotform.csv
py migrar_jotform.py cargar
```

El histórico no cambia el estado actual de los equipos (eso vino de
Monday). Muchas OT de JotForm nunca se marcaron como finalizadas y
quedan abiertas; para cerrarlas todas las que no tuvieron movimiento en
el mes, en el SQL Editor:

```sql
update ordenes_trabajo
   set estado = 'Cerrada',
       detalle_cierre = 'Cerrada en la migración: en JotForm no se marcó Trabajo Finalizado'
 where origen = 'jotform' and estado = 'Abierta'
   and id not in (select ot_id from ot_registros
                  where fecha >= date_trunc('month', current_date));
```

---

## La PWA

Carpeta `pwa-v5/`. Se sube a GitHub Pages.

| Archivo | |
|---|---|
| `parte_diario_v5.html` | La app entera, en un solo archivo |
| `sw.js` | Service worker: hace que funcione sin señal |
| `index.html` | Redirección |
| `manifest.json` | Para instalarla como app en el celular |

**Cada vez que cambies el HTML hay que subirle la versión a `sw.js`**
(la constante `CACHE_VERSION`, arriba de todo). Si no, los celulares que
ya abrieron la app siguen usando la copia vieja y el cambio no aparece.
Versión actual: `parte-diario-v5-12`.

---

## Los scripts de Google

Van en un proyecto de Apps Script, en la hoja espejo.
La clave de Supabase NO va en el código: va en **Configuración del
proyecto → Propiedades del script**.

| Archivo | Propiedades que necesita | Cada cuánto |
|---|---|---|
| `espejo_supabase_a_sheets.gs` | `SUPABASE_KEY` | cada hora |
| `archivo_fotos_a_drive.gs` | `SUPABASE_KEY`, `DRIVE_CARPETA_ID` | domingos 3 AM |

`consulta_M_PWA_PARTE_DIARIO_EQUIPOS.txt` es la consulta de Power Query
que lee la hoja espejo. Se pega en el Editor avanzado de la consulta
`PWA_PARTE_DIARIO_EQUIPOS`, y esa consulta se anexa al `Table.Combine`
de `BD_PARTE_DIARIO_EQUIPOS`.

---

## Migración y usuarios

| Archivo | |
|---|---|
| `migrar_datos.py` | Carga el histórico de JotForm desde el Excel |
| `usuarios/crear_usuarios.py` | Da de alta usuarios (roles: operador, admin_obra, taller, admin_central) |
| `usuarios/usuarios.csv` | La lista, con la cédula como contraseña inicial |
| `usuarios/operadores_faltantes.sql` | 8 operadores con cuenta pero sin ficha en el catálogo |

`migrar.py` es una versión anterior de `migrar_datos.py`: **no se usa**.

El script de migración es reejecutable — usa `ON CONFLICT DO NOTHING`
sobre `client_id`, así que correrlo dos veces no duplica nada. El día del
corte se vuelve a correr con el Excel actualizado y solo entra lo nuevo.

---

## Cosas que conviene tener presentes

**Las ~60.000 fotos históricas viven en JotForm.** La base solo guarda el
enlace. El día que se dé de baja esa cuenta, se pierden todas. Es lo único
del proyecto con fecha de vencimiento real. El script de archivado ya
tiene la mitad del trabajo hecho; falta una función que haga lo mismo
partiendo de las URLs de JotForm.

**No hay respaldo automático.** El plan gratuito de Supabase no los
incluye. La hoja vieja de JotForm sí es un respaldo real del histórico,
pero los catálogos, los 175 usuarios y la definición del formulario no
tienen copia en ningún lado. El espejo NO sirve como respaldo: se
reescribe entero cada hora, así que replica los borrados.

**El proyecto se pausa solo** tras 7 días sin actividad. Con carga diaria
no pasa, pero después de un feriado largo puede aparecer caído un lunes.
Se despausa desde el panel en un minuto.

**1 GB de Storage** en el plan gratuito, ~160 MB por mes de fotos. El
archivado a Drive es lo que mantiene eso bajo control.

**El proyecto está en Oregón (us-west-2)**, no en São Paulo. Son ~150 ms
más de latencia desde Paraguay. No rompe nada, pero si algún día se
rehace desde cero, conviene `sa-east-1`.

**Partes con fecha futura:** quedaban 2 con fecha 2028 (equipo VC-08).
El panel los lista en Anomalías.

---

## El agujero del horómetro (por si vuelve a aparecer)

`ultimo_horometro` se creó sin `SECURITY DEFINER`, así que corría con los
permisos de quien la llamaba — y RLS dice que un operador solo ve SUS
partes. Resultado: cuando una máquina cambiaba de operador, la función
devolvía el último parte *de ese operador*, no el último real. La regla
"el horómetro no retrocede" funcionaba perfecto mientras la máquina
tuviera siempre el mismo chofer, y se volvía ciega justo cuando rotaba.

Lo arregla `08_horometro.sql`. La comprobación del final tiene que decir
`definer`. Si alguna vez alguien recrea esa función, que no se olvide.
