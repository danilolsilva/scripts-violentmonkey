// ==UserScript==
// @name         Futemax – sem pop-ups e abas novas
// @namespace    local.antipop
// @version      1.1.2
// @description  Bloqueia os pop-unders do Futemax e roda os players em iframe com sandbox (sem permissão para abrir abas nem redirecionar a página).
// @homepageURL  https://github.com/danilolsilva/scripts-violentmonkey
// @supportURL   https://github.com/danilolsilva/scripts-violentmonkey/issues
// @updateURL    https://raw.githubusercontent.com/danilolsilva/scripts-violentmonkey/main/futemax-antipopup.user.js
// @downloadURL  https://raw.githubusercontent.com/danilolsilva/scripts-violentmonkey/main/futemax-antipopup.user.js
// @match        http://*/*
// @match        https://*/*
// @run-at       document-start
// @inject-into  page
// @grant        none
// ==/UserScript==

/*
 * Por que o @match pega todos os sites: o script precisa rodar DENTRO dos iframes dos players
 * (domínios de terceiros que mudam o tempo todo). Ele sai na primeira linha se não
 * estiver no Futemax ou num iframe embutido no Futemax (checado via
 * location.ancestorOrigins, que existe no Chrome/Edge, no Safari e no Firefox 148+;
 * em navegador sem ele só a parte da página principal funciona e o sandbox fica desligado).
 * O @match é http/https (em vez de *://) porque o app Userscripts do iPhone só aceita esses.
 *
 * O que o site faz (mapeado em 14/11/2026):
 *  1. Script inline: no 1º clique em QUALQUER lugar chama window.open('https://bit.ly/brfutemax')
 *     (1x a cada 30 min, chave localStorage "brfutemax_pop_30min", só das 7h às 23h de Brasília)
 *     e 1,5 s depois injeta um pop-under de dv5vwlgir0hsc.cloudfront.net, que sequestra os
 *     cliques seguintes.
 *  2. Script inline: carrega acscdn.com/script/aclib.js e chama aclib.runPop() (pop-under).
 *  3. Os players (iframes de terceiros) carregam tags de anúncio próprias (llvpn.com,
 *     servetraff.com…) e checam se estão em sandbox via `document.domain = document.domain`,
 *     que no Chrome lança erro em qualquer iframe com sandbox.
 *
 * Como o script resolve:
 *  - Página: window.open vira no-op, scripts de anúncio não carregam e cada iframe nasce com
 *    sandbox SEM allow-popups/allow-top-navigation/allow-modals/allow-downloads (bloqueio
 *    garantido pelo próprio navegador, inclusive para iframes aninhados).
 *  - Dentro dos players: `document.domain = …` deixa de lançar erro (a checagem de sandbox passa)
 *    e as mesmas proteções de window.open/links/scripts são aplicadas.
 */
(() => {
  'use strict';

  /* ----------------------------- Configuração ----------------------------- */
  const CFG = {
    debug: true,           // loga no console (filtro "anti-pop") o que foi bloqueado
    sandboxIframes: true,  // players sem allow-popups / allow-top-navigation
    riskyOptions: 'mark',  // 'mark' = marca com ⚠ | 'hide' = esconde | 'off' = não mexe
  };

  const SITE = /(^|\.)futemax\.[a-z]{2,}(\.[a-z]{2,})?$/i;

  // Scripts de rede de anúncio vistos no site e nos players.
  const BLOCKED_SCRIPT_HOSTS = [
    'acscdn.com',                   // aclib.runPop() – pop-under
    'dv5vwlgir0hsc.cloudfront.net', // pop-under carregado depois do 1º clique
    'llvpn.com',                    // tag.min.js dos players
    'servetraff.com',
    'extancecompert.com',
  ];

  // Opções cujo player aninhado (dadinhodetapioca.fun) foi detectado pelo
  // Windows Defender como Trojan:JS/Cryxos.
  const RISKY_EMBED_HOSTS = ['rdcanais.org', 'esportesembed.cc'];

  // Sem allow-popups (abas novas), allow-top-navigation (redirecionar a página),
  // allow-modals (alert/confirm falsos) e allow-downloads.
  const SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-presentation';
  const STRIP_TOKENS = /^allow-(popups.*|top-navigation.*|modals|downloads.*)$/;
  const NEEDED_ALLOW = ['autoplay', 'encrypted-media', 'fullscreen', 'picture-in-picture'];

  /* --------------------- Onde estou? (sai cedo se não é aqui) --------------------- */
  const isTop = window === window.top;
  const hostOf = u => { try { return new URL(u).hostname; } catch { return ''; } };
  const canSeeAncestors = !!(location.ancestorOrigins && 'length' in location.ancestorOrigins);
  const insideSite = !isTop && canSeeAncestors &&
    Array.from(location.ancestorOrigins).some(o => SITE.test(hostOf(o)));
  if (isTop ? !SITE.test(location.hostname) : !insideSite) return;

  // Sem ancestorOrigins (Firefox < 148, por exemplo) não dá para desarmar a checagem de sandbox dos players,
  // então o sandbox fica desligado para não quebrar o vídeo.
  const useSandbox = CFG.sandboxIframes && canSeeAncestors;

  /* ------------------------------- Utilitários ------------------------------ */
  const where = isTop ? 'página' : `iframe ${location.hostname}`;
  const blocked = [];
  const log = (what, detail) => {
    blocked.push({ what, detail: String(detail ?? ''), at: new Date().toISOString() });
    if (CFG.debug) console.info(`[anti-pop] (${where})`, what, detail ?? '');
  };
  if (CFG.debug) window.__antiPop = blocked;

  const hostIn = (url, list) => {
    try {
      const h = new URL(String(url), location.href).hostname;
      return list.some(d => h === d || h.endsWith('.' + d));
    } catch { return false; }
  };

  const nativeSetAttr = Element.prototype.setAttribute;

  /* ------------- 0. Dentro do player: desarma a checagem de sandbox ------------- */
  if (!isTop) {
    const domain = Object.getOwnPropertyDescriptor(Document.prototype, 'domain');
    Object.defineProperty(Document.prototype, 'domain', {
      ...domain,
      set(v) {
        try { domain.set.call(this, v); } catch { /* "Assignment is forbidden for sandboxed iframes" */ }
      },
    });
  }

  /* ---------------- 1. Pop-up "caseiro" (bit.ly) + 2º anúncio ---------------- */
  // O script só abre se Date.now() - valorSalvo >= 30 min. Com um valor no futuro,
  // nunca abre e, por consequência, nunca carrega o pop-under do cloudfront.
  if (isTop) {
    try { localStorage.setItem('brfutemax_pop_30min', '8640000000000000'); } catch {}
    try {
      Object.defineProperty(window, 'secondAdLoaded', { value: true, writable: false, configurable: false });
    } catch {}
  }

  /* ------------------------------ 2. window.open ----------------------------- */
  const blockedOpen = function open(url) {
    log('window.open bloqueado', url);
    return null;
  };
  try {
    Object.defineProperty(window, 'open', { value: blockedOpen, writable: false, configurable: false });
  } catch {
    window.open = blockedOpen;
  }

  /* ------------- 3. Links/formulários abertos por script (não por você) ------------- */
  const opensElsewhere = el => {
    const t = (el.getAttribute('target') || '').toLowerCase();
    return !el.isConnected || (t !== '' && t !== '_self' && t !== '_top' && t !== '_parent');
  };

  const nativeAClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function click() {
    if (opensElsewhere(this)) { log('a.click() bloqueado', this.href); return; }
    return nativeAClick.call(this);
  };

  const nativeDispatch = EventTarget.prototype.dispatchEvent;
  EventTarget.prototype.dispatchEvent = function dispatchEvent(ev) {
    if (ev && ev.type === 'click' && this instanceof Element) {
      const a = this.closest('a[href]');
      if (a && opensElsewhere(a)) { log('clique sintético em link bloqueado', a.href); return false; }
    }
    return nativeDispatch.call(this, ev);
  };

  const nativeSubmit = HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit = function submit() {
    if (opensElsewhere(this)) { log('form.submit() bloqueado', this.action); return; }
    return nativeSubmit.call(this);
  };

  /* ----------------------- 4. Scripts de rede de anúncio ---------------------- */
  const scriptSrc = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
  Object.defineProperty(HTMLScriptElement.prototype, 'src', {
    ...scriptSrc,
    set(v) {
      if (hostIn(v, BLOCKED_SCRIPT_HOSTS)) { log('script bloqueado', v); return; }
      scriptSrc.set.call(this, v);
    },
  });

  /* ------------------------- 5. Iframes em sandbox ------------------------- */
  const sandbox = f => {
    if (!useSandbox) return;
    const cur = f.getAttribute('sandbox');
    const next = cur === null
      ? SANDBOX
      : cur.split(/\s+/).filter(t => t && !STRIP_TOKENS.test(t)).join(' ');
    if (cur !== next) {
      nativeSetAttr.call(f, 'sandbox', next);
      log('iframe em sandbox', f.getAttribute('src') || '(sem src)');
    }
    const allow = (f.getAttribute('allow') || '').split(';').map(s => s.trim()).filter(Boolean);
    const missing = NEEDED_ALLOW.filter(p => !allow.some(a => a.split(/\s+/)[0] === p));
    if (missing.length) nativeSetAttr.call(f, 'allow', allow.concat(missing).join('; '));
    f.allowFullscreen = true;
  };

  const iframeSrc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src');
  Object.defineProperty(HTMLIFrameElement.prototype, 'src', {
    ...iframeSrc,
    set(v) { sandbox(this); iframeSrc.set.call(this, v); },
  });

  Element.prototype.setAttribute = function setAttribute(name, value) {
    const n = String(name).toLowerCase();
    if (n === 'src' && this instanceof HTMLScriptElement && hostIn(value, BLOCKED_SCRIPT_HOSTS)) {
      log('script bloqueado', value);
      return;
    }
    if (this instanceof HTMLIFrameElement && (n === 'src' || n === 'srcdoc')) sandbox(this);
    if (this instanceof HTMLIFrameElement && n === 'sandbox') {
      nativeSetAttr.call(this, name, value);
      sandbox(this); // limpa allow-popups etc. se a página tentar liberar
      return;
    }
    return nativeSetAttr.call(this, name, value);
  };

  // Antes de inserir qualquer nó, coloca sandbox nos iframes que ele contém.
  // Vale também para o truque de criar um iframe about:blank e usar o
  // window.open "limpo" dele: o iframe nasce em sandbox e o pop-up é barrado.
  const prep = node => {
    if (!node || (node.nodeType !== 1 && node.nodeType !== 11)) return;
    if (node.nodeType === 1 && node.tagName === 'IFRAME') sandbox(node);
    node.querySelectorAll?.('iframe').forEach(sandbox);
  };
  const wrapInsert = (proto, name, argIdx) => {
    const orig = proto[name];
    if (typeof orig !== 'function') return;
    proto[name] = function (...args) {
      (argIdx == null ? args : [args[argIdx]]).forEach(prep);
      return orig.apply(this, args);
    };
  };
  wrapInsert(Node.prototype, 'appendChild', 0);
  wrapInsert(Node.prototype, 'insertBefore', 0);
  wrapInsert(Node.prototype, 'replaceChild', 0);
  ['append', 'prepend', 'before', 'after', 'replaceWith', 'replaceChildren']
    .forEach(m => wrapInsert(Element.prototype, m));
  wrapInsert(Element.prototype, 'insertAdjacentElement', 1);

  // Rede de segurança para iframes que vêm no HTML ou via innerHTML:
  // aplica o sandbox e recarrega o iframe (o sandbox só vale na próxima navegação).
  new MutationObserver(muts => {
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        const frames = n.tagName === 'IFRAME' ? [n] : n.querySelectorAll('iframe');
        for (const f of frames) {
          const before = f.getAttribute('sandbox');
          sandbox(f);
          const src = f.getAttribute('src');
          if (src && f.getAttribute('sandbox') !== before) iframeSrc.set.call(f, src);
        }
      }
    }
  }).observe(document, { childList: true, subtree: true });

  /* --------------- 6. Marca/esconde opções com player perigoso --------------- */
  if (isTop) {
    const markRisky = () => {
      if (CFG.riskyOptions === 'off') return;
      document.querySelectorAll('.btn-player [data-src]').forEach(btn => {
        if (!hostIn(btn.getAttribute('data-src'), RISKY_EMBED_HOSTS) || btn.dataset.antipop) return;
        btn.dataset.antipop = '1';
        if (CFG.riskyOptions === 'hide') { btn.style.display = 'none'; return; }
        btn.textContent = '⚠ ' + btn.textContent;
        btn.title = 'O player desta opção carrega um script detectado como malware (Trojan:JS/Cryxos).';
      });
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', markRisky, { once: true });
    } else {
      markRisky();
    }
  }
})();
