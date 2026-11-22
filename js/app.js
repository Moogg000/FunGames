/*
 * app.js — home page: renders the game library from js/manifest.js.
 *
 * Everything is generated at runtime, so adding an entry to the manifest is
 * all it takes to put a new game on the page.
 */
(function (global) {
  'use strict';

  var STORAGE = global.FunGamesStorage;
  var GAMES = global.FUN_GAMES || [];

  function el(tag, props, children) {
    var node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        if (k === 'class') node.className = props[k];
        else if (k === 'text') node.textContent = props[k];
        else if (k === 'html') node.innerHTML = props[k];
        else if (k.slice(0, 2) === 'on' && typeof props[k] === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), props[k]);
        } else if (props[k] !== null && props[k] !== undefined) {
          node.setAttribute(k, props[k]);
        }
      });
    }
    (children || []).forEach(function (child) {
      if (child === null || child === undefined) return;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return node;
  }

  function bestText(game) {
    if (!game.best) return null;
    var value = typeof game.best.read === 'function'
      ? game.best.read()
      : STORAGE.get(game.best.key, null);
    if (value === null || value === undefined || value === '') return null;
    var formatted = game.best.format ? game.best.format(value) : String(value);
    return (game.best.label ? game.best.label + '：' : '') + formatted;
  }

  function createCard(game) {
    var best = bestText(game);

    var tags = (game.tags || []).map(function (tag) {
      return el('span', { class: 'tag', text: tag });
    });

    return el('a', {
      class: 'game-card',
      href: game.href,
      'data-title': (game.title + ' ' + (game.description || '') + ' ' + (game.tags || []).join(' ')).toLowerCase()
    }, [
      el('div', { class: 'game-card__icon', 'aria-hidden': 'true', text: game.icon || '🎮' }),
      el('div', { class: 'game-card__body' }, [
        el('h2', { class: 'game-card__title', text: game.title }),
        el('p', { class: 'game-card__desc', text: game.description || '' }),
        el('div', { class: 'game-card__tags' }, tags)
      ]),
      el('div', { class: 'game-card__footer' }, [
        best
          ? el('span', { class: 'game-card__best', text: '★ ' + best })
          : el('span', { class: 'game-card__best game-card__best--empty', text: '还未玩过' }),
        el('span', { class: 'game-card__play', text: '开始玩 →' })
      ])
    ]);
  }

  function render() {
    var host = document.getElementById('game-list');
    if (!host) return;

    var filterInput = document.getElementById('game-filter');
    var countEl = document.getElementById('game-count');
    var emptyEl = document.getElementById('empty-state');

    host.innerHTML = '';
    var query = (filterInput && filterInput.value || '').trim().toLowerCase();

    var shown = 0;
    GAMES.forEach(function (game) {
      var haystack = (game.title + ' ' + (game.description || '') + ' ' + (game.tags || []).join(' ')).toLowerCase();
      if (query && haystack.indexOf(query) === -1) return;
      host.appendChild(createCard(game));
      shown++;
    });

    if (countEl) {
      countEl.textContent = shown === GAMES.length
        ? GAMES.length + ' 款游戏'
        : '已筛选 ' + shown + ' / ' + GAMES.length + ' 款';
    }
    if (emptyEl) emptyEl.hidden = shown !== 0;
  }

  function init() {
    var grid = document.getElementById('game-list');
    if (!grid) return;

    if (!GAMES.length) {
      grid.innerHTML = '';
      grid.appendChild(el('p', { class: 'empty-note', text: '还没有注册任何游戏，请在 js/manifest.js 中添加。' }));
      return;
    }

    grid.appendChild(document.createDocumentFragment());
    render();

    var filterInput = document.getElementById('game-filter');
    if (filterInput) {
      filterInput.addEventListener('input', render);
      filterInput.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          filterInput.value = '';
          render();
        }
      });
    }

    // Keep the count honest if another tab changes storage.
    global.addEventListener('storage', render);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.FunGamesHome = { render: render };
})(window);
