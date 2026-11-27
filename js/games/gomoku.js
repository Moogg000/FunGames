/*
 * gomoku.js — 五子棋（25 路棋盘）。
 *
 * 玩家先手执黑，AI 执白。先在横 / 竖 / 斜任意方向连成 5 子者获胜。
 *
 * AI 引擎在 gomoku-ai.js（window.GomokuAI）：
 *   简单 —— 一步启发式（进攻 + 防守加权 + 少量随机扰动）
 *   困难 —— Minimax + Alpha-Beta + 迭代加深 + 置换表（异步执行，不卡界面）
 *
 * 最高分 = 最高连胜：赢一场连胜 +1，输或平局清零。
 * 棋盘、回合、难度、连胜与战绩都会写入 localStorage，刷新后接着下。
 */
(function (global) {
  'use strict';

  var Engine = global.GomokuAI;
  var SIZE = Engine.SIZE;
  var COUNT = Engine.CELL_COUNT;
  var HUMAN = Engine.HUMAN;     // 1 = 玩家（黑）
  var MACHINE = Engine.AI;      // 2 = AI（白）

  var STATE_KEY = 'gomoku:state';
  var STREAK_KEY = 'gomoku:streak';
  var BEST_KEY = 'gomoku:best';
  var RECORD_KEY = 'gomoku:record';

  var DIFFICULTIES = [
    { id: 'easy', label: '简单' },
    { id: 'hard', label: '困难' }
  ];
  var DIFFICULTY_IDS = { easy: true, hard: true };

  var state = {
    board: newUint8Array(),
    turn: 'player',
    over: false,
    result: null,
    difficulty: 'easy',
    lastMove: -1,
    winLine: null,
    locked: false,
    cursor: 12 * SIZE + 12
  };

  function newUint8Array() {
    return new Uint8Array(COUNT);
  }

  var page = global.FunGamesUI.createPage({
    title: '五子棋',
    subtitle: '25 路棋盘 · 你先手执黑',
    backHref: '../index.html',
    best: {
      storageKey: BEST_KEY,
      label: '最高连胜',
      format: function (v) {
        return v + ' 场';
      }
    }
  });

  /* ---------- DOM ---------- */

  var streakEl = global.FunGamesUI.el('strong', { text: '0' });
  var bestEl = global.FunGamesUI.el('strong', { text: '—' });
  var recordEl = global.FunGamesUI.el('strong', { text: '0 胜 0 负 0 平' });
  var statusEl = global.FunGamesUI.el('p', {
    class: 'panel__hint',
    'aria-live': 'polite'
  });

  var diffButtons = {};
  var diffRow = global.FunGamesUI.el('div', {
    class: 'segmented',
    role: 'group',
    'aria-label': '难度'
  });

  DIFFICULTIES.forEach(function (diff) {
    var btn = global.FunGamesUI.el('button', {
      class: 'segmented__btn',
      type: 'button',
      'aria-pressed': 'false',
      text: diff.label
    });
    btn.addEventListener('click', function () {
      setDifficulty(diff.id);
    });
    diffButtons[diff.id] = btn;
    diffRow.appendChild(btn);
  });

  var panel = global.FunGamesUI.el('section', { class: 'panel' }, [
    global.FunGamesUI.el('div', { class: 'stat-row' }, [
      global.FunGamesUI.el('div', { class: 'stat' }, ['当前连胜 ', streakEl]),
      global.FunGamesUI.el('div', { class: 'stat' }, ['历史最高 ', bestEl]),
      global.FunGamesUI.el('div', { class: 'stat' }, ['战绩 ', recordEl])
    ]),
    global.FunGamesUI.el('div', { class: 'stat-row' }, [diffRow]),
    statusEl,
    global.FunGamesUI.el('p', { class: 'panel__hint' }, [
      '点击棋盘落子；也可以用方向键移动光标后按 Enter。',
      '困难档会做多层博弈树搜索，思考需要一点时间。'
    ])
  ]);

  var board = global.FunGamesUI.el('div', {
    class: 'gomoku__board',
    role: 'grid',
    tabindex: '0',
    'aria-label': '五子棋棋盘，25 乘 25'
  });
  var cells = [];
  for (var i = 0; i < COUNT; i++) {
    var cell = global.FunGamesUI.el('button', {
      class: 'gomoku__cell',
      type: 'button',
      'data-index': String(i),
      'aria-label': '第 ' + (Math.floor(i / SIZE) + 1) + ' 行第 ' + (i % SIZE + 1) + ' 列，空'
    });
    board.appendChild(cell);
    cells.push(cell);
  }

  var overlay = global.FunGamesUI.el('div', { class: 'overlay', hidden: 'hidden' });
  var stage = global.FunGamesUI.el('div', { class: 'gomoku__stage' }, [board, overlay]);
  var gameArea = global.FunGamesUI.el('div', { class: 'gomoku' }, [panel, stage]);
  page.main.appendChild(gameArea);
  document.getElementById('app').appendChild(page.root);

  /* ---------- 工具 ---------- */

  var UI = global.FunGamesUI;

  function other(player) {
    return player === MACHINE ? HUMAN : MACHINE;
  }

  /* 连成 5 子的那一条线（用于高亮）。 */
  function winLineAt(boardArr, idx) {
    var player = boardArr[idx];
    if (!player) return null;
    var r = Math.floor(idx / SIZE);
    var c = idx % SIZE;
    var dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];

    for (var d = 0; d < dirs.length; d++) {
      var dr = dirs[d][0];
      var dc = dirs[d][1];
      var line = [idx];
      var i, nr, nc;

      for (i = 1; i < 5; i++) {
        nr = r + dr * i;
        nc = c + dc * i;
        if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE) break;
        if (boardArr[nr * SIZE + nc] !== player) break;
        line.push(nr * SIZE + nc);
      }
      for (i = 1; i < 5; i++) {
        nr = r - dr * i;
        nc = c - dc * i;
        if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE) break;
        if (boardArr[nr * SIZE + nc] !== player) break;
        line.push(nr * SIZE + nc);
      }
      if (line.length >= 5) return line;
    }
    return null;
  }

  function isBoardFull(boardArr) {
    for (var i = 0; i < COUNT; i++) {
      if (boardArr[i] === 0) return false;
    }
    return true;
  }

  function vibrate(pattern) {
    if (global.navigator && global.navigator.vibrate) global.navigator.vibrate(pattern);
  }

  /* ---------- 存档 ---------- */

  function save() {
    global.FunGamesStorage.set(STATE_KEY, {
      board: Array.prototype.slice.call(state.board),
      turn: state.turn,
      over: state.over,
      result: state.result,
      difficulty: state.difficulty,
      lastMove: state.lastMove,
      winLine: state.winLine
    });
  }

  function validBoard(arr) {
    if (!Array.isArray(arr) || arr.length !== COUNT) return false;
    var human = 0;
    var machine = 0;
    for (var i = 0; i < COUNT; i++) {
      var v = arr[i];
      if (v !== 0 && v !== HUMAN && v !== MACHINE) return false;
      if (v === HUMAN) human++;
      else if (v === MACHINE) machine++;
    }
    // 玩家先手，双方子数相等或玩家多一子。
    return human === machine || human === machine + 1;
  }

  function load() {
    var data = global.FunGamesStorage.get(STATE_KEY, null);
    if (!data || typeof data !== 'object') return false;
    if (!validBoard(data.board)) return false;
    if (data.turn !== 'player' && data.turn !== 'ai') return false;

    state.board = newUint8Array();
    for (var i = 0; i < COUNT; i++) state.board[i] = data.board[i];
    state.turn = data.turn;
    state.over = !!data.over;
    state.result = data.result === 'win' || data.result === 'lose' || data.result === 'draw'
      ? data.result : null;
    state.difficulty = DIFFICULTY_IDS[data.difficulty] ? data.difficulty : 'easy';
    state.lastMove = typeof data.lastMove === 'number' ? data.lastMove : -1;
    state.winLine = Array.isArray(data.winLine) ? data.winLine : null;
    state.locked = false;

    var streak = global.FunGamesStorage.get(STREAK_KEY, 0);
    state.streak = typeof streak === 'number' && streak > 0 ? Math.floor(streak) : 0;

    var record = global.FunGamesStorage.get(RECORD_KEY, null);
    state.record = record && typeof record === 'object'
      ? {
        w: record.w | 0,
        l: record.l | 0,
        d: record.d | 0
      }
      : { w: 0, l: 0, d: 0 };
    return true;
  }

  function saveStreaks() {
    global.FunGamesStorage.set(STREAK_KEY, state.streak);
    global.FunGamesStorage.set(RECORD_KEY, state.record);
  }

  /* ---------- 对局流程 ---------- */

  var aiToken = 0;

  function reset() {
    aiToken++;
    state.board = newUint8Array();
    state.turn = 'player';
    state.over = false;
    state.result = null;
    state.lastMove = -1;
    state.winLine = null;
    state.locked = false;

    page.beginRun();
    page.renderBest(page.getBest());

    var streak = global.FunGamesStorage.get(STREAK_KEY, 0);
    state.streak = typeof streak === 'number' && streak > 0 ? Math.floor(streak) : 0;

    var record = global.FunGamesStorage.get(RECORD_KEY, null);
    state.record = record && typeof record === 'object'
      ? { w: record.w | 0, l: record.l | 0, d: record.d | 0 }
      : { w: 0, l: 0, d: 0 };
    saveStreaks();

    hideOverlay();
    setDifficultyButtons();
    paint();
    save();
  }

  function place(index, player) {
    if (state.over || state.locked) return false;
    if (index < 0 || index >= COUNT) return false;
    if (state.board[index] !== 0) return false;
    if (player === HUMAN && state.turn !== 'player') return false;
    if (player === MACHINE && state.turn !== 'ai') return false;

    state.board[index] = player;
    state.lastMove = index;

    var line = winLineAt(state.board, index);
    if (line) {
      state.winLine = line;
      finish(player === HUMAN ? 'win' : 'lose');
      paint();
      save();
      return true;
    }
    if (isBoardFull(state.board)) {
      finish('draw');
      paint();
      save();
      return true;
    }

    state.turn = player === HUMAN ? 'ai' : 'player';
    paint();
    save();
    return true;
  }

  function finish(result) {
    state.over = true;
    state.locked = false;
    state.result = result;

    if (result === 'win') {
      state.streak += 1;
      state.record.w += 1;
      if (state.streak > 0) page.setBest(state.streak);
    } else if (result === 'lose') {
      state.streak = 0;
      state.record.l += 1;
    } else {
      state.streak = 0;
      state.record.d += 1;
    }
    saveStreaks();
    updateStats();
    showResult();
    vibrate(result === 'win' ? [40, 60, 40] : 120);
  }

  function showResult() {
    var options;
    if (state.result === 'win') {
      options = {
        icon: '🎉',
        title: '你赢了！',
        text: '当前连胜 ' + state.streak + ' 场。' +
          (state.streak >= page.getBest() ? '这就是你的历史最高！' : '')
      };
    } else if (state.result === 'lose') {
      options = {
        icon: '🤖',
        title: 'AI 获胜',
        text: '连胜已中断，再来一局报仇吧。',
        danger: true
      };
    } else {
      options = {
        icon: '🤝',
        title: '平局',
        text: '棋盘下满了，势均力敌。'
      };
    }
    options.actionLabel = '再来一局';
    options.onAction = reset;
    showOverlay(options);
  }

  function requestAiMove() {
    var token = ++aiToken;
    state.locked = true;
    statusEl.textContent = 'AI 思考中…';
    paint();

    Engine.chooseMoveAsync(state.board, state.difficulty, {
      timeBudget: 1500,
      maxDepth: 5
    }, function (move) {
      if (token !== aiToken) return;   // 已经重新开局，结果作废
      state.locked = false;
      if (!state.over && state.turn === 'ai' && move && move.index >= 0) {
        place(move.index, MACHINE);
      } else {
        paint();
      }
    });
  }

  function handlePlayerMove(index) {
    if (state.over || state.locked || state.turn !== 'player') return;
    state.cursor = index;
    if (!place(index, HUMAN)) return;
    if (!state.over) requestAiMove();
  }

  /* ---------- 难度 / 渲染 ---------- */

  function setDifficulty(id) {
    if (!DIFFICULTY_IDS[id] || state.difficulty === id) return;
    state.difficulty = id;
    setDifficultyButtons();
    save();
  }

  function setDifficultyButtons() {
    Object.keys(diffButtons).forEach(function (id) {
      diffButtons[id].setAttribute('aria-pressed', String(id === state.difficulty));
    });
  }

  function updateStats() {
    streakEl.textContent = String(state.streak);
    var best = page.getBest();
    bestEl.textContent = best === null || best === undefined ? '—' : String(best);
    recordEl.textContent = state.record.w + ' 胜 ' + state.record.l + ' 负 ' + state.record.d + ' 平';
  }

  function statusText() {
    if (state.over) {
      if (state.result === 'win') return '你赢了！当前连胜 ' + state.streak + ' 场。';
      if (state.result === 'lose') return 'AI 获胜，连胜已中断。';
      return '平局。';
    }
    if (state.locked || state.turn === 'ai') return 'AI 思考中…';
    return '轮到你了（黑棋），点一个交叉点落子。';
  }

  function paint() {
    var winSet = {};
    if (state.winLine) {
      state.winLine.forEach(function (idx) { winSet[idx] = true; });
    }

    for (var i = 0; i < COUNT; i++) {
      var cell = cells[i];
      var value = state.board[i];
      var cls = 'gomoku__cell';

      if (value === HUMAN) cls += ' gomoku__cell--b';
      else if (value === MACHINE) cls += ' gomoku__cell--w';
      if (i === state.lastMove && !state.over) cls += ' gomoku__cell--last';
      if (winSet[i]) cls += ' gomoku__cell--win';
      if (i === state.cursor && !state.over) cls += ' gomoku__cell--cursor';

      cell.className = cls;

      var r = Math.floor(i / SIZE) + 1;
      var c = (i % SIZE) + 1;
      var label = '第 ' + r + ' 行第 ' + c + ' 列，';
      if (value === HUMAN) label += '黑子';
      else if (value === MACHINE) label += '白子';
      else label += '空';
      if (winSet[i]) label += '，五连';
      cell.setAttribute('aria-label', label);
      cell.disabled = state.over || state.locked || value !== 0 || state.turn !== 'player';
    }

    statusEl.textContent = statusText();
    updateStats();
  }

  /* ---------- 遮罩 ---------- */

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

  board.addEventListener('click', function (e) {
    var cell = e.target && e.target.closest ? e.target.closest('.gomoku__cell') : null;
    if (!cell) return;
    var index = parseInt(cell.getAttribute('data-index'), 10);
    if (isNaN(index)) return;
    handlePlayerMove(index);
  });

  board.addEventListener('keydown', function (e) {
    var r = Math.floor(state.cursor / SIZE);
    var c = state.cursor % SIZE;
    var handled = true;

    if (e.key === 'ArrowUp') r--;
    else if (e.key === 'ArrowDown') r++;
    else if (e.key === 'ArrowLeft') c--;
    else if (e.key === 'ArrowRight') c++;
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handlePlayerMove(state.cursor);
      return;
    } else {
      handled = false;
    }

    if (!handled) return;
    e.preventDefault();
    r = Math.max(0, Math.min(SIZE - 1, r));
    c = Math.max(0, Math.min(SIZE - 1, c));
    state.cursor = r * SIZE + c;
    paint();
  });

  page.onNewGame(reset);

  /* ---------- 启动 ---------- */

  if (load()) {
    page.beginRun();
    page.renderBest(page.getBest());
    setDifficultyButtons();
    paint();
    save();

    if (state.over) {
      showResult();
    } else if (state.turn === 'ai') {
      // 上次关闭时轮到 AI，恢复后让它把棋下完。
      requestAiMove();
    }
  } else {
    reset();
  }
})(window);
