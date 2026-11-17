// ==UserScript==
// @name         Instagram – corrige posts que abrem invisíveis
// @namespace    local.instagram-posts-invisiveis
// @version      1.0.0
// @description  Impede que o bloqueador de anúncios esconda posts normais só porque algum comentário contém "Ad" (Adorei, Admiro…), "Patrocinado" ou "Sponsored".
// @homepageURL  https://github.com/danilolsilva/scripts-violentmonkey
// @supportURL   https://github.com/danilolsilva/scripts-violentmonkey/issues
// @updateURL    https://raw.githubusercontent.com/danilolsilva/scripts-violentmonkey/main/instagram-posts-invisiveis.user.js
// @downloadURL  https://raw.githubusercontent.com/danilolsilva/scripts-violentmonkey/main/instagram-posts-invisiveis.user.js
// @match        https://www.instagram.com/*
// @noframes
// @run-at       document-start
// @inject-into  page
// @grant        none
// ==/UserScript==

/*
 * O problema (investigado em 17/11/2026):
 *   Um filtro de bloqueador de anúncios esconde o bloco do post (o <div> filho do <article>, com
 *   `display: none !important`) sempre que QUALQUER texto dentro dele contém "Ad", "Patrocinado" ou
 *   "Sponsored", sem checar se é a palavra inteira. Um único comentário "Adoreiiii 😍" basta para o
 *   post abrir invisível (só o fundo escuro e o X). O bloqueador age no mesmo instante em que o post
 *   entra na página e, depois de esconder, não solta mais (recoloca o `display: none` em ~2 ms).
 *
 * A correção:
 *   O texto é corrigido ANTES de entrar na página: o script intercepta os métodos que o React do
 *   Instagram usa para inserir elementos e textos (appendChild, insertBefore, textContent, nodeValue…)
 *   e coloca um caractere invisível (U+2060, "word joiner") entre a 1ª e a 2ª letra dessas palavras:
 *   "A⁠dorei". Na tela nada muda, mas o filtro deixa de reconhecer a palavra.
 *   Texto que é SÓ o rótulo ("Ad", "Patrocinado", "Sponsored") não é tocado, então anúncios de
 *   verdade continuam bloqueados. Só mexe em texto dentro de posts (<article>) e janelas de post.
 *
 *   Efeito colateral: ao copiar um comentário com essas palavras, o caractere invisível vai junto.
 */
(() => {
  'use strict';

  const WJ = '⁠';
  const GATILHO = /Ad|Patrocinado|Sponsored/;
  const GATILHO_G = /Ad|Patrocinado|Sponsored/g;
  // Rótulo de anúncio de verdade (o texto é só a palavra, talvez com separadores): não mexe.
  const ROTULO = /^[\s·•|\-–—]*(Ad|Patrocinado|Sponsored)[\s·•|\-–—]*$/;
  const ONDE = 'article, [role="dialog"]';
  const NAO_MEXER = 'textarea, input, [contenteditable=""], [contenteditable="true"], script, style';

  const quebra = (t) => (GATILHO.test(t) && !ROTULO.test(t))
    ? t.replace(GATILHO_G, (w) => w[0] + WJ + w.slice(1))
    : t;
  const elDe = (n) => (n && n.nodeType === 1 ? n : n && n.parentElement) || null;
  const emPost = (el) => !!(el && el.closest(ONDE)) && !el.closest(NAO_MEXER);

  const dData = Object.getOwnPropertyDescriptor(CharacterData.prototype, 'data');
  const dNodeValue = Object.getOwnPropertyDescriptor(Node.prototype, 'nodeValue');
  const dTextContent = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
  const lerTexto = (t) => dData.get.call(t);
  const gravarTexto = (t, v) => dData.set.call(t, v);

  // Corrige os textos de `node` (e da subárvore dele) que vão ficar dentro de um post.
  // `pai` é onde o nó está entrando (pode ainda estar fora do documento).
  function corrige(node, pai) {
    if (!node) return;
    if (node.nodeType === 3) {
      const v = lerTexto(node);
      if (GATILHO.test(v) && emPost(elDe(pai) || node.parentElement)) gravarTexto(node, quebra(v));
      return;
    }
    if (node.nodeType !== 1 && node.nodeType !== 11) return;
    if (!GATILHO.test(dTextContent.get.call(node))) return; // atalho: nada a corrigir aqui
    const paiEmPost = emPost(elDe(pai));
    const w = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) {
      const t = w.currentNode;
      const v = lerTexto(t);
      if (!GATILHO.test(v)) continue;
      const p = t.parentElement;
      if (p && p.closest(NAO_MEXER)) continue;
      if (paiEmPost || (p && p.closest(ONDE))) gravarTexto(t, quebra(v));
    }
  }

  // 1) Inserções feitas por JavaScript (é assim que o React monta posts e comentários).
  for (const [proto, nome] of [[Node.prototype, 'appendChild'], [Node.prototype, 'insertBefore'], [Node.prototype, 'replaceChild']]) {
    const orig = proto[nome];
    proto[nome] = function (child, ...resto) {
      try { corrige(child, this); } catch (e) { /* nunca atrapalha a inserção */ }
      return orig.call(this, child, ...resto);
    };
  }

  // 2) Textos alterados em nós que já estão na página.
  const setterQueQuebra = (desc, contexto) => ({
    ...desc,
    set(v) {
      try { if (typeof v === 'string' && GATILHO.test(v) && emPost(contexto(this))) v = quebra(v); } catch (e) { /* ignora */ }
      desc.set.call(this, v);
    },
  });
  Object.defineProperty(CharacterData.prototype, 'data', setterQueQuebra(dData, (n) => n.parentElement));
  Object.defineProperty(Node.prototype, 'nodeValue', setterQueQuebra(dNodeValue, (n) => (n.nodeType === 3 ? n.parentElement : null)));
  Object.defineProperty(Node.prototype, 'textContent', setterQueQuebra(dTextContent, elDe));

  // 3) Rede de segurança para o que entrar por outros caminhos (HTML inicial, innerHTML…).
  new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) corrige(n, m.target);
  }).observe(document, { childList: true, subtree: true });
})();
