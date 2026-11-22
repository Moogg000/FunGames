/*
 * 2048.js — the classic sliding tile puzzle.
 *
 * Input:
 *   - Arrow keys / WASD ... move tiles
 *   - Swipe ............... move tiles (touch)
 *   - On-screen D-pad ..... move tiles (shown on touch / narrow screens)
 *
 * The board, score and best score are persisted in localStorage, so a refresh
 * resumes exactly where you left off.
 */
(function (global) {
  'use strict';

  var Storage = global.FunGamesStorage;
  var UI = global.FunGamesUI;

  var SIZE = 4;
  var STATE_KEY = '2048:state';
  var BEST_KEY = '2048:best';

  var page = UI.createPage({
    title: '2048',
    subtitle: '合并数字，挑战 2048',
    backHref: '../index.html',
    best: {
      storageKey: BEST_KEY,
      label: '最高分数',
      format: function (v) {
        return Number(v).toLocaleString('zh-CN');
      }
    }
  });

  /* ---------- DOM ---------- */

  var scoreEl = UI.el('strong', { text: '0' });
  var panel = UI.el('section', { class: 'panel' }, [
    UI.el('div', { class: 'g2048__score-row' }, [
      UI.el('div', { class: 'stat' }, ['分数 ', scoreEl])
    ]),
    UI.el('p', { class: 'panel__hint' }, [
      '使用方向键、滑动或屏幕上的方向按钮。' +
      '相同数字的方块相撞时会合并成一个。'
    ])
  ]);

  var bgGrid = UI.el('div', { class: 'g2048__bg', 'aria-hidden': 'true' });
  for (var i = 0; i < SIZE * SIZE; i++) bgGrid.appendChild(UI.el('span'));

  var tilesLayer = UI.el('div', { class: 'g2048__tiles' });
  var board = UI.el('div', { class: 'g2048__board', 'aria-label': '2048 棋盘' }, [bgGrid, tilesLayer]);

  var overlay = UI.el('div', { class: 'overlay', hidden: 'hidden' });
  var stage = UI.el('div', { class: 'ms-stage' }, [board, overlay]);

  var pad = UI.el('div', { class: 'g2048__pad', 'aria-label': '移动控制' });
  [
    { dir: 'left', label: '←', aria: '向左移动', r: 1, c: 0 },
    { dir: 'up', label: '↑', aria: '向上移动', r: 0, c: 1 },
    { dir: 'down', label: '↓', aria: '向下移动', r: 2, c: 1 },
    { dir: 'right', label: '→', aria: '向右移动', r: 1, c: 2 }
  ].forEach(function (item) {
    var btn = UI.el('button', {
      class: 'btn',
      type: 'button',
      'aria-label': item.aria,
      text: item.label
    });
    btn.style.gridRow = String(item.r + 1);
    btn.style.gridColumn = String(item.c + 1);
    btn.addEventListener('click', function () {
      move(item.dir);
    });
    pad.appendChild(btn);
  });

  var gameArea = UI.el('div', { class: 'g2048' }, [panel, stage, pad]);
  page.main.appendChild(gameArea);
  document.getElementById('app').appendChild(page.root);

  /* ---------- State ---------- */

  var tiles = [];
  var tileEls = {};
  var nextId = 1;
  var score = 0;
  var over = false;
  var won = false;
  var keepPlaying = false;
  var cell = 80;
  var gap = 10;

  /* ---------- Persistence ---------- */

  function save() {
    Storage.set(STATE_KEY, {
      tiles: tiles.filter(function (t) {
        return !t.dead;
      }).map(function (t) {
        return { id: t.id, value: t.value, row: t.row, col: t.col };
      }),
      nextId: nextId,
      score: score,
      over: over,
      won: won,
      keepPlaying: keepPlaying
    });
  }

  function load() {
    var data = Storage.get(STATE_KEY, null);
    if (!data || typeof data !== 'object' || !Array.isArray(data.tiles)) return false;

    tiles = [];
    tileEls = {};
    tilesLayer.innerHTML = '';

    for (var i = 0; i < data.tiles.length; i++) {
      var t = data.tiles[i];
      if (!t || typeof t.id !== 'number' || typeof t.value !== 'number') return false;
      if (t.row < 0 || t.row >= SIZE || t.col < 0 || t.col >= SIZE) return false;
      tiles.push({ id: t.id, value: t.value, row: t.row, col: t.col });
    }

    nextId = typeof data.nextId === 'number' ? data.nextId : maxId() + 1;
    score = typeof data.score === 'number' ? data.score : 0;
    over = !!data.over;
    won = !!data.won;
    keepPlaying = !!data.keepPlaying;
    return tiles.length > 0;
  }

  function maxId() {
    return tiles.reduce(function (acc, t) {
      return Math.max(acc, t.id);
    }, 0);
  }

  /* ---------- Rendering ---------- */

  function measure() {
    gap = parseFloat(global.getComputedStyle(bgGrid).gap) || 10;
    cell = (tilesLayer.clientWidth - (SIZE - 1) * gap) / SIZE;
    board.style.setProperty('--cell', cell + 'px');
  }

  function posX(col) {
    return col * (cell + gap);
  }

  function posY(row) {
    return row * (cell + gap);
  }

  function byId(id) {
    for (var i = 0; i < tiles.length; i++) {
      if (tiles[i].id === id) return tiles[i];
    }
    return null;
  }

  /*
   * Fade animation for a tile that just appeared or is about to disappear.
   *
   * Only `opacity` is animated — never `transform`. Animating transform would
   * override the inline translate() that positions the tile, so the tile would
   * fly in from the top-left corner of the board (and read as a flicker).
   * The class is kept until the animation has finished, so a fast follow-up
   * move cannot cut it short.
   */
  function playAnim(tile, kind) {
    tile.anim = kind;
    var token = (tile.animToken || 0) + 1;
    tile.animToken = token;

    setTimeout(function () {
      if (tile.animToken !== token) return;
      tile.anim = null;
      var node = tileEls[tile.id];
      if (node) node.classList.remove('tile--new', 'tile--merged', 'tile--absorbed');
    }, 220);
  }

  function render() {
    measure();

    var seen = {};
    tiles.forEach(function (t) {
      seen[t.id] = true;

      var node = tileEls[t.id];
      if (!node) {
        node = document.createElement('div');
        node.className = 'tile';
        tilesLayer.appendChild(node);
        tileEls[t.id] = node;
      }

      var cls = 'tile tile--' + (t.value <= 2048 ? t.value : 'super');
      if (t.anim) cls += ' tile--' + t.anim;

      // Only touch the DOM when something actually changed. Rewriting
      // className on every render would restart CSS animations.
      if (node.className !== cls) node.className = cls;
      var label = String(t.value);
      if (node.textContent !== label) node.textContent = label;

      var transform = 'translate(' + posX(t.col) + 'px, ' + posY(t.row) + 'px)';
      if (node.style.transform !== transform) node.style.transform = transform;

      var ratio = t.value >= 1024 ? 0.3 : t.value >= 128 ? 0.34 : 0.42;
      var fontSize = (cell * ratio) + 'px';
      if (node.style.fontSize !== fontSize) node.style.fontSize = fontSize;
    });

    Object.keys(tileEls).forEach(function (id) {
      if (!seen[id]) {
        var stale = tileEls[id];
        if (stale.parentNode) stale.parentNode.removeChild(stale);
        delete tileEls[id];
      }
    });
  }

  function updateScores() {
    scoreEl.textContent = score.toLocaleString('zh-CN');
    // A score of 0 is not a record worth keeping; it keeps the badge at "—"
    // until the player actually scores.
    if (score > 0) {
      page.setBest(score);
    } else {
      page.renderBest(page.getBest());
    }
  }

  /* ---------- Game flow ---------- */

  function reset() {
    tiles = [];
    tileEls = {};
    tilesLayer.innerHTML = '';
    nextId = 1;
    score = 0;
    over = false;
    won = false;
    keepPlaying = false;

    page.beginRun();
    spawnRandom();
    spawnRandom();
    hideOverlay();
    render();
    updateScores();
    save();
  }

  function spawnRandom() {
    var occupied = {};
    tiles.forEach(function (t) {
      if (t.dead) return;
      occupied[t.row + ',' + t.col] = true;
    });

    var empty = [];
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        if (!occupied[r + ',' + c]) empty.push({ row: r, col: c });
      }
    }
    if (!empty.length) return null;

    var pick = empty[Math.floor(Math.random() * empty.length)];
    var tile = {
      id: nextId++,
      value: Math.random() < 0.9 ? 2 : 4,
      row: pick.row,
      col: pick.col
    };
    tiles.push(tile);
    return tile;
  }

  function move(dir) {
    if (over) return;

    var vector = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] }[dir];
    if (!vector) return;
    var dr = vector[0];
    var dc = vector[1];

    var rows = [0, 1, 2, 3];
    var cols = [0, 1, 2, 3];
    if (dr === 1) rows.reverse();
    if (dc === 1) cols.reverse();

    var grid = [];
    for (var r = 0; r < SIZE; r++) grid.push([null, null, null, null]);
    tiles.forEach(function (t) {
      if (t.dead) return;
      grid[t.row][t.col] = t;
      t.merged = false;
    });

    var moved = false;
    var absorbed = [];
    var mergedIds = [];

    rows.forEach(function (row) {
      cols.forEach(function (col) {
        var tile = grid[row][col];
        if (!tile) return;

        var nr = row;
        var nc = col;
        while (true) {
          var tr = nr + dr;
          var tc = nc + dc;
          if (tr < 0 || tr >= SIZE || tc < 0 || tc >= SIZE) break;
          if (grid[tr][tc]) break;
          nr = tr;
          nc = tc;
        }

        var br = nr + dr;
        var bc = nc + dc;
        var target = (br >= 0 && br < SIZE && bc >= 0 && bc < SIZE) ? grid[br][bc] : null;

        if (target && target.value === tile.value && !target.merged) {
          grid[row][col] = null;
          // 被合并的方块滑到目标格并淡出，视觉上完成一次合并。
          tile.row = br;
          tile.col = bc;
          tile.dead = true;
          target.value *= 2;
          target.merged = true;
          absorbed.push(tile);
          mergedIds.push(target.id);
          score += target.value;
          if (target.value >= 2048) won = true;
          moved = true;
        } else if (nr !== row || nc !== col) {
          grid[row][col] = null;
          grid[nr][nc] = tile;
          tile.row = nr;
          tile.col = nc;
          moved = true;
        }
      });
    });

    if (!moved) return;

    // 1. 标记要淡入的方块（合并结果）和要淡出的方块（被合并掉的）。
    mergedIds.forEach(function (id) {
      var tile = byId(id);
      if (tile) playAnim(tile, 'merged');
    });
    absorbed.forEach(function (t) {
      playAnim(t, 'absorbed');
    });

    // 2. 生成新方块并淡入。
    var spawned = spawnRandom();
    if (spawned) playAnim(spawned, 'new');

    // 3. 每次移动只渲染一次：一次性摆好所有方块并套用动画类。
    render();

    // 被合并的方块淡出后再从 DOM 移除。
    setTimeout(function () {
      absorbed.forEach(function (t) {
        var node = tileEls[t.id];
        if (node && node.parentNode) node.parentNode.removeChild(node);
        delete tileEls[t.id];
      });
      tiles = tiles.filter(function (t) {
        return !t.dead;
      });
    }, 160);

    updateScores();
    save();

    if (won && !keepPlaying) {
      showOverlay({
        icon: '🏆',
        title: '你拼出了 2048！',
        text: '干得漂亮！可以继续挑战更高分，也可以重新开始。',
        actionLabel: '继续挑战',
        onAction: function () {
          keepPlaying = true;
          hideOverlay();
          save();
        },
        secondaryLabel: '新游戏',
        onSecondary: reset
      });
    } else if (!movesAvailable()) {
      over = true;
      save();
      showOverlay({
        icon: '😵',
        title: '无路可走了',
        text: '最终得分：' + score.toLocaleString('zh-CN') + '。',
        actionLabel: '再来一局',
        danger: true,
        onAction: reset
      });
    }
  }

  function movesAvailable() {
    var grid = [];
    for (var r = 0; r < SIZE; r++) grid.push([null, null, null, null]);
    tiles.forEach(function (t) {
      if (t.dead) return;
      grid[t.row][t.col] = t;
    });

    for (var row = 0; row < SIZE; row++) {
      for (var col = 0; col < SIZE; col++) {
        var tile = grid[row][col];
        if (!tile) return true;
        if (row + 1 < SIZE && grid[row + 1][col] && grid[row + 1][col].value === tile.value) {
          return true;
        }
        if (col + 1 < SIZE && grid[row][col + 1] && grid[row][col + 1].value === tile.value) {
          return true;
        }
      }
    }
    return false;
  }

  function showOverlay(options) {
    overlay.innerHTML = '';
    overlay.hidden = false;

    var actions = UI.el('div', { class: 'overlay__actions' });

    var primary = UI.el('button', {
      class: 'btn' + (options.danger ? ' btn--danger' : ''),
      type: 'button',
      text: options.actionLabel || 'OK'
    });
    primary.addEventListener('click', function () {
      if (options.onAction) options.onAction();
    });
    actions.appendChild(primary);

    if (options.secondaryLabel) {
      var secondary = UI.el('button', {
        class: 'btn btn--ghost',
        type: 'button',
        text: options.secondaryLabel
      });
      secondary.addEventListener('click', function () {
        if (options.onSecondary) options.onSecondary();
      });
      actions.appendChild(secondary);
    }

    overlay.appendChild(UI.el('div', { class: 'overlay__icon', 'aria-hidden': 'true', text: options.icon || '🎯' }));
    overlay.appendChild(UI.el('h2', { class: 'overlay__title', text: options.title }));
    overlay.appendChild(UI.el('p', { class: 'overlay__text', text: options.text }));
    overlay.appendChild(actions);
  }

  function hideOverlay() {
    overlay.hidden = true;
    overlay.innerHTML = '';
  }

  /* ---------- Input ---------- */

  global.addEventListener('keydown', function (e) {
    var map = {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right',
      w: 'up',
      s: 'down',
      a: 'left',
      d: 'right',
      W: 'up',
      S: 'down',
      A: 'left',
      D: 'right'
    };
    var dir = map[e.key];
    if (!dir) return;
    e.preventDefault();
    move(dir);
  });

  UI.onSwipe(board, function (dir) {
    move(dir);
  });

  if (global.ResizeObserver) {
    new ResizeObserver(function () {
      render();
    }).observe(board);
  }
  global.addEventListener('resize', render);

  page.onNewGame(reset);

  /* ---------- Boot ---------- */

  if (!load()) {
    reset();
  } else {
    hideOverlay();
    render();
    updateScores();

    if (over) {
      showOverlay({
        icon: '😵',
        title: '无路可走了',
        text: '最终得分：' + score.toLocaleString('zh-CN') + '。',
        actionLabel: '再来一局',
        danger: true,
        onAction: reset
      });
    }
  }
})(window);
