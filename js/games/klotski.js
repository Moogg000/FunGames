/*
 * klotski.js — 数字华容道（n×n 滑块复原）。
 *
 * 目标：把数字复原为从左到右、从上到下 1..n*n-1，空格停在最后。
 *
 * 规格：3×3 / 4×4 / 5×5 三档，默认 4×4；每个尺寸有独立的存档与最高分。
 * 输入：点击与空格同行/同列的方块（整段滑动）· 拖动方块 · 方向键。
 * 计时：第一次移动后起表，切走标签页 / 失焦自动暂停；用时即最高分（精确到 0.1s）。
 * 提示：调用 KlotskiSolver（IDA* + 加权兜底）给出一步建议；用过提示的局不计入纪录。
 * 撤销：无限步回退（不回退计时）。
 */
(function (global) {
  'use strict';

  var Storage = global.FunGamesStorage;
  var UI = global.FunGamesUI;
  var Solver = global.KlotskiSolver;

  var SIZES = [
    { n: 3, label: '3×3', scramble: 30 },
    { n: 4, label: '4×4', scramble: 60 },
    { n: 5, label: '5×5', scramble: 60 }
  ];
  var SIZE_BY_N = { 3: SIZES[0], 4: SIZES[1], 5: SIZES[2] };

  var DEFAULT_SIZE = 4;

  var HINT_TIME_LIMIT = 800;        // 求最优解的预算
  var HINT_FALLBACK_LIMIT = 1200;   // 求次优解的预算

  var state = {
    size: DEFAULT_SIZE,
    tiles: [],
    history: [],
    elapsed: 0,       // 已累积的毫秒（不含当前这段运行时间）
    startedAt: 0,
    started: false,   // 是否已经下过第一步（起表）
    running: false,
    over: false,
    usedHint: false,
    hintPath: null,   // 缓存的剩余解法（格子下标序列）
    hintCell: -1,
    playing: false,   // 是否正在演示完整解法
    playbackMoves: [],
    playbackIndex: 0,
    playbackTimer: null,
    paused: false
  };

  /* ---------- 页面框架 ---------- */

  var page = UI.createPage({
    title: '数字华容道',
    subtitle: '把数字复原为 1…N',
    backHref: '../index.html',
    best: {
      storageKey: function () {
        return 'klotski:best:' + state.size;
      },
      label: '最短时间',
      lowerIsBetter: true,
      format: function (v) {
        return UI.formatClock(v);
      }
    }
  });

  var timeEl = UI.el('strong', { text: '0:00.0' });
  var bestEl = UI.el('strong', { text: '—' });
  var statusEl = UI.el('p', { class: 'panel__hint', 'aria-live': 'polite' });
  var ruleEl = UI.el('p', { class: 'panel__hint' });

  var sizeButtons = {};
  var sizeRow = UI.el('div', { class: 'segmented', role: 'group', 'aria-label': '尺寸' });

  SIZES.forEach(function (item) {
    var btn = UI.el('button', {
      class: 'segmented__btn',
      type: 'button',
      'aria-pressed': 'false',
      text: item.label
    });
    btn.addEventListener('click', function () {
      switchSize(item.n);
    });
    sizeButtons[item.n] = btn;
    sizeRow.appendChild(btn);
  });

  var hintBtn = UI.el('button', {
    class: 'btn',
    type: 'button',
    text: '💡 提示'
  });
  hintBtn.addEventListener('click', function () {
    showHint();
  });

  var undoBtn = UI.el('button', {
    class: 'btn btn--ghost',
    type: 'button',
    text: '↩ 撤销'
  });
  undoBtn.addEventListener('click', function () {
    undo();
  });

  var demoBtn = UI.el('button', {
    class: 'btn',
    type: 'button',
    text: '▶ 演示通关'
  });
  demoBtn.addEventListener('click', function () {
    if (state.playing) stopDemo();
    else startDemo();
  });

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
      UI.el('div', { class: 'stat' }, ['本局用时 ', timeEl]),
      UI.el('div', { class: 'stat' }, ['本尺寸最佳 ', bestEl])
    ]),
    UI.el('div', { class: 'stat-row' }, [sizeRow]),
    UI.el('div', { class: 'stat-row' }, [undoBtn, pauseBtn]),
    UI.el('div', { class: 'stat-row' }, [hintBtn, demoBtn]),
    ruleEl,
    statusEl
  ]);

  var board = UI.el('div', {
    class: 'kp__board',
    tabindex: '0',
    role: 'grid',
    'aria-label': '数字华容道棋盘'
  });

  var overlay = UI.el('div', { class: 'overlay', hidden: 'hidden' });
  var stage = UI.el('div', { class: 'kp__stage' }, [board, overlay]);
  var gameArea = UI.el('div', { class: 'kp' }, [panel, stage]);
  page.main.appendChild(gameArea);
  document.getElementById('app').appendChild(page.root);

  /* ---------- 棋盘元素 ---------- */

  var tileEls = [];

  function buildBoard() {
    board.innerHTML = '';
    board.style.setProperty('--n', String(state.size));
    tileEls = [];

    for (var v = 0; v < state.size * state.size; v++) {
      var cell = UI.el('div', {
        class: 'kp__cell' + (v === Solver.BLANK ? ' kp__cell--blank' : ''),
        role: 'gridcell',
        'data-value': String(v),
        'aria-label': v === Solver.BLANK ? '空格' : '数字 ' + v
      });
      if (v !== Solver.BLANK) cell.textContent = String(v);
      board.appendChild(cell);
      tileEls.push(cell);
    }
  }

  function paint() {
    var n = state.size;
    var positionOf = [];
    for (var i = 0; i < state.tiles.length; i++) positionOf[state.tiles[i]] = i;

    for (var v = 0; v < state.tiles.length; v++) {
      var el = tileEls[v];
      var idx = positionOf[v];
      var r = Math.floor(idx / n);
      var c = idx % n;
      el.style.transform = 'translate(' + c * 100 + '%,' + r * 100 + '%)';

      var cls = 'kp__cell';
      if (v === Solver.BLANK) {
        cls += ' kp__cell--blank';
      } else {
        if (positionOf[v] === v - 1) cls += ' kp__cell--ok';
        if (v !== 0 && positionOf[v] === state.hintCell) cls += ' kp__cell--hint';
      }
      if (state.over && v !== Solver.BLANK) cls += ' kp__cell--win';
      el.className = cls;
    }

    ruleEl.textContent = '目标：把数字复原为 1…' + (n * n - 1) +
      ' · 点击或拖动方块滑入空格 · 方向键移动 · P 暂停';
    updateStats();
  }

  function updateStats() {
    timeEl.textContent = UI.formatClock(currentElapsed());
    var best = page.getBest();
    bestEl.textContent = best === null || best === undefined ? '—' : UI.formatClock(best);
  }

  /* ---------- 计时 ---------- */

  function currentElapsed() {
    return state.elapsed + (state.running ? Date.now() - state.startedAt : 0);
  }

  var ticker = null;

  function startTicker() {
    stopTicker();
    var ticks = 0;
    ticker = setInterval(function () {
      if (!state.running) return;
      timeEl.textContent = UI.formatClock(currentElapsed());
      // 每秒落盘一次：中途刷新 / 关闭页面也不会丢掉已经用掉的时间。
      if (++ticks % 10 === 0) save();
    }, 100);
  }

  function stopTicker() {
    if (ticker !== null) {
      clearInterval(ticker);
      ticker = null;
    }
  }

  function pauseTimer() {
    if (!state.running) return;
    state.elapsed = currentElapsed();
    state.running = false;
    save();
  }

  function resumeTimer() {
    if (!state.started || state.running || state.over) return;
    state.running = true;
    state.startedAt = Date.now();
    startTicker();
  }

  function ensureStarted() {
    if (state.started) return;
    state.started = true;
    state.running = true;
    state.startedAt = Date.now();
    startTicker();
  }

  /*
   * 手动暂停 / 继续（贪吃蛇、俄罗斯方块同款交互）。
   * 暂停时停表、锁住棋盘输入，并弹出「已暂停」遮罩；必须由玩家主动继续。
   */
  function setPaused(paused) {
    if (state.over) paused = false;
    if (state.paused === paused) return;

    state.paused = paused;
    pauseBtn.textContent = paused ? '▶ 继续' : '⏸ 暂停';

    if (paused) {
      stopDemo();          // 暂停时先把演示停下来，避免棋还在自己走
      pauseTimer();
      save();
      showOverlay({
        icon: '⏸️',
        title: '已暂停',
        text: '计时已停止。按 P 或点击「继续」回到游戏。',
        actionLabel: '继续',
        onAction: function () {
          setPaused(false);
        }
      });
    } else {
      hideOverlay();
      resumeTimer();
    }
  }

  /* ---------- 存档 ---------- */

  /*
   * 存档：直接把「当前累计用时」写进存储，不动内存里的运行态。
   *
   * 早先是先把运行态归一化（running 置 false）再存，结果每次落子保存后
   * 计时器就停了 —— 画面上的时间会一直停在第一手的时刻。暂停/恢复统一
   * 由 pauseTimer / resumeTimer 显式处理，保存这边只读不写。
   */
  function save() {
    Storage.set('klotski:state:' + state.size, {
      tiles: state.tiles,
      history: state.history,
      elapsed: currentElapsed(),
      started: state.started,
      usedHint: state.usedHint,
      over: state.over
    });
    Storage.set('klotski:size', state.size);
  }

  function validTiles(arr, n) {
    if (!Array.isArray(arr) || arr.length !== n * n) return false;
    var seen = {};
    for (var i = 0; i < arr.length; i++) {
      var v = arr[i];
      if (typeof v !== 'number' || v < 0 || v >= n * n || seen[v]) return false;
      seen[v] = true;
    }
    return true;
  }

  function loadState(n) {
    var data = Storage.get('klotski:state:' + n, null);
    if (!data || typeof data !== 'object') return false;
    if (!validTiles(data.tiles, n)) return false;

    state.size = n;
    state.tiles = data.tiles.slice(0, n * n);
    state.history = Array.isArray(data.history) ? data.history : [];
    state.elapsed = typeof data.elapsed === 'number' && data.elapsed >= 0
      ? Math.round(data.elapsed) : 0;
    state.started = !!data.started;
    state.running = false;
    state.startedAt = 0;
    state.usedHint = !!data.usedHint;
    state.over = !!data.over;
    state.hintPath = null;
    state.hintCell = -1;
    state.playing = false;
    state.playbackMoves = [];
    state.playbackIndex = 0;
    state.playbackTimer = null;
    state.paused = false;
    pauseBtn.textContent = '⏸ 暂停';
    return true;
  }

  /* ---------- 行棋 ---------- */

  function applySlide(path, recordHistory) {
    if (!path.length || state.over) return false;

    var before = state.tiles.slice();
    var blank = state.tiles.indexOf(Solver.BLANK);

    for (var k = 0; k < path.length; k++) {
      var p = path[k];
      state.tiles[blank] = state.tiles[p];
      state.tiles[p] = Solver.BLANK;
      blank = p;
    }

    if (recordHistory !== false) state.history.push(before);
    state.hintCell = -1;
    afterMove(path.length === 1 ? path[0] : -1);
    return true;
  }

  // 点击：把 pos 处的方块（连同中间的所有块）滑向空格。
  function trySlide(pos) {
    if (state.over || state.playing || state.paused || pos < 0) return false;
    var n = state.size;
    var blank = state.tiles.indexOf(Solver.BLANK);
    if (pos === blank) return false;

    var br = Math.floor(blank / n);
    var bc = blank % n;
    var r = Math.floor(pos / n);
    var c = pos % n;
    var path = [];
    var k;

    if (r === br && c !== bc) {
      if (c < bc) {
        for (k = bc; k > c; k--) path.push(br * n + k - 1);
      } else {
        for (k = bc; k < c; k++) path.push(br * n + k + 1);
      }
    } else if (c === bc && r !== br) {
      if (r < br) {
        for (k = br; k > r; k--) path.push((k - 1) * n + bc);
      } else {
        for (k = br; k < r; k++) path.push((k + 1) * n + bc);
      }
    } else {
      return false;
    }
    return applySlide(path);
  }

  // 单格滑动（方向键）：把指定位置的方块滑进空格。
  function slideTileAt(pos) {
    if (state.over || state.playing || state.paused) return false;
    var blank = state.tiles.indexOf(Solver.BLANK);
    var n = state.size;
    var dr = Math.floor(pos / n) - Math.floor(blank / n);
    var dc = (pos % n) - (blank % n);
    if (Math.abs(dr) + Math.abs(dc) !== 1) return false;
    return applySlide([pos]);
  }

  // 拖动：被拖动的格子与空格同行/同列且朝空格方向。
  function tryDrag(pos, dir) {
    if (state.over || state.playing || state.paused) return false;
    var n = state.size;
    var blank = state.tiles.indexOf(Solver.BLANK);
    var br = Math.floor(blank / n), bc = blank % n;
    var r = Math.floor(pos / n), c = pos % n;

    if (r === br) {
      if (dir === 'left' && c < bc) return trySlide(pos);
      if (dir === 'right' && c > bc) return trySlide(pos);
    } else if (c === bc) {
      if (dir === 'up' && r < br) return trySlide(pos);
      if (dir === 'down' && r > br) return trySlide(pos);
    }
    return false;
  }

  function afterMove(singleTilePos) {
    ensureStarted();

    // 提示路径缓存：只有走出缓存的第一步才继续沿用，否则作废。
    if (singleTilePos >= 0 && state.hintPath && state.hintPath.length) {
      if (state.hintPath[0] === singleTilePos) {
        state.hintPath.shift();
      } else {
        state.hintPath = null;
      }
    } else if (singleTilePos < 0) {
      state.hintPath = null;
    }

    if (Solver.isSolved(state.tiles, state.size)) {
      finish();
      return;
    }

    paint();
    save();
  }

  function finish() {
    state.over = true;
    pauseTimer();
    state.hintCell = -1;
    var ms = currentElapsed();

    var record = false;
    if (!state.usedHint) {
      record = page.setBest(ms);
    }

    paint();
    save();

    var lines = ['用时 ' + UI.formatClock(ms) + ' · ' + SIZE_BY_N[state.size].label];
    if (state.usedHint) {
      lines.push('本局使用了提示或演示，未计入最高分。');
    } else if (record) {
      lines.push('🎉 刷新了本尺寸的最短用时！');
    } else {
      var best = page.getBest();
      lines.push('本尺寸最佳 ' + (best === null || best === undefined ? '—' : UI.formatClock(best)));
    }

    showOverlay({
      icon: '🧩',
      title: '复原完成！',
      text: lines.join('　'),
      actionLabel: '再来一局',
      onAction: reset
    });
  }

  /* ---------- 撤销 / 重开 ---------- */

  function undo() {
    if (state.playing || state.paused || state.over || !state.history.length) return;
    state.tiles = state.history.pop();
    state.hintCell = -1;
    state.hintPath = null;
    paint();
    save();
    setStatus('已撤销一步');
  }

  function reset() {
    stopDemo();
    stopTicker();
    state.size = SIZE_BY_N[state.size].n;
    state.tiles = Solver.scramble(state.size, SIZE_BY_N[state.size].scramble);
    state.history = [];
    state.elapsed = 0;
    state.started = false;
    state.running = false;
    state.startedAt = 0;
    state.over = false;
    state.usedHint = false;
    state.hintPath = null;
    state.hintCell = -1;
    state.paused = false;
    pauseBtn.textContent = '⏸ 暂停';

    page.beginRun();
    page.renderBest(page.getBest());

    hideOverlay();
    setSizeButtons();
    buildBoard();
    paint();
    save();
    setStatus('');
  }

  function switchSize(n) {
    if (n === state.size && !state.over) return;

    stopDemo();
    stopTicker();
    // 先把当前这局存好（每个尺寸的进度互相独立）。
    save();

    var loaded = false;
    if (n !== state.size) {
      loaded = loadState(n);
    }

    if (!loaded) {
      state.size = n;
      state.tiles = Solver.scramble(n, SIZE_BY_N[n].scramble);
      state.history = [];
      state.elapsed = 0;
      state.started = false;
      state.running = false;
      state.startedAt = 0;
      state.over = false;
      state.usedHint = false;
      state.hintPath = null;
      state.hintCell = -1;
      state.playing = false;
      state.playbackMoves = [];
      state.playbackIndex = 0;
      state.playbackTimer = null;
      state.paused = false;
      pauseBtn.textContent = '⏸ 暂停';
    }

    page.beginRun();
    page.renderBest(page.getBest());

    hideOverlay();
    setSizeButtons();
    setDemoPlaying(false);
    buildBoard();
    paint();
    save();

    if (!loaded) setStatus('已切换到 ' + SIZE_BY_N[n].label + '，新的一局');
    else setStatus('已切换到 ' + SIZE_BY_N[n].label);
  }

  function setSizeButtons() {
    Object.keys(sizeButtons).forEach(function (key) {
      sizeButtons[key].setAttribute('aria-pressed', String(Number(key) === state.size));
    });
  }

  /* ---------- 提示 ---------- */

  function showHint() {
    if (state.over || state.playing || state.paused) return;
    if (Solver.isSolved(state.tiles, state.size)) return;

    if (state.hintPath && state.hintPath.length) {
      presentHint(state.hintPath[0], false);
      return;
    }

    setStatus('正在求解…');
    // 让状态文字先渲染，再开始阻塞式搜索。
    var boardRef = state.tiles;
    setTimeout(function () {
      if (state.tiles !== boardRef) return;   // 期间已经换局 / 换尺寸
      if (state.over) return;

      var result = Solver.solve(state.tiles, state.size, {
        timeLimit: HINT_TIME_LIMIT,
        fallbackTimeLimit: HINT_FALLBACK_LIMIT
      });

      if (result.found && result.moves.length) {
        state.hintPath = result.moves.slice();
        state.usedHint = true;
        presentHint(state.hintPath[0], !!result.greedy || !!result.suboptimal);
        save();
      } else {
        setStatus('这一局暂时解不出来，换个局面试试');
      }
    }, 30);
  }

  function presentHint(cellIndex, approximate) {
    state.hintCell = cellIndex;
    paint();
    setStatus(approximate
      ? '已给出一个建议走法（非最优解）'
      : '建议滑动高亮的方块');
    setTimeout(function () {
      if (state.hintCell === cellIndex) {
        state.hintCell = -1;
        paint();
      }
    }, 2500);
  }

  /* ---------- 完整解法演示 ---------- */

  var DEMO_STEP_MS = 160;

  function startDemo() {
    if (state.over || state.playing || state.paused) return;
    if (Solver.isSolved(state.tiles, state.size)) return;

    setStatus('正在求解完整解法…');
    var boardRef = state.tiles;
    setTimeout(function () {
      if (state.tiles !== boardRef) return;   // 期间已经换局 / 换尺寸
      if (state.over || state.playing) return;

      var result = Solver.solve(state.tiles, state.size, {
        timeLimit: HINT_TIME_LIMIT,
        fallbackTimeLimit: HINT_FALLBACK_LIMIT
      });
      if (state.over || state.playing) return;

      // 只有单步贪心兜底时拿不到「完整解法」，退化为单步提示。
      if (!result.found || !result.moves.length) {
        setStatus('这一局暂时解不出来，换个局面试试');
        return;
      }
      if (result.greedy) {
        state.usedHint = true;
        presentHint(result.moves[0], true);
        save();
        return;
      }

      state.usedHint = true;
      state.hintPath = null;
      state.hintCell = -1;
      state.playing = true;
      state.playbackMoves = result.moves.slice();
      state.playbackIndex = 0;
      setDemoPlaying(true);
      save();

      setStatus('正在演示完整解法（共 ' + result.moves.length + ' 步）· 点「停止」可中断');
      demoStep();
    }, 30);
  }

  function demoStep() {
    if (!state.playing) return;
    if (state.playbackIndex >= state.playbackMoves.length) {
      stopDemo();
      return;
    }

    var pos = state.playbackMoves[state.playbackIndex++];
    applySlide([pos], false);   // 演示过程不进撤销历史

    if (state.over) {
      stopDemo();
      return;
    }
    scheduleDemo();
  }

  function scheduleDemo() {
    clearDemoTimer();
    state.playbackTimer = setTimeout(demoStep, DEMO_STEP_MS);
  }

  function clearDemoTimer() {
    if (state.playbackTimer !== null) {
      clearTimeout(state.playbackTimer);
      state.playbackTimer = null;
    }
  }

  function stopDemo(message) {
    clearDemoTimer();
    var wasPlaying = state.playing;
    state.playing = false;
    state.playbackMoves = [];
    state.playbackIndex = 0;
    setDemoPlaying(false);
    if (wasPlaying && !state.over) setStatus(message || '已停止演示');
  }

  function setDemoPlaying(on) {
    demoBtn.textContent = on ? '⏹ 停止' : '▶ 演示通关';
  }

  /* ---------- 状态栏 / 遮罩 ---------- */

  function setStatus(text) {
    statusEl.textContent = text || '';
  }

  function showOverlay(options) {
    overlay.innerHTML = '';
    overlay.hidden = false;

    var primary = UI.el('button', {
      class: 'btn' + (options.danger ? ' btn--danger' : ''),
      type: 'button',
      text: options.actionLabel || '再来一局'
    });
    primary.addEventListener('click', function () {
      if (options.onAction) options.onAction();
    });

    overlay.appendChild(UI.el('div', {
      class: 'overlay__icon',
      'aria-hidden': 'true',
      text: options.icon || '🎯'
    }));
    overlay.appendChild(UI.el('h2', { class: 'overlay__title', text: options.title || '' }));
    overlay.appendChild(UI.el('p', { class: 'overlay__text', text: options.text || '' }));
    overlay.appendChild(UI.el('div', { class: 'overlay__actions' }, [primary]));
  }

  function hideOverlay() {
    overlay.hidden = true;
    overlay.innerHTML = '';
  }

  /* ---------- 输入 ---------- */

  var dragStart = null;

  board.addEventListener('pointerdown', function (e) {
    if (state.over || state.playing || state.paused) return;
    var cell = e.target && e.target.closest ? e.target.closest('.kp__cell') : null;
    if (!cell) return;
    dragStart = {
      value: parseInt(cell.getAttribute('data-value'), 10),
      x: e.clientX,
      y: e.clientY
    };
  });

  board.addEventListener('pointerup', function (e) {
    if (!dragStart) return;
    var start = dragStart;
    dragStart = null;
    if (state.over || state.playing || state.paused) return;

    var dx = e.clientX - start.x;
    var dy = e.clientY - start.y;

    var positionOf = [];
    for (var i = 0; i < state.tiles.length; i++) positionOf[state.tiles[i]] = i;
    var pos = positionOf[start.value];

    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) {
      if (trySlide(pos)) return;
    }

    var dir = Math.abs(dx) > Math.abs(dy)
      ? (dx > 0 ? 'right' : 'left')
      : (dy > 0 ? 'down' : 'up');
    tryDrag(pos, dir);
  });

  board.addEventListener('pointercancel', function () {
    dragStart = null;
  });

  board.addEventListener('keydown', function (e) {
    if (state.over || state.playing || state.paused) return;
    var n = state.size;
    var blank = state.tiles.indexOf(Solver.BLANK);
    var r = Math.floor(blank / n);
    var c = blank % n;
    var target = -1;

    if (e.key === 'ArrowUp' && r < n - 1) target = blank + n;
    else if (e.key === 'ArrowDown' && r > 0) target = blank - n;
    else if (e.key === 'ArrowLeft' && c < n - 1) target = blank + 1;
    else if (e.key === 'ArrowRight' && c > 0) target = blank - 1;
    else if ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      undo();
      return;
    } else if (e.key === 'z' || e.key === 'Z') {
      e.preventDefault();
      undo();
      return;
    } else {
      return;
    }

    e.preventDefault();
    slideTileAt(target);
  });

  global.addEventListener('keydown', function (e) {
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
      e.preventDefault();
      setPaused(!state.paused);
      return;
    }

    if (state.paused || state.playing) return;

    if (e.key === 'u' || e.key === 'U') {
      e.preventDefault();
      undo();
    }
  });

  // 切走标签页 / 窗口失焦：自动暂停（和贪吃蛇、俄罗斯方块一致）；回来不自动继续。
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) setPaused(true);
  });
  global.addEventListener('blur', function () {
    setPaused(true);
  });

  page.onNewGame(reset);

  /* ---------- 启动 ---------- */

  var initialSize = Storage.get('klotski:size', DEFAULT_SIZE);
  if (!SIZE_BY_N[initialSize]) initialSize = DEFAULT_SIZE;

  if (!loadState(initialSize)) {
    state.size = initialSize;
    state.tiles = Solver.scramble(initialSize, SIZE_BY_N[initialSize].scramble);
    state.history = [];
    state.elapsed = 0;
    state.started = false;
    state.running = false;
    state.over = false;
    state.usedHint = false;
    state.paused = false;
    pauseBtn.textContent = '⏸ 暂停';
  }

  page.beginRun();
  page.renderBest(page.getBest());
  setSizeButtons();
  buildBoard();
  paint();
  save();
  if (state.started && !state.over) resumeTimer();
  if (state.over) {
    // 上次的局面已经结束，直接重开一局更友好。
    reset();
  }
})(window);
