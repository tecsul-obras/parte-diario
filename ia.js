// ══════════════════════════════════════════════════════════════════
// ASISTENTE IA — Tecsul S.A.E.
//
// Chat para administradores centrales: se le pregunta en castellano y
// contesta con los datos de la app. La pregunta va a la Edge Function
// "asistente" de Supabase, que habla con Gemini (la clave de Gemini
// vive allá, nunca en el teléfono) y corre las consultas en modo solo
// lectura. Vive en flota.html.
// ══════════════════════════════════════════════════════════════════
window.Asistente = (() => {
  const GUARDADO = 'ia_chat';
  const SUGERENCIAS = [
    '¿Qué equipos trabajaron más horas este mes?',
    '¿Qué máquinas no cargaron parte en los últimos 3 días?',
    'Consumo de gasoil por equipo el mes pasado comparado con su referencia',
    'Órdenes de trabajo abiertas hace más de 30 días: ¿qué tienen en común?',
    'Horas hombre por obra en septiembre',
    '¿Cuánto se liquidó de alquileres por arrendatario en los últimos 3 meses?',
  ];
  let mensajes = [];   // { rol: 'user' | 'model', texto, consultas?, error? }
  let ocupado = false;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function cargar() {
    try { mensajes = JSON.parse(localStorage.getItem(GUARDADO) || '[]'); } catch (e) { mensajes = []; }
  }
  function guardar() {
    try { localStorage.setItem(GUARDADO, JSON.stringify(mensajes.slice(-40))); } catch (e) { /* lleno: no importa */ }
  }

  // Markdown mínimo: títulos, negrita, cursiva, código, listas y tablas
  function md(texto) {
    const lineas = esc(texto).split('\n');
    let html = '', i = 0;
    const enLinea = (t) => t.replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>');
    while (i < lineas.length) {
      const l = lineas[i];
      if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lineas.length && /^\s*\|[\s:|-]+\|\s*$/.test(lineas[i + 1])) {
        const celdas = (x) => x.trim().replace(/^\||\|$/g, '').split('|').map(c => enLinea(c.trim()));
        const cab = celdas(l);
        i += 2;
        const filas = [];
        while (i < lineas.length && /^\s*\|.*\|\s*$/.test(lineas[i])) filas.push(celdas(lineas[i++]));
        html += `<div class="ia-tabla"><table><thead><tr>${cab.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${
          filas.map(f => `<tr>${f.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
        continue;
      }
      if (/^\s*[-*•]\s+/.test(l)) {
        html += '<ul>';
        while (i < lineas.length && /^\s*[-*•]\s+/.test(lineas[i])) html += `<li>${enLinea(lineas[i++].replace(/^\s*[-*•]\s+/, ''))}</li>`;
        html += '</ul>';
        continue;
      }
      if (/^\s*\d+[.)]\s+/.test(l)) {
        html += '<ol>';
        while (i < lineas.length && /^\s*\d+[.)]\s+/.test(lineas[i])) html += `<li>${enLinea(lineas[i++].replace(/^\s*\d+[.)]\s+/, ''))}</li>`;
        html += '</ol>';
        continue;
      }
      const t = l.match(/^(#{1,4})\s+(.*)$/);
      if (t) { html += `<h4>${enLinea(t[2])}</h4>`; i++; continue; }
      html += l.trim() ? `<p>${enLinea(l)}</p>` : '';
      i++;
    }
    return html;
  }

  function pintar() {
    const s = $('screen-ia');
    s.innerHTML = `
      <div class="ia-caja">
        <div class="ia-cab">
          <div><b>Asistente IA</b><span>Preguntá en castellano sobre partes, flota, taller, combustible, mantenimiento y alquileres.</span></div>
          <button class="btn-filtro" onclick="Asistente.nueva()">Nueva conversación</button>
        </div>
        <div id="ia-mensajes" class="ia-mensajes"></div>
        <div class="ia-entrada">
          <textarea id="ia-texto" rows="2" placeholder="Ej.: ¿Qué equipos gastaron más gasoil por hora este mes?"
            onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();Asistente.enviar()}"></textarea>
          <button class="btn btn-primario" id="ia-enviar" onclick="Asistente.enviar()">Enviar</button>
        </div>
        <p class="cambio" style="margin:6px 2px 0">Usa Gemini de Google. Revisá los números importantes antes de decidir: la IA se puede equivocar.
          Cada respuesta muestra las consultas que hizo.</p>
      </div>`;
    pintarMensajes();
  }

  function pintarMensajes() {
    const c = $('ia-mensajes');
    if (!c) return;
    if (!mensajes.length) {
      c.innerHTML = `<div class="ia-vacio"><div style="font-size:30px">💬</div>
        <p>Probá con alguna de estas:</p>
        <div class="ia-sugerencias">${SUGERENCIAS.map(q => `<button onclick="Asistente.preguntar(this.textContent)">${esc(q)}</button>`).join('')}</div></div>`;
      return;
    }
    c.innerHTML = mensajes.map((m, i) => m.rol === 'user'
      ? `<div class="ia-msg yo">${esc(m.texto).replace(/\n/g, '<br>')}</div>`
      : `<div class="ia-msg ella ${m.error ? 'error' : ''}">${m.error ? esc(m.error) : md(m.texto)}
          ${(m.consultas || []).length ? `<details class="ia-sql"><summary>Cómo lo calculó (${m.consultas.length} consulta${m.consultas.length > 1 ? 's' : ''})</summary>
            ${m.consultas.map(q => `<div class="cambio">${esc(q.motivo || '')}${q.error ? ' · <span style="color:var(--rojo)">error, corregida</span>' : ` · ${q.filas ?? 0} filas`}</div>
            <pre>${esc(q.sql)}</pre>`).join('')}</details>` : ''}
          ${!m.error ? `<button class="ia-copiar" onclick="Asistente.copiar(${i})">Copiar</button>` : ''}</div>`).join('')
      + (ocupado ? '<div class="ia-msg ella pensando"><span></span><span></span><span></span> Consultando los datos…</div>' : '');
    c.scrollTop = c.scrollHeight;
  }

  function preguntar(texto) { $('ia-texto').value = texto; enviar(); }

  async function enviar() {
    const t = ($('ia-texto').value || '').trim();
    if (!t || ocupado) return;
    if (!navigator.onLine) return toast('El asistente necesita señal', 'warning');
    $('ia-texto').value = '';
    mensajes.push({ rol: 'user', texto: t });
    ocupado = true;
    $('ia-enviar').disabled = true;
    guardar(); pintarMensajes();
    try {
      // Solo el texto de la conversación (sin las consultas) y lo último
      const historia = mensajes.filter(m => !m.error).slice(-12).map(m => ({ rol: m.rol, texto: m.texto }));
      const { data, error } = await sb.functions.invoke('asistente', { body: { mensajes: historia } });
      if (error) {
        let msg = error.message;
        try { const cuerpo = await error.context.json(); if (cuerpo && cuerpo.error) msg = cuerpo.error; } catch (e) { /* nada */ }
        throw new Error(msg);
      }
      if (data && data.error) throw new Error(data.error);
      mensajes.push({ rol: 'model', texto: data.respuesta, consultas: data.consultas || [] });
    } catch (e) {
      mensajes.push({ rol: 'model', error: 'No se pudo responder: ' + (e.message || e) });
    } finally {
      ocupado = false;
      if ($('ia-enviar')) $('ia-enviar').disabled = false;
      guardar(); pintarMensajes();
    }
  }

  function nueva() {
    if (mensajes.length && !confirm('¿Empezar una conversación nueva? La actual se borra de este equipo.')) return;
    mensajes = []; guardar(); pintarMensajes();
  }

  async function copiar(i) {
    try { await navigator.clipboard.writeText(mensajes[i].texto); toast('Copiado', 'success'); }
    catch (e) { toast('No se pudo copiar', 'warning'); }
  }

  function mostrar() {
    if (!$('ia-estilos')) {
      const st = document.createElement('style');
      st.id = 'ia-estilos';
      st.textContent = `
        #screen-ia { max-width: 980px; margin: 0 auto; }
        .ia-caja { display: flex; flex-direction: column; height: calc(100vh - 150px); min-height: 460px; }
        .ia-cab { display: flex; gap: 10px; align-items: center; justify-content: space-between; margin-bottom: 10px; }
        .ia-cab b { display: block; font-size: 16px; } .ia-cab span { font-size: 12.5px; color: var(--gris-texto); }
        .ia-mensajes { flex: 1; overflow-y: auto; background: var(--blanco); border-radius: var(--radio); box-shadow: var(--sombra);
          padding: 14px; display: flex; flex-direction: column; gap: 10px; }
        .ia-msg { max-width: 88%; padding: 10px 13px; border-radius: 12px; font-size: 14px; line-height: 1.5; position: relative; }
        .ia-msg.yo { align-self: flex-end; background: var(--azul-medio); color: #fff; border-bottom-right-radius: 3px; }
        .ia-msg.ella { align-self: flex-start; background: #f3f5f9; border-bottom-left-radius: 3px; max-width: 96%; }
        .ia-msg.error { background: #fdeceb; color: var(--rojo); }
        .ia-msg p { margin: 0 0 7px; } .ia-msg p:last-of-type { margin-bottom: 0; }
        .ia-msg h4 { margin: 8px 0 5px; font-size: 14.5px; } .ia-msg ul, .ia-msg ol { margin: 4px 0 8px; padding-left: 20px; }
        .ia-msg code { background: #e6eaf2; padding: 1px 5px; border-radius: 4px; font-size: 12.5px; }
        .ia-tabla { overflow-x: auto; margin: 6px 0 8px; }
        .ia-tabla table { border-collapse: collapse; font-size: 12.5px; background: #fff; }
        .ia-tabla th { background: var(--azul-oscuro); color: #fff; padding: 6px 9px; text-align: left; white-space: nowrap; }
        .ia-tabla td { padding: 5px 9px; border-bottom: 1px solid #e5e9f0; }
        .ia-sql { margin-top: 8px; font-size: 12px; } .ia-sql summary { cursor: pointer; color: var(--azul-medio); font-weight: 600; }
        .ia-sql pre { background: #1a2744; color: #e6eaf2; padding: 8px 10px; border-radius: 6px; white-space: pre-wrap; font-size: 11.5px; margin: 4px 0 8px; }
        .ia-copiar { position: absolute; top: 6px; right: 8px; border: 0; background: transparent; color: var(--gris-texto); font-size: 11px; opacity: .6; }
        .ia-copiar:hover { opacity: 1; }
        .ia-entrada { display: flex; gap: 8px; margin-top: 10px; }
        .ia-entrada textarea { flex: 1; padding: 11px 12px; border: 1.5px solid var(--gris-borde); border-radius: 10px; resize: none; font-size: 15px; }
        .ia-vacio { margin: auto; text-align: center; color: var(--gris-texto); max-width: 640px; }
        .ia-sugerencias { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
        .ia-sugerencias button { border: 1.5px solid var(--gris-borde); background: #fff; border-radius: 18px; padding: 8px 13px;
          font-size: 13px; color: var(--azul-oscuro); text-align: left; }
        .ia-sugerencias button:hover { border-color: var(--azul-medio); }
        .pensando { color: var(--gris-texto); }
        .pensando span { display: inline-block; width: 7px; height: 7px; margin-right: 3px; border-radius: 50%; background: var(--azul-medio);
          animation: iaPunto 1s infinite ease-in-out; }
        .pensando span:nth-child(2) { animation-delay: .15s; } .pensando span:nth-child(3) { animation-delay: .3s; }
        @keyframes iaPunto { 0%, 80%, 100% { opacity: .25 } 40% { opacity: 1 } }
        @media (max-width: 699px) { .ia-caja { height: calc(100vh - 135px); } .ia-cab span { display: none; } }`;
      document.head.appendChild(st);
    }
    cargar();
    pintar();
  }

  return { mostrar, enviar, preguntar, nueva, copiar };
})();
