'use strict';

/* =========================================================================
   Mesa — modo «Mismo móvil» de los juegos de fiesta por fases.
   Es el mismo archivo en El campanario, Noche de estacas, El ritual,
   El presidente y la bomba y El club clandestino.

   El juego pinta cada fase con la MISMA función que usa en la sala
   (render(ctx)), así que los dos modos se ven igual:
   - En las fases secretas (reparto, noche, elegir sala…) el móvil pasa
     por orden: «Pasa el móvil a Ana» → «Soy Ana» → lo suyo → «Listo».
   - En las fases públicas (amanecer, debate, recuento…) se pinta la vista
     de todos (me = -1, host = true).

   El juego da (engine):
     act(g, i, a, host) → null | { timer? }     (como en la sala)
     advance(g)          → cierra la fase secreta cuando ya han pasado todos
     privateTurn(g)      → null | { key, order: [i], done(g, i) }
     render(ctx), card(g, i, names), title(g)
     openVote(g)         → opcional: null | { targets: [i], allowNone, onDone({ votes, none }) }
     fx(g)               → opcional: 'win' | 'lose' | null al cambiar de fase
   ========================================================================= */

const Mesa = (() => {
  let L = null;
  const RING = 2 * Math.PI * 54;

  const esc = (s) => Kit.esc(s == null ? '' : s);

  function holdHtml(prompt) {
    return '<button type="button" id="mesa-hold" class="hold-card"><span class="hold-inner"><span class="hold-face hold-front">' +
      `<span class="hold-icon" aria-hidden="true">👆</span><span class="hold-prompt">${esc(prompt || 'Mantén pulsado para ver tu papel')}</span>` +
      '<span class="hold-sub">Suelta para ocultarlo</span></span><span class="hold-face hold-back" id="mesa-role"></span></span></button>';
  }

  function timerHtml() {
    return '<div class="timer-block"><div class="timer-ring"><svg viewBox="0 0 120 120" aria-hidden="true">' +
      '<circle class="ring-bg" cx="60" cy="60" r="54"/><circle class="ring-fg" id="mesa-ring" cx="60" cy="60" r="54"/></svg>' +
      '<span class="timer-display" id="mesa-timer" role="timer"></span></div><div class="timer-controls">' +
      `<button type="button" class="btn btn-ghost" data-mesa-timer="-">−${L.step}s</button>` +
      '<button type="button" class="btn btn-ghost" id="mesa-timer-toggle">Pausar</button>' +
      `<button type="button" class="btn btn-ghost" data-mesa-timer="+">+${L.step}s</button></div></div>`;
  }

  function ctx(me, host) {
    return {
      g: L.game, me, host, names: L.names, esc, hostName: 'quien tenga el móvil', local: true,
      timer: L.secs ? timerHtml() : '', card: holdHtml(L.holdPrompt)
    };
  }

  /**
   * opts: { root, titleEl, engine, game, names, secretVote, holdPrompt, timerStep,
   *         onAgain(), onSetup() }
   */
  function start(opts) {
    stop();
    L = Object.assign({ step: 30, turnKey: null, pos: 0, unlocked: false, order: [], secs: 0, phase: '' }, opts);
    L.step = opts.timerStep || 30;
    render();
  }

  function stop() {
    if (L && L.timer) L.timer.stop();
    L = null;
  }

  function render() {
    if (!L) return;
    const e = L.engine;
    const g = L.game;
    if (L.titleEl) L.titleEl.textContent = e.title(g);
    const pt = e.privateTurn(g);
    if (pt && pt.key !== L.turnKey) {
      L.turnKey = pt.key;
      L.pos = 0;
      L.unlocked = false;
      L.order = pt.order.slice();
    }
    let html;
    let vote = null;
    if (pt && L.pos < L.order.length) {
      const i = L.order[L.pos];
      const last = L.pos === L.order.length - 1;
      if (!L.unlocked) {
        html = `<ol class="progress-dots" aria-hidden="true">${L.order.map((_, k) => `<li class="${k < L.pos ? 'is-done' : k === L.pos ? 'is-current' : ''}"></li>`).join('')}</ol>` +
          (pt.intro ? `<p class="screen-help">${pt.intro}</p>` : '') +
          `<p class="reveal-pass">Pasa el móvil a</p><h2 class="reveal-player">${esc(L.names[i])}</h2>` +
          '<p class="reveal-warning">🤫 Que nadie más mire la pantalla</p>' +
          `<button type="button" class="btn btn-primary btn-large" id="mesa-unlock">Soy ${esc(L.names[i])}</button>`;
      } else {
        html = e.render(ctx(i, false));
        if (pt.done(g, i)) {
          html += `<button type="button" class="btn btn-secondary btn-large" id="mesa-pass">${last ? (pt.lastLabel || 'Listo') : 'Listo, pasa el móvil'}</button>`;
        }
      }
    } else {
      vote = !L.secretVote && e.openVote ? e.openVote(g) : null;
      html = e.render(Object.assign(ctx(-1, true), { openVote: Boolean(vote) }));
      if (vote) html += '<div class="vote-area" id="mesa-vote"></div>';
    }
    const key = `${pt ? pt.key : 'pub'}-${e.phaseKey(g)}`;
    if (key !== L.phase) {
      const fx = e.fx ? e.fx(g) : null;
      if (fx === 'win') { Kit.sfx.win(); Kit.confetti(); }
      else if (fx === 'lose') Kit.sfx.lose();
      else if (L.phase) Kit.sfx.reveal();
      L.phase = key;
    }
    L.root.innerHTML = `<div class="center-wrap sala-wrap">${html}</div>`;
    bind(vote);
  }

  function doAct(a) {
    const g = L.game;
    const pt = L.engine.privateTurn(g);
    const inTurn = pt && L.pos < L.order.length && L.unlocked;
    const i = inTurn ? L.order[L.pos] : -1;
    const res = L.engine.act(g, i, a, !inTurn);
    if (!res) return;
    Kit.sfx.tap();
    Kit.buzz(15);
    if ('timer' in res) setTimer(res.timer);
    render();
  }

  function setTimer(s) {
    if (L.timer) L.timer.stop();
    L.timer = null;
    L.secs = s || 0;
    L.left = s || 0;
  }

  function bind(vote) {
    const root = L.root;
    root.querySelectorAll('[data-act]').forEach((b) => {
      b.onclick = () => {
        let a;
        try { a = JSON.parse(b.dataset.act); } catch (err) { return; }
        doAct(a);
      };
    });
    root.querySelectorAll('[data-sala]').forEach((b) => {
      b.onclick = () => {
        const k = b.dataset.sala;
        Kit.sfx.tap();
        if (k === 'again' && L.onAgain) L.onAgain();
        else if (k === 'lobby' && L.onSetup) L.onSetup();
      };
    });
    const unlock = document.getElementById('mesa-unlock');
    if (unlock) unlock.onclick = () => { L.unlocked = true; Kit.sfx.tap(); render(); };
    const pass = document.getElementById('mesa-pass');
    if (pass) {
      pass.onclick = () => {
        L.pos += 1;
        L.unlocked = false;
        if (L.pos >= L.order.length) {
          const res = L.engine.advance(L.game);
          if (res && 'timer' in res) setTimer(res.timer);
        }
        Kit.sfx.tap();
        render();
      };
    }
    const hold = document.getElementById('mesa-hold');
    if (hold) {
      const back = document.getElementById('mesa-role');
      Kit.bindHold(hold, () => {
        const c = L.engine.card(L.game, L.order[L.pos], L.names);
        if (!c) return;
        back.classList.toggle('is-alert', Boolean(c.alert));
        back.innerHTML = `<span class="role-category-label">${esc(c.label || '')}</span><span class="role-emoji" aria-hidden="true">${esc(c.emoji || '')}</span>` +
          `<span class="role-content${c.impostor ? ' is-impostor' : ''}">${esc(c.content || '')}</span><span class="role-extra">${c.extra || ''}</span>`;
        hold.classList.add('is-held');
        Kit.buzz(20);
      }, () => {
        hold.classList.remove('is-held');
        setTimeout(() => { if (!hold.classList.contains('is-held')) back.innerHTML = ''; }, 300);
      });
    }
    const disp = document.getElementById('mesa-timer');
    if (disp && L.secs) {
      const keep = L.timer ? L.timer.seconds : L.left;
      if (L.timer) L.timer.stop();
      L.timer = Kit.createTimer({
        display: disp,
        ring: document.getElementById('mesa-ring'),
        toggleBtn: document.getElementById('mesa-timer-toggle'),
        onEnd: () => Kit.toast('⏰ ¡Se acabó el tiempo!')
      });
      L.timer.start(L.secs);
      if (keep !== L.secs) L.timer.adjust(keep - L.secs);
      document.getElementById('mesa-timer-toggle').onclick = () => L.timer.toggle();
      root.querySelectorAll('[data-mesa-timer]').forEach((b) => {
        b.onclick = () => L.timer.adjust(b.dataset.mesaTimer === '+' ? L.step : -L.step);
      });
    } else if (L.timer) {
      L.left = L.timer.seconds;
      L.timer.stop();
      L.timer = null;
    }
    if (vote) {
      Kit.runVote(document.getElementById('mesa-vote'), {
        names: vote.targets.map((k) => L.names[k]),
        secret: false,
        allowNone: Boolean(vote.allowNone),
        noneLabel: vote.noneLabel || '🙅 Nadie',
        onDone: ({ votes, none }) => {
          const counts = {};
          votes.forEach((c, j) => { if (c) counts[vote.targets[j]] = c; });
          vote.onDone({ counts, none });
          render();
        }
      });
    }
  }

  /** Para la sala: tras cada acción válida, cierra la fase si ya han actuado todos. */
  function autoAct(engine) {
    return (g, i, a, host) => {
      const res = engine.act(g, i, a, host);
      if (!res) return null;
      const pt = engine.privateTurn(g);
      if (pt && pt.order.every((k) => pt.done(g, k))) {
        const more = engine.advance(g);
        if (more && 'timer' in more) return Object.assign({}, res, { timer: more.timer });
      }
      return res;
    };
  }

  return { start, stop, render, autoAct, isOn: () => Boolean(L), RING };
})();
