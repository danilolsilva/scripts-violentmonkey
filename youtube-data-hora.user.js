// ==UserScript==
// @name         YouTube – data e hora exatas nos cards
// @namespace    local.youtube-data-hora
// @version      1.0.1
// @description  Mostra a data e a hora exatas nos cards de vídeo do YouTube: início → fim das lives ("Transmitido há X") e data/hora de publicação dos vídeos comuns.
// @homepageURL  https://github.com/danilolsilva/scripts-violentmonkey
// @supportURL   https://github.com/danilolsilva/scripts-violentmonkey/issues
// @updateURL    https://raw.githubusercontent.com/danilolsilva/scripts-violentmonkey/main/youtube-data-hora.user.js
// @downloadURL  https://raw.githubusercontent.com/danilolsilva/scripts-violentmonkey/main/youtube-data-hora.user.js
// @match        https://www.youtube.com/*
// @exclude      https://www.youtube.com/live_chat*
// @exclude      https://www.youtube.com/embed/*
// @noframes
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(() => {
  'use strict';

  // ---------------- Configuração ----------------
  const MAX_PARALELO = 4;   // consultas simultâneas ao YouTube
  const MARGEM_PX = 800;    // busca a data dos cards até essa distância da área visível
  const MAX_CACHE = 5000;   // quantos vídeos ficam guardados no armazenamento do script
  const LOG = '[yt-data-hora]';

  // Tipos de card suportados.
  const CARD_SEL = [
    'yt-lockup-view-model',       // layout novo: abas do canal (Vídeos / Ao vivo), início, barra lateral
    'ytd-video-renderer',         // resultados de busca
    'ytd-grid-video-renderer',    // layouts antigos
    'ytd-compact-video-renderer',
    'ytd-rich-grid-media',
  ].join(',');

  const W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const ID_RE = /^[\w-]{11}$/;
  const SO_DATA_RE = /^\d{4}-\d{2}-\d{2}$/;

  // ---------------- Cache ----------------
  // Em memória: tudo (inclusive lives em andamento/agendadas).
  // No armazenamento do script: só vídeos cuja data não muda mais.
  const mem = new Map();
  let disk = {};
  try { disk = GM_getValue('cache', {}) || {}; } catch (e) { /* sem armazenamento: só memória */ }

  function getInfo(id) {
    if (mem.has(id)) return mem.get(id);
    const d = disk[id];
    if (!d) return null;
    const info = { s: d[0] || null, e: d[1] || null, p: d[2] || null, live: false, up: false };
    mem.set(id, info);
    return info;
  }

  let saveTimer = 0;
  function setInfo(id, info) {
    mem.set(id, info);
    if (info.live || info.up) return;
    disk[id] = [info.s, info.e, info.p, Date.now()];
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const keys = Object.keys(disk);
      if (keys.length > MAX_CACHE) {
        keys.sort((a, b) => disk[a][3] - disk[b][3]);
        for (const k of keys.slice(0, keys.length - Math.floor(MAX_CACHE * 0.8))) delete disk[k];
      }
      try { GM_setValue('cache', disk); } catch (e) { /* ignora */ }
    }, 2000);
  }

  // ---------------- Consulta ao YouTube ----------------
  let fallbackContext = null;
  function innertubeContext() {
    try {
      const c = W.ytcfg && W.ytcfg.get && W.ytcfg.get('INNERTUBE_CONTEXT');
      if (c && c.client) return c;
    } catch (e) { /* script isolado da página: usa o plano B */ }
    if (!fallbackContext) {
      let ver = '2.20250101.00.00';
      for (const s of document.scripts) {
        const m = s.textContent.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/);
        if (m) { ver = m[1]; break; }
      }
      fallbackContext = { client: { clientName: 'WEB', clientVersion: ver, hl: 'pt', gl: 'BR' } };
    }
    return fallbackContext;
  }

  async function fetchInfo(id) {
    let mf = null, vd = null;
    try {
      // Mesma API interna que o player usa (~10 KB). Só lê os metadados; nada é reproduzido.
      const r = await fetch('/youtubei/v1/player?prettyPrint=false', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: innertubeContext(), videoId: id }),
      });
      if (r.ok) {
        const j = await r.json();
        mf = (j && j.microformat && j.microformat.playerMicroformatRenderer) || null;
        vd = (j && j.videoDetails) || null;
      }
    } catch (e) { /* tenta o plano B */ }

    let lb = (mf && mf.liveBroadcastDetails) || null;
    let pub = (mf && (mf.publishDate || mf.uploadDate)) || null;

    if (!lb && !pub) {
      // Plano B: HTML da página do vídeo (bem mais pesado, ~1,5 MB).
      const r = await fetch('/watch?v=' + id, { credentials: 'same-origin' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const h = await r.text();
      const m = h.match(/"liveBroadcastDetails":(\{[^{}]*\})/);
      if (m) { try { lb = JSON.parse(m[1]); } catch (e) { /* ignora */ } }
      const p = h.match(/"publishDate":"([^"]+)"/) || h.match(/"uploadDate":"([^"]+)"/);
      pub = p ? p[1] : null;
      if (!lb && !pub) throw new Error('data não encontrada');
    }

    const s = (lb && lb.startTimestamp) || null;
    const e = (lb && lb.endTimestamp) || null;
    const live = !!(lb && lb.isLiveNow);
    const up = !live && (!!(vd && vd.isUpcoming) || (!!s && !e && Date.parse(s) > Date.now()));
    return { s, e, p: pub, live, up };
  }

  // Fila com limite de requisições simultâneas.
  const queue = [];
  const queued = new Set();
  const failedAt = new Map();
  let active = 0;

  function request(id) {
    if (mem.has(id) || queued.has(id)) return;
    const f = failedAt.get(id);
    if (f && Date.now() - f < 60000) return; // espera 1 min antes de tentar de novo
    queued.add(id);
    queue.push(id);
    pump();
  }

  function pump() {
    while (active < MAX_PARALELO && queue.length) {
      const id = queue.shift();
      active++;
      fetchInfo(id)
        .then((info) => { failedAt.delete(id); setInfo(id, info); })
        .catch((err) => { failedAt.set(id, Date.now()); console.debug(LOG, id, err); })
        .finally(() => { active--; queued.delete(id); scheduleScan(); pump(); });
    }
  }

  // ---------------- Formatação (fuso horário do seu computador) ----------------
  const p2 = (n) => String(n).padStart(2, '0');
  const dma = (d) => `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`;
  const hm = (d) => `${p2(d.getHours())}:${p2(d.getMinutes())}`;
  const completo = (d) => d.toLocaleString('pt-BR', {
    weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const toDate = (iso) => {
    if (!iso) return null;
    const d = new Date(iso);
    return isNaN(d) ? null : d;
  };

  function describe(info) {
    const S = toDate(info.s);
    const E = toDate(info.e);
    const P = info.p && !SO_DATA_RE.test(info.p) ? toDate(info.p) : null;
    const tip = [];
    let text = null;

    if (S && info.up) {
      text = `Agendada: ${dma(S)} ${hm(S)}`;
      tip.push('Início agendado: ' + completo(S));
    } else if (S && info.live) {
      text = `Ao vivo desde ${dma(S)} ${hm(S)}`;
      tip.push('Início da transmissão: ' + completo(S));
    } else if (S) {
      text = `${dma(S)} ${hm(S)}`;
      tip.push('Início da transmissão: ' + completo(S));
      if (E) {
        const mesmoDia = S.toDateString() === E.toDateString();
        text += ' → ' + (mesmoDia ? hm(E) : `${dma(E).slice(0, 5)} ${hm(E)}`);
        tip.push('Fim da transmissão: ' + completo(E));
      }
    } else if (P) {
      text = `${dma(P)} ${hm(P)}`;
    } else if (info.p && SO_DATA_RE.test(info.p)) {
      const [y, m, d] = info.p.split('-');
      text = `${d}/${m}/${y}`;
    }

    if (P) tip.push('Publicado: ' + completo(P));
    return text ? { text, tip: tip.join('\n') } : null;
  }

  // ---------------- DOM ----------------
  function videoId(card) {
    const isLockup = card.localName === 'yt-lockup-view-model';
    if (isLockup) {
      const host = card.querySelector('[class*="content-id-"]');
      if (host) {
        for (const c of host.classList) {
          if (c.startsWith('content-id-')) {
            const id = c.slice(11);
            return ID_RE.test(id) ? id : null; // playlists e mixes têm IDs longos: ignora
          }
        }
      }
    }
    const a = card.querySelector('a#thumbnail[href], a#video-title[href], a#video-title-link[href], a[href^="/watch?v="]');
    const href = a && a.getAttribute('href');
    if (!href || !href.startsWith('/watch')) return null;
    const u = new URL(href, location.origin);
    if (isLockup && u.searchParams.has('list')) return null;
    const v = u.searchParams.get('v');
    return v && ID_RE.test(v) ? v : null;
  }

  // A linha de metadados já mostra uma data completa (dd/mm/aaaa)? Isso acontece quando
  // outra extensão/script já troca o "há X" pela data — aí não duplicamos.
  const DATA_VISIVEL_RE = /\d{1,2}\/\d{1,2}\/\d{4}/;
  function jaMostraData(container) {
    for (const el of container.children) {
      if (!el.classList.contains('ytdt-line') && DATA_VISIVEL_RE.test(el.textContent)) return true;
    }
    return false;
  }

  // Layout novo: o bloco "▷ 92 · Transmitido há 2 anos".
  // Layout antigo (busca): a linha "visualizações • há X".
  const metaContainer = (card) => card.querySelector(
    card.localName === 'yt-lockup-view-model' ? 'yt-content-metadata-view-model' : '#metadata-line');

  function render(card, container, line, id, info) {
    const d = describe(info);
    if (!d) { if (line) line.remove(); return; }
    if (line && line.dataset.vid === id && line.textContent === d.text) return;
    if (line) line.remove();

    if (card.localName === 'yt-lockup-view-model') {
      // Nova linha logo abaixo de "▷ 92 · Transmitido há 2 anos", com o mesmo estilo.
      line = document.createElement('div');
      line.className = 'ytContentMetadataViewModelMetadataRow ytdt-line';
      const span = document.createElement('span');
      span.className = 'ytAttributedStringHost ytContentMetadataViewModelMetadataText';
      span.textContent = d.text;
      line.append(span);
    } else {
      // Mais um item na linha, separado por "•" pelo próprio CSS do YouTube.
      line = document.createElement('span');
      line.className = 'inline-metadata-item style-scope ytd-video-meta-block ytdt-line';
      line.textContent = d.text;
    }
    line.dataset.vid = id;
    line.title = d.tip;
    container.append(line);
  }

  function processCard(card) {
    const old = card.querySelector('.ytdt-line');
    const id = videoId(card);
    const container = metaContainer(card);
    if (!id || !container || jaMostraData(container)) { if (old) old.remove(); return; }
    const info = getInfo(id);
    if (info) { render(card, container, old, id, info); return; }
    if (old && old.dataset.vid !== id) old.remove(); // card reaproveitado para outro vídeo
    if (nearView.has(card)) request(id);
  }

  // Só busca a data dos cards que estão (ou estão quase) na tela.
  const nearView = new WeakSet();
  const observed = new WeakSet();
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (en.isIntersecting) { nearView.add(en.target); processCard(en.target); }
      else nearView.delete(en.target);
    }
  }, { rootMargin: `${MARGEM_PX}px 0px` });

  function scan() {
    for (const card of document.querySelectorAll(CARD_SEL)) {
      if (!observed.has(card)) { observed.add(card); io.observe(card); }
      processCard(card);
    }
  }

  let scanPending = false;
  function scheduleScan() {
    if (scanPending) return;
    scanPending = true;
    setTimeout(() => { scanPending = false; scan(); }, 250);
  }

  // O YouTube troca o conteúdo sem recarregar a página: observa as mudanças.
  new MutationObserver(scheduleScan).observe(document.documentElement, {
    childList: true, subtree: true, characterData: true,
    attributes: true, attributeFilter: ['href'],
  });
  document.addEventListener('yt-navigate-finish', scheduleScan);
  scan();
})();
