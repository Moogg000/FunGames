/*
 * tetris.js — 俄罗斯方块。
 *
 * 输入：
 *   - ← / → （或 A / D）.. 左右移动
 *   - ↓ （或 S）........... 软降（+1 分 / 格）
 *   - ↑ / W / X ............ 旋转
 *   - 空格 ................. 硬降（+2 分 / 格）
 *   - P / Esc .............. 暂停 / 继续
 *   - 触屏：滑动左 / 右移动，下滑软降，上滑旋转，轻点棋盘旋转
 *
 * 消行得分：1 行 100、2 行 300、3 行 500、4 行 800，再乘以当前等级。
 * 每消 10 行升一级，下落随之加快。方块采用 7-bag 随机，保证每种方块数量均匀。
 * 棋盘、当前方块、下一个方块、分数和等级都会写入 localStorage，刷新后接着玩。
 */
(function (global) {
  'use strict';

  var Storage = global.FunGamesStorage;
  var UI = global.FunGamesUI;

  var COLS = 10;
  var ROWS = 20;
  var STATE_KEY = 'tetris:state';
  var BEST_KEY = 'tetris:best';

  /* size 是方块外接方格的边长，cells 用 [行, 列] 表示，原点在左上角。 */
  var SHAPES = [
    { name: 'I', size: 4, cells: [[0, 0], [0, 1], [0, 2], [0, 3]] },
    { name: 'O', size: 2, cells: [[0, 0], [0, 1], [1, 0], [1, 1]] },
    { name: 'T', size: 3, cells: [[0, 1], [1, 0], [1, 1], [1, 2]] },
    { name: 'S', size: 3, cells: [[0, 1], [0, 2], [1, 0], [1, 1]] },
    { name: 'Z', size: 3, cells: [[0, 0], [0, 1], [1, 1], [1, 2]] },
    { name: 'J', size: 3, cells: [[0, 0], [1, 0], [1, 1], [1, 2]] },
    { name: 'L', size: 3, cells: [[0, 2], [1, 0], [1, 1], [1, 2]] }
  ];

  var LINE_SCORES = [0, 100, 300, 500, 800];
  var SOFT_POINTS = 1;
  var HARD_POINTS = 2;
  var LINES_PER_LEVEL = 10;

  var state = {
    grid: [],
    piece: null,
    next: 0,
    bag: [],
    score: 0,
    lines: 0,
    level: 1,
    over: false,
    paused: false
  };

  var page = UI.createPage({
    title: '俄罗斯方块',
    subtitle: '堆叠方块，消除整行',
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
  var linesEl = UI.el('strong', { text: '0' });
  var levelEl = UI.el('strong', { text: '1' });

  var pauseBtn = UI.el('button', {
    class: 'btn btn--ghost',
    type: 'button',
    text: '⏸ 暂停'
  });
  pauseBtn.addEventListener('click', function () {
    setPaused(!state.paused);
  });

  var panel = UI.el('section', { class: 'panel' }, [
    UI.el('div', { class: 'stat-row' }, [
      UI.el('div', { class: 'stat' }, ['分数 ', scoreEl]),
      UI.el('div', { class: 'stat' }, ['行数 ', linesEl]),
      UI.el('div', { class: 'stat' }, ['等级 ', levelEl])
    ]),
    UI.el('div', { class: 'tetris__mid' }, [
      UI.el('div', { class: 'tetris__next' }, [
        UI.el('p', { class: 'tetris__next-title', text: '下一个' }),
        UI.el('div', { class: 'tetris__next-grid', 'aria-hidden': 'true' })
      ]),
      UI.el('p', { class: 'panel__hint' }, [
        '← → 移动 · ↓ 软降 · ↑ 旋转 · 空格硬降 · P 暂停。' +
        '触屏可以滑动或轻点棋盘旋转。'
      ])
    ]),
    pauseBtn
  ]);

  var nextGrid = panel.querySelector('.tetris__next-grid');
  var previewCells = [];
  for (var i = 0; i < 16; i++) {
    var mini = UI.el('span', { class: 'tetris__mini' });
    nextGrid.appendChild(mini);
    previewCells.push(mini);
  }

  var board = UI.el('div', {
    class: 'tetris__board',
    role: 'img',
    'aria-label': '俄罗斯方块棋盘'
  });
  var cells = [];
  for (var r = 0; r < ROWS; r++) {
    for (var c = 0; c < COLS; c++) {
      var cell = UI.el('span', { class: 'tetris__cell', 'aria-hidden': 'true' });
      board.appendChild(cell);
      cells.push(cell);
    }
  }

  var overlay = UI.el('div', { class: 'overlay', hidden: 'hidden' });
  var stage = UI.el('div', { class: 'tetris__stage' }, [board, overlay]);

  var pad = UI.el('div', { class: 'tetris__pad', 'aria-label': '方块控制' });
  [
    { action: function () { moveHorizontal(-1); }, label: '←', aria: '向左移动' },
    { action: function () { moveHorizontal(1); }, label: '→', aria: '向右移动' },
    { action: softDrop, label: '↓', aria: '软降' },
    { action: rotate, label: '⟳', aria: '旋转' },
    { action: hardDrop, label: '⤓', aria: '硬降' }
  ].forEach(function (item) {
    var btn = UI.el('button', {
      class: 'btn',
      type: 'button',
      'aria-label': item.aria,
      text: item.label
    });
    btn.addEventListener('click', item.action);
    pad.appendChild(btn);
  });

  var gameArea = UI.el('div', { class: 'tetris' }, [panel, stage, pad]);
  page.main.appendChild(gameArea);
  document.getElementById('app').appendChild(page.root);

  /* ---------- Helpers ---------- */

  function emptyRow() {
    var row = [];
    for (var c = 0; c < COLS; c++) row.push(0);
    return row;
  }

  function emptyGrid() {
    var grid = [];
    for (var r = 0; r < ROWS; r++) grid.push(emptyRow());
    return grid;
  }

  function vibrate(pattern) {
    if (global.navigator && global.navigator.vibrate) global.navigator.vibrate(pattern);
  }

  /* 旋转：绕外接方格的中心顺时针转 90°。 */
  function rotatedCells(shapeIndex, rotation) {
    var shape = SHAPES[shapeIndex];
    var size = shape.size;
    var cells = shape.cells;
    for (var i = 0; i < rotation; i++) {
      cells = cells.map(function (cell) {
        return [cell[1], size - 1 - cell[0]];
      });
    }
    return cells;
  }

  function cellsFor(piece) {
    return rotatedCells(piece.s, piece.r);
  }

  /* grid 参数让存档校验能在 state.grid 赋值之前复用同一套碰撞逻辑。 */
  function collides(cells, row, col, grid) {
    var board = grid || state.grid;
    for (var i = 0; i < cells.length; i++) {
      var r = row + cells[i][0];
      var c = col + cells[i][1];
      if (c < 0 || c >= COLS || r >= ROWS) return true;
      if (r >= 0 && board[r][c]) return true;
    }
    return false;
  }

  /* 7-bag：每 7 个方块为一袋，袋内顺序随机。 */
  function drawShape() {
    if (!state.bag.length) {
      var bag = [];
      for (var i = 0; i < SHAPES.length; i++) bag.push(i);
      for (var k = bag.length - 1; k > 0; k--) {
        var m = Math.floor(Math.random() * (k + 1));
        var tmp = bag[k];
        bag[k] = bag[m];
        bag[m] = tmp;
      }
      state.bag = bag;
    }
    return state.bag.shift();
  }

  function makePiece(shapeIndex) {
    var shape = SHAPES[shapeIndex];
    return {
      s: shapeIndex,
      r: 0,
      row: 0,
      col: Math.floor((COLS - shape.size) / 2)
    };
  }

  function canPlay() {
    return !state.over && !state.paused && !!state.piece;
  }

  /* ---------- Persistence ---------- */

  function save() {
    Storage.set(STATE_KEY, {
      grid: state.grid,
      piece: state.piece,
      next: state.next,
      bag: state.bag,
      score: state.score,
      lines: state.lines,
      level: state.level,
      over: state.over,
      paused: state.paused
    });
  }

  function validGrid(grid) {
    if (!Array.isArray(grid) || grid.length !== ROWS) return false;
    for (var r = 0; r < ROWS; r++) {
      if (!Array.isArray(grid[r]) || grid[r].length !== COLS) return false;
      for (var c = 0; c < COLS; c++) {
        var v = grid[r][c];
        if (typeof v !== 'number' || v < 0 || v >= SHAPES.length + 1) return false;
      }
    }
    return true;
  }

  function validPiece(piece, grid) {
    if (!piece || typeof piece !== 'object') return false;
    if (typeof piece.s !== 'number' || piece.s < 0 || piece.s >= SHAPES.length) return false;
    if (typeof piece.r !== 'number' || piece.r < 0 || piece.r > 3) return false;
    if (typeof piece.row !== 'number' || typeof piece.col !== 'number') return false;
    return !collides(cellsFor(piece), piece.row, piece.col, grid);
  }

  function load() {
    var data = Storage.get(STATE_KEY, null);
    if (!data || typeof data !== 'object') return false;
    if (!validGrid(data.grid)) return false;
    if (!validPiece(data.piece, data.grid)) return false;
    if (typeof data.next !== 'number' || data.next < 0 || data.next >= SHAPES.length) return false;
    if (!Array.isArray(data.bag)) return false;

    state.grid = data.grid.map(function (row) {
      return row.slice(0, COLS);
    });
    state.piece = {
      s: data.piece.s,
      r: data.piece.r,
      row: data.piece.row,
      col: data.piece.col
    };
    state.next = data.next;
    state.bag = data.bag.filter(function (v) {
      return typeof v === 'number' && v >= 0 && v < SHAPES.length;
    });
    state.score = typeof data.score === 'number' && data.score >= 0
      ? Math.floor(data.score) : 0;
    state.lines = typeof data.lines === 'number' && data.lines >= 0
      ? Math.floor(data.lines) : 0;
    state.level = typeof data.level === 'number' && data.level >= 1
      ? Math.floor(data.level) : 1;
    state.over = !!data.over;
    state.paused = !!data.paused;
    return true;
  }

  /* ---------- Game flow ---------- */

  function reset() {
    state.grid = emptyGrid();
    state.bag = [];
    state.next = drawShape();
    state.score = 0;
    state.lines = 0;
    state.level = 1;
    state.over = false;
    state.paused = false;
    pauseBtn.textContent = '⏸ 暂停';

    page.beginRun();
    page.renderBest(page.getBest());

    hideOverlay();
    updateStats();
    spawnPiece();
    paint();
    save();
    schedule();
  }

  function spawnPiece() {
    state.piece = makePiece(state.next);
    state.next = drawShape();
    paintPreview();

    if (collides(cellsFor(state.piece), state.piece.row, state.piece.col)) {
      gameOver();
      return false;
    }
    return true;
  }

  function moveDown() {
    var piece = state.piece;
    if (!collides(cellsFor(piece), piece.row + 1, piece.col)) {
      piece.row++;
      return true;
    }
    return false;
  }

  function clearLines() {
    var full = [];
    for (var r = 0; r < ROWS; r++) {
      var filled = true;
      for (var c = 0; c < COLS; c++) {
        if (!state.grid[r][c]) {
          filled = false;
          break;
        }
      }
      if (filled) full.push(r);
    }
    if (!full.length) return 0;

    var kept = [];
    for (var r2 = 0; r2 < ROWS; r2++) {
      if (full.indexOf(r2) === -1) kept.push(state.grid[r2]);
    }
    while (kept.length < ROWS) kept.unshift(emptyRow());
    state.grid = kept;
    return full.length;
  }

  function lockPiece() {
    var piece = state.piece;
    cellsFor(piece).forEach(function (cell) {
      var r = piece.row + cell[0];
      var c = piece.col + cell[1];
      if (r >= 0 && r < ROWS && c >= 0 && c < COLS) {
        state.grid[r][c] = piece.s + 1;
      }
    });

    var cleared = clearLines();
    if (cleared) {
      state.score += (LINE_SCORES[cleared] || 0) * state.level;
      page.setBest(state.score);
      state.lines += cleared;

      var level = Math.floor(state.lines / LINES_PER_LEVEL) + 1;
      if (level !== state.level) {
        state.level = level;
        page.toast('⬆ 升到 ' + level + ' 级！');
      }
    }

    updateStats();
    paint();
    save();

    if (spawnPiece()) {
      paint();
      save();
    }
  }

  function tick() {
    if (state.paused || state.over) return;
    // 重力每步只改内存中的 row，必须重新绘制，否则方块不会往下动。
    if (moveDown()) paint();
    else lockPiece();
  }

  function gameOver() {
    state.over = true;
    state.paused = false;
    stopLoop();
    paint();
    save();

    showGameOver();
    page.toast('游戏结束，得分 ' + state.score.toLocaleString('zh-CN'));
    vibrate(120);
  }

  function showGameOver() {
    var best = page.getBest();
    showOverlay({
      icon: '🧱',
      title: '游戏结束',
      text: '本局得分 ' + state.score.toLocaleString('zh-CN') +
        ' · 消除 ' + state.lines + ' 行' +
        (best === null || best === undefined
          ? '。'
          : ' · 最高 ' + Number(best).toLocaleString('zh-CN') + '。'),
      actionLabel: '再来一局',
      danger: true,
      onAction: reset
    });
  }

  /* ---------- 操作 ---------- */

  function moveHorizontal(dx) {
    if (!canPlay()) return;
    var piece = state.piece;
    if (!collides(cellsFor(piece), piece.row, piece.col + dx)) {
      piece.col += dx;
      paint();
      save();
    }
  }

  function softDrop() {
    if (!canPlay()) return;
    if (moveDown()) {
      state.score += SOFT_POINTS;
      page.setBest(state.score);
      updateStats();
      paint();
      save();
      schedule();
    } else {
      lockPiece();
    }
  }

  function hardDrop() {
    if (!canPlay()) return;
    var piece = state.piece;
    var distance = 0;
    while (!collides(cellsFor(piece), piece.row + 1, piece.col)) {
      piece.row++;
      distance++;
    }
    state.score += distance * HARD_POINTS;
    page.setBest(state.score);
    lockPiece();
  }

  function rotate() {
    if (!canPlay()) return;
    var piece = state.piece;
    var nextRotation = (piece.r + 1) % 4;
    var kicks = [0, -1, 1, -2, 2];

    for (var i = 0; i < kicks.length; i++) {
      var col = piece.col + kicks[i];
      if (!collides(rotatedCells(piece.s, nextRotation), piece.row, col)) {
        piece.r = nextRotation;
        piece.col = col;
        paint();
        save();
        return;
      }
    }
  }

  /* ---------- 循环 / 暂停 ---------- */

  var timerId = null;

  function stopLoop() {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
  }

  function dropInterval() {
    return Math.max(80, 620 - (state.level - 1) * 55);
  }

  function schedule() {
    stopLoop();
    if (state.over || state.paused) return;

    timerId = setTimeout(function () {
      timerId = null;
      tick();
      schedule();
    }, dropInterval());
  }

  function setPaused(paused) {
    if (state.over) paused = false;
    if (state.paused === paused) return;

    state.paused = paused;
    pauseBtn.textContent = paused ? '▶ 继续' : '⏸ 暂停';

    if (paused) {
      stopLoop();
      save();
      showOverlay({
        icon: '⏸️',
        title: '已暂停',
        text: '按 P 或点击「继续」回到游戏。',
        actionLabel: '继续',
        onAction: function () {
          setPaused(false);
        }
      });
    } else {
      hideOverlay();
      save();
      schedule();
    }
  }

  /* ---------- 渲染 ---------- */

  function updateStats() {
    scoreEl.textContent = state.score.toLocaleString('zh-CN');
    linesEl.textContent = String(state.lines);
    levelEl.textContent = String(state.level);
  }

  function paint() {
    var overlay = {};
    var piece = state.piece;

    if (piece && !state.over) {
      var ghostRow = piece.row;
      while (!collides(cellsFor(piece), ghostRow + 1, piece.col)) ghostRow++;

      cellsFor(piece).forEach(function (cell) {
        var r = ghostRow + cell[0];
        var c = piece.col + cell[1];
        if (r >= 0) overlay[r + ',' + c] = 'ghost';
      });
      cellsFor(piece).forEach(function (cell) {
        var r = piece.row + cell[0];
        var c = piece.col + cell[1];
        if (r >= 0) overlay[r + ',' + c] = String(piece.s + 1);
      });
    }

    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        var key = r + ',' + c;
        var cls = 'tetris__cell';
        if (overlay[key]) {
          cls += overlay[key] === 'ghost'
            ? ' tetris__cell--ghost'
            : ' tetris__cell--' + overlay[key];
        } else if (state.grid[r][c]) {
          cls += ' tetris__cell--' + state.grid[r][c];
        }
        cells[r * COLS + c].className = cls;
      }
    }
  }

  function paintPreview() {
    for (var i = 0; i < previewCells.length; i++) {
      previewCells[i].className = 'tetris__mini';
    }

    var shape = SHAPES[state.next];
    if (!shape) return;

    var minR = 99;
    var maxR = -1;
    var minC = 99;
    var maxC = -1;
    shape.cells.forEach(function (cell) {
      minR = Math.min(minR, cell[0]);
      maxR = Math.max(maxR, cell[0]);
      minC = Math.min(minC, cell[1]);
      maxC = Math.max(maxC, cell[1]);
    });

    var offR = Math.floor((4 - (maxR - minR + 1)) / 2);
    var offC = Math.floor((4 - (maxC - minC + 1)) / 2);

    shape.cells.forEach(function (cell) {
      var r = cell[0] - minR + offR;
      var c = cell[1] - minC + offC;
      previewCells[r * 4 + c].className =
        'tetris__mini tetris__mini--' + (state.next + 1);
    });
  }

  /* ---------- 遮罩 ---------- */

  function showOverlay(options) {
    overlay.innerHTML = '';
    overlay.hidden = false;

    var actions = UI.el('div', { class: 'overlay__actions' });

    var primary = UI.el('button', {
      class: 'btn' + (options.danger ? ' btn--danger' : ''),
      type: 'button',
      text: options.actionLabel || '确定'
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

    overlay.appendChild(UI.el('div', {
      class: 'overlay__icon',
      'aria-hidden': 'true',
      text: options.icon || '🎯'
    }));
    overlay.appendChild(UI.el('h2', { class: 'overlay__title', text: options.title || '' }));
    overlay.appendChild(UI.el('p', { class: 'overlay__text', text: options.text || '' }));
    overlay.appendChild(actions);
  }

  function hideOverlay() {
    overlay.hidden = true;
    overlay.innerHTML = '';
  }

  /* ---------- 输入 ---------- */

  var KEY_ACTIONS = {
    ArrowLeft: function () { moveHorizontal(-1); },
    ArrowRight: function () { moveHorizontal(1); },
    ArrowDown: softDrop,
    ArrowUp: rotate,
    a: function () { moveHorizontal(-1); },
    d: function () { moveHorizontal(1); },
    s: softDrop,
    w: rotate,
    A: function () { moveHorizontal(-1); },
    D: function () { moveHorizontal(1); },
    S: softDrop,
    W: rotate,
    x: rotate,
    X: rotate
  };

  global.addEventListener('keydown', function (e) {
    var tag = e.target && e.target.tagName;
    var onControl = tag === 'BUTTON' || tag === 'A' || tag === 'INPUT';

    var action = KEY_ACTIONS[e.key];
    if (action) {
      if (onControl) return;
      e.preventDefault();
      action();
      return;
    }

    if (e.key === ' ' || e.code === 'Space') {
      if (onControl) return;
      e.preventDefault();
      hardDrop();
      return;
    }

    if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
      e.preventDefault();
      setPaused(!state.paused);
    }
  });

  UI.onSwipe(board, function (dir) {
    if (dir === 'left') moveHorizontal(-1);
    else if (dir === 'right') moveHorizontal(1);
    else if (dir === 'down') softDrop();
    else rotate();
  });

  // 轻点棋盘 = 旋转（滑动由 UI.onSwipe 处理，这里只响应原地点击）。
  var tapStart = null;
  board.addEventListener('pointerdown', function (e) {
    tapStart = { x: e.clientX, y: e.clientY, t: Date.now() };
  });
  board.addEventListener('pointerup', function (e) {
    if (!tapStart) return;
    var dx = e.clientX - tapStart.x;
    var dy = e.clientY - tapStart.y;
    var dt = Date.now() - tapStart.t;
    tapStart = null;
    if (dt < 500 && Math.abs(dx) < 12 && Math.abs(dy) < 12) rotate();
  });
  board.addEventListener('pointercancel', function () {
    tapStart = null;
  });

  // 切走标签页或窗口失焦时自动暂停。
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) setPaused(true);
  });
  global.addEventListener('blur', function () {
    setPaused(true);
  });

  page.onNewGame(reset);

  /* ---------- 启动 ---------- */

  if (load()) {
    page.beginRun();
    page.renderBest(page.getBest());
    updateStats();
    paintPreview();
    paint();

    if (state.over) {
      showGameOver();
    } else if (state.paused) {
      pauseBtn.textContent = '▶ 继续';
      showOverlay({
        icon: '⏸️',
        title: '已暂停',
        text: '按 P 或点击「继续」回到游戏。',
        actionLabel: '继续',
        onAction: function () {
          setPaused(false);
        }
      });
    } else {
      schedule();
    }
  } else {
    reset();
  }
})(window);
