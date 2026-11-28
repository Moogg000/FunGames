/*
 * minesweeper.js — classic Minesweeper.
 *
 * Input:
 *   - tap / left click ........ reveal
 *   - long press / right click  flag
 *   - Enter / Space on a cell . reveal (keyboard)
 *   - "Flag mode" toggle ...... every tap flags (useful on small screens)
 *
 * The first click is always safe. Best time is stored per difficulty in
 * localStorage under "fungames:minesweeper:best"; unfinished boards are kept
 * under "fungames:minesweeper:state" so leaving and coming back resumes the
 * same game (finished games leave no save behind).
 */
(function (global) {
  'use strict';

  var UI = global.FunGamesUI;
  var Storage = global.FunGamesStorage;

  var DIFFICULTIES = [
    { id: 'beginner', label: '初级', rows: 9, cols: 9, mines: 10 },
    { id: 'intermediate', label: '中级', rows: 16, cols: 16, mines: 40 },
    { id: 'expert', label: '高级', rows: 16, cols: 30, mines: 99 }
  ];

  var LONG_PRESS_MS = 380;

  // 未完成对局的存档键。已结束（胜利 / 踩雷）的对局不保留，下次进来开新局。
  var SAVE_KEY = 'minesweeper:state';

  // 当前难度对应的存储键。createPage() 的 storageKey 支持函数，
  // 这样切换难度时，标题栏徽章会自动显示该难度的最佳时间。
  var currentDifficultyId = DIFFICULTIES[0].id;

  var page = UI.createPage({
    title: '扫雷',
    subtitle: '点击翻格 · 长按插旗',
    backHref: '../index.html',
    best: {
      storageKey: function () {
        return 'minesweeper:best:' + currentDifficultyId;
      },
      label: '最佳时间',
      lowerIsBetter: true,
      format: UI.formatTime
    }
  });

  /* ---------- DOM ---------- */

  var diffButtons = {};
  var diffRow = UI.el('div', { class: 'segmented', role: 'group', 'aria-label': '难度' });

  DIFFICULTIES.forEach(function (diff) {
    var btn = UI.el('button', {
      class: 'segmented__btn',
      type: 'button',
      'aria-pressed': 'false',
      text: diff.label
    });
    btn.addEventListener('click', function () {
      newGame(diff.id);
    });
    diffButtons[diff.id] = btn;
    diffRow.appendChild(btn);
  });

  var flagModeBtn = UI.el('button', {
    class: 'segmented__btn ms-flag-toggle',
    type: 'button',
    'aria-pressed': 'false',
    text: '🚩 插旗模式'
  });
  flagModeBtn.addEventListener('click', function () {
    state.flagMode = !state.flagMode;
    flagModeBtn.setAttribute('aria-pressed', String(state.flagMode));
    page.toast(state.flagMode ? '插旗模式已开启：轻点即可插旗' : '插旗模式已关闭：轻点可翻格');
  });

  var minesLeftEl = UI.el('strong', { text: '0' });
  var timeEl = UI.el('strong', { text: '0:00' });

  var panel = UI.el('section', { class: 'panel' }, [
    UI.el('div', { class: 'stat-row' }, [
      diffRow,
      flagModeBtn
    ]),
    UI.el('div', { class: 'stat-row' }, [
      UI.el('div', { class: 'stat' }, ['剩余地雷 ', minesLeftEl]),
      UI.el('div', { class: 'stat' }, ['用时 ', timeEl])
    ]),
    UI.el('p', { class: 'panel__hint' }, [
      '揭开所有不是地雷的格子。格子中的数字表示周围 8 格内有多少颗地雷。' +
      '触屏设备可以长按格子来插旗。'
    ])
  ]);

  var boardScroll = UI.el('div', { class: 'ms-board-scroll' });
  var board = UI.el('div', {
    class: 'ms-board',
    role: 'grid',
    'aria-label': '扫雷棋盘'
  });
  boardScroll.appendChild(board);

  var overlay = UI.el('div', { class: 'overlay', hidden: 'hidden' });
  var stage = UI.el('div', { class: 'ms-stage' }, [boardScroll, overlay]);

  var gameArea = UI.el('div', { class: 'ms-wrap' }, [panel, stage]);
  page.main.appendChild(gameArea);
  document.getElementById('app').appendChild(page.root);

  /* ---------- State ---------- */

  var state = {
    difficulty: DIFFICULTIES[0],
    rows: 0,
    cols: 0,
    mines: 0,
    grid: [],
    firstClick: true,
    over: false,
    won: false,
    flags: 0,
    opened: 0,
    seconds: 0,
    timerId: null,
    flagMode: false
  };

  /* ---------- Helpers ---------- */

  function neighbors(index) {
    var r = Math.floor(index / state.cols);
    var c = index % state.cols;
    var out = [];
    for (var dr = -1; dr <= 1; dr++) {
      for (var dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        var nr = r + dr;
        var nc = c + dc;
        if (nr < 0 || nr >= state.rows || nc < 0 || nc >= state.cols) continue;
        out.push(nr * state.cols + nc);
      }
    }
    return out;
  }

  function startTimer(fromSeconds) {
    stopTimer();
    state.seconds = fromSeconds || 0;
    timeEl.textContent = UI.formatTime(state.seconds);
    state.timerId = setInterval(function () {
      state.seconds++;
      timeEl.textContent = UI.formatTime(state.seconds);
    }, 1000);
  }

  function stopTimer() {
    if (state.timerId !== null) {
      clearInterval(state.timerId);
      state.timerId = null;
    }
  }

  /* ---------- Game flow ---------- */

  function newGame(difficultyId) {
    var diff = DIFFICULTIES.filter(function (d) {
      return d.id === difficultyId;
    })[0] || DIFFICULTIES[0];

    state.difficulty = diff;
    currentDifficultyId = diff.id;
    state.rows = diff.rows;
    state.cols = diff.cols;
    state.mines = diff.mines;
    state.grid = [];
    state.firstClick = true;
    state.over = false;
    state.won = false;
    state.flags = 0;
    state.opened = 0;
    state.flagMode = false;

    flagModeBtn.setAttribute('aria-pressed', 'false');

    Object.keys(diffButtons).forEach(function (id) {
      diffButtons[id].setAttribute('aria-pressed', String(id === diff.id));
    });

    stopTimer();
    hideOverlay();
    timeEl.textContent = UI.formatTime(0);
    minesLeftEl.textContent = String(state.mines);

    var total = state.rows * state.cols;
    for (var i = 0; i < total; i++) {
      state.grid.push({ mine: false, open: false, flag: false, adj: 0 });
    }

    buildBoard();
    page.beginRun();
    page.renderBest(page.getBest());
  }

  /* ---------- 存档（退出再进入可续玩） ---------- */

  /*
   * 只保存「未完成」的对局。结束时（胜利或踩雷）会删掉存档，
   * 这样下次从首页进来就是干净的一局，而不是一个已经翻开的终局。
   */
  function save() {
    if (state.over) return;
    Storage.set(SAVE_KEY, {
      v: 1,
      difficulty: state.difficulty.id,
      rows: state.rows,
      cols: state.cols,
      mines: state.mines,
      flags: state.flags,
      opened: state.opened,
      seconds: state.seconds,
      firstClick: state.firstClick,
      grid: state.grid.map(function (c) {
        return [c.mine ? 1 : 0, c.open ? 1 : 0, c.flag ? 1 : 0, c.adj];
      })
    });
  }

  function discardSave() {
    Storage.remove(SAVE_KEY);
  }

  function loadState() {
    var d = Storage.get(SAVE_KEY, null);
    if (!d || d.v !== 1) return false;

    var diff = DIFFICULTIES.filter(function (x) { return x.id === d.difficulty; })[0];
    if (!diff) return false;
    if (d.rows !== diff.rows || d.cols !== diff.cols || d.mines !== diff.mines) return false;
    var total = diff.rows * diff.cols;
    if (!Array.isArray(d.grid) || d.grid.length !== total) return false;
    for (var i = 0; i < d.grid.length; i++) {
      if (!Array.isArray(d.grid[i]) || d.grid[i].length !== 4) return false;
    }

    state.difficulty = diff;
    currentDifficultyId = diff.id;
    state.rows = diff.rows;
    state.cols = diff.cols;
    state.mines = diff.mines;
    state.firstClick = !!d.firstClick;
    state.over = false;
    state.won = false;
    state.flags = typeof d.flags === 'number' ? d.flags : 0;
    state.opened = typeof d.opened === 'number' ? d.opened : 0;
    state.seconds = typeof d.seconds === 'number' ? d.seconds : 0;
    state.flagMode = false;
    state.grid = d.grid.map(function (g) {
      return { mine: !!g[0], open: !!g[1], flag: !!g[2], adj: g[3] | 0 };
    });

    flagModeBtn.setAttribute('aria-pressed', 'false');
    Object.keys(diffButtons).forEach(function (id) {
      diffButtons[id].setAttribute('aria-pressed', String(id === diff.id));
    });

    hideOverlay();
    buildBoard();
    page.beginRun();
    page.renderBest(page.getBest());

    minesLeftEl.textContent = String(Math.max(0, state.mines - state.flags));
    // 还没首击就还没起表；否则从存档的秒数继续计时。
    if (!state.firstClick) startTimer(state.seconds);

    return true;
  }

  function buildBoard() {
    board.innerHTML = '';
    board.style.gridTemplateColumns = 'repeat(' + state.cols + ', var(--cell))';
    board.style.setProperty('--cell', '32px');

    for (var i = 0; i < state.rows * state.cols; i++) {
      var cell = UI.el('button', {
        class: 'ms-cell',
        type: 'button',
        'data-index': String(i),
        'aria-label': '未翻开的格子'
      });
      board.appendChild(cell);
    }

    fitBoard();
    paintAll();
  }

  function fitBoard() {
    var available = boardScroll.clientWidth - 10;
    var gap = 2;
    var cell = Math.floor((available - (state.cols - 1) * gap) / state.cols);
    cell = Math.max(20, Math.min(34, cell));
    board.style.setProperty('--cell', cell + 'px');
  }

  function placeMines(safeIndex) {
    var total = state.rows * state.cols;
    var forbidden = {};
    forbidden[safeIndex] = true;
    neighbors(safeIndex).forEach(function (n) {
      forbidden[n] = true;
    });

    var pool = [];
    for (var i = 0; i < total; i++) {
      if (!forbidden[i]) pool.push(i);
    }
    if (pool.length < state.mines) {
      pool = [];
      for (var j = 0; j < total; j++) {
        if (j !== safeIndex) pool.push(j);
      }
    }

    for (var k = pool.length - 1; k > 0; k--) {
      var m = Math.floor(Math.random() * (k + 1));
      var tmp = pool[k];
      pool[k] = pool[m];
      pool[m] = tmp;
    }
    for (var p = 0; p < state.mines; p++) {
      state.grid[pool[p]].mine = true;
    }

    for (var idx = 0; idx < total; idx++) {
      if (state.grid[idx].mine) continue;
      state.grid[idx].adj = neighbors(idx).filter(function (n) {
        return state.grid[n].mine;
      }).length;
    }
  }

  function reveal(index) {
    if (state.over) return;
    var cell = state.grid[index];
    if (!cell || cell.open || cell.flag) return;

    if (state.firstClick) {
      placeMines(index);
      state.firstClick = false;
      startTimer();
    }

    var stack = [index];
    while (stack.length) {
      var current = stack.pop();
      var node = state.grid[current];
      if (node.open || node.flag) continue;

      node.open = true;
      state.opened++;

      if (node.mine) {
        // lose() reveals every mine, repaints the board and marks the cell
        // that was clicked, so there is nothing left to do here.
        lose(current);
        return;
      }

      if (node.adj === 0) {
        neighbors(current).forEach(function (n) {
          if (!state.grid[n].open && !state.grid[n].flag) stack.push(n);
        });
      }
    }

    paintAll();
    checkWin();
    save();
  }

  function toggleFlag(index) {
    if (state.over) return;
    var cell = state.grid[index];
    if (!cell || cell.open) return;

    cell.flag = !cell.flag;
    state.flags += cell.flag ? 1 : -1;
    minesLeftEl.textContent = String(state.mines - state.flags);
    paintCell(index);
    save();
  }

  function handlePrimary(index) {
    if (state.flagMode) {
      toggleFlag(index);
    } else {
      reveal(index);
    }
  }

  function checkWin() {
    if (state.opened !== state.rows * state.cols - state.mines) return;
    state.over = true;
    state.won = true;
    stopTimer();

    // Auto-flag the remaining mines for a tidy board.
    for (var i = 0; i < state.grid.length; i++) {
      if (state.grid[i].mine && !state.grid[i].flag) {
        state.grid[i].flag = true;
        state.flags++;
      }
    }
    minesLeftEl.textContent = '0';
    paintAll();
    discardSave();          // 已结束，不留存档，下次进来开新局

    var isRecord = page.setBest(state.seconds);
    showOverlay({
      title: '恭喜，全部排完！🎉',
      text: '用时：' + UI.formatTime(state.seconds) + (isRecord ? ' —— 新纪录！' : '。'),
      actionLabel: '再来一局'
    });
    page.toast('用时 ' + UI.formatTime(state.seconds) + ' 完成');
    if (global.navigator && global.navigator.vibrate) global.navigator.vibrate([40, 60, 40]);
  }

  function lose(boomIndex) {
    state.over = true;
    state.won = false;
    stopTimer();

    for (var i = 0; i < state.grid.length; i++) {
      if (state.grid[i].mine) state.grid[i].open = true;
    }
    paintAll();
    discardSave();          // 已结束，不留存档

    var boom = board.querySelector('[data-index="' + boomIndex + '"]');
    if (boom) boom.classList.add('ms-cell--boom');

    showOverlay({
      title: '💥 轰！',
      text: '你在 ' + UI.formatTime(state.seconds) + ' 后踩到了地雷。',
      actionLabel: '重试一次',
      danger: true
    });
    page.toast('踩到地雷，游戏结束');
    if (global.navigator && global.navigator.vibrate) global.navigator.vibrate(120);
  }

  /* ---------- Rendering ---------- */

  function paintCell(index) {
    var node = board.querySelector('[data-index="' + index + '"]');
    var data = state.grid[index];
    if (!node || !data) return;

    var classes = ['ms-cell'];
    var text = '';
    var label = '未翻开的格子';

    if (data.open) {
      classes.push('ms-cell--open');
      if (data.mine) {
        classes.push('ms-cell--mine');
        text = '💣';
        label = '地雷';
      } else if (data.adj > 0) {
        classes.push('ms-n' + data.adj);
        text = String(data.adj);
        label = '周围有 ' + data.adj + ' 颗地雷';
      } else {
        label = '空格';
      }
    } else if (data.flag) {
      classes.push('ms-cell--flag');
      text = '🚩';
      label = '已插旗的格子';
    }

    node.className = classes.join(' ');
    node.textContent = text;
    node.setAttribute('aria-label', label);
  }

  function paintAll() {
    for (var i = 0; i < state.grid.length; i++) paintCell(i);
  }

  function showOverlay(options) {
    overlay.innerHTML = '';
    overlay.hidden = false;

    var action = UI.el('button', {
      class: 'btn' + (options.danger ? ' btn--danger' : ''),
      type: 'button',
      text: options.actionLabel || '再来一局'
    });
    action.addEventListener('click', function () {
      newGame(state.difficulty.id);
    });

    overlay.appendChild(UI.el('div', { class: 'overlay__icon', 'aria-hidden': 'true', text: options.icon || '🎯' }));
    overlay.appendChild(UI.el('h2', { class: 'overlay__title', text: options.title }));
    overlay.appendChild(UI.el('p', { class: 'overlay__text', text: options.text }));
    overlay.appendChild(UI.el('div', { class: 'overlay__actions' }, [action]));
  }

  function hideOverlay() {
    overlay.hidden = true;
    overlay.innerHTML = '';
  }

  /* ---------- Input ---------- */

  function indexFromEvent(e) {
    var node = e.target && e.target.closest ? e.target.closest('.ms-cell') : null;
    if (!node) return null;
    var raw = node.getAttribute('data-index');
    var idx = parseInt(raw, 10);
    return isNaN(idx) ? null : idx;
  }

  var pressTimer = null;
  var pressIndex = null;
  var longPressFired = false;
  var longPressAt = 0;

  function clearPress() {
    if (pressTimer !== null) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
    pressIndex = null;
  }

  board.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    var idx = indexFromEvent(e);
    if (idx === null) return;
    pressIndex = idx;
    longPressFired = false;

    pressTimer = setTimeout(function () {
      longPressFired = true;
      longPressAt = Date.now();
      clearPress();
      toggleFlag(pressIndex === null ? idx : pressIndex);
      if (global.navigator && global.navigator.vibrate) global.navigator.vibrate(25);
    }, LONG_PRESS_MS);
  });

  board.addEventListener('pointerup', function (e) {
    var wasLongPress = longPressFired;
    var idx = indexFromEvent(e);
    clearPress();
    if (wasLongPress) return;
    if (idx === null) return;
    handlePrimary(idx);
  });

  board.addEventListener('pointercancel', clearPress);
  board.addEventListener('pointermove', function (e) {
    // Cancel the long-press if the finger slides off the starting tile.
    if (pressTimer === null || pressIndex === null) return;
    var idx = indexFromEvent(e);
    if (idx !== pressIndex) clearPress();
  });

  board.addEventListener('contextmenu', function (e) {
    e.preventDefault();
    // Touch browsers synthesise a context menu right after a long press;
    // ignore it so the long-press flag is not immediately toggled back.
    if (Date.now() - longPressAt < 600) return;
    var idx = indexFromEvent(e);
    if (idx !== null) toggleFlag(idx);
  });

  board.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var idx = indexFromEvent(e);
    if (idx === null) return;
    e.preventDefault();
    handlePrimary(idx);
  });

  global.addEventListener('resize', fitBoard);

  page.onNewGame(function () {
    newGame(state.difficulty.id);
  });

  // 优先恢复未完成的对局；没有存档才开新局。
  if (!loadState()) {
    newGame(currentDifficultyId || DIFFICULTIES[0].id);
  }
})(window);
