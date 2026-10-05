// ══════════════════════════════════════════════════════════════════
// ASISTENTE IA — Edge Function de Supabase (Tecsul S.A.E.)
// ══════════════════════════════════════════════════════════════════
import { createClient } from 'npm:@supabase/supabase-js@2';

const CLAVE = Deno.env.get('GEMINI_API_KEY') ?? '';

// Lista de modelos ordenados por preferencia (si uno falla por 429, pasa al siguiente)
const MODELO_PRINCIPAL = Deno.env.get('GEMINI_MODEL');
const LISTA_MODELOS = MODELO_PRINCIPAL 
  ? [MODELO_PRINCIPAL, 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-flash-8b']
  : ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-flash-8b'];

const BASE = Deno.env.get('GEMINI_BASE') || 'https://generativelanguage.googleapis.com';   // solo para pruebas
const MAX_VUELTAS = 8;          // consultas que puede encadenar por pregunta
const MAX_CARACTERES = 30000;   // lo que se le muestra de cada resultado

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (cuerpo: unknown, estado = 200) =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: { ...CORS, 'Content-Type': 'application/json' } });

const HERRAMIENTAS = [{
  functionDeclarations: [{
    name: 'consultar_datos',
    description: 'Ejecuta UNA consulta SELECT de PostgreSQL sobre la base de Tecsul y devuelve las filas (máximo 300). ' +
      'Usala siempre que necesites un dato; agregá con GROUP BY / SUM / COUNT en vez de traer filas sueltas.',
    parameters: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'Una sola consulta SELECT (o WITH … SELECT), sin punto y coma.' },
        motivo: { type: 'string', description: 'Para qué se hace la consulta, en pocas palabras.' },
      },
      required: ['sql'],
    },
  }],
}];

function instrucciones(esquema: { tabla: string; columnas: string }[]): string {
  const hoy = new Intl.DateTimeFormat('es-PY', { timeZone: 'America/Asuncion', dateStyle: 'full' }).format(new Date());
  const fechaIso = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date());
  return `Sos el asistente de datos de Tecsul S.A.E., empresa paraguaya de construcción vial. Ayudás a la gerencia a
analizar el uso de la maquinaria, el taller, el combustible, el mantenimiento y los alquileres de equipos.
Hoy es ${hoy} (${fechaIso}), zona horaria America/Asuncion.

REGLAS
- Todo número que digas tiene que salir de consultar_datos. Nunca inventes datos ni supongas valores.
- Escribí SQL de PostgreSQL. Solo SELECT. Agregá en SQL (SUM, COUNT, AVG, GROUP BY) y limitá filas; el resultado se corta en 300 filas.
- Si la pregunta no dice el período, usá el mes en curso y aclaralo. Si es ambigua, elegí la interpretación más razonable y decila.
- Si una consulta da error, corregila y probá de nuevo.
- Respondé en español de Paraguay, claro y breve: primero la conclusión, después el detalle. Usá tablas en markdown
  para listas de más de 3 elementos. Montos en guaraníes con punto de miles (Gs 1.250.000). Fechas DD/MM/AAAA.
- Si algo no se puede responder con estas tablas, decilo y sugerí qué dato faltaría. No tenés acceso a Power BI:
  los datos de Power BI del parte diario salen de estas mismas tablas.

QUÉ SIGNIFICA CADA COSA
- partes: un parte diario por equipo, operador y turno. fecha (date); equipo_id (código, ej. CV-14); operador_cedula
  (join operadores.cedula); obra_clave (join obras.clave); horas_horometro = horas que trabajó la máquina según horómetro
  (si es null usar horas_horometro_reportada); horas_hombre = horas del operador; km_recorridos; tiene_falla (boolean);
  actividad_dia, detalle_actividad; origen ('jotform' = histórico, 'pwa' = app). v_resumen_mensual ya resume por mes.
- equipos: id = código; descripcion; tipo; marca; categoria ('equipo','vehiculo_liviano','tanque','contenedor','bascula');
  propiedad 'Propio' o 'Tercero' (los de terceros NO son flota propia); activo; consumo_nominal / consumo_promedio_lh (L/h).
- v_flota: estado actual de cada equipo: estado ('Operativo','Fallando','Inoperativo'), disponibilidad, asignacion,
  ubicacion, dias_en_taller, ultimo_horometro, ultimo_parte_fecha. equipo_estado_historial: cambios de estado.
- v_ot: órdenes de trabajo de taller (numero, estado 'Solicitada','Abierta','Cerrada','Anulada', equipo_id, nombre,
  fallas, abierta_el, fecha_cierre, dias, atrasada, registros, horas_trabajo). v_ot_horas: horas por técnico/sistema.
  ot_registros + ot_registro_items: cada carga del mecánico.
- combustible_movimientos: actividad ('Despacho de combustible','Ingreso de combustible','Medición de tanque',
  'Prueba de desviación'); litros (despachados), litros_ingresados, stock_medido; tanque_salida_id; equipo_id = quien
  recibe (si es un tanque es traspaso); receptor_texto = tercero; horometro; fecha; obra_clave; insumo.
  v_stock_tanques: stock estimado por tanque. v_combustible_consumo: litros/hora por equipo y mes vs referencia
  (desvio_pct). v_combustible_conciliacion: despacho vs lo declared en el parte. v_combustible_anomalias.
- v_mantenimiento_plan: plan de service por equipo (ciclo 250/500/750/1.000 h; proximo_nivel, horas_restantes,
  semaforo 'VENCIDO','PRÓXIMO','OK','SIN DATOS'). mantenimientos: services y reparaciones hechos (tipo, nivel, fecha).
- v_alertas_flota: vencimientos (Dinatran, municipal, seguros), mantenimiento y taller demorado.
- v_alquiler_liquidacion: alquiler de equipos a terceros por mes (horas_trabajadas, horas_facturables, monto_gs,
  estado_facturacion). alquiler_contratos, alquiler_equipos. seguros: pólizas (vencimiento, compania, costo_total).

TABLAS Y COLUMNAS DISPONIBLES
${esquema.map((t) => `- ${t.tabla}(${t.columnas})`).join('\n')}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Usar POST' }, 405);

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  });
  let pregunta = '';
  const consultas: { sql: string; motivo?: string; filas?: number; error?: string }[] = [];
  let modeloUsado = '';

  try {
    const { data: esAdmin, error: errAdmin } = await sb.rpc('es_admin');
    if (errAdmin || !esAdmin) return json({ error: 'El asistente es solo para administradores centrales.' }, 403);
    if (!CLAVE) {
      return json({ error: 'Falta configurar la clave de Gemini (secreto GEMINI_API_KEY en Supabase → Edge Functions → Secrets).' }, 500);
    }

    const { mensajes } = await req.json() as { mensajes: { rol: string; texto: string }[] };
    if (!Array.isArray(mensajes) || !mensajes.length) return json({ error: 'No llegó la pregunta' }, 400);
    pregunta = String(mensajes[mensajes.length - 1].texto || '').slice(0, 4000);

    const { data: esquema, error: errEsq } = await sb.rpc('ia_esquema');
    if (errEsq) throw new Error('No se pudo leer el esquema: ' + errEsq.message);

    // deno-lint-ignore no-explicit-any
    const contenidos: any[] = mensajes.slice(-14).map((m) => ({
      role: m.rol === 'model' ? 'model' : 'user',
      parts: [{ text: String(m.texto || '').slice(0, 8000) }],
    }));

    let respuesta = '';
    for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
      let exitoLlamada = false;
      let errorUltimoModelo = '';

      // BUCLE FALLBACK DE MODELOS: Prueba cada modelo si el anterior devuelve 429
      for (const mod of LISTA_MODELOS) {
        const r = await fetch(`${BASE}/v1beta/models/${mod}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': CLAVE },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: instrucciones(esquema) }] },
            contents: contenidos,
            tools: HERRAMIENTAS,
            generationConfig: { temperature: 0.2 },
          }),
        });

        const datos = await r.json();

        if (!r.ok) {
          const msg = datos?.error?.message || `Gemini respondió ${r.status}`;
          errorUltimoModelo = msg;
          // Si es un error 429 (límite superado), pasa al siguiente modelo de LISTA_MODELOS
          if (r.status === 429 || msg.includes('429')) {
            console.warn(`Límite 429 en ${mod}. Probando siguiente modelo...`);
            continue;
          }
          // Si es otro error grave, detiene la ejecución
          throw new Error(msg);
        }

        // Si la llamada fue exitosa
        modeloUsado = mod;
        exitoLlamada = true;

        const contenido = datos?.candidates?.[0]?.content;
        if (!contenido?.parts?.length) {
          respuesta = 'Gemini no devolvió respuesta' + (datos?.candidates?.[0]?.finishReason ? ` (${datos.candidates[0].finishReason})` : '') + '.';
          break;
        }
        contenidos.push(contenido);

        // deno-lint-ignore no-explicit-any
        const llamadas = contenido.parts.filter((p: any) => p.functionCall);
        if (!llamadas.length) {
          // deno-lint-ignore no-explicit-any
          respuesta = contenido.parts.filter((p: any) => p.text && !p.thought).map((p: any) => p.text).join('').trim();
          break;
        }

        // deno-lint-ignore no-explicit-any
        const resultados: any[] = [];
        for (const p of llamadas) {
          const sql = String(p.functionCall.args?.sql ?? '');
          const motivo = p.functionCall.args?.motivo;
          const { data: filas, error } = await sb.rpc('ia_consulta', { p_sql: sql });
          // deno-lint-ignore no-explicit-any
          let salida: any;
          if (error) {
            salida = { error: error.message };
            consultas.push({ sql, motivo, error: error.message });
          } else {
            const lista = Array.isArray(filas) ? filas : [];
            let mostradas = lista;
            while (mostradas.length > 1 && JSON.stringify(mostradas).length > MAX_CARACTERES) {
              mostradas = mostradas.slice(0, Math.floor(mostradas.length / 2));
            }
            salida = { total_filas: lista.length, filas: mostradas,
                       aviso: mostradas.length < lista.length ? `Se muestran ${mostradas.length} de ${lista.length} filas: agregá más en SQL.` : undefined };
            consultas.push({ sql, motivo, filas: lista.length });
          }
          resultados.push({ functionResponse: { name: p.functionCall.name, id: p.functionCall.id, response: salida } });
        }
        contenidos.push({ role: 'user', parts: resultados });
        break; // Rompe el bucle de modelos porque este modelo respondió bien
      }

      if (!exitoLlamada && !respuesta) {
        throw new Error('Todos los modelos disponibles de Gemini alcanzaron su límite de cuota (429). Probá de nuevo en unos minutos. ' + errorUltimoModelo);
      }

      if (respuesta) break; // Si ya se generó la respuesta final, sale del bucle de vueltas
    }

    if (!respuesta) respuesta = 'No llegué a una respuesta con las consultas permitidas. Probá con una pregunta más concreta.';

    await sb.from('ia_registro').insert({ pregunta, consultas, respuesta: respuesta.slice(0, 20000), modelo: modeloUsado });
    return json({ respuesta, consultas, modelo: modeloUsado });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (pregunta) await sb.from('ia_registro').insert({ pregunta, consultas, error: msg.slice(0, 2000), modelo: modeloUsado });
    return json({ error: msg, consultas }, 500);
  }
});
