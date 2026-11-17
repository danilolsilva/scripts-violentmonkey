// ==UserScript==
// @name         YouTube: desativar atalho "/"
// @namespace    Violentmonkey Scripts
// @version      1.0.1
// @description  Desativa o atalho "/" do YouTube, que joga o foco para a caixa de pesquisa.
// @homepageURL  https://github.com/danilolsilva/scripts-violentmonkey
// @supportURL   https://github.com/danilolsilva/scripts-violentmonkey/issues
// @updateURL    https://raw.githubusercontent.com/danilolsilva/scripts-violentmonkey/main/youtube-desativar-atalho-pesquisa.user.js
// @downloadURL  https://raw.githubusercontent.com/danilolsilva/scripts-violentmonkey/main/youtube-desativar-atalho-pesquisa.user.js
// @match        https://www.youtube.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

window.addEventListener('keydown', e => {
  if (e.key === '/') {
    e.stopImmediatePropagation();
    console.log('bloqueado `/`');
  }
}, true);
