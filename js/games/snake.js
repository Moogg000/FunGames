/*
 * snake.js — 经典贪吃蛇。
 *
 * 输入：
 *   - 方向键 / WASD ....... 转向
 *   - 滑动 ................ 转向（触屏）
 *   - 屏幕方向盘 .......... 转向（触屏 / 窄屏显示）
 *   - 空格 ................ 暂停 / 继续
 *
 * 吃到食物加 10 分；撞墙或咬到自己就结束。棋盘、蛇身、食物、分数和速度
 * 都会写入 localStorage，刷新页面可以接着玩。最高分按速度分别保存
 * （fungames:snake:best:slow / normal / fast）。
 */
(function (global) {
  'use strict';

  var Storage = global.FunGamesStorage;
  var UI = global.FunGamesUI;

  var SIZE = 20;
  var STATE_KEY = 'snake:state';
  var BEST_KEY_PREFIX = 'snake:best:';
  var FOOD_SCORE = 10;

  var SPEEDS = [
    { id: 'slow', label: '慢速', interval: 190 },
    { id: 'normal', label: '标准', interval: 135 },
    { id: 'fast', label: '快速', interval: 90 }
  ];
  var SPEED_IDS = { slow: true, normal: true, fast: true };

  var DIRS = {
    up: { r: -1, c: 0 },
    down: { r: 1, c: 0 },
    left: { r: 0, c: -1 },
    right: { r: 0, c: 1 }
  };
  var OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };

  /*
   * state 必须声明在 createPage() 之前：createPage() 会立刻读一次最高分，
   * 而 storageKey 是函数、会访问 state.speed，否则会拿到 undefined。
   */
  var state = {
    speed: 'normal',
    snake: [],
    dir: 'right',
    queue: [],
    food: null,
    score: 0,
    over: false,
    paused: false
  };

  var page = UI.createPage({
    title: '贪吃蛇',
    subtitle: '吃食物变长，别撞墙、别咬到自己',
    backHref: '../index.html',
    best: {
      storageKey: function () {
        return BEST_KEY_PREFIX + state.speed;
      },
      label: '最高分数',
      format: function (v) {
        return Number(v).toLocaleString('zh-CN');
      }
    }
  });

  /* ---------- DOM ---------- */

  var scoreEl = UI.el('strong', { text: '0' });
  var lengthEl = UI.el('strong', { text: '3' });

  var speedButtons = {};
  var speedRow = UI.el('div', { class: 'segmented', role: 'group', 'aria-label': '速度' });

  SPEEDS.forEach(function (speed) {
    var btn = UI.el('button', {
      class: 'segmented__btn',
      type: 'button',
      'aria-pressed': 'false',
      text: speed.label
    });
    btn.addEventListener('click', function () {
      setSpeed(speed.id);
    });
    speedButtons[speed.id] = btn;
    speedRow.appendChild(btn);
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
      UI.el('div', { class: 'stat' }, ['分数 ', scoreEl]),
      UI.el('div', { class: 'stat' }, ['长度 ', lengthEl])
    ]),
    UI.el('div', { class: 'stat-row' }, [speedRow, pauseBtn]),
    UI.el('p', { class: 'panel__hint' }, [
      '使用方向键 / WASD 或滑动来转向，空格暂停。' +
      '吃到食物加 ' + FOOD_SCORE + ' 分，撞墙或咬到自己就结束。'
    ])
  ]);

  var board = UI.el('div', {
    class: 'snake__board',
    role: 'img',
    'aria-label': '贪吃蛇棋盘'
  });
  var cells = [];
  for (var i = 0; i < SIZE * SIZE; i++) {
    var cell = UI.el('span', { class: 'snake__cell', 'aria-hidden': 'true' });
    board.appendChild(cell);
    cells.push(cell);
  }

  var overlay = UI.el('div', { class: 'overlay', hidden: 'hidden' });
  var stage = UI.el('div', { class: 'snake__stage' }, [board, overlay]);

  var pad = UI.el('div', { class: 'snake__pad', 'aria-label': '方向控制' });
  [
    { dir: 'left', label: '←', aria: '向左转', r: 1, c: 0 },
    { dir: 'up', label: '↑', aria: '向上转', r: 0, c: 1 },
    { dir: 'down', label: '↓', aria: '向下转', r: 2, c: 1 },
    { dir: 'right', label: '→', aria: '向右转', r: 1, c: 2 }
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
      queueDir(item.dir);
    });
    pad.appendChild(btn);
  });

  var gameArea = UI.el('div', { class: 'snake' }, [panel, stage, pad]);
  page.main.appendChild(gameArea);
  document.getElementById('app').appendChild(page.root);

  /* ---------- Helpers ---------- */

  function indexAt(row, col) {
    return row * SIZE + col;
  }

  function inBounds(row, col) {
    return row >= 0 && row < SIZE && col >= 0 && col < SIZE;
  }

  function validPoint(p) {
    return !!p && typeof p.r === 'number' && typeof p.c === 'number' &&
      p.r >= 0 && p.r < SIZE && p.c >= 0 && p.c < SIZE;
  }

  function currentSpeed() {
    for (var i = 0; i < SPEEDS.length; i++) {
      if (SPEEDS[i].id === state.speed) return SPEEDS[i];
    }
    return SPEEDS[1];
  }

  function vibrate(pattern) {
    if (global.navigator && global.navigator.vibrate) global.navigator.vibrate(pattern);
  }

  /* ---------- Persistence ---------- */

  function save() {
    Storage.set(STATE_KEY, {
      snake: state.snake,
      dir: state.dir,
      queue: state.queue,
      food: state.food,
      score: state.score,
      speed: state.speed,
      over: state.over,
      paused: state.paused
    });
  }

  function load() {
    var data = Storage.get(STATE_KEY, null);
    if (!data || typeof data !== 'object') return false;
    if (!Array.isArray(data.snake) || data.snake.length < 2) return false;

    var seen = {};
    for (var i = 0; i < data.snake.length; i++) {
      var seg = data.snake[i];
      if (!validPoint(seg)) return false;
      var key = seg.r + ',' + seg.c;
      if (seen[key]) return false;
      seen[key] = true;
    }

    if (!validPoint(data.food)) return false;
    if (seen[data.food.r + ',' + data.food.c]) return false;
    if (!DIRS[data.dir]) return false;

    if (!Array.isArray(data.queue)) return false;
    for (var q = 0; q < data.queue.length; q++) {
      if (!DIRS[data.queue[q]]) return false;
    }

    state.snake = data.snake.map(function (point) {
      return { r: point.r, c: point.c };
    });
    state.dir = data.dir;
    state.queue = data.queue.slice(0, 3);
    state.food = { r: data.food.r, c: data.food.c };
    state.score = typeof data.score === 'number' && data.score >= 0
      ? Math.floor(data.score) : 0;
    state.speed = SPEED_IDS[data.speed] ? data.speed : SPEEDS[1].id;
    state.over = !!data.over;
    state.paused = !!data.paused;
    return true;
  }

  /* ---------- Game flow ---------- */

  function reset() {
    state.snake = [
      { r: 10, c: 10 },
      { r: 10, c: 9 },
      { r: 10, c: 8 }
    ];
    state.dir = 'right';
    state.queue = [];
    state.score = 0;
    state.over = false;
    state.paused = false;
    pauseBtn.textContent = '⏸ 暂停';

    page.beginRun();
    page.renderBest(page.getBest());

    spawnFood();
    hideOverlay();
    setSpeedButtons();
    updateStats();
    paint();
    save();
    schedule();
  }

  function spawnFood() {
    var occupied = {};
    state.snake.forEach(function (seg) {
      occupied[seg.r + ',' + seg.c] = true;
    });

    var empty = [];
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        if (!occupied[r + ',' + c]) empty.push({ r: r, c: c });
      }
    }
    if (!empty.length) {
      state.food = null;
      return false;
    }

    state.food = empty[Math.floor(Math.random() * empty.length)];
    return true;
  }

  function step() {
    if (state.paused || state.over) return;

    if (state.queue.length) state.dir = state.queue.shift();

    var head = state.snake[0];
    var vector = DIRS[state.dir];
    var next = { r: head.r + vector.r, c: head.c + vector.c };
    var eating = state.food && next.r === state.food.r && next.c === state.food.c;

    if (!inBounds(next.r, next.c)) {
      gameOver();
      return;
    }

    // 不吃东西时尾巴这一步会移开，所以碰撞检测不算尾巴。
    var body = eating ? state.snake : state.snake.slice(0, state.snake.length - 1);
    for (var i = 0; i < body.length; i++) {
      if (body[i].r === next.r && body[i].c === next.c) {
        gameOver();
        return;
      }
    }

    state.snake.unshift(next);

    if (eating) {
      state.score += FOOD_SCORE;
      page.setBest(state.score);
      if (!spawnFood()) {
        win();
        return;
      }
    } else {
      state.snake.pop();
    }

    updateStats();
    paint();
    save();
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

  function win() {
    state.over = true;
    state.paused = false;
    stopLoop();
    paint();
    save();

    showOverlay({
      icon: '🏆',
      title: '填满整个棋盘！',
      text: '本局得分 ' + state.score.toLocaleString('zh-CN') + '，简直神乎其技。',
      actionLabel: '再来一局',
      onAction: reset
    });
  }

  function showGameOver() {
    var best = page.getBest();
    showOverlay({
      icon: '💀',
      title: '游戏结束',
      text: '本局得分 ' + state.score.toLocaleString('zh-CN') +
        (best === null || best === undefined
          ? '。'
          : ' · 最高 ' + Number(best).toLocaleString('zh-CN') + '。'),
      actionLabel: '再来一局',
      danger: true,
      onAction: reset
    });
  }

  /* ---------- Loop / pause / speed ---------- */

  var timerId = null;

  function stopLoop() {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
  }

  function schedule() {
    stopLoop();
    if (state.over || state.paused) return;

    timerId = setTimeout(function () {
      timerId = null;
      step();
      schedule();
    }, currentSpeed().interval);
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
        text: '按空格或点击「继续」回到游戏。',
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

  function setSpeed(id) {
    if (!SPEED_IDS[id] || state.speed === id) return;

    state.speed = id;
    setSpeedButtons();
    page.renderBest(page.getBest());
    save();
    // 用新速度重新计时；暂停中调用时 schedule() 会直接返回。
    schedule();
  }

  function setSpeedButtons() {
    Object.keys(speedButtons).forEach(function (id) {
      speedButtons[id].setAttribute('aria-pressed', String(id === state.speed));
    });
  }

  /* ---------- Rendering ---------- */

  function updateStats() {
    scoreEl.textContent = state.score.toLocaleString('zh-CN');
    lengthEl.textContent = String(state.snake.length);
  }

  function paint() {
    for (var i = 0; i < cells.length; i++) {
      cells[i].className = 'snake__cell';
    }

    if (state.food) {
      cells[indexAt(state.food.r, state.food.c)].className =
        'snake__cell snake__cell--food';
    }

    for (var s = 0; s < state.snake.length; s++) {
      var seg = state.snake[s];
      cells[indexAt(seg.r, seg.c)].className = s === 0
        ? 'snake__cell snake__cell--head'
        : 'snake__cell snake__cell--body';
    }
  }

  /* ---------- Overlay ---------- */

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

  /* ---------- Input ---------- */

  function queueDir(dir) {
    if (state.over) return;

    var last = state.queue.length ? state.queue[state.queue.length - 1] : state.dir;
    if (dir === last || dir === OPPOSITE[last]) return;
    if (state.queue.length >= 3) return;

    state.queue.push(dir);
    save();
  }

  var KEY_MAP = {
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

  global.addEventListener('keydown', function (e) {
    var dir = KEY_MAP[e.key];
    if (dir) {
      e.preventDefault();
      queueDir(dir);
      return;
    }

    if (e.key === ' ' || e.key === 'Spacebar') {
      // 焦点在按钮 / 链接 / 输入框上时保留浏览器默认行为（激活控件）。
      var tag = e.target && e.target.tagName;
      if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT') return;
      e.preventDefault();
      setPaused(!state.paused);
    }
  });

  UI.onSwipe(board, queueDir);

  // 切走标签页或窗口失焦时自动暂停，避免回来时发现蛇已经撞死。
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) setPaused(true);
  });
  global.addEventListener('blur', function () {
    setPaused(true);
  });

  page.onNewGame(reset);

  /* ---------- Boot ---------- */

  setSpeedButtons();

  if (load()) {
    page.beginRun();
    page.renderBest(page.getBest());
    updateStats();
    paint();

    if (state.over) {
      showGameOver();
    } else if (state.paused) {
      pauseBtn.textContent = '▶ 继续';
      showOverlay({
        icon: '⏸️',
        title: '已暂停',
        text: '按空格或点击「继续」回到游戏。',
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
