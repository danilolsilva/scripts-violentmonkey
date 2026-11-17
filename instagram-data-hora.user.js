// ==UserScript==
// @name         Instagram – data e hora exatas nas postagens
// @namespace    local.instagram-data-hora
// @version      2.0.1
// @description  Acrescenta a data e a hora exatas ao "3 h", "2 sem." etc. das postagens e comentários do Instagram ("15 h · 16/11/2026 23:56") e mostra a data de publicação também na aba Reels.
// @homepageURL  https://github.com/danilolsilva/scripts-violentmonkey
// @supportURL   https://github.com/danilolsilva/scripts-violentmonkey/issues
// @updateURL    https://raw.githubusercontent.com/danilolsilva/scripts-violentmonkey/main/instagram-data-hora.user.js
// @downloadURL  https://raw.githubusercontent.com/danilolsilva/scripts-violentmonkey/main/instagram-data-hora.user.js
// @match        https://www.instagram.com/*
// @noframes
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const SEP = ' · ';
  const p2 = (n) => String(n).padStart(2, '0');
  const curto = (d) => `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
  const completo = (d) => d.toLocaleString('pt-BR', {
    weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });

  // =====================================================================
  // 1) Feed, posts e comentários
  // O Instagram já entrega o horário exato em <time datetime="2026-11-17T15:01:05.000Z">3 h</time>;
  // só não mostra. O texto dele é mantido e a data exata vem depois, no fuso do seu computador.
  // =====================================================================
  const NOSSO_SUFIXO_RE = / · \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/;

  function fix(t) {
    const iso = t.getAttribute('datetime');
    if (!iso) return;
    const d = new Date(iso);
    if (isNaN(d)) return;
    // Só mexe no formato esperado (um único nó de texto), para não brigar com o React do Instagram.
    const node = t.firstChild;
    if (t.childNodes.length !== 1 || node.nodeType !== Node.TEXT_NODE) return;
    const atual = node.data;
    const m = atual.match(NOSSO_SUFIXO_RE);
    const relativo = (m ? atual.slice(0, m.index) : atual).trim(); // texto original do Instagram
    const txt = relativo ? relativo + SEP + curto(d) : curto(d);
    if (atual === txt) return;
    node.data = txt;
    t.title = completo(d);
    t.style.whiteSpace = 'nowrap';
  }

  function scan() {
    for (const t of document.querySelectorAll('time[datetime]')) fix(t);
  }

  let pending = false;
  const scheduleScan = () => {
    if (pending) return;
    pending = true;
    setTimeout(() => { pending = false; scan(); }, 200);
  };

  // O Instagram troca o conteúdo sem recarregar a página (e reaproveita elementos).
  new MutationObserver(scheduleScan).observe(document.documentElement, {
    childList: true, subtree: true, characterData: true,
    attributes: true, attributeFilter: ['datetime'],
  });
  scan();

  // =====================================================================
  // 2) Aba Reels (/reels/CODIGO/)
  // Lá o Instagram não mostra data nenhuma. O código do reel ativo está na URL; a data de
  // publicação vem da mesma API interna que o site usa (1 consulta por reel, guardada em memória).
  // =====================================================================
  const IG_APP_ID = '936619743392459'; // identificador público do Instagram Web, enviado pelo próprio site
  const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const PERFIL_RE = /^\/[^/]+\/(reels\/)?$/;

  const shortcodeParaId = (code) => {
    let id = 0n;
    for (const c of code.slice(0, 11)) id = id * 64n + BigInt(ALFABETO.indexOf(c));
    return id.toString();
  };

  function relativoDe(d) {
    const min = (Date.now() - d) / 60000;
    if (min < 1) return 'agora';
    if (min < 60) return `${Math.floor(min)} min`;
    const h = min / 60;
    if (h < 24) return `${Math.floor(h)} h`;
    const dias = h / 24;
    if (dias < 7) return `${Math.floor(dias)} d`;
    if (dias < 365) return `${Math.floor(dias / 7)} sem`;
    const anos = Math.floor(dias / 365);
    return `${anos} ${anos === 1 ? 'ano' : 'anos'}`;
  }

  const reelData = new Map();   // código -> Date
  const reelBuscando = new Set();
  const reelFalhou = new Map(); // código -> horário da falha (espera 1 min para tentar de novo)

  async function buscarDataDoReel(code) {
    const r = await fetch(`/api/v1/media/${shortcodeParaId(code)}/info/`, {
      credentials: 'include',
      headers: { 'X-IG-App-ID': IG_APP_ID, 'X-Requested-With': 'XMLHttpRequest' },
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const it = j && j.items && j.items[0];
    if (!it || !it.taken_at) throw new Error('sem data');
    return new Date(it.taken_at * 1000);
  }

  // O reel ativo é o vídeo que está (quase) inteiro na tela.
  function videoAtivo() {
    let best = null, bestVis = 0;
    for (const v of document.querySelectorAll('video')) {
      const r = v.getBoundingClientRect();
      if (r.height < 100) continue;
      const vis = (Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)) / r.height;
      if (vis > bestVis) { bestVis = vis; best = v; }
    }
    return bestVis >= 0.9 ? best : null; // durante a rolagem, espera assentar
  }

  function tickReels() {
    const m = location.pathname.match(/^\/reels\/([\w-]+)/);
    if (!m) return;
    const code = m[1];
    const video = videoAtivo();
    if (!video) return;

    // Sobe até o bloco do reel: o primeiro ancestral que tem o link do autor.
    let item = video, autor = null;
    for (let i = 0; i < 30 && !autor; i++) {
      item = item.parentElement;
      if (!item) return;
      autor = [...item.querySelectorAll('a[href]')].find((a) => PERFIL_RE.test(a.getAttribute('href')) && a.textContent.trim());
    }
    if (!autor || item.querySelectorAll('video').length !== 1) return;

    // A data entra na coluna do nome do autor, logo abaixo do nome.
    let col = autor.parentElement;
    while (col && col !== item && getComputedStyle(col).flexDirection !== 'column') col = col.parentElement;
    if (!col || col === item) return;

    let line = col.querySelector(':scope > .igdt-reel');
    if (line && line.dataset.code === code && line.textContent !== '…') return; // já está certo

    const d = reelData.get(code);
    if (!d) {
      const f = reelFalhou.get(code);
      if (f && Date.now() - f < 60000) { if (line) line.remove(); return; }
    }
    if (!line) {
      line = document.createElement('div');
      line.className = 'igdt-reel';
      Object.assign(line.style, {
        color: 'rgb(var(--ig-secondary-text, 168, 168, 168))', fontSize: '12px', lineHeight: '16px',
        marginTop: '2px', whiteSpace: 'nowrap',
      });
      col.append(line);
    }
    line.dataset.code = code;

    if (d) {
      line.textContent = relativoDe(d) + SEP + curto(d);
      line.title = completo(d);
      return;
    }
    line.textContent = '…';
    line.title = '';
    if (reelBuscando.has(code)) return;
    reelBuscando.add(code);
    buscarDataDoReel(code)
      .then((data) => {
        reelData.set(code, data);
        for (const l of document.querySelectorAll('.igdt-reel')) {
          if (l.dataset.code === code) { l.textContent = relativoDe(data) + SEP + curto(data); l.title = completo(data); }
        }
      })
      .catch((err) => {
        reelFalhou.set(code, Date.now());
        console.debug('[ig-data-hora]', code, err);
        for (const l of document.querySelectorAll('.igdt-reel')) if (l.dataset.code === code) l.remove();
      })
      .finally(() => { reelBuscando.delete(code); });
  }

  setInterval(tickReels, 500);
})();
