// ══════════════════════════════════════════════════════════════════
// MENÚ COMÚN — Tecsul S.A.E.
//
// La app son dos páginas (parte_diario_v5.html y flota.html) pero el
// usuario tiene que ver UNA sola app: las dos dibujan exactamente las
// mismas solapas, en el mismo orden. Una solapa de la otra página es
// un enlace (pagina.html?p=solapa) que abre directo en esa solapa.
//
// Qué solapas ve cada uno:
//   · Formularios (parte, taller, combustible): según mis_formularios()
//   · Gestión (flota, OT, control de combustible, alertas): taller,
//     admin_obra y admin_central
//   · Administración: solo admin_central
// ══════════════════════════════════════════════════════════════════
window.Menu = (() => {
  const GESTION = ['taller', 'admin_obra', 'admin_central'];
  const TALLER = ['taller', 'admin_central'];   // plata: alquileres y seguros
  const ITEMS = [
    { id: 'form',        t: 'Nuevo parte',            pag: 'parte', ver: c => c.f.includes('parte') },
    { id: 'taller',      t: 'Reporte de taller',      pag: 'parte', ver: c => c.f.includes('taller') },
    { id: 'combustible', t: 'Carga de combustible',   pag: 'parte', ver: c => c.f.includes('combustible') },
    { id: 'historial',   t: 'Historial de partes',    pag: 'parte', ver: c => c.f.includes('parte') },
    { id: 'flota',       t: 'Flota',                  pag: 'flota', ver: c => GESTION.includes(c.rol) },
    { id: 'ot',          t: 'Órdenes de trabajo',     pag: 'flota', ver: c => GESTION.includes(c.rol) },
    { id: 'gasoil',      t: 'Control de combustible', pag: 'flota', ver: c => GESTION.includes(c.rol) },
    { id: 'mant',        t: 'Mantenimiento',          pag: 'flota', ver: c => GESTION.includes(c.rol) },
    { id: 'alq',         t: 'Alquileres',             pag: 'flota', ver: c => TALLER.includes(c.rol) },
    { id: 'seg',         t: 'Seguros',                pag: 'flota', ver: c => TALLER.includes(c.rol) },
    { id: 'pers',        t: 'Personal',               pag: 'flota', ver: c => GESTION.includes(c.rol) },
    { id: 'alertas',     t: 'Alertas',                pag: 'flota', ver: c => GESTION.includes(c.rol),
      extra: '<span class="n" id="n-alertas" style="display:none"></span>' },
    { id: 'bi',          t: 'Reportes',               pag: 'flota', ver: c => c.bi },
    { id: 'admin',       t: 'Administración',         pag: 'parte', ver: c => c.rol === 'admin_central' },
  ];
  const PAGINAS = { parte: './parte_diario_v5.html', flota: './flota.html' };

  let ctx = { rol: null, f: [] };
  let pagina = null;
  // La solapa pedida en la dirección se lee una sola vez, al cargar
  // (después la dirección se va actualizando con la solapa activa).
  const pedidaAlCargar = new URLSearchParams(location.search).get('p');

  // Formularios por defecto según el rol, por si todavía no se pudo
  // preguntar a la base (sin señal la primera vez).
  function formulariosPorDefecto(rol) {
    if (rol === 'admin_central' || rol === 'taller') return ['parte', 'taller', 'combustible'];
    if (rol === 'admin_obra') return ['parte', 'combustible'];
    return ['parte'];
  }

  function guardados(rol) {
    try {
      const g = JSON.parse(localStorage.getItem('fx_formularios') || 'null');
      if (Array.isArray(g) && g.length) return g;
    } catch (e) { /* nada */ }
    return formulariosPorDefecto(rol);
  }

  function pintar(pag, rol, formularios) {
    pagina = pag;
    ctx = { rol, f: formularios || guardados(rol), bi: hayReportes() };
    // El asistente IA no es una solapa: es el botón flotante (ia.js)
    if (window.Asistente) Asistente.activar(rol);
    const nav = document.getElementById('menu');
    if (!nav) return;
    nav.innerHTML = visibles().map(it => it.pag === pagina
      ? `<button class="nav-tab" id="tab-${it.id}" onclick="mostrarPantalla('${it.id}')">${it.t}${it.extra || ''}</button>`
      : `<a class="nav-tab" id="tab-${it.id}" href="${PAGINAS[it.pag]}?p=${it.id}" style="text-decoration:none">${it.t}${it.extra || ''}</a>`
    ).join('');
  }

  const visibles = () => ITEMS.filter(it => it.ver(ctx));
  const puede = (id) => visibles().some(it => it.id === id);

  // La solapa con la que arranca esta página: la pedida en la dirección
  // (?p=ot) si la persona la puede ver, si no la primera de esta página.
  function inicial() {
    const pedida = pedidaAlCargar;
    const v = visibles();
    if (pedida && v.some(it => it.id === pedida && it.pag === pagina)) return pedida;
    const propia = v.find(it => it.pag === pagina);
    return propia ? propia.id : null;
  }

  // Marca la solapa activa, pone el título y deja la dirección lista
  // para que "volver" o recargar caigan en el mismo lugar.
  // ¿Tiene reportes de Power BI para ver? Se guarda en el teléfono y se
  // refresca en cada entrada (reportes()).
  function hayReportes() {
    try { return Number(localStorage.getItem('reportes_bi_n') || 0) > 0; } catch (e) { return false; }
  }
  async function reportes(sb) {
    try {
      const { data, error } = await sb.from('reportes_bi').select('id').eq('activo', true).limit(100);
      if (error) return;   // sin señal o sin la tabla todavía: queda lo guardado
      const n = (data || []).length;
      const antes = hayReportes();
      localStorage.setItem('reportes_bi_n', String(n));
      if ((n > 0) !== antes && pagina) {
        pintar(pagina, ctx.rol, ctx.f);
        if (actual) activar(actual);
      }
    } catch (e) { /* sin señal: queda lo guardado */ }
  }

  let actual = null;
  function activar(id) {
    actual = id;
    document.querySelectorAll('#menu .nav-tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + id));
    const it = ITEMS.find(x => x.id === id);
    const titulo = document.querySelector('.app-header .t b');
    if (it && titulo) titulo.textContent = it.t;
    if (it) document.title = it.t + ' - Tecsul';
    const tab = document.getElementById('tab-' + id);
    if (tab && tab.scrollIntoView) tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    try { history.replaceState(null, '', location.pathname + '?p=' + id + location.hash); } catch (e) { /* nada */ }
  }

  return { pintar, puede, inicial, activar, formulariosPorDefecto, reportes, rol: () => ctx && ctx.rol };
})();
