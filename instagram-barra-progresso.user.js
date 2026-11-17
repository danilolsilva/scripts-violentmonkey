// ==UserScript==
// @name         Instagram – barra de progresso nos vídeos
// @namespace    local.instagram-barra-progresso
// @version      1.0.1
// @description  Mostra uma barra de progresso clicável e arrastável nos vídeos do Instagram (feed, posts e Reels), com tempo atual e duração.
// @homepageURL  https://github.com/danilolsilva/scripts-violentmonkey
// @supportURL   https://github.com/danilolsilva/scripts-violentmonkey/issues
// @updateURL    https://raw.githubusercontent.com/danilolsilva/scripts-violentmonkey/main/instagram-barra-progresso.user.js
// @downloadURL  https://raw.githubusercontent.com/danilolsilva/scripts-violentmonkey/main/instagram-barra-progresso.user.js
// @match        https://www.instagram.com/*
// @noframes
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  // ---------------- Configuração ----------------
  const AREA_PX = 12;          // altura da faixa clicável na base do vídeo (o botão de som fica logo acima)
  const BARRA_PX = 3;          // espessura da barra parada
  const BARRA_HOVER_PX = 6;    // espessura com o mouse em cima
  const COR = '#ffffff';

  // Todo o estilo é aplicado via element.style (não depende da CSP do Instagram).
  const css = (el, props) => { Object.assign(el.style, props); return el; };
  const div = (props) => css(document.createElement('div'), props);

  const p2 = (n) => String(n).padStart(2, '0');
  const fmt = (sec) => {
    const s = Math.max(0, Math.floor(sec || 0));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return h ? `${h}:${p2(m)}:${p2(x)}` : `${m}:${p2(x)}`;
  };

  // Maior elemento posicionado que tem exatamente o tamanho do vídeo. É ele que
  // contém as camadas transparentes do Instagram por cima do vídeo; a barra
  // entra ali como último filho, acima delas.
  function findContainer(video) {
    const vr = video.getBoundingClientRect();
    if (vr.width < 80 || vr.height < 80) return null;
    let best = null;
    for (let e = video.parentElement, i = 0; e && e !== document.body && i < 25; e = e.parentElement, i++) {
      const r = e.getBoundingClientRect();
      if (Math.abs(r.width - vr.width) > 2 || Math.abs(r.height - vr.height) > 2) break;
      if (getComputedStyle(e).position !== 'static') best = e;
    }
    return best;
  }

  const states = new Set();
  const byVideo = new WeakMap();

  function attach(video) {
    const container = findContainer(video);
    if (!container) return;

    const root = div({
      position: 'absolute', left: '0', right: '0', bottom: '0', height: AREA_PX + 'px',
      zIndex: '10', cursor: 'pointer', touchAction: 'none', userSelect: 'none',
    });
    root.className = 'igpb-barra';
    const track = div({
      position: 'absolute', left: '0', right: '0', bottom: '0', height: BARRA_PX + 'px',
      background: 'rgba(255,255,255,0.3)', transition: 'height .12s',
    });
    const buffered = div({ position: 'absolute', left: '0', top: '0', bottom: '0', width: '0', background: 'rgba(255,255,255,0.4)' });
    const played = div({ position: 'absolute', left: '0', top: '0', bottom: '0', width: '0', background: COR });
    const thumb = div({
      position: 'absolute', top: '50%', left: '0', width: '12px', height: '12px', borderRadius: '50%',
      background: COR, transform: 'translate(-50%, -50%) scale(0)', transition: 'transform .12s',
      boxShadow: '0 0 3px rgba(0,0,0,.5)',
    });
    const label = div({
      position: 'absolute', left: '8px', bottom: AREA_PX + 6 + 'px', padding: '2px 6px', borderRadius: '4px',
      background: 'rgba(0,0,0,0.65)', color: '#fff', font: '600 12px/16px system-ui, -apple-system, "Segoe UI", sans-serif',
      opacity: '0', transition: 'opacity .12s', pointerEvents: 'none', whiteSpace: 'nowrap',
    });
    const tip = div({
      position: 'absolute', left: '0', bottom: AREA_PX + 6 + 'px', padding: '2px 6px', borderRadius: '4px',
      background: 'rgba(0,0,0,0.8)', color: '#fff', font: '600 12px/16px system-ui, -apple-system, "Segoe UI", sans-serif',
      transform: 'translateX(-50%)', opacity: '0', transition: 'opacity .12s', pointerEvents: 'none', whiteSpace: 'nowrap',
    });
    track.append(buffered, played, thumb);
    root.append(track, label, tip);
    container.append(root);

    const st = { video, root, track, buffered, played, thumb, label, tip, hover: false, drag: false, dragFrac: null, lastSeek: 0, lastKey: '' };
    states.add(st);
    byVideo.set(video, st);

    const frac = (e) => {
      const r = root.getBoundingClientRect();
      return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    };
    const seek = (f, final) => {
      const d = video.duration;
      if (!isFinite(d) || d <= 0) return;
      st.dragFrac = f;
      const now = performance.now();
      if (final || now - st.lastSeek > 80) { video.currentTime = f * d; st.lastSeek = now; }
    };
    const showHover = (on) => {
      st.hover = on;
      track.style.height = (on ? BARRA_HOVER_PX : BARRA_PX) + 'px';
      thumb.style.transform = `translate(-50%, -50%) scale(${on ? 1 : 0})`;
      label.style.opacity = tip.style.opacity = on ? '1' : '0';
    };

    // Impede que o Instagram trate o clique (pausar, curtir com 2 cliques, abrir o post…).
    for (const t of ['click', 'dblclick', 'mousedown', 'mouseup', 'touchstart', 'touchmove', 'touchend']) {
      root.addEventListener(t, (e) => e.stopPropagation());
    }
    root.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      st.drag = true;
      try { root.setPointerCapture(e.pointerId); } catch (err) { /* ignora */ }
      seek(frac(e), false);
    });
    root.addEventListener('pointermove', (e) => {
      e.stopPropagation();
      const f = frac(e);
      const d = video.duration;
      if (isFinite(d)) {
        tip.textContent = fmt(f * d);
        tip.style.left = Math.min(Math.max(f * root.clientWidth, 24), root.clientWidth - 24) + 'px';
      }
      if (st.drag) seek(f, false);
    });
    const endDrag = (e) => {
      e.stopPropagation();
      if (!st.drag) return;
      st.drag = false;
      seek(frac(e), true);
      st.dragFrac = null;
      try { root.releasePointerCapture(e.pointerId); } catch (err) { /* ignora */ }
      if (!root.matches(':hover')) showHover(false);
    };
    root.addEventListener('pointerup', endDrag);
    root.addEventListener('pointercancel', endDrag);
    root.addEventListener('pointerenter', () => showHover(true));
    root.addEventListener('pointerleave', () => { if (!st.drag) showHover(false); });
  }

  function update(st) {
    const v = st.video;
    const d = v.duration;
    const ok = isFinite(d) && d > 0; // lives (duração infinita) ficam sem barra
    const ct = st.dragFrac != null ? st.dragFrac * d : v.currentTime;
    let bufEnd = 0;
    for (let i = 0; i < v.buffered.length; i++) {
      if (v.buffered.start(i) <= ct + 0.5) bufEnd = Math.max(bufEnd, v.buffered.end(i));
    }
    const key = `${ok}|${ct.toFixed(2)}|${bufEnd.toFixed(1)}|${st.hover}`;
    if (key === st.lastKey) return;
    st.lastKey = key;
    st.root.style.display = ok ? '' : 'none';
    if (!ok) return;
    const pct = Math.min(100, (ct / d) * 100);
    st.played.style.width = pct + '%';
    st.thumb.style.left = pct + '%';
    st.buffered.style.width = Math.min(100, (bufEnd / d) * 100) + '%';
    if (st.hover) st.label.textContent = `${fmt(ct)} / ${fmt(d)}`;
  }

  function loop() {
    for (const st of states) update(st);
    requestAnimationFrame(loop);
  }

  function scan() {
    for (const st of states) {
      if (!st.video.isConnected) { st.root.remove(); states.delete(st); byVideo.delete(st.video); }
      else if (!st.root.isConnected) { states.delete(st); byVideo.delete(st.video); } // o Instagram refez o layout
    }
    for (const v of document.querySelectorAll('video')) {
      if (!byVideo.has(v)) attach(v);
    }
  }

  let pending = false;
  const scheduleScan = () => {
    if (pending) return;
    pending = true;
    setTimeout(() => { pending = false; scan(); }, 300);
  };
  new MutationObserver(scheduleScan).observe(document.documentElement, { childList: true, subtree: true });
  // Vídeos que estavam escondidos (ex.: slides de carrossel) ganham a barra quando aparecem/tocam.
  document.addEventListener('loadedmetadata', scheduleScan, true);
  document.addEventListener('play', scheduleScan, true);
  window.addEventListener('resize', scheduleScan);
  scan();
  requestAnimationFrame(loop);
})();
