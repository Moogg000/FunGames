/*
 * tictactoe.js — 井字棋（玩家 X 先手，AI O 后手）。
 *
 * 输入：
 *   - 轻点 / 左键格子 ... 落子
 *   - 键盘数字 1-9 ...... 落子（7 8 9 / 4 5 6 / 1 2 3，和小键盘一致）
 *   - Tab + Enter ....... 落子（格子是原生 button）
 *
 * AI 用极小化极大 + α-β 剪枝，两档难度：
 *   简单 —— 搜 4 层，12% 概率随机（会犯错，可以赢）
 *   困难 —— 完全搜索，不会输（最多平局）
 *
 * 最高分 = 最高连胜：赢一场连胜 +1，输或平局连胜清零；连胜突破历史最高时
 * 由框架自动刷新标题栏徽章并弹出提示。
 */
(function (global) {
  'use strict';

  var Storage = global.FunGamesStorage;
  var UI = global.FunGamesUI;

  var HUMAN = 1;
  var AI = 2;

  var STATE_KEY = 'tictactoe:state';
  var STREAK_KEY = 'tictactoe:streak';
  var BEST_KEY = 'tictactoe:best';

  var DIFFICULTIES = [
    { id: 'easy', label: '简单', depth: 4, mistake: 0.12 },
    { id: 'hard', label: '困难', depth: 9, mistake: 0 }
  ];
  var DIFFICULTY_IDS = { easy: true, hard: true };

  var LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6]
  ];

  /* 数字键 -> 格子下标（小键盘布局：7 8 9 在上，1 2 3 在下）。 */
  var NUMBER_KEYS = {
    '1': 6, '2': 7, '3': 8,
    '4': 3, '5': 4, '6': 5,
    '7': 0, '8': 1, '9': 2
  };

  var AI_DELAY_MS = 380;

  var state = {
    board: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    turn: 'player',
    over: false,
    result: null,
    difficulty: 'easy',
    streak: 0,
    locked: false
  };

  var page = UI.createPage({
    title: '井字棋',
    subtitle: '三子连线，和 AI 对弈',
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

  var streakEl = UI.el('strong', { text: '0' });
  var bestEl = UI.el('strong', { text: '—' });
  var statusEl = UI.el('p', { class: 'panel__hint', 'aria-live': 'polite' });

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
      setDifficulty(diff.id);
    });
    diffButtons[diff.id] = btn;
    diffRow.appendChild(btn);
  });

  var panel = UI.el('section', { class: 'panel' }, [
    UI.el('div', { class: 'stat-row' }, [
      UI.el('div', { class: 'stat' }, ['当前连胜 ', streakEl]),
      UI.el('div', { class: 'stat' }, ['历史最高 ', bestEl])
    ]),
    UI.el('div', { class: 'stat-row' }, [diffRow]),
    statusEl
  ]);

  var board = UI.el('div', {
    class: 'ttt__board',
    role: 'group',
    'aria-label': '井字棋棋盘'
  });
  var cells = [];
  for (var i = 0; i < 9; i++) {
    var cell = UI.el('button', {
      class: 'ttt__cell',
      type: 'button',
      'data-index': String(i),
      'aria-label': '空格子'
    });
    board.appendChild(cell);
    cells.push(cell);
  }

  var overlay = UI.el('div', { class: 'overlay', hidden: 'hidden' });
  var stage = UI.el('div', { class: 'ttt__stage' }, [board, overlay]);
  var gameArea = UI.el('div', { class: 'ttt' }, [panel, stage]);
  page.main.appendChild(gameArea);
  document.getElementById('app').appendChild(page.root);

  /* ---------- 规则 ---------- */

  /* 返回 { player: 1|2|0, line: [a,b,c]|null } */
  function findWinner(board) {
    for (var i = 0; i < LINES.length; i++) {
      var line = LINES[i];
      var a = board[line[0]];
      if (a && a === board[line[1]] && a === board[line[2]]) {
        return { player: a, line: line };
      }
    }
    return { player: 0, line: null };
  }

  function isFull(board) {
    return board.indexOf(0) === -1;
  }

  /* ---------- AI：极小化极大 + α-β 剪枝 ---------- */

  function minimax(board, depth, alpha, beta, maximizing) {
    var win = findWinner(board).player;
    // depth 越大表示离终局越近（剩下的层数越多），所以加上 depth：
    // 快速获胜得分更高，拖到后面才输的得分更高。
    if (win === AI) return 100 + depth;
    if (win === HUMAN) return -100 - depth;
    if (isFull(board) || depth <= 0) return 0;

    var i;
    var value;
    if (maximizing) {
      value = -Infinity;
      for (i = 0; i < 9; i++) {
        if (board[i]) continue;
        board[i] = AI;
        value = Math.max(value, minimax(board, depth - 1, alpha, beta, false));
        board[i] = 0;
        alpha = Math.max(alpha, value);
        if (alpha >= beta) break;
      }
      return value;
    }

    value = Infinity;
    for (i = 0; i < 9; i++) {
      if (board[i]) continue;
      board[i] = HUMAN;
      value = Math.min(value, minimax(board, depth - 1, alpha, beta, true));
      board[i] = 0;
      beta = Math.min(beta, value);
      if (alpha >= beta) break;
    }
    return value;
  }

  /* 在分值最好的着法里随机挑一个，避免每局走法完全相同。 */
  function bestMove(board, depth) {
    var best = -Infinity;
    var moves = [];
    for (var i = 0; i < 9; i++) {
      if (board[i]) continue;
      board[i] = AI;
      var value = minimax(board, depth - 1, -Infinity, Infinity, false);
      board[i] = 0;
      if (value > best) {
        best = value;
        moves = [i];
      } else if (value === best) {
        moves.push(i);
      }
    }
    if (!moves.length) return -1;
    return moves[Math.floor(Math.random() * moves.length)];
  }

  function randomMove(board) {
    var empty = [];
    for (var i = 0; i < 9; i++) {
      if (!board[i]) empty.push(i);
    }
    if (!empty.length) return -1;
    return empty[Math.floor(Math.random() * empty.length)];
  }

  function currentDifficulty() {
    for (var i = 0; i < DIFFICULTIES.length; i++) {
      if (DIFFICULTIES[i].id === state.difficulty) return DIFFICULTIES[i];
    }
    return DIFFICULTIES[0];
  }

  function aiChoose(board) {
    var diff = currentDifficulty();
    // 简单档偶尔故意走随机，给玩家机会；困难档完全搜索。
    if (Math.random() < diff.mistake) return randomMove(board);
    return bestMove(board, diff.depth);
  }

  /* ---------- 存档 ---------- */

  function save() {
    Storage.set(STATE_KEY, {
      board: state.board,
      turn: state.turn,
      over: state.over,
      result: state.result,
      difficulty: state.difficulty
    });
  }

  function validBoard(board) {
    if (!Array.isArray(board) || board.length !== 9) return false;
    for (var i = 0; i < 9; i++) {
      if (board[i] !== 0 && board[i] !== HUMAN && board[i] !== AI) return false;
    }
    return true;
  }

  function load() {
    var data = Storage.get(STATE_KEY, null);
    if (!data || typeof data !== 'object') return false;
    if (!validBoard(data.board)) return false;
    if (data.turn !== 'player' && data.turn !== 'ai') return false;

    state.board = data.board.slice(0, 9);
    state.turn = data.turn;
    state.over = !!data.over;
    state.result = data.result === 'win' || data.result === 'draw' || data.result === 'lose'
      ? data.result : null;
    state.difficulty = DIFFICULTY_IDS[data.difficulty] ? data.difficulty : 'easy';
    state.locked = false;

    var streak = Storage.get(STREAK_KEY, 0);
    state.streak = typeof streak === 'number' && streak > 0 ? Math.floor(streak) : 0;
    return true;
  }

  /* ---------- 对局流程 ---------- */

  function reset() {
    stopAiTimer();
    state.board = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    state.turn = 'player';
    state.over = false;
    state.result = null;
    state.locked = false;

    page.beginRun();
    page.renderBest(page.getBest());

    hideOverlay();
    setDifficultyButtons();
    var streak = Storage.get(STREAK_KEY, 0);
    state.streak = typeof streak === 'number' && streak > 0 ? Math.floor(streak) : 0;
    Storage.set(STREAK_KEY, state.streak);
    paint();
    save();
  }

  function play(index) {
    if (state.over || state.locked || state.turn !== 'player') return;
    if (state.board[index]) return;

    state.board[index] = HUMAN;
    state.turn = 'ai';
    state.locked = true;
    paint();
    save();

    if (finishIfNeeded()) return;
    scheduleAi();
  }

  function aiMove() {
    aiTimerId = null;
    if (state.over || state.turn !== 'ai') return;

    var index = aiChoose(state.board);
    state.locked = false;
    if (index < 0) {
      finishAsDraw();
      return;
    }

    state.board[index] = AI;
    state.turn = 'player';
    paint();

    if (finishIfNeeded()) return;
    save();
  }

  function finishIfNeeded() {
    var win = findWinner(state.board).player;
    if (!win && !isFull(state.board)) return false;

    stopAiTimer();
    state.over = true;
    state.locked = false;

    if (win === HUMAN) {
      state.result = 'win';
      state.streak += 1;
      Storage.set(STREAK_KEY, state.streak);
      if (state.streak > 0) page.setBest(state.streak);
    } else if (win === AI) {
      state.result = 'lose';
      state.streak = 0;
      Storage.set(STREAK_KEY, 0);
    } else {
      finishAsDraw();
      return true;
    }

    paint();
    save();
    showResult();
    return true;
  }

  function finishAsDraw() {
    stopAiTimer();
    state.over = true;
    state.locked = false;
    state.result = 'draw';
    state.streak = 0;
    Storage.set(STREAK_KEY, 0);
    paint();
    save();
    showResult();
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
        text: '连胜已中断，重新挑战吧。',
        danger: true
      };
    } else {
      options = {
        icon: '🤝',
        title: '平局',
        text: '连胜已中断，再来一局分出胜负。'
      };
    }

    options.actionLabel = '再来一局';
    options.onAction = reset;
    showOverlay(options);
  }

  /* ---------- 计时 / 难度 ---------- */

  var aiTimerId = null;

  function stopAiTimer() {
    if (aiTimerId !== null) {
      clearTimeout(aiTimerId);
      aiTimerId = null;
    }
  }

  function scheduleAi() {
    stopAiTimer();
    aiTimerId = setTimeout(function () {
      aiMove();
    }, AI_DELAY_MS);
  }

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

  /* ---------- 渲染 ---------- */

  function updateStats() {
    streakEl.textContent = String(state.streak);
    var best = page.getBest();
    bestEl.textContent = best === null || best === undefined ? '—' : String(best);
  }

  function statusText() {
    if (state.over) {
      if (state.result === 'win') return '你赢了！当前连胜 ' + state.streak + ' 场。';
      if (state.result === 'lose') return 'AI 获胜，连胜已中断。';
      return '平局，连胜已中断。';
    }
    if (state.locked || state.turn === 'ai') return 'AI 思考中…';
    return '轮到你了，点一个格子落子。';
  }

  function paint() {
    var winLine = state.over ? findWinner(state.board).line : null;

    for (var i = 0; i < 9; i++) {
      var cell = cells[i];
      var value = state.board[i];
      var cls = 'ttt__cell';
      var label = '第 ' + (i + 1) + ' 格，空';

      if (value === HUMAN) {
        cls += ' ttt__cell--x';
        label = '第 ' + (i + 1) + ' 格，X';
      } else if (value === AI) {
        cls += ' ttt__cell--o';
        label = '第 ' + (i + 1) + ' 格，O';
      }
      if (winLine && winLine.indexOf(i) !== -1) {
        cls += ' ttt__cell--win';
        label += '，三连';
      }

      cell.className = cls;
      cell.textContent = value === HUMAN ? '✕' : value === AI ? '◯' : '';
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
    var cell = e.target && e.target.closest ? e.target.closest('.ttt__cell') : null;
    if (!cell) return;
    var index = parseInt(cell.getAttribute('data-index'), 10);
    if (isNaN(index)) return;
    play(index);
  });

  global.addEventListener('keydown', function (e) {
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    // Enter / 空格交给原生 button（Tab 聚焦后可直接落子）。
    if (e.key === ' ' || e.key === 'Enter') return;

    var index = NUMBER_KEYS[e.key];
    if (index === undefined) return;
    e.preventDefault();
    play(index);
  });

  page.onNewGame(reset);

  /* ---------- 启动 ---------- */

  if (load()) {
    page.beginRun();
    page.renderBest(page.getBest());
    setDifficultyButtons();
    paint();
    // 立即落盘：旧版本存档里的难度值可以借此归一化。
    save();

    if (state.over) {
      showResult();
    } else {
      // 若上次关闭时轮到 AI，恢复后继续把它的棋下完。
      if (state.turn === 'ai') {
        state.locked = true;
        paint();
        scheduleAi();
      }
    }
  } else {
    reset();
  }
})(window);
