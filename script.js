'use strict';

/* =========================================================================
   Noche de estacas — cazadores contra vampiros, sin narrador
   Algunos jugadores son vampiros en secreto y se conocen entre ellos.
   De noche los vampiros muerden a alguien; de día se vota a quién clavar
   la estaca. Quien cae sigue jugando como fantasma: vota de día y de
   noche vela por alguien para salvarlo de los colmillos.
   Modo básico (solo cazadores y vampiros) o avanzado (con habilidades).

   Un único motor para los dos modos: «Mismo móvil» (mesa.js) y
   «Con código de sala» (sala.js). La partida vive solo en memoria.
   ========================================================================= */

const MIN_PLAYERS = 5;
const MAX_PLAYERS = 14;
const TIMER_OPTIONS = [0, 1, 2, 3, 4, 5, 6, 8, 10];
const TIMER_STEP = 30;
const SETTINGS_KEY = 'noche-estacas-settings-v1';

const ROLES = {
  cazador: { name: 'Cazador', emoji: '🏹', team: 'cazadores', goal: 'Descubre a los vampiros y clávales la estaca de día.' },
  rastreadora: { name: 'Rastreadora', emoji: '🔍', team: 'cazadores', goal: 'Cada noche descubres si alguien es vampiro.' },
  herbolario: { name: 'Herbolario', emoji: '🧄', team: 'cazadores', goal: 'Cada noche proteges a alguien con ajo (también a ti). No repites dos noches seguidas.' },
  veterano: { name: 'Veterano', emoji: '🪵', team: 'cazadores', goal: 'Una vez por partida, de día, clavas tu estaca sin votación. Si no era vampiro, caes tú.' },
  vampiro: { name: 'Vampiro', emoji: '🧛', team: 'vampiros', goal: 'Cada noche, con los tuyos, mordéis a alguien. De día, disimula.' },
  conde: { name: 'Conde', emoji: '🦇', team: 'vampiros', goal: 'Muerdes con los tuyos y, una vez por partida, puedes convertir a tu víctima en vampiro en vez de matarla.' },
  sombra: { name: 'Sombra', emoji: '🌑', team: 'vampiros', goal: 'Muerdes con los tuyos. La rastreadora te ve como cazador.' }
};
const isVamp = (r) => ROLES[r].team === 'vampiros';

/* --------------------------------- Ajustes --------------------------------- */

let settings = { playerCount: 7, vampires: 2, advanced: true, timerMinutes: 3, reveal: true, secretVote: false };
let vampManual = false;

const maxVampsFor = (n) => Math.max(1, Math.floor((n - 1) / 3));
const suggestedVamps = (n) => Math.min(maxVampsFor(n), n <= 6 ? 1 : n <= 9 ? 2 : 3);

function loadSettings() {
  const p = Kit.load(SETTINGS_KEY, {}) || {};
  if (typeof p.playerCount === 'number') settings.playerCount = Kit.clamp(Math.round(p.playerCount), MIN_PLAYERS, MAX_PLAYERS);
  if (typeof p.vampires === 'number') { settings.vampires = Kit.clamp(p.vampires, 1, maxVampsFor(settings.playerCount)); vampManual = true; }
  else settings.vampires = suggestedVamps(settings.playerCount);
  ['advanced', 'reveal', 'secretVote'].forEach((k) => { if (typeof p[k] === 'boolean') settings[k] = p[k]; });
  if (TIMER_OPTIONS.includes(p.timerMinutes)) settings.timerMinutes = p.timerMinutes;
}
function saveSettings() { Kit.save(SETTINGS_KEY, salaBackup ? Object.assign({}, settings, salaBackup) : settings); }

/* ---------------------------------- Motor ----------------------------------- */
// Fases: reveal → night → dawn → day → vote → verdict → night… y end.

function newGame(n, cfg, local) {
  const v = Kit.clamp(cfg.vampires, 1, maxVampsFor(n));
  const roles = [];
  for (let k = 0; k < v; k++) roles.push(cfg.advanced && k === 0 ? 'conde' : cfg.advanced && k === 1 ? 'sombra' : 'vampiro');
  if (cfg.advanced) ['rastreadora', 'herbolario', 'veterano'].slice(0, n - v >= 5 ? 3 : 2).forEach((r) => roles.push(r));
  while (roles.length < n) roles.push('cazador');
  return {
    cfg: { reveal: cfg.reveal, seconds: cfg.timerMinutes * 60, local: Boolean(local), open: Boolean(local && !cfg.secretVote) },
    players: Kit.shuffled(roles).map((role) => ({ role, alive: true })),
    day: 1, phase: 'reveal', ready: {}, night: null, lastGarlic: null, lastWatch: {},
    countUsed: false, vetUsed: false, dawn: null, shot: null, votes: {}, verdict: null, winner: null
  };
}

const roleOf = (g, i) => g.players[i].role;
const aliveList = (g) => g.players.map((p, i) => (p.alive ? i : -1)).filter((i) => i >= 0);
const allList = (g) => g.players.map((_, i) => i);
const vampsOf = (g) => allList(g).filter((i) => isVamp(roleOf(g, i)));

function checkWin(g) {
  const alive = aliveList(g);
  const v = alive.filter((i) => isVamp(roleOf(g, i))).length;
  if (v === 0) return 'cazadores';
  if (v >= alive.length - v) return 'vampiros';
  return null;
}

function startNight(g) {
  g.phase = 'night';
  g.night = { acts: {}, conv: false };
  g.votes = {};
  g.verdict = null;
  g.shot = null;
}

function validTarget(g, i, t) {
  if (!(t >= 0 && t < g.players.length) || !g.players[t].alive) return false;
  const me = g.players[i];
  if (!me.alive) return t !== g.lastWatch[i];
  if (isVamp(me.role)) return !isVamp(roleOf(g, t));
  if (me.role === 'herbolario') return t !== g.lastGarlic;
  return t !== i;
}

function resolveNight(g) {
  const acts = g.night.acts;
  const biters = vampsOf(g).filter((i) => g.players[i].alive && acts[i] != null);
  const counts = {};
  biters.forEach((i) => { counts[acts[i]] = (counts[acts[i]] || 0) + 1; });
  const max = Math.max(0, ...Object.values(counts));
  const top = Object.keys(counts).filter((k) => counts[k] === max).map(Number);
  let victim = top.length ? Kit.pick(top) : null;
  const conde = biters.find((i) => roleOf(g, i) === 'conde');
  const convert = conde != null && g.night.conv && !g.countUsed;
  if (convert) victim = acts[conde];
  const herb = g.players.findIndex((p) => p.role === 'herbolario' && p.alive);
  const garlic = herb !== -1 && acts[herb] != null ? acts[herb] : null;
  const watch = {};
  allList(g).filter((k) => !g.players[k].alive && acts[k] != null).forEach((k) => { watch[k] = acts[k]; });
  const watched = Object.values(watch);
  let died = null;
  let saved = null;
  let converted = null;
  if (victim != null) {
    if (victim === garlic) saved = 'ajo';
    else if (watched.includes(victim)) saved = 'fantasma';
    else if (convert) {
      g.players[victim].conv = g.players[victim].role;
      g.players[victim].role = 'vampiro';
      g.countUsed = true;
      converted = victim;
    } else {
      g.players[victim].alive = false;
      died = victim;
    }
  }
  g.lastGarlic = garlic;
  g.lastWatch = watch;
  g.dawn = { died, saved, converted };
  g.phase = 'dawn';
  g.winner = checkWin(g);
}

function resolveVote(g, votes) {
  const counts = {};
  let none = 0;
  Object.keys(votes).forEach((k) => {
    const t = votes[k];
    if (t === 'none') none += 1; else counts[t] = (counts[t] || 0) + 1;
  });
  resolveCounts(g, counts, none);
}

function resolveCounts(g, counts, none) {
  const max = Math.max(0, ...Object.values(counts));
  const top = Object.keys(counts).filter((k) => counts[k] === max).map(Number);
  let out = null;
  let reason = 'novote';
  if (none > 0 && none >= max) reason = 'none';
  else if (top.length > 1) reason = 'tie';
  else if (top.length === 1) { out = top[0]; reason = 'out'; }
  if (out != null) g.players[out].alive = false;
  g.verdict = { out, reason, counts, none };
  g.phase = 'verdict';
  g.winner = checkWin(g);
}

function act(g, i, a, host) {
  const me = g.players[i];
  switch (a.t) {
    case 'ready':
      if (g.phase !== 'reveal' || !me) return null;
      g.ready[i] = true;
      return {};
    case 'night-start':
      if (!host || (g.phase !== 'reveal' && g.phase !== 'verdict') || g.winner) return null;
      if (g.phase === 'verdict') g.day += 1;
      startNight(g);
      return { timer: null };
    case 'night':
      if (g.phase !== 'night' || !me || g.night.acts[i] != null || !validTarget(g, i, a.target)) return null;
      g.night.acts[i] = a.target;
      if (me.alive && me.role === 'conde' && a.conv && !g.countUsed) g.night.conv = true;
      return {};
    case 'dawn':
      if (!host || g.phase !== 'night') return null;
      resolveNight(g);
      return {};
    case 'day':
      if (!host || g.phase !== 'dawn' || g.winner) return null;
      g.phase = 'day';
      return { timer: g.cfg.seconds || null };
    case 'stake': {
      // el veterano: en la sala lo hace él; en un móvil se dice quién dispara (by)
      const by = host && a.by != null ? a.by : i;
      const shooter = g.players[by];
      if (g.phase !== 'day' || g.shot || !shooter || !shooter.alive) return null;
      if (!(a.target >= 0 && a.target < g.players.length) || !g.players[a.target].alive || a.target === by) return null;
      if (shooter.role !== 'veterano' || g.vetUsed) { g.shot = { by, target: a.target, fake: true }; return {}; }
      g.vetUsed = true;
      const hit = isVamp(roleOf(g, a.target));
      g.players[hit ? a.target : by].alive = false;
      g.shot = { by, target: a.target, hit };
      g.winner = checkWin(g);
      if (g.winner) { g.phase = 'verdict'; g.verdict = { out: null, reason: 'shot', counts: {}, none: 0 }; }
      return {};
    }
    case 'to-vote':
      if (!host || g.phase !== 'day') return null;
      g.phase = 'vote';
      g.votes = {};
      return { timer: null };
    case 'vote':
      // votan los vivos y los fantasmas; solo se puede votar a los vivos
      if (g.phase !== 'vote' || !me) return null;
      if (a.target !== 'none' && (!(a.target >= 0 && a.target < g.players.length) || !g.players[a.target].alive || a.target === i)) return null;
      g.votes[i] = a.target;
      return {};
    case 'tally':
      if (!host || g.phase !== 'vote') return null;
      resolveVote(g, g.votes);
      return {};
    case 'end':
      if (!host || !g.winner) return null;
      g.phase = 'end';
      return { timer: null };
    default:
      return null;
  }
}

function privateTurn(g) {
  if (g.phase === 'reveal') return { key: 'reveal', order: allList(g), done: (gg, k) => g.cfg.local || Boolean(gg.ready[k]), lastLabel: 'Listo, ¡llega la noche!' };
  if (g.phase === 'night') return { key: `night-${g.day}`, order: allList(g), done: (gg, k) => gg.night.acts[k] != null, lastLabel: 'Listo, ¡que amanezca!', intro: `🌙 Noche ${g.day}. Todos, también los fantasmas, hacen algo en secreto.` };
  if (g.phase === 'vote' && !g.cfg.open) return { key: `vote-${g.day}`, order: allList(g), done: (gg, k) => gg.votes[k] != null, lastLabel: 'Ver el recuento', intro: '🗳️ Votación secreta. Los fantasmas también votan.' };
  return null;
}

function advance(g) {
  if (g.phase === 'reveal') { startNight(g); return {}; }
  if (g.phase === 'night') { resolveNight(g); return {}; }
  if (g.phase === 'vote') { resolveVote(g, g.votes); return {}; }
  return null;
}

/* ------------------------------ Lo que se pinta ------------------------------ */

const esc = Kit.esc;
const actAttr = (a) => `data-act="${esc(JSON.stringify(a))}"`;
const nameList = (ids, names) => ids.map((k) => `<strong>${esc(names[k])}</strong>`).join(', ').replace(/, ([^,]*)$/, ' y $1');
const roleTag = (g, i) => `${ROLES[roleOf(g, i)].emoji} ${ROLES[roleOf(g, i)].name}`;
const hostBtn = (a, label) => `<button type="button" class="btn btn-primary btn-large" ${actAttr(a)}>${label}</button>`;
const waitHost = (ctx, text) => `<p class="setup-hint sala-center">⏳ ${esc(text || `Esperando a ${ctx.hostName}`)}</p>`;

function roleCard(g, i, names) {
  const p = g.players[i];
  const role = ROLES[p.role];
  let extra = esc(role.goal);
  if (p.conv) extra = `Te mordieron y ahora eres vampiro (eras ${ROLES[p.conv].name.toLowerCase()}). ${extra}`;
  if (isVamp(p.role)) {
    const pack = vampsOf(g).filter((k) => k !== i);
    extra += `<br><strong>${pack.length ? `Tus vampiros: ${pack.map((k) => `${esc(names[k])} (${ROLES[roleOf(g, k)].name})`).join(', ')}` : 'Eres el único vampiro'}</strong>`;
  }
  const vamp = isVamp(p.role);
  return { label: vamp ? 'Equipo de los vampiros' : 'Equipo de los cazadores', emoji: role.emoji, content: role.name, extra, alert: vamp, impostor: vamp };
}

function targetButtons(g, i, names, list, ok, note, extra) {
  return '<div class="sala-votes">' + list.map((k) => {
    const can = ok(k);
    return `<button type="button" class="sala-vote" ${can ? actAttr(Object.assign({ t: 'night', target: k }, extra || {})) : 'disabled'}>${esc(names[k])}${!can && note ? `<small>${note(k)}</small>` : ''}</button>`;
  }).join('') + '</div>';
}

function nightPanel(g, i, names) {
  const me = g.players[i];
  const done = g.night.acts[i];
  const r = me.role;
  const alive = aliveList(g);
  if (!me.alive) {
    if (done != null) return `<p class="screen-help">👻 Esta noche velas por <strong>${esc(names[done])}</strong>. Si la muerden, la salvas.</p>`;
    return '<h3 class="night-title">👻 Eres un fantasma: ¿por quién velas?</h3><p class="screen-help">Si los vampiros muerden a quien veles, se salva. No puedes velar dos noches seguidas por la misma persona.</p>' +
      targetButtons(g, i, names, alive, (k) => k !== g.lastWatch[i], () => 'anoche');
  }
  const conv = me.conv ? '<div class="night-result is-wolf"><span>🧛</span><p>Te mordieron: ahora eres <strong>vampiro</strong>.</p></div>' : '';
  if (done != null) {
    if (isVamp(r)) return conv + `<p class="screen-help">🧛 Has elegido a <strong>${esc(names[done])}</strong>${g.night.conv && r === 'conde' ? ' para convertirlo' : ''}. Al amanecer se sabrá…</p>`;
    if (r === 'rastreadora') {
      const v = isVamp(roleOf(g, done)) && roleOf(g, done) !== 'sombra';
      return `<div class="night-result ${v ? 'is-wolf' : 'is-safe'}"><span>${v ? '🧛' : '🕊️'}</span><p><strong>${esc(names[done])}</strong> ${v ? '¡es un vampiro!' : 'no es un vampiro'}</p></div>` +
        '<p class="screen-help">Guárdatelo: si lo dices muy claro, irán a por ti.</p>';
    }
    if (r === 'herbolario') return `<p class="screen-help">🧄 Esta noche proteges a <strong>${esc(names[done])}</strong>.</p>`;
    return '<p class="screen-help">😴 Duermes con un ojo abierto…</p>';
  }
  if (isVamp(r)) {
    const pack = vampsOf(g).filter((k) => k !== i && g.players[k].alive);
    const picks = pack.filter((k) => g.night.acts[k] != null).map((k) => `${esc(names[k])} → <strong>${esc(names[g.night.acts[k]])}</strong>`);
    const ok = (k) => !isVamp(roleOf(g, k));
    let html = conv + '<h3 class="night-title">🧛 ¿A quién mordéis esta noche?</h3>' +
      (pack.length ? `<p class="screen-help">Tus vampiros: ${nameList(pack, names)}.${picks.length ? `<br>Han elegido: ${picks.join(' · ')}` : ''}</p>` : '') +
      targetButtons(g, i, names, alive, ok, () => 'vampiro');
    if (r === 'conde' && !g.countUsed) {
      html += '<details class="fold"><summary>🦇 Convertir en vez de matar <small>una vez</small></summary>' +
        '<p class="setup-hint">Tu elección manda sobre la de los demás: la víctima se vuelve vampiro si nadie la protege.</p>' +
        targetButtons(g, i, names, alive, ok, () => 'vampiro', { conv: true }) + '</details>';
    }
    return html;
  }
  if (r === 'rastreadora') return '<h3 class="night-title">🔍 ¿De quién quieres saber si es vampiro?</h3>' + targetButtons(g, i, names, alive.filter((k) => k !== i), () => true);
  if (r === 'herbolario') {
    return '<h3 class="night-title">🧄 ¿A quién proteges con ajo?</h3>' +
      targetButtons(g, i, names, alive, (k) => k !== g.lastGarlic, () => 'anoche') +
      (g.lastGarlic != null ? '<p class="setup-hint">No puedes proteger dos noches seguidas a la misma persona.</p>' : '');
  }
  return `<h3 class="night-title">😴 Eres ${ROLES[r].name.toLowerCase()}: vigilas</h3><p class="screen-help">Toca a quien te parece más sospechoso. No cambia nada: es para que nadie note quién tiene poderes.</p>` +
    targetButtons(g, i, names, alive.filter((k) => k !== i), () => true);
}

function newsHtml(g, names) {
  const d = g.dawn;
  const reveal = (k) => (g.cfg.reveal ? ` Era <strong>${roleTag(g, k)}</strong>.` : '');
  if (d.died != null) return `<div class="verdict is-lose"><span class="verdict-emoji" aria-hidden="true">🩸</span><h2 class="verdict-title">${esc(names[d.died])} no ha despertado</h2><p class="verdict-text">Tiene dos marcas en el cuello. Ahora es un fantasma.${reveal(d.died)}</p></div>`;
  if (d.saved === 'ajo') return '<div class="verdict is-win"><span class="verdict-emoji" aria-hidden="true">🧄</span><h2 class="verdict-title">¡Nadie ha muerto!</h2><p class="verdict-text">Los vampiros atacaron, pero el ajo los espantó.</p></div>';
  if (d.saved === 'fantasma') return '<div class="verdict is-win"><span class="verdict-emoji" aria-hidden="true">👻</span><h2 class="verdict-title">¡Nadie ha muerto!</h2><p class="verdict-text">Los vampiros atacaron, pero un fantasma veló por su víctima.</p></div>';
  return '<div class="verdict"><span class="verdict-emoji" aria-hidden="true">🌄</span><h2 class="verdict-title">Noche tranquila</h2><p class="verdict-text">Nadie ha muerto… o eso parece.</p></div>';
}

function shotHtml(g, names) {
  const s = g.shot;
  if (!s) return '';
  if (s.fake) return `<div class="verdict"><span class="verdict-emoji" aria-hidden="true">🪵</span><h2 class="verdict-title">${esc(names[s.by])} clava una estaca a ${esc(names[s.target])}</h2><p class="verdict-text">No pasa nada. Quizá no era el veterano…</p></div>`;
  if (s.hit) return `<div class="verdict is-win"><span class="verdict-emoji" aria-hidden="true">🪵</span><h2 class="verdict-title">¡Estaca certera!</h2><p class="verdict-text">${esc(names[s.by])} ha clavado la estaca a <strong>${esc(names[s.target])}</strong>, que era ${roleTag(g, s.target)}.</p></div>`;
  return `<div class="verdict is-lose"><span class="verdict-emoji" aria-hidden="true">🪵</span><h2 class="verdict-title">¡Estaca fallida!</h2><p class="verdict-text">${esc(names[s.target])} no era vampiro y ${esc(names[s.by])}, el veterano, cae del disgusto.</p></div>`;
}

function verdictHtml(g, names) {
  const v = g.verdict;
  if (v.reason === 'shot') return shotHtml(g, names);
  if (v.out != null) {
    const vamp = isVamp(roleOf(g, v.out));
    const show = g.cfg.reveal ? ` Era <strong>${roleTag(g, v.out)}</strong>.` : '';
    return `<div class="verdict ${g.cfg.reveal ? (vamp ? 'is-win' : 'is-lose') : ''}"><span class="verdict-emoji" aria-hidden="true">🪵</span><h2 class="verdict-title">Estaca para ${esc(names[v.out])}</h2><p class="verdict-text">${show || 'Su papel queda en secreto.'} Ahora es un fantasma.</p></div>`;
  }
  const text = v.reason === 'tie' ? 'Empate en la votación: nadie recibe la estaca.' : v.reason === 'none' ? 'Hoy no se clava ninguna estaca.' : 'Nadie votó.';
  return `<div class="verdict"><span class="verdict-emoji" aria-hidden="true">🤝</span><h2 class="verdict-title">Nadie cae</h2><p class="verdict-text">${text}</p></div>`;
}

function voteSummary(g, names) {
  const v = g.verdict;
  const rows = Object.keys(v.counts).map(Number).sort((a, b) => v.counts[b] - v.counts[a]).map((k) => `${esc(names[k])} ${v.counts[k]}`);
  if (v.none) rows.push(`Nadie ${v.none}`);
  return rows.length ? `<p class="vote-summary">Votos: ${rows.join(' · ')}</p>` : '';
}

function endHtml(g, names) {
  const town = g.winner === 'cazadores';
  return `<div class="verdict ${town ? 'is-win' : 'is-lose'}"><span class="verdict-emoji" aria-hidden="true">${town ? '🌅' : '🧛'}</span>` +
    `<h2 class="verdict-title">${town ? '¡Ganan los cazadores!' : '¡Ganan los vampiros!'}</h2>` +
    `<p class="verdict-text">${town ? 'No queda ni un vampiro en pie. Por fin amanece de verdad.' : 'Los vampiros ya son tantos como los vivos. La noche es suya.'}</p></div>` +
    '<div class="card reveal-box"><p class="results-label">Quién era quién</p><ul class="town-list">' +
    g.players.map((p, k) => `<li class="${isVamp(p.role) ? 'is-wolf' : ''}${p.alive ? '' : ' is-dead'}"><span>${ROLES[p.role].emoji}</span><strong>${esc(names[k])}</strong><small>${ROLES[p.role].name}${p.conv ? ` · antes ${ROLES[p.conv].name.toLowerCase()}` : ''}${p.alive ? '' : ' · 👻'}</small></li>`).join('') +
    '</ul></div>';
}

function aliveChips(g, names) {
  return `<ul class="town-chips">${g.players.map((p, k) => `<li class="${p.alive ? '' : 'is-dead'}">${p.alive ? '' : '👻 '}${esc(names[k])}</li>`).join('')}</ul>`;
}

function voteButtons(g, i, names) {
  const mine = g.votes[i];
  return '<div class="sala-votes">' + aliveList(g).filter((k) => k !== i).map((k) =>
    `<button type="button" class="sala-vote${mine === k ? ' is-selected' : ''}" ${actAttr({ t: 'vote', target: k })}>${esc(names[k])}</button>`).join('') +
    `<button type="button" class="sala-vote is-none${mine === 'none' ? ' is-selected' : ''}" ${actAttr({ t: 'vote', target: 'none' })}>🙅 Nadie</button></div>`;
}

// Estaca del veterano en un solo móvil: quien dice serlo elige a quién
function stakePicker(g, names) {
  if (g.shot || g.vetUsed) return '';
  const alive = aliveList(g);
  return '<details class="fold"><summary>🪵 Estaca del veterano</summary><p class="setup-hint">Quien diga ser el veterano elige primero quién es y luego a quién clava la estaca. Si no lo es, no pasa nada.</p>' +
    alive.map((by) => `<p class="results-label">${esc(names[by])} clava la estaca a…</p><div class="sala-votes">` +
      alive.filter((k) => k !== by).map((k) => `<button type="button" class="sala-vote" ${actAttr({ t: 'stake', by, target: k })}>${esc(names[k])}</button>`).join('') + '</div>').join('') +
    '</details>';
}

function render(ctx) {
  const { g, me, host, names } = ctx;
  const inGame = me >= 0 && me < g.players.length;
  const p = inGame ? g.players[me] : null;
  const all = allList(g);
  const count = (obj) => all.filter((k) => obj[k] != null).length;
  const spectator = '<p class="screen-help">👀 Has entrado con la partida empezada: mira y espera a la siguiente.</p>';
  const ghost = p && !p.alive ? '<p class="setup-hint sala-center">👻 Eres un fantasma: puedes hablar, votas de día y velas de noche.</p>' : '';

  switch (g.phase) {
    case 'reveal':
      if (ctx.local) return `<h2 class="reveal-player">${esc(names[me])}</h2>${ctx.card}`;
      return (inGame ? `<h2 class="reveal-player">${esc(names[me])}</h2><p class="reveal-warning">🤫 Que nadie más mire tu pantalla</p>${ctx.card}` +
          (g.ready[me] ? '<p class="screen-help">✅ Listo. Esperando a los demás…</p>' : `<button type="button" class="btn btn-secondary btn-large" ${actAttr({ t: 'ready' })}>Ya lo vi</button>`) : spectator) +
        `<p class="sala-count">Listos <strong>${count(g.ready)}</strong> de ${g.players.length}</p>` +
        (host ? hostBtn({ t: 'night-start' }, 'Empezar la noche 🌙') : '');
    case 'night':
      return `<h2 class="screen-title">🌙 Noche ${g.day}</h2>` + (inGame ? `<p class="reveal-pass">${esc(names[me])} · ${roleTag(g, me)}${p.alive ? '' : ' · 👻'}</p>` + nightPanel(g, me, names) : spectator) +
        (ctx.local ? '' : `<p class="sala-count">Han actuado <strong>${count(g.night.acts)}</strong> de ${g.players.length}</p>` +
          (host ? `<button type="button" class="btn btn-text" ${actAttr({ t: 'dawn' })}>Que amanezca ya</button>` : ''));
    case 'dawn': {
      const conv = inGame && g.dawn.converted === me ? '<div class="night-result is-wolf"><span>🧛</span><p>Anoche te mordieron: <strong>ahora eres vampiro</strong>. Mira tu carta.</p></div>' + ctx.card : '';
      return `<h2 class="screen-title">☀️ Amanece · día ${g.day}</h2>${newsHtml(g, names)}${conv}${ghost}` +
        (host ? (g.winner ? hostBtn({ t: 'end' }, 'Ver el final') : hostBtn({ t: 'day' }, 'Empezar el día 🗣️')) : waitHost(ctx));
    }
    case 'day': {
      let stake = '';
      if (ctx.local) stake = stakePicker(g, names);
      else if (p && p.alive && p.role === 'veterano' && !g.vetUsed && !g.shot) {
        stake = '<details class="fold"><summary>🪵 Clavar tu estaca</summary><p class="setup-hint">Si no es vampiro, caes tú.</p><div class="sala-votes">' +
          aliveList(g).filter((k) => k !== me).map((k) => `<button type="button" class="sala-vote" ${actAttr({ t: 'stake', target: k })}>${esc(names[k])}</button>`).join('') + '</div></details>';
      }
      return `<h2 class="screen-title">🗣️ Debate · día ${g.day}</h2><p class="screen-help">¿Quién tiene colmillos? Hablad, acusad y defendeos. Los fantasmas también hablan y votan.</p>${ghost}` +
        shotHtml(g, names) + aliveChips(g, names) + ctx.timer + stake +
        (host ? hostBtn({ t: 'to-vote' }, 'Votar 🗳️') : waitHost(ctx, `${ctx.hostName} abrirá la votación`));
    }
    case 'vote':
      if (ctx.openVote) return '<h2 class="screen-title">¿Quién recibe la estaca?</h2><p class="screen-help">Votan los vivos y los fantasmas. Solo se puede votar a los vivos.</p>';
      return '<h2 class="screen-title">¿Quién recibe la estaca?</h2>' +
        (inGame ? `<p class="screen-help">${p.alive ? 'Vota desde tu móvil.' : '👻 Los fantasmas también votan.'}</p>` + voteButtons(g, me, names) : spectator) +
        (ctx.local ? '' : `<p class="sala-count">🗳️ Han votado <strong>${count(g.votes)}</strong> de ${g.players.length}</p>` +
          (host ? `<button type="button" class="btn btn-text" ${actAttr({ t: 'tally' })}>Hacer el recuento ya</button>` : ''));
    case 'verdict':
      return verdictHtml(g, names) + voteSummary(g, names) +
        (host ? (g.winner ? hostBtn({ t: 'end' }, 'Ver el final') : hostBtn({ t: 'night-start' }, 'Llega la noche 🌙')) : waitHost(ctx));
    case 'end':
      return endHtml(g, names) + (host
        ? '<div class="results-actions"><button type="button" class="btn btn-primary btn-large" data-sala="again">Otra partida ▶</button>' +
          '<button type="button" class="btn btn-secondary btn-large" data-sala="lobby">Cambiar ajustes</button></div>'
        : waitHost(ctx, `Esperando a que ${ctx.hostName} empiece otra partida`));
    default:
      return '';
  }
}

const engine = {
  act, advance, privateTurn, render,
  card: (g, i, names) => (i >= 0 && i < g.players.length ? roleCard(g, i, names) : null),
  title: (g) => (g.phase === 'reveal' ? 'Reparto de papeles' : g.phase === 'end' ? 'Final' : `Día ${g.day}`),
  phaseKey: (g) => `${g.phase}-${g.day}`,
  fx: (g) => (g.phase === 'end' ? (g.winner === 'cazadores' ? 'win' : 'lose') : null),
  openVote: (g) => (g.phase === 'vote' && g.cfg.open ? {
    targets: aliveList(g), allowNone: true,
    onDone: ({ counts, none }) => resolveCounts(g, counts, none)
  } : null)
};

/* ------------------------------- Ajustes (DOM) ------------------------------- */

const el = {};
let game = null;
let local = null;

function cacheDom() {
  ['player-count-value', 'btn-player-minus', 'btn-player-plus', 'vamp-count-value', 'btn-vamp-minus', 'btn-vamp-plus',
    'vamp-hint', 'names-grid', 'btn-shuffle-names', 'opt-advanced', 'role-summary', 'time-value', 'timer-hint',
    'btn-time-minus', 'btn-time-plus', 'opt-reveal', 'opt-secret-vote', 'opt-sound', 'opt-vibrate', 'btn-start-game',
    'game-bar-title', 'btn-exit', 'play-root'
  ].forEach((id) => { el[id.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = document.getElementById(id); });
}

function renderSetup() {
  const n = settings.playerCount;
  const max = maxVampsFor(n);
  settings.vampires = Kit.clamp(settings.vampires, 1, max);
  el.playerCountValue.textContent = String(n);
  el.btnPlayerMinus.disabled = n <= MIN_PLAYERS;
  el.btnPlayerPlus.disabled = n >= MAX_PLAYERS;
  el.vampCountValue.textContent = String(settings.vampires);
  el.btnVampMinus.disabled = settings.vampires <= 1;
  el.btnVampPlus.disabled = settings.vampires >= max;
  el.vampHint.textContent = `Máximo ${max} para ${n} jugadores`;
  Kit.renderNameInputs(el.namesGrid, n);
  el.optAdvanced.checked = settings.advanced;
  el.optReveal.checked = settings.reveal;
  el.optSecretVote.checked = settings.secretVote;
  const v = settings.vampires;
  if (settings.advanced) {
    const powers = n - v >= 5 ? 3 : 2;
    el.roleSummary.textContent = `🦇 1${v > 1 ? ' · 🌑 1' : ''}${v > 2 ? ` · 🧛 ${v - 2}` : ''} · 🔍 1 · 🧄 1${powers > 2 ? ' · 🪵 1' : ''} · 🏹 ${n - v - powers}`;
  } else {
    el.roleSummary.textContent = `🧛 ${v} · 🏹 ${n - v}`;
  }
  const idx = TIMER_OPTIONS.indexOf(settings.timerMinutes);
  el.timeValue.textContent = settings.timerMinutes ? `${settings.timerMinutes}′` : '—';
  el.timerHint.textContent = settings.timerMinutes ? 'Con cronómetro' : 'Sin cronómetro';
  el.btnTimeMinus.disabled = idx <= 0;
  el.btnTimePlus.disabled = idx >= TIMER_OPTIONS.length - 1;
}

function changePlayers(d) {
  settings.playerCount = Kit.clamp(settings.playerCount + d, MIN_PLAYERS, MAX_PLAYERS);
  if (!vampManual) settings.vampires = suggestedVamps(settings.playerCount);
  saveSettings();
  renderSetup();
}

function startLocalGame() {
  game = newGame(settings.playerCount, settings, true);
  local = { names: Kit.playerNames(settings.playerCount) };
  Kit.keepAwake(true);
  Kit.showScreen('play');
  Mesa.start({
    root: el.playRoot, titleEl: el.gameBarTitle, engine, game, names: local.names,
    secretVote: settings.secretVote, timerStep: TIMER_STEP,
    onAgain: startLocalGame, onSetup: backToSetup
  });
}

function backToSetup() {
  Mesa.stop();
  game = null;
  local = null;
  Kit.keepAwake(false);
  renderSetup();
  Kit.showScreen('setup');
}

/* --------------------------- Con código de sala ------------------------------ */

let salaBackup = null;

function salaHosting(on, players) {
  if (on) {
    if (!salaBackup) salaBackup = { playerCount: settings.playerCount };
    settings.playerCount = Kit.clamp(players, MIN_PLAYERS, MAX_PLAYERS);
    settings.vampires = Kit.clamp(settings.vampires, 1, maxVampsFor(settings.playerCount));
  } else if (salaBackup) {
    settings.playerCount = salaBackup.playerCount;
    salaBackup = null;
  }
  renderSetup();
}

Sala.configure({
  id: 'estacas',
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  timerStep: TIMER_STEP,
  holdPrompt: 'Mantén pulsado para ver tu papel',
  who: { one: 'vampiro', many: 'vampiros', One: 'Vampiro', Many: 'Vampiros', the: 'el vampiro', The: 'El vampiro' },
  hosting: salaHosting,
  custom: {
    start: (n) => newGame(n, settings, false),
    act: Mesa.autoAct(engine),
    render,
    card: engine.card,
    phaseKey: engine.phaseKey,
    phaseFx: (g, me) => {
      if (g.phase !== 'end') return null;
      const mine = me >= 0 && me < g.players.length ? ROLES[roleOf(g, me)].team : 'cazadores';
      return mine === g.winner ? 'win' : 'lose';
    }
  }
});

/* --------------------------------- Eventos ----------------------------------- */

function bindEvents() {
  el.btnPlayerMinus.addEventListener('click', () => changePlayers(-1));
  el.btnPlayerPlus.addEventListener('click', () => changePlayers(1));
  el.btnVampMinus.addEventListener('click', () => { settings.vampires -= 1; vampManual = true; saveSettings(); renderSetup(); });
  el.btnVampPlus.addEventListener('click', () => { settings.vampires += 1; vampManual = true; saveSettings(); renderSetup(); });
  el.btnTimeMinus.addEventListener('click', () => { settings.timerMinutes = TIMER_OPTIONS[Math.max(0, TIMER_OPTIONS.indexOf(settings.timerMinutes) - 1)]; saveSettings(); renderSetup(); });
  el.btnTimePlus.addEventListener('click', () => { settings.timerMinutes = TIMER_OPTIONS[Math.min(TIMER_OPTIONS.length - 1, TIMER_OPTIONS.indexOf(settings.timerMinutes) + 1)]; saveSettings(); renderSetup(); });
  el.btnShuffleNames.addEventListener('click', () => { Kit.shuffleNames(el.namesGrid, settings.playerCount); Kit.toast('Orden mezclado 🔀'); });
  [['optAdvanced', 'advanced'], ['optReveal', 'reveal'], ['optSecretVote', 'secretVote']].forEach(([node, key]) => {
    el[node].addEventListener('change', () => { settings[key] = el[node].checked; saveSettings(); renderSetup(); });
  });
  Kit.bindPrefToggle(el.optSound, 'sound');
  Kit.bindPrefToggle(el.optVibrate, 'vibrate');
  el.btnStartGame.addEventListener('click', () => {
    saveSettings();
    try { history.pushState({ inGame: true }, ''); } catch (err) { /* sin historial */ }
    startLocalGame();
  });
  el.btnExit.addEventListener('click', () => {
    if (!game || window.confirm('¿Salir de la partida? Se perderá la partida en curso.')) backToSetup();
  });
  window.addEventListener('popstate', () => {
    if (!game) return;
    if (window.confirm('¿Salir de la partida? Se perderá la partida en curso.')) backToSetup();
    else { try { history.pushState({ inGame: true }, ''); } catch (err) { /* sin historial */ } }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  cacheDom();
  loadSettings();
  bindEvents();
  renderSetup();
  Kit.showScreen('setup');
});
