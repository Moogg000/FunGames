/*
 * ui.js — shared page chrome + small UI helpers for every mini-game.
 *
 * A game only has to provide:
 *   - a title
 *   - a mount node (page.main)
 *   - a "new game" callback
 *
 * Everything else (back link, title bar, best-score badge, new-game button,
 * toasts, touch swipe detection) lives here so all games look and behave the
 * same.
 *
 * Usage:
 *   var page = FunGamesUI.createPage({
 *     title: 'Minesweeper',
 *     backHref: '../index.html',
 *     best: {
 *       storageKey: 'minesweeper:best', // 也可以是 () => 'minesweeper:best:' + diff
 *       label: 'Best time',
 *       format: fmt,
 *       lowerIsBetter: true,            // 计时类纪录
 *       recordMessage: '🎉 New record!' // 可选，打破纪录时的提示
 *     }
 *   });
 *   page.onNewGame(startGame);
 *   page.beginRun();          // 每一局开始时调用
 *   page.setBest(42);         // 成绩变化时调用：实时刷新徽章 + 破纪录提示
 *   document.getElementById('app').appendChild(page.root);
 */
(function (global) {
  'use strict';

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

  function createPage(options) {
    options = options || {};
    var backHref = options.backHref || '../index.html';

    var root = el('div', { class: 'page' });

    var bestEl = el('span', {
      class: 'badge',
      title: options.best ? options.best.label : ''
    }, ['—']);

    var newGameBtn = el('button', {
      class: 'btn',
      type: 'button',
      text: options.newGameLabel || '新游戏'
    });

    var header = el('header', { class: 'topbar' }, [
      el('a', {
        class: 'icon-btn',
        href: backHref,
        'aria-label': '返回游戏列表',
        title: '全部游戏',
        text: '←'
      }),
      el('div', { class: 'topbar__titles' }, [
        el('h1', { class: 'topbar__title', text: options.title || '游戏' }),
        options.subtitle ? el('p', { class: 'topbar__subtitle', text: options.subtitle }) : null
      ]),
      el('div', { class: 'topbar__actions' }, [bestEl, newGameBtn])
    ]);

    var main = el('main', { class: 'game-main', id: 'game-main' });

    var toastHost = el('div', {
      class: 'toast-host',
      'aria-live': 'polite',
      'aria-atomic': 'true'
    });

    root.appendChild(header);
    root.appendChild(main);
    root.appendChild(toastHost);

    var bestConfig = options.best || null;
    var runBest = null; // 本轮开始时的最佳成绩，用于判断「是否打破纪录」
    var recordCelebrated = false; // 本轮是否已经提示过，避免连续刷屏

    function bestKey() {
      if (!bestConfig) return null;
      return typeof bestConfig.storageKey === 'function'
        ? bestConfig.storageKey()
        : bestConfig.storageKey;
    }

    function readStored() {
      var key = bestKey();
      return key ? global.FunGamesStorage.get(key, null) : null;
    }

    function isBetter(value, reference) {
      if (reference === null || reference === undefined) return true;
      return bestConfig.lowerIsBetter ? value < reference : value > reference;
    }

    function renderBest(value) {
      if (!bestConfig) {
        bestEl.style.display = 'none';
        return;
      }
      var label = bestConfig.label ? bestConfig.label + '：' : '';
      if (value === null || value === undefined || value === '') {
        bestEl.textContent = label + '—';
        return;
      }
      var formatted = bestConfig.format ? bestConfig.format(value) : String(value);
      bestEl.textContent = label + formatted;
    }

    /*
     * beginRun() —— 在一局开始（或读取存档继续）时调用。
     * 它把「本轮开始时的最佳成绩」固定下来，作为判断是否破纪录的基准。
     * 不调用也能玩，但破纪录的提示会以上次页面加载时的成绩为基准。
     */
    function beginRun() {
      runBest = readStored();
      recordCelebrated = false;
    }

    /*
     * setBest(value) —— 游戏在成绩变化时调用。
     * 比现有最佳更好就立刻写入并刷新徽章（实时显示）；
     * 本轮第一次超越 beginRun() 时的基准，就弹一次不遮挡操作的提示。
     * 返回是否刷新了纪录。
     */
    function setBest(value) {
      if (!bestConfig) return false;
      var previous = readStored();

      if (!isBetter(value, previous)) {
        renderBest(previous);
        return false;
      }

      global.FunGamesStorage.set(bestKey(), value);
      renderBest(value);

      if (!recordCelebrated && isBetter(value, runBest)) {
        recordCelebrated = true;
        var formatted = bestConfig.format ? bestConfig.format(value) : String(value);
        toast(bestConfig.recordMessage ||
          (bestConfig.lowerIsBetter ? '🎉 新纪录：' : '🎉 新的最高分：') + formatted + '！');
      }
      return true;
    }

    beginRun();
    renderBest(readStored());

    var newGameHandlers = [];
    newGameBtn.addEventListener('click', function () {
      beginRun();
      newGameHandlers.forEach(function (fn) {
        try {
          fn();
        } catch (err) {
          console.error('[FunGames] new-game handler failed:', err);
        }
      });
    });

    /*
     * toast —— 页面底部的轻提示。
     * 多条提示会上下堆叠，最多同时显示 3 条，不会遮挡棋盘或按钮。
     */
    function toast(message, timeout) {
      var node = el('div', { class: 'toast', role: 'status', text: message });
      toastHost.appendChild(node);

      while (toastHost.children.length > 3) {
        toastHost.removeChild(toastHost.children[0]);
      }

      // Force a reflow so the entry animation replays on consecutive toasts.
      void node.offsetWidth;
      node.classList.add('toast--in');

      setTimeout(function () {
        node.classList.remove('toast--in');
        setTimeout(function () {
          if (node.parentNode) node.parentNode.removeChild(node);
        }, 220);
      }, timeout || 2600);
    }

    return {
      root: root,
      main: main,
      header: header,
      bestEl: bestEl,
      newGameBtn: newGameBtn,
      toastHost: toastHost,
      setBest: setBest,
      beginRun: beginRun,
      getBest: function () {
        return readStored();
      },
      renderBest: renderBest,
      onNewGame: function (fn) {
        if (typeof fn === 'function') newGameHandlers.push(fn);
      },
      toast: toast,
      el: el
    };
  }

  /*
   * onSwipe — unified touch/pointer swipe detector.
   * handler(direction) where direction is 'up' | 'down' | 'left' | 'right'.
   * Returns a detach function.
   */
  function onSwipe(node, handler, threshold) {
    var limit = threshold || 24;
    var startX = 0;
    var startY = 0;
    var tracking = false;

    function down(x, y) {
      tracking = true;
      startX = x;
      startY = y;
    }

    function up(x, y) {
      if (!tracking) return;
      tracking = false;
      var dx = x - startX;
      var dy = y - startY;
      if (Math.abs(dx) < limit && Math.abs(dy) < limit) return;
      if (Math.abs(dx) > Math.abs(dy)) {
        handler(dx > 0 ? 'right' : 'left');
      } else {
        handler(dy > 0 ? 'down' : 'up');
      }
    }

    node.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) return;
      down(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });

    node.addEventListener('touchend', function (e) {
      var t = e.changedTouches[0];
      up(t.clientX, t.clientY);
    }, { passive: true });

    node.addEventListener('touchcancel', function () {
      tracking = false;
    }, { passive: true });

    // Mouse drag support (handy on desktop / hybrid devices).
    node.addEventListener('mousedown', function (e) {
      down(e.clientX, e.clientY);
      function mouseUp(ev) {
        up(ev.clientX, ev.clientY);
        document.removeEventListener('mouseup', mouseUp);
      }
      document.addEventListener('mouseup', mouseUp);
    });

    return function () {
      node.removeEventListener('touchstart', function () {});
    };
  }

  /*
   * formatTime — seconds -> "m:ss" (or "h:mm:ss" for very long games).
   */
  function formatTime(totalSeconds) {
    var s = Math.max(0, Math.floor(totalSeconds || 0));
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    var pad = function (n) {
      return (n < 10 ? '0' : '') + n;
    };
    if (h > 0) return h + ':' + pad(m) + ':' + pad(sec);
    return m + ':' + pad(sec);
  }

  /*
   * formatClock — 毫秒 -> "m:ss.d"（精确到 0.1 秒），用于计分类纪录。
   */
  function formatClock(ms) {
    var total = Math.max(0, Math.round(ms || 0));
    var d = Math.floor(total / 100) % 10;
    var s = Math.floor(total / 1000);
    var m = Math.floor(s / 60);
    var sec = s % 60;
    return m + ':' + (sec < 10 ? '0' : '') + sec + '.' + d;
  }

  global.FunGamesUI = {
    el: el,
    createPage: createPage,
    onSwipe: onSwipe,
    formatTime: formatTime,
    formatClock: formatClock
  };
})(window);
