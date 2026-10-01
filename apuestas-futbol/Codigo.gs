/**
 * ⚽ PRONÓSTICOS DE FÚTBOL - Google Apps Script
 *
 * Busca los próximos partidos de las ligas configuradas (Liga MX, Champions,
 * LaLiga, Premier, etc.), analiza los últimos 10 juegos de cada equipo y los
 * enfrentamientos directos, calcula probabilidades con un modelo de Poisson
 * (con corrección Dixon-Coles) y propone la MEJOR APUESTA de cada partido.
 *
 * Fuente de datos: API pública de ESPN (no requiere API key).
 *
 * Uso:
 *   1. Crea una Hoja de cálculo de Google > Extensiones > Apps Script.
 *   2. Pega este archivo, guarda y ejecuta `actualizarPronosticos` (acepta permisos).
 *   3. Recarga la hoja: aparecerá el menú "⚽ Apuestas".
 *
 * AVISO: Es un modelo estadístico, no una garantía. Apuesta con responsabilidad.
 */

// ============================== CONFIGURACIÓN ==============================

const CONFIG = {
  DIAS_ADELANTE: 7,          // cuántos días hacia adelante buscar partidos
  PARTIDOS_FORMA: 10,        // últimos N juegos para medir el nivel actual
  DECAIMIENTO: 0.92,         // peso de cada partido anterior (el más reciente pesa 1)
  VENTAJA_LOCAL: 1.12,       // multiplicador de goles por jugar en casa
  SUAVIZADO: 3,              // partidos "virtuales" de media de liga (evita extremos con pocos datos)
  PESO_FORMA: 0.10,          // cuánto influye la diferencia de puntos por partido
  PESO_H2H: 0.06,            // cuánto influye el historial directo
  RHO_DIXON_COLES: -0.08,    // corrección para marcadores bajos (0-0, 1-0, 0-1, 1-1)
  PROB_MAX_MERCADO: 0.80,    // descarta picks con cuota justa < 1.25 (no pagan)
  PROB_MIN_MERCADO: 0.50,    // probabilidad mínima para recomendar algo
  VALOR_MIN: 0.03,           // EV mínimo (+3%) para marcar una apuesta de VALOR con cuota real
  TOP_N: 10,                 // cuántos partidos van a la hoja "Top Apuestas"
  EMAIL_TOP: '',             // tu correo para recibir el Top (vacío = no envía)
  CACHE_SEG: 6 * 60 * 60,    // caché de historiales (6 h)

  // Orden = prioridad. `peso` sube/baja la confianza final del ranking.
  LIGAS: [
    { id: 'mex.1',                  nombre: 'Liga MX',              peso: 1.00 },
    { id: 'uefa.champions',         nombre: 'Champions League',     peso: 1.00 },
    { id: 'esp.1',                  nombre: 'LaLiga',               peso: 0.98 },
    { id: 'eng.1',                  nombre: 'Premier League',       peso: 0.98 },
    { id: 'uefa.europa',            nombre: 'Europa League',        peso: 0.93 },
    { id: 'ita.1',                  nombre: 'Serie A',              peso: 0.95 },
    { id: 'ger.1',                  nombre: 'Bundesliga',           peso: 0.95 },
    { id: 'fra.1',                  nombre: 'Ligue 1',              peso: 0.93 },
    { id: 'concacaf.champions',     nombre: 'Concachampions',       peso: 0.90 },
    { id: 'conmebol.libertadores',  nombre: 'Copa Libertadores',    peso: 0.90 },
    { id: 'usa.1',                  nombre: 'MLS',                  peso: 0.88 },
    { id: 'por.1',                  nombre: 'Liga Portugal',        peso: 0.88 },
    { id: 'ned.1',                  nombre: 'Eredivisie',           peso: 0.88 },
    { id: 'uefa.europa.conf',       nombre: 'Conference League',    peso: 0.85 },
    { id: 'bra.1',                  nombre: 'Brasileirão',          peso: 0.85 },
    { id: 'arg.1',                  nombre: 'Liga Argentina',       peso: 0.85 },
    { id: 'mex.2',                  nombre: 'Liga Expansión MX',    peso: 0.75 }
  ]
};

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/soccer/';
const MEDIA_GOLES_DEFECTO = 1.35; // goles por equipo por partido si no hay datos

// ================================ MENÚ =====================================

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('⚽ Apuestas')
    .addItem('Actualizar pronósticos', 'actualizarPronosticos')
    .addSeparator()
    .addItem('Programar actualización diaria (8 am)', 'programarDiario')
    .addItem('Quitar programación', 'quitarProgramacion')
    .addToUi();
}

function programarDiario() {
  quitarProgramacion();
  ScriptApp.newTrigger('actualizarPronosticos').timeBased().everyDays(1).atHour(8).create();
  aviso_('Listo: se actualizará todos los días a las 8 am.');
}

function quitarProgramacion() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'actualizarPronosticos')
    .forEach(t => ScriptApp.deleteTrigger(t));
}

// =========================== FLUJO PRINCIPAL ===============================

function actualizarPronosticos() {
  const inicio = Date.now();
  const partidos = buscarProximosPartidos_();
  if (!partidos.length) {
    aviso_('No se encontraron partidos en los próximos ' + CONFIG.DIAS_ADELANTE + ' días.');
    return;
  }

  // Historial de cada equipo (deduplicado, en paralelo y con caché).
  const historiales = cargarHistoriales_(partidos);

  // Media de goles por liga calculada con los propios datos.
  const mediaLiga = {};
  partidos.forEach(p => {
    if (mediaLiga[p.liga.id] !== undefined) return;
    const goles = [];
    partidos.filter(q => q.liga.id === p.liga.id).forEach(q => {
      [q.local.id, q.visita.id].forEach(id => {
        (historiales[id] || []).slice(0, CONFIG.PARTIDOS_FORMA).forEach(m => goles.push(m.gf));
      });
    });
    mediaLiga[p.liga.id] = goles.length >= 20
      ? goles.reduce((a, b) => a + b, 0) / goles.length
      : MEDIA_GOLES_DEFECTO;
  });

  const resultados = partidos.map(p => analizarPartido_(p, historiales, mediaLiga[p.liga.id]));
  resultados.sort((a, b) => b.confianza - a.confianza);

  escribirHoja_(resultados);
  escribirTop_(resultados.filter(r => r.mejor));
  if (CONFIG.EMAIL_TOP) enviarCorreo_(resultados.filter(r => r.mejor).slice(0, CONFIG.TOP_N));

  Logger.log('Analizados %s partidos en %s s', resultados.length, Math.round((Date.now() - inicio) / 1000));
}

// ============================ DATOS (ESPN) =================================

/** Devuelve los partidos programados (no iniciados) de todas las ligas. */
function buscarProximosPartidos_() {
  const hoy = new Date();
  const fin = new Date(hoy.getTime() + CONFIG.DIAS_ADELANTE * 864e5);
  const rango = fmtFechaApi_(hoy) + '-' + fmtFechaApi_(fin);

  const urls = CONFIG.LIGAS.map(l => ESPN + l.id + '/scoreboard?limit=200&dates=' + rango);
  const respuestas = fetchJsonAll_(urls);

  const partidos = [];
  respuestas.forEach((json, i) => {
    const liga = CONFIG.LIGAS[i];
    ((json && json.events) || []).forEach(ev => {
      const comp = (ev.competitions || [])[0];
      if (!comp) return;
      const estado = (comp.status || ev.status || {}).type || {};
      if (estado.state && estado.state !== 'pre') return; // solo partidos por jugarse
      const local = (comp.competitors || []).find(c => c.homeAway === 'home');
      const visita = (comp.competitors || []).find(c => c.homeAway === 'away');
      if (!local || !visita) return;
      partidos.push({
        id: ev.id,
        fecha: new Date(ev.date),
        liga: liga,
        neutral: !!comp.neutralSite,
        local: { id: String(local.team.id), nombre: local.team.displayName, formaEspn: local.form || '' },
        visita: { id: String(visita.team.id), nombre: visita.team.displayName, formaEspn: visita.form || '' },
        cuotas: leerCuotas_(comp.odds)
      });
    });
  });
  return partidos;
}

/**
 * Para cada equipo obtiene sus partidos terminados (más reciente primero).
 * En copas internacionales también suma los partidos de su liga local para
 * que "los últimos 10" reflejen su nivel real.
 */
function cargarHistoriales_(partidos) {
  const cache = CacheService.getScriptCache();
  const equipos = {}; // id -> { liga }
  partidos.forEach(p => [p.local, p.visita].forEach(e => {
    if (!equipos[e.id]) equipos[e.id] = { liga: p.liga.id };
  }));

  const historiales = {};
  const pendientes = [];
  Object.keys(equipos).forEach(id => {
    const enCache = cache.get('hist_' + id);
    if (enCache) historiales[id] = JSON.parse(enCache);
    else pendientes.push(id);
  });
  if (!pendientes.length) return historiales;

  const esCopa = liga => /^(uefa|conmebol|concacaf)\./.test(liga);

  // 1) Temporada actual en la competición del partido (+ info del equipo si es copa).
  const urls1 = [];
  pendientes.forEach(id => {
    const liga = equipos[id].liga;
    urls1.push(ESPN + liga + '/teams/' + id + '/schedule');
    urls1.push(esCopa(liga) ? ESPN + liga + '/teams/' + id : null);
  });
  const resp1 = fetchJsonAll_(urls1);

  const acumulado = {}; // id -> lista de partidos
  const urls2 = [];
  const dueños2 = [];
  pendientes.forEach((id, i) => {
    const sched = resp1[i * 2];
    const info = resp1[i * 2 + 1];
    acumulado[id] = extraerPartidos_(sched, id);

    // Liga doméstica para equipos en copas internacionales.
    const ligaLocal = ligaDomestica_(info);
    if (ligaLocal) {
      urls2.push(ESPN + ligaLocal + '/teams/' + id + '/schedule');
      dueños2.push(id);
    }
    // Temporada anterior si no alcanzan los partidos (inicio de torneo).
    if (acumulado[id].length < CONFIG.PARTIDOS_FORMA) {
      const anio = (sched && sched.season && sched.season.year) || new Date().getFullYear();
      urls2.push(ESPN + equipos[id].liga + '/teams/' + id + '/schedule?season=' + (anio - 1));
      dueños2.push(id);
    }
  });

  fetchJsonAll_(urls2).forEach((json, i) => {
    const id = dueños2[i];
    acumulado[id] = acumulado[id].concat(extraerPartidos_(json, id));
  });

  pendientes.forEach(id => {
    const vistos = {};
    const lista = acumulado[id]
      .filter(m => !vistos[m.ev] && (vistos[m.ev] = true))
      .sort((a, b) => b.t - a.t)
      .slice(0, 40);
    historiales[id] = lista;
    try { cache.put('hist_' + id, JSON.stringify(lista), CONFIG.CACHE_SEG); } catch (e) { /* demasiado grande */ }
  });
  return historiales;
}

/** Convierte la respuesta de /schedule en partidos terminados compactos. */
function extraerPartidos_(json, equipoId) {
  const out = [];
  ((json && json.events) || []).forEach(ev => {
    const comp = (ev.competitions || [])[0];
    if (!comp) return;
    const estado = ((comp.status || ev.status || {}).type) || {};
    if (!estado.completed) return;
    const yo = (comp.competitors || []).find(c => String(c.id || (c.team && c.team.id)) === equipoId);
    const rival = (comp.competitors || []).find(c => c !== yo);
    if (!yo || !rival) return;
    const gf = leerMarcador_(yo.score);
    const ga = leerMarcador_(rival.score);
    if (gf === null || ga === null) return;
    out.push({
      ev: ev.id,
      t: new Date(ev.date).getTime(),
      gf: gf,
      ga: ga,
      casa: yo.homeAway === 'home',
      rival: String(rival.id || (rival.team && rival.team.id))
    });
  });
  return out;
}

function ligaDomestica_(info) {
  const t = info && info.team;
  if (!t || !t.defaultLeague) return null;
  const dl = t.defaultLeague;
  const slug = (dl.slug || dl.midsizeName || '').toLowerCase();
  return /^[a-z]{3}\.\d$/.test(slug) ? slug : null;
}

function leerMarcador_(s) {
  if (s === undefined || s === null) return null;
  const v = typeof s === 'object' ? (s.value !== undefined ? s.value : s.displayValue) : s;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

/** Cuotas de la casa (si ESPN las trae) en formato decimal. */
function leerCuotas_(odds) {
  const o = (odds || [])[0];
  if (!o) return null;
  const ml = (obj, alt) => {
    if (obj && obj.moneyLine !== undefined) return obj.moneyLine;
    if (alt && alt.close && alt.close.odds) return alt.close.odds;
    if (alt && alt.open && alt.open.odds) return alt.open.odds;
    return null;
  };
  const m = o.moneyline || {};
  const c = {
    local: americanaADecimal_(ml(o.homeTeamOdds, m.home)),
    empate: americanaADecimal_(ml(o.drawOdds, m.draw)),
    visita: americanaADecimal_(ml(o.awayTeamOdds, m.away)),
    proveedor: (o.provider && o.provider.name) || ''
  };
  return (c.local || c.visita) ? c : null;
}

function americanaADecimal_(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(String(v).replace('+', ''));
  if (isNaN(n) || n === 0) return null;
  return n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n);
}

function fetchJsonAll_(urls) {
  const out = new Array(urls.length).fill(null);
  const reales = [];
  urls.forEach((u, i) => { if (u) reales.push(i); });
  for (let k = 0; k < reales.length; k += 40) {
    const lote = reales.slice(k, k + 40);
    let resps;
    try {
      resps = UrlFetchApp.fetchAll(lote.map(i => ({ url: urls[i], muteHttpExceptions: true })));
    } catch (e) {
      Logger.log('Error de red: ' + e);
      continue;
    }
    resps.forEach((r, j) => {
      if (r.getResponseCode() !== 200) return;
      try { out[lote[j]] = JSON.parse(r.getContentText()); } catch (e) { /* ignora */ }
    });
  }
  return out;
}

// =============================== MODELO ====================================

/** Estadísticas ponderadas de los últimos N partidos. */
function statsEquipo_(hist) {
  const ult = (hist || []).slice(0, CONFIG.PARTIDOS_FORMA);
  let w = 0, gf = 0, ga = 0, pts = 0;
  let forma = '';
  ult.forEach((m, i) => {
    const p = Math.pow(CONFIG.DECAIMIENTO, i);
    const r = m.gf > m.ga ? 'G' : m.gf === m.ga ? 'E' : 'P';
    w += p;
    gf += p * m.gf;
    ga += p * m.ga;
    pts += p * (r === 'G' ? 3 : r === 'E' ? 1 : 0);
    forma += r;
  });
  return { n: ult.length, w: w, gfW: gf, gaW: ga, ppg: w ? pts / w : 1.3, forma: forma };
}

function analizarPartido_(p, historiales, media) {
  const hL = historiales[p.local.id] || [];
  const hV = historiales[p.visita.id] || [];
  const sL = statsEquipo_(hL);
  const sV = statsEquipo_(hV);
  const K = CONFIG.SUAVIZADO;

  // Fuerza de ataque y defensa relativas a la media (suavizadas).
  const ataque = s => ((s.gfW + K * media) / (s.w + K)) / media;
  const defensa = s => ((s.gaW + K * media) / (s.w + K)) / media;
  const va = p.neutral ? 1 : CONFIG.VENTAJA_LOCAL;

  let lamL = media * ataque(sL) * defensa(sV) * va;
  let lamV = media * ataque(sV) * defensa(sL) / va;

  // Nivel actual: diferencia de puntos por partido en los últimos 10.
  const dForma = (sL.ppg - sV.ppg) / 3;
  lamL *= 1 + CONFIG.PESO_FORMA * dForma;
  lamV *= 1 - CONFIG.PESO_FORMA * dForma;

  // Enfrentamientos directos.
  const h2h = hL.filter(m => m.rival === p.visita.id).slice(0, 6);
  let h2hTxt = '-';
  if (h2h.length) {
    const g = h2h.filter(m => m.gf > m.ga).length;
    const e = h2h.filter(m => m.gf === m.ga).length;
    const pe = h2h.length - g - e;
    h2hTxt = g + 'G ' + e + 'E ' + pe + 'P';
    if (h2h.length >= 2) {
      const d = (g - pe) / h2h.length;
      lamL *= 1 + CONFIG.PESO_H2H * d;
      lamV *= 1 - CONFIG.PESO_H2H * d;
    }
  }

  lamL = Math.min(4, Math.max(0.15, lamL));
  lamV = Math.min(4, Math.max(0.15, lamV));

  const pr = probabilidades_(lamL, lamV);
  const mejor = elegirMejorApuesta_(p, pr);
  const datos = Math.min(1, (sL.n + sV.n) / (2 * CONFIG.PARTIDOS_FORMA));
  const confianza = mejor
    ? Math.round(100 * mejor.prob * p.liga.peso * (0.7 + 0.3 * datos) * (mejor.valor > 0 ? 1.05 : 1))
    : 0;

  return {
    p: p, sL: sL, sV: sV, lamL: lamL, lamV: lamV, pr: pr,
    h2h: h2hTxt, mejor: mejor, confianza: confianza, datos: datos
  };
}

/** Matriz de Poisson con corrección Dixon-Coles -> mercados. */
function probabilidades_(lL, lV) {
  const MAX = 10;
  const pois = (l, k) => Math.exp(-l) * Math.pow(l, k) / factorial_(k);
  const rho = CONFIG.RHO_DIXON_COLES;
  const tau = (x, y) => {
    if (x === 0 && y === 0) return 1 - lL * lV * rho;
    if (x === 0 && y === 1) return 1 + lL * rho;
    if (x === 1 && y === 0) return 1 + lV * rho;
    if (x === 1 && y === 1) return 1 - rho;
    return 1;
  };

  let total = 0;
  const m = [];
  for (let i = 0; i <= MAX; i++) {
    m[i] = [];
    for (let j = 0; j <= MAX; j++) {
      m[i][j] = Math.max(0, pois(lL, i) * pois(lV, j) * tau(i, j));
      total += m[i][j];
    }
  }

  const r = { local: 0, empate: 0, visita: 0, o15: 0, o25: 0, o35: 0, btts: 0, marcador: '', pMarcador: 0 };
  for (let i = 0; i <= MAX; i++) {
    for (let j = 0; j <= MAX; j++) {
      const q = m[i][j] / total;
      if (i > j) r.local += q; else if (i === j) r.empate += q; else r.visita += q;
      if (i + j >= 2) r.o15 += q;
      if (i + j >= 3) r.o25 += q;
      if (i + j >= 4) r.o35 += q;
      if (i > 0 && j > 0) r.btts += q;
      if (q > r.pMarcador) { r.pMarcador = q; r.marcador = i + '-' + j; }
    }
  }
  return r;
}

function factorial_(n) {
  let f = 1;
  for (let i = 2; i <= n; i++) f *= i;
  return f;
}

/**
 * 1) Si hay cuotas reales y alguna da valor esperado positivo -> apuesta de VALOR.
 * 2) Si no, el mercado más probable que todavía pague (cuota justa >= 1.25).
 */
function elegirMejorApuesta_(p, pr) {
  const L = p.local.nombre, V = p.visita.nombre;

  if (p.cuotas) {
    const conValor = [
      { mercado: 'Gana ' + L, prob: pr.local, cuota: p.cuotas.local },
      { mercado: 'Empate', prob: pr.empate, cuota: p.cuotas.empate },
      { mercado: 'Gana ' + V, prob: pr.visita, cuota: p.cuotas.visita }
    ].filter(c => c.cuota && c.prob >= 0.35)
      .map(c => Object.assign(c, { valor: c.prob * c.cuota - 1 }))
      .filter(c => c.valor >= CONFIG.VALOR_MIN)
      .sort((a, b) => b.valor - a.valor);
    if (conValor.length) return Object.assign(conValor[0], { tipo: 'VALOR' });
  }

  const candidatos = [
    { mercado: 'Gana ' + L, prob: pr.local },
    { mercado: 'Gana ' + V, prob: pr.visita },
    { mercado: L + ' o Empate (1X)', prob: pr.local + pr.empate },
    { mercado: V + ' o Empate (X2)', prob: pr.visita + pr.empate },
    { mercado: 'Más de 1.5 goles', prob: pr.o15 },
    { mercado: 'Más de 2.5 goles', prob: pr.o25 },
    { mercado: 'Menos de 2.5 goles', prob: 1 - pr.o25 },
    { mercado: 'Menos de 3.5 goles', prob: 1 - pr.o35 },
    { mercado: 'Ambos anotan: Sí', prob: pr.btts },
    { mercado: 'Ambos anotan: No', prob: 1 - pr.btts }
  ].filter(c => c.prob >= CONFIG.PROB_MIN_MERCADO && c.prob <= CONFIG.PROB_MAX_MERCADO)
    .sort((a, b) => b.prob - a.prob);

  if (!candidatos.length) return null;
  const c = candidatos[0];
  let cuota = null;
  if (p.cuotas) {
    if (c.mercado === 'Gana ' + L) cuota = p.cuotas.local;
    if (c.mercado === 'Gana ' + V) cuota = p.cuotas.visita;
  }
  return Object.assign(c, { tipo: 'PROBABLE', cuota: cuota, valor: cuota ? c.prob * cuota - 1 : null });
}

// =============================== SALIDA ====================================

const ENCABEZADOS = [
  'Confianza', 'Fecha', 'Liga', 'Local', 'Visitante', 'Forma local', 'Forma visita',
  'H2H (local)', 'xG local', 'xG visita', '1', 'X', '2', '+2.5', 'Ambos anotan',
  'Marcador probable', 'MEJOR APUESTA', 'Tipo', 'Prob.', 'Cuota justa', 'Cuota casa', 'Valor (EV)'
];

function filaDe_(r) {
  const m = r.mejor;
  return [
    r.confianza,
    r.p.fecha,
    r.p.liga.nombre,
    r.p.local.nombre,
    r.p.visita.nombre,
    r.sL.forma || r.p.local.formaEspn || '-',
    r.sV.forma || r.p.visita.formaEspn || '-',
    r.h2h,
    redondear_(r.lamL, 2),
    redondear_(r.lamV, 2),
    r.pr.local, r.pr.empate, r.pr.visita, r.pr.o25, r.pr.btts,
    r.pr.marcador,
    m ? m.mercado : 'Sin apuesta clara',
    m ? m.tipo : '',
    m ? m.prob : '',
    m ? redondear_(1 / m.prob, 2) : '',
    m && m.cuota ? redondear_(m.cuota, 2) : '',
    m && m.valor !== null && m.valor !== undefined ? m.valor : ''
  ];
}

function escribirHoja_(resultados) {
  const hoja = obtenerHoja_('Pronósticos');
  hoja.clear();
  hoja.getRange(1, 1, 1, ENCABEZADOS.length).setValues([ENCABEZADOS]);
  if (resultados.length) {
    hoja.getRange(2, 1, resultados.length, ENCABEZADOS.length).setValues(resultados.map(filaDe_));
  }
  formatear_(hoja, resultados.length);
  hoja.getRange(resultados.length + 3, 1).setValue(
    'Actualizado: ' + new Date().toLocaleString('es-MX') +
    ' · Modelo Poisson/Dixon-Coles con últimos ' + CONFIG.PARTIDOS_FORMA +
    ' partidos + H2H. Cuota justa = 1/prob. Apuesta sólo si la casa paga MÁS que la cuota justa.'
  ).setFontStyle('italic').setFontColor('#666');
}

function escribirTop_(conApuesta) {
  const hoja = obtenerHoja_('Top Apuestas');
  hoja.clear();
  const top = conApuesta.slice(0, CONFIG.TOP_N);
  hoja.getRange(1, 1, 1, ENCABEZADOS.length).setValues([ENCABEZADOS]);
  if (top.length) hoja.getRange(2, 1, top.length, ENCABEZADOS.length).setValues(top.map(filaDe_));
  formatear_(hoja, top.length);
}

function formatear_(hoja, n) {
  const enc = hoja.getRange(1, 1, 1, ENCABEZADOS.length);
  enc.setFontWeight('bold').setBackground('#0b3d2e').setFontColor('#fff').setWrap(true);
  hoja.setFrozenRows(1);
  if (!n) return;
  hoja.getRange(2, 2, n, 1).setNumberFormat('ddd dd/mm HH:mm');
  hoja.getRange(2, 11, n, 5).setNumberFormat('0%');
  hoja.getRange(2, 19, n, 1).setNumberFormat('0%');
  hoja.getRange(2, 22, n, 1).setNumberFormat('+0%;-0%');
  hoja.getRange(2, 17, n, 1).setFontWeight('bold').setBackground('#e6f4ea');

  const conf = hoja.getRange(2, 1, n, 1);
  hoja.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().setGradientMaxpoint('#34a853')
      .setGradientMidpointWithValue('#fbbc04', SpreadsheetApp.InterpolationType.NUMBER, '55')
      .setGradientMinpoint('#ea4335').setRanges([conf]).build()
  ]);
  hoja.autoResizeColumns(1, ENCABEZADOS.length);
}

function enviarCorreo_(top) {
  if (!top.length) return;
  const filas = top.map((r, i) =>
    '<tr><td>' + (i + 1) + '</td><td>' + r.p.liga.nombre + '</td><td>' +
    r.p.local.nombre + ' vs ' + r.p.visita.nombre + '</td><td><b>' + r.mejor.mercado +
    '</b></td><td>' + Math.round(r.mejor.prob * 100) + '%</td><td>' + r.confianza + '</td></tr>'
  ).join('');
  MailApp.sendEmail({
    to: CONFIG.EMAIL_TOP,
    subject: '⚽ Top ' + top.length + ' apuestas de la semana',
    htmlBody: '<table border="1" cellpadding="4" style="border-collapse:collapse">' +
      '<tr><th>#</th><th>Liga</th><th>Partido</th><th>Apuesta</th><th>Prob.</th><th>Confianza</th></tr>' +
      filas + '</table><p style="color:#666">Modelo estadístico, no garantiza resultados.</p>'
  });
}

// ============================== UTILIDADES =================================

function obtenerHoja_(nombre) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(nombre) || ss.insertSheet(nombre);
}

function fmtFechaApi_(d) {
  return Utilities.formatDate(d, 'UTC', 'yyyyMMdd');
}

function redondear_(x, d) {
  const f = Math.pow(10, d);
  return Math.round(x * f) / f;
}

function aviso_(msg) {
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); }
}
