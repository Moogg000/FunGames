/*
 * breakout.js — 打砖块。
 *
 * Canvas 2D。视口按设备分两种：
 *   竖版（手机 / 触屏）  480 × 640
 *   横版（桌面宽屏）    640 × 480
 * 布局参数全部由视口尺寸推导，物理参数保持一致。
 *
 * 规则：3 条命；挡板接球反弹，清空当前关卡的全部砖块进入下一关；
 *       球落到底部扣 1 命，命用完游戏结束；清空第 5 关即通关。
 *
 * 计分：砖块按总血量给分（1 血 10、2 血 20、3 血 30），打破那一刻才得分；
 *       过关奖励 = 剩余命 × 100。纪录：最高分（徽章）+ 最远关卡 + 通关次数。
 *
 * 操控：鼠标移动（绝对映射）、触屏拖动（相对）、键盘 ←→ / A D、窄屏屏幕方向键；
 *       点击 / 空格发球，发球角度由点击相对挡板中心的位置决定（最多 ±20°）。
 *       暂停：⏸ 按钮或 P / Esc，切标签页 / 失焦自动暂停。
 *
 * 手感要点：挡板按「击中位置」改变出射角（最大 ±60°）；每次反弹后强制一个
 *           最小垂直速度分量；固定物理步长 1/120s，高速球不会穿透砖块。
 *
 * 性能：每帧统计实际帧率，持续低于 45fps 时自动切到「性能模式」（关闭粒子 /
 *       拖尾 / 震屏并把渲染分辨率降到 1x），面板可随时手动切换。
 */
(function (global) {
  'use strict';

  var Storage = global.FunGamesStorage;
  var UI = global.FunGamesUI;

  /* ------------------------------------------------------------------ *
   *  视口与布局
   * ------------------------------------------------------------------ */

  var VIEWS = {
    portrait: { w: 480, h: 640 },
    landscape: { w: 640, h: 480 }
  };

  var view = { w: VIEWS.portrait.w, h: VIEWS.portrait.h };
  var L = {};

  var BRICK_COLS = 8;
  var BRICK_GAP = 6;
  var BRICK_H = 22;
  var BALL_R = 7;

  var START_LIVES = 3;
  var MAX_BOUNCE_DEG = 60;
  var SERVE_OFFSET_DEG = 20;
  var MIN_VY_RATIO = 0.34;
  var PHYS_DT = 1 / 120;
  var MAX_FRAME_DT = 0.05;
  var LEVEL_CLEAR_DELAY = 1200;
  var MAX_DPR = 2;             // 渲染分辨率上限：DPR 3 时像素量翻倍以上，得不偿失

  var LOW_FPS_THRESHOLD = 40;
  var LOW_FPS_HOLD_MS = 2500;
  var MANUAL_GUARD_MS = 30000;   // 手动切换后 30s 内不再自动降级，避免和玩家抢开关

  var BEST_KEY = 'breakout:best';
  var LEVEL_KEY = 'breakout:maxLevel';
  var CLEAR_KEY = 'breakout:cleared';
  var PERF_KEY = 'breakout:perf';
  var SAVE_KEY = 'breakout:state';   // 未完成对局的存档（退出再进入可续玩）

  /*
   * 关卡数据：每行是一个字符串，长度 = 列数。
   *   '.' 空位；'1'/'2'/'3' 表示该砖块的血量。
   * speed 单位 px/s。难度递进靠：球速 + 排数 + 血量梯度（挡板宽度全程不变）。
   */
  var LEVELS = [
    {
      name: '第 1 关',
      speed: 320,
      hint: '一整面薄墙，先找手感',
      rows: [
        '11111111',
        '11111111',
        '11111111',
        '11111111'
      ]
    },
    {
      name: '第 2 关',
      speed: 352,
      hint: '顶排是 2 血硬砖',
      rows: [
        '22222222',
        '11111111',
        '11111111',
        '11111111',
        '11111111'
      ]
    },
    {
      name: '第 3 关',
      speed: 388,
      hint: '中间留了缺口，试试走位',
      rows: [
        '22222222',
        '21111112',
        '21.11.12',
        '31111113',
        '31111113'
      ]
    },
    {
      name: '第 4 关',
      speed: 424,
      hint: '对称方阵，先拆边角',
      rows: [
        '33333333',
        '32222223',
        '32111123',
        '32111123',
        '32222223',
        '33333333'
      ]
    },
    {
      name: '第 5 关',
      speed: 464,
      hint: '混合阵型，综合考验',
      rows: [
        '33333333',
        '32222223',
        '321..123',
        '3.1111.3',
        '321..123',
        '32222223',
        '33333333'
      ]
    }
  ];

  /* 砖块颜色按血量区分（信息优先于好看）。 */
  var BRICK_COLORS = {
    1: ['#4a90e2', '#3a7bc8'],
    2: ['#f0a13a', '#d98a26'],
    3: ['#d9534f', '#bf403b']
  };

  /* ------------------------------------------------------------------ *
   *  状态
   * ------------------------------------------------------------------ */

  var state = {
    mode: 'portrait',
    level: 0,
    score: 0,
    lives: START_LIVES,
    bricks: [],
    status: 'serving',   // serving | playing | levelclear | gameover | cleared
    paused: false,
    perfMode: false,
    paddleX: view.w / 2,
    paddleTargetX: view.w / 2,
    ball: { x: view.w / 2, y: 0, vx: 0, vy: 0 },
    serveOffset: 0,
    particles: [],
    trail: [],
    shake: 0,
    keys: { left: false, right: false },
    pointerDown: false,
    pointerStart: null,
    touchDrag: null,
    advanceTimer: null,
    rafId: null,
    lastFrameAt: 0,
    accumulator: 0,
    saveAccum: 0,
    maxLevel: 0,
    cleared: 0
  };

  var theme = {};
  var fpsValue = 0;
  var lowFpsSince = 0;
  var manualPerfAt = 0;
  var fpsAccum = 0;

  /* ------------------------------------------------------------------ *
   *  布局：全部由视口推导
   * ------------------------------------------------------------------ */

  function clamp(v, min, max) {
    return v < min ? min : v > max ? max : v;
  }

  function computeLayout() {
    var W = view.w;
    var H = view.h;
    L.W = W;
    L.H = H;
    // 挡板宽度按场地宽度取比例（比最初的 96px 明显更宽）
    L.paddleW = clamp(Math.round(W * 0.22), 92, 150);
    L.paddleH = Math.max(10, Math.round(H * 0.019));
    L.paddleY = H - Math.max(34, Math.round(H * 0.075));
    L.brickSide = Math.round(W * 0.05);
    L.brickTop = Math.round(H * 0.105);
    L.brickW = (W - L.brickSide * 2 - BRICK_GAP * (BRICK_COLS - 1)) / BRICK_COLS;
  }

  function selectMode() {
    var coarse = false;
    var wide = false;
    if (global.matchMedia) {
      try {
        coarse = global.matchMedia('(pointer: coarse)').matches;
        wide = global.matchMedia('(min-width: 640px)').matches;
      } catch (err) {
        coarse = false;
        wide = false;
      }
    }
    return (!coarse && wide) ? 'landscape' : 'portrait';
  }

  /* 切换视口：重算布局、重建砖块（保留关卡定义）、复位挡板与球 */
  function applyMode(mode) {
    if (!VIEWS[mode]) return;
    state.mode = mode;
    view.w = VIEWS[mode].w;
    view.h = VIEWS[mode].h;
    computeLayout();
    resizeCanvas();
    if (canvas && canvas.style && canvas.style.setProperty) {
      canvas.style.setProperty('--bk-ratio', view.w + ' / ' + view.h);
    }
    state.bricks = buildBricks(LEVELS[state.level]);
    var half = L.paddleW / 2;
    state.paddleX = clamp(state.paddleX, half, view.w - half);
    state.paddleTargetX = clamp(state.paddleTargetX, half, view.w - half);
    if (state.status === 'serving') positionBallOnPaddle();
    updateStats();
  }

  /* ------------------------------------------------------------------ *
   *  页面框架
   * ------------------------------------------------------------------ */

  var page = UI.createPage({
    title: '打砖块',
    subtitle: '击碎所有砖块',
    backHref: '../index.html',
    best: {
      storageKey: BEST_KEY,
      label: '最高分数',
      format: function (v) {
        return Number(v).toLocaleString('zh-CN');
      }
    }
  });

  var scoreEl = UI.el('strong', { text: '0' });
  var livesEl = UI.el('strong', { text: String(START_LIVES) });
  var levelEl = UI.el('strong', { text: '1' });
  var maxLevelEl = UI.el('strong', { text: '—' });
  var clearedEl = UI.el('strong', { text: '0' });
  var fpsEl = UI.el('strong', { text: '—' });
  var statusEl = UI.el('p', { class: 'panel__hint', 'aria-live': 'polite' });
  var ruleEl = UI.el('p', { class: 'panel__hint' });

  var pauseBtn = UI.el('button', {
    class: 'btn btn--ghost',
    type: 'button',
    text: '⏸ 暂停'
  });
  pauseBtn.addEventListener('click', function () {
    setPaused(!state.paused);
  });

  var perfBtn = UI.el('button', {
    class: 'btn btn--ghost',
    type: 'button',
    text: '⚡ 性能'
  });
  perfBtn.addEventListener('click', function () {
    setPerfMode(!state.perfMode);
  });

  var panel = UI.el('section', { class: 'panel' }, [
    UI.el('div', { class: 'stat-row' }, [
      UI.el('div', { class: 'stat' }, ['得分 ', scoreEl]),
      UI.el('div', { class: 'stat' }, ['生命 ', livesEl]),
      UI.el('div', { class: 'stat' }, ['关卡 ', levelEl])
    ]),
    UI.el('div', { class: 'stat-row' }, [
      UI.el('div', { class: 'stat' }, ['最远关卡 ', maxLevelEl]),
      UI.el('div', { class: 'stat' }, ['通关次数 ', clearedEl]),
      UI.el('div', { class: 'stat' }, ['帧率 ', fpsEl])
    ]),
    UI.el('div', { class: 'stat-row' }, [pauseBtn, perfBtn]),
    ruleEl,
    statusEl
  ]);

  var canvas = UI.el('canvas', {
    class: 'bk__canvas',
    width: String(view.w),
    height: String(view.h),
    role: 'img',
    'aria-label': '打砖块画面'
  });

  var pad = UI.el('div', { class: 'bk__pad', 'aria-label': '挡板控制' });
  [
    { key: 'left', label: '←', aria: '挡板左移' },
    { key: 'right', label: '→', aria: '挡板右移' }
  ].forEach(function (item) {
    var btn = UI.el('button', {
      class: 'btn',
      type: 'button',
      'aria-label': item.aria,
      text: item.label
    });
    btn.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      state.keys[item.key] = true;
    });
    var stop = function () {
      state.keys[item.key] = false;
    };
    btn.addEventListener('pointerup', stop);
    btn.addEventListener('pointercancel', stop);
    btn.addEventListener('pointerleave', stop);
    pad.appendChild(btn);
  });

  var overlay = UI.el('div', { class: 'overlay', hidden: 'hidden' });
  var stage = UI.el('div', { class: 'bk__stage' }, [canvas, pad, overlay]);
  var gameArea = UI.el('div', { class: 'bk' }, [panel, stage]);
  page.main.appendChild(gameArea);
  document.getElementById('app').appendChild(page.root);

  var ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;

  /* ------------------------------------------------------------------ *
   *  主题色（从 CSS 变量读取，深浅色自动适配）
   * ------------------------------------------------------------------ */

  function readTheme() {
    if (typeof getComputedStyle !== 'function') return;
    var cs = getComputedStyle(document.documentElement);
    var pick = function (name, fallback) {
      var v = cs.getPropertyValue(name);
      return v && v.trim() ? v.trim() : fallback;
    };
    theme = {
      bg: pick('--bg', '#0d1017'),
      surface: pick('--surface', '#161b25'),
      surface2: pick('--surface-2', '#1e2431'),
      text: pick('--text', '#e8ecf5'),
      dim: pick('--text-dim', '#97a1b6'),
      border: pick('--border', '#2a3142'),
      accent: pick('--accent', '#6b93ff')
    };
  }

  function resizeCanvas() {
    if (!ctx || !canvas) return;
    var dpr = global.devicePixelRatio || 1;
    if (state.perfMode) dpr = 1;
    dpr = Math.max(1, Math.min(MAX_DPR, dpr));

    var w = Math.round(view.w * dpr);
    var h = Math.round(view.h * dpr);
    // 尺寸没变化就不要重新分配后备缓冲（频繁 resize 本身有代价）
    if (canvas.width === w && canvas.height === h) return;

    canvas.width = w;
    canvas.height = h;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ------------------------------------------------------------------ *
   *  工具
   * ------------------------------------------------------------------ */

  function roundRect(c, x, y, w, h, r) {
    var rad = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + rad, y);
    c.arcTo(x + w, y, x + w, y + h, rad);
    c.arcTo(x + w, y + h, x, y + h, rad);
    c.arcTo(x, y + h, x, y, rad);
    c.arcTo(x, y, x + w, y, rad);
    c.closePath();
  }

  /* ------------------------------------------------------------------ *
   *  关卡构建
   * ------------------------------------------------------------------ */

  function buildBricks(level) {
    var list = [];
    var rows = level.rows;
    for (var r = 0; r < rows.length; r++) {
      var line = rows[r];
      for (var c = 0; c < line.length && c < BRICK_COLS; c++) {
        var ch = line[c];
        if (ch === '.') continue;
        var hp = parseInt(ch, 10);
        if (!(hp >= 1 && hp <= 3)) continue;
        list.push({
          x: L.brickSide + c * (L.brickW + BRICK_GAP),
          y: L.brickTop + r * (BRICK_H + BRICK_GAP),
          w: L.brickW,
          h: BRICK_H,
          hp: hp,
          maxHp: hp
        });
      }
    }
    return list;
  }

  function startLevel(index) {
    state.level = index;
    state.bricks = buildBricks(LEVELS[index]);
    state.paddleX = view.w / 2;
    state.paddleTargetX = view.w / 2;
    state.trail.length = 0;
    setupServe();
    saveMaxLevel();
    updateStats();
    saveState();          // 新关卡（含重开）落盘，退出后可从这一关继续
  }

  function positionBallOnPaddle() {
    state.ball.x = state.paddleX;
    state.ball.y = L.paddleY - BALL_R - 1;
  }

  function setupServe() {
    state.status = 'serving';
    state.ball.vx = 0;
    state.ball.vy = 0;
    state.serveOffset = 0;
    state.trail.length = 0;   // 关键：清掉上一球的拖尾，避免残留到新球
    positionBallOnPaddle();
  }

  function serve() {
    if (state.status !== 'serving') return;
    var speed = LEVELS[state.level].speed;
    var ang = state.serveOffset * SERVE_OFFSET_DEG * Math.PI / 180;
    state.ball.vx = speed * Math.sin(ang);
    state.ball.vy = -speed * Math.cos(ang);
    state.status = 'playing';
  }

  /* ------------------------------------------------------------------ *
   *  物理
   * ------------------------------------------------------------------ */

  /* 反弹后强制一个最小垂直分量，避免球贴水平无限弹。 */
  function enforceMinVertical() {
    var b = state.ball;
    var speed = Math.hypot(b.vx, b.vy);
    if (speed < 1e-3) {
      b.vy = -LEVELS[state.level].speed;
      b.vx = 0;
      return;
    }
    var minVy = speed * MIN_VY_RATIO;
    if (Math.abs(b.vy) < minVy) {
      b.vy = (b.vy < 0 ? -1 : 1) * minVy;
      b.vx = (b.vx < 0 ? -1 : 1) * Math.sqrt(Math.max(0, speed * speed - b.vy * b.vy));
    }
  }

  function damageBrick(brick) {
    brick.hp -= 1;
    if (brick.hp > 0) {
      spawnParticles(brick.x + brick.w / 2, brick.y + brick.h / 2,
        BRICK_COLORS[brick.maxHp][0], 6, 1.5);
      addShake(1.5);
      return;
    }

    state.bricks.splice(state.bricks.indexOf(brick), 1);
    var gain = brick.maxHp * 10;
    state.score += gain;
    page.setBest(state.score);
    spawnParticles(brick.x + brick.w / 2, brick.y + brick.h / 2,
      BRICK_COLORS[brick.maxHp][0], 14, 3);
    addShake(3);
    updateStats();
    saveState();          // 砖块变化即时落盘

    if (!state.bricks.length) levelCleared();
  }

  function stepPhysics(dt) {
    var b = state.ball;
    b.x += b.vx * dt;
    b.y += b.vy * dt;

    // 左右墙
    if (b.x < BALL_R) {
      b.x = BALL_R;
      b.vx = Math.abs(b.vx);
    } else if (b.x > view.w - BALL_R) {
      b.x = view.w - BALL_R;
      b.vx = -Math.abs(b.vx);
    }
    // 顶部
    if (b.y < BALL_R) {
      b.y = BALL_R;
      b.vy = Math.abs(b.vy);
    }

    // 挡板
    var halfW = L.paddleW / 2;
    if (b.vy > 0 &&
        b.y + BALL_R >= L.paddleY && b.y - BALL_R <= L.paddleY + L.paddleH &&
        b.x >= state.paddleX - halfW - BALL_R && b.x <= state.paddleX + halfW + BALL_R) {
      var rel = clamp((b.x - state.paddleX) / halfW, -1, 1);
      var ang = rel * MAX_BOUNCE_DEG * Math.PI / 180;
      var speed = Math.hypot(b.vx, b.vy);
      b.vx = speed * Math.sin(ang);
      b.vy = -Math.abs(speed * Math.cos(ang));
      b.y = L.paddleY - BALL_R - 0.5;
      enforceMinVertical();
    }

    // 砖块（每次子步只处理一次碰撞）
    for (var i = 0; i < state.bricks.length; i++) {
      var br = state.bricks[i];
      var nx = clamp(b.x, br.x, br.x + br.w);
      var ny = clamp(b.y, br.y, br.y + br.h);
      var dx = b.x - nx;
      var dy = b.y - ny;
      if (dx * dx + dy * dy > BALL_R * BALL_R) continue;

      var overlapL = (b.x + BALL_R) - br.x;
      var overlapR = (br.x + br.w) - (b.x - BALL_R);
      var overlapT = (b.y + BALL_R) - br.y;
      var overlapB = (br.y + br.h) - (b.y - BALL_R);
      if (Math.min(overlapL, overlapR) < Math.min(overlapT, overlapB)) {
        b.vx = overlapL < overlapR ? -Math.abs(b.vx) : Math.abs(b.vx);
      } else {
        b.vy = overlapT < overlapB ? -Math.abs(b.vy) : Math.abs(b.vy);
      }
      b.x += dx === 0 ? 0 : (b.x < br.x + br.w / 2 ? -0.5 : 0.5);
      enforceMinVertical();
      damageBrick(br);
      break;
    }

    // 落底
    if (b.y - BALL_R > view.h) loseLife();
  }

  function updatePaddle(dt) {
    if (state.keys.left) state.paddleTargetX -= 540 * dt;
    if (state.keys.right) state.paddleTargetX += 540 * dt;
    var half = L.paddleW / 2;
    state.paddleTargetX = clamp(state.paddleTargetX, half, view.w - half);
    state.paddleX = state.paddleTargetX;

    if (state.status === 'serving') positionBallOnPaddle();
  }

  /* ------------------------------------------------------------------ *
   *  特效（性能模式下整体关闭）
   * ------------------------------------------------------------------ */

  function addShake(amount) {
    if (state.perfMode) return;
    state.shake = Math.min(7, state.shake + amount);
  }

  function spawnParticles(x, y, color, count, power) {
    if (state.perfMode) return;
    for (var i = 0; i < count; i++) {
      if (state.particles.length > 220) return;
      var a = Math.random() * Math.PI * 2;
      var sp = (60 + Math.random() * 180) * power;
      state.particles.push({
        x: x, y: y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 40,
        life: 0.45 + Math.random() * 0.4,
        maxLife: 0.85,
        size: 2 + Math.random() * 3,
        color: color
      });
    }
  }

  function updateFx(dt) {
    for (var i = state.particles.length - 1; i >= 0; i--) {
      var p = state.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        state.particles.splice(i, 1);
        continue;
      }
      p.vy += 620 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    if (state.shake > 0) state.shake = Math.max(0, state.shake - 26 * dt);
  }

  /* ------------------------------------------------------------------ *
   *  帧率统计与自适应画质
   * ------------------------------------------------------------------ */

  function trackFps(now, dtMs) {
    if (dtMs > 0 && dtMs < 2000) {
      var inst = 1000 / dtMs;
      fpsValue = fpsValue ? fpsValue * 0.92 + inst * 0.08 : inst;
    }
    if (state.perfMode) { lowFpsSince = 0; return; }
    var active = !state.paused &&
      (state.status === 'playing' || state.status === 'serving') &&
      !(typeof document !== 'undefined' && document.hidden);
    if (active && fpsValue > 0 && fpsValue < LOW_FPS_THRESHOLD &&
        Date.now() - manualPerfAt > MANUAL_GUARD_MS) {
      if (!lowFpsSince) lowFpsSince = now;
      else if (now - lowFpsSince > LOW_FPS_HOLD_MS) {
        setPerfMode(true);
        setStatus('帧率偏低，已自动切到性能模式（点「✨ 效果」可恢复）');
      }
    } else {
      lowFpsSince = 0;
    }
  }

  function setPerfMode(on) {
    state.perfMode = !!on;
    manualPerfAt = Date.now();
    perfBtn.textContent = on ? '✨ 效果' : '⚡ 性能';
    Storage.set(PERF_KEY, on ? 1 : 0);
    resizeCanvas();
  }

  /* ------------------------------------------------------------------ *
   *  渲染
   * ------------------------------------------------------------------ */

  function draw() {
    if (!ctx) return;

    ctx.save();
    if (state.shake > 0.2) {
      ctx.translate((Math.random() - 0.5) * state.shake, (Math.random() - 0.5) * state.shake);
    }

    ctx.fillStyle = theme.bg;
    ctx.fillRect(-12, -12, view.w + 24, view.h + 24);
    ctx.fillStyle = theme.surface2;
    roundRect(ctx, 1, 1, view.w - 2, view.h - 2, 10);
    ctx.fill();

    // 砖块
    for (var i = 0; i < state.bricks.length; i++) {
      var br = state.bricks[i];
      var pair = BRICK_COLORS[br.maxHp];
      ctx.fillStyle = pair[0];
      roundRect(ctx, br.x, br.y, br.w, br.h, 5);
      ctx.fill();
      // 底部压色条代替描边：省掉每块砖一次 stroke（高 DPR 下很贵）
      ctx.fillStyle = pair[1];
      ctx.fillRect(br.x + 2, br.y + br.h - 4, br.w - 4, 3);
      if (br.hp < br.maxHp) {
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.fillRect(br.x + 4, br.y + br.h / 2 - 2, br.w - 8, 4);
      }
    }

    // 挡板
    ctx.fillStyle = theme.accent;
    roundRect(ctx, state.paddleX - L.paddleW / 2, L.paddleY, L.paddleW, L.paddleH, 6);
    ctx.fill();

    // 拖尾
    if (!state.perfMode) {
      for (var t = 0; t < state.trail.length; t++) {
        var tr = state.trail[t];
        ctx.globalAlpha = (t + 1) / state.trail.length * 0.28;
        ctx.fillStyle = theme.text;
        ctx.beginPath();
        ctx.arc(tr.x, tr.y, BALL_R * (0.6 + 0.4 * t / state.trail.length), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // 球
    ctx.fillStyle = theme.text;
    ctx.beginPath();
    ctx.arc(state.ball.x, state.ball.y, BALL_R, 0, Math.PI * 2);
    ctx.fill();

    // 粒子
    for (var j = 0; j < state.particles.length; j++) {
      var p = state.particles[j];
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / p.maxLife));
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;

    ctx.restore();
  }

  /* ------------------------------------------------------------------ *
   *  主循环
   * ------------------------------------------------------------------ */

  function loop(now) {
    state.rafId = requestAnimationFrame(loop);
    var dtMs = now - state.lastFrameAt;
    var dt = dtMs / 1000;
    state.lastFrameAt = now;
    if (!(dt > 0)) dt = 0;
    if (dt > MAX_FRAME_DT) dt = MAX_FRAME_DT;

    trackFps(now, dtMs);

    if (!state.paused && (state.status === 'playing' || state.status === 'serving')) {
      updatePaddle(dt);
      state.accumulator += dt;
      while (state.accumulator >= PHYS_DT) {
        if (state.status === 'playing') stepPhysics(PHYS_DT);
        state.accumulator -= PHYS_DT;
      }
      if (state.status === 'playing' && !state.perfMode) {
        state.trail.push({ x: state.ball.x, y: state.ball.y });
        if (state.trail.length > 9) state.trail.shift();
      }
      // 运动中每 0.5s 落一次盘，避免长时间飞行后退出丢失太多进度
      state.saveAccum += dt;
      if (state.saveAccum >= 0.5 && state.status === 'playing') {
        state.saveAccum = 0;
        saveState();
      }
    }

    updateFx(dt);
    draw();

    // 帧率读数每秒刷新一次（不做逐帧 DOM 写入）
    fpsAccum += dt;
    if (fpsAccum >= 1) {
      fpsAccum = 0;
      fpsEl.textContent = fpsValue > 0 ? String(Math.round(fpsValue)) : '—';
    }
  }

  /* ------------------------------------------------------------------ *
   *  流程
   * ------------------------------------------------------------------ */

  function loseLife() {
    state.lives -= 1;
    updateStats();
    if (state.lives <= 0) {
      gameOver();
      return;
    }
    setupServe();
    saveState();
    setStatus('丢了一条命，还剩 ' + state.lives + ' 条');
  }

  function levelCleared() {
    var bonus = state.lives * 100;
    state.score += bonus;
    page.setBest(state.score);
    updateStats();

    if (state.level >= LEVELS.length - 1) {
      allCleared();
      return;
    }

    state.status = 'levelclear';
    var name = LEVELS[state.level].name;
    // 此时棋盘已空、无法直接恢复；记下「清空的是第几关」，下次从下一关继续。
    saveResumeAfter(state.level);
    showOverlay({
      icon: '🎯',
      title: name + ' 完成！',
      text: '过关奖励 +' + bonus + ' · 剩余命 ' + state.lives +
        ' · 当前得分 ' + state.score.toLocaleString('zh-CN'),
      actionLabel: '下一关',
      onAction: nextLevel
    });
    setStatus(name + ' 完成，马上进入下一关…');
    state.advanceTimer = setTimeout(function () {
      state.advanceTimer = null;
      nextLevel();
    }, LEVEL_CLEAR_DELAY);
  }

  function nextLevel() {
    if (state.advanceTimer !== null) {
      clearTimeout(state.advanceTimer);
      state.advanceTimer = null;
    }
    hideOverlay();
    startLevel(state.level + 1);
    setStatus('');
  }

  function gameOver() {
    state.status = 'gameover';
    discardState();       // 命已用尽，不留存档
    saveMaxLevel();
    showOverlay({
      icon: '💀',
      title: '游戏结束',
      text: '得分 ' + state.score.toLocaleString('zh-CN') +
        ' · 到达第 ' + (state.level + 1) + ' 关',
      danger: true,
      actionLabel: '再来一局',
      onAction: resetGame
    });
    setStatus('游戏结束');
  }

  function allCleared() {
    state.status = 'cleared';
    discardState();       // 一轮已通关，不留存档
    state.cleared = (Storage.get(CLEAR_KEY, 0) | 0) + 1;
    Storage.set(CLEAR_KEY, state.cleared);
    saveMaxLevel();
    updateStats();
    showOverlay({
      icon: '🏆',
      title: '通关！',
      text: '五关全部清空 · 最终得分 ' + state.score.toLocaleString('zh-CN') +
        ' · 累计通关 ' + state.cleared + ' 次',
      actionLabel: '再来一轮',
      onAction: resetGame
    });
    setStatus('通关！');
  }

  function resetGame() {
    if (state.advanceTimer !== null) {
      clearTimeout(state.advanceTimer);
      state.advanceTimer = null;
    }
    state.level = 0;
    state.score = 0;
    state.lives = START_LIVES;
    state.particles.length = 0;
    state.trail.length = 0;
    state.shake = 0;
    state.paused = false;
    pauseBtn.textContent = '⏸ 暂停';
    state.cleared = Storage.get(CLEAR_KEY, 0) | 0;
    state.maxLevel = Storage.get(LEVEL_KEY, 0) | 0;

    page.beginRun();
    page.renderBest(page.getBest());

    hideOverlay();
    startLevel(0);
  }

  /* ------------------------------------------------------------------ *
   *  纪录 / 面板
   * ------------------------------------------------------------------ */

  function saveMaxLevel() {
    var reached = state.level + 1;
    var prev = Storage.get(LEVEL_KEY, 0) | 0;
    if (reached > prev) Storage.set(LEVEL_KEY, reached);
    state.maxLevel = Math.max(prev, reached);
  }

  /* ---------- 存档（退出再进入可续玩） ---------- */

  function brickKey(br) {
    var c = Math.round((br.x - L.brickSide) / (L.brickW + BRICK_GAP));
    var r = Math.round((br.y - L.brickTop) / (BRICK_H + BRICK_GAP));
    return r + '_' + c;
  }

  /*
   * 保存当前对局。位置用「关卡布局坐标」记录，横竖屏切换后仍能正确还原。
   * 只在进行中表示可恢复；结束态（过关遮罩 / 游戏结束 / 通关）另有处理。
   */
  function saveState() {
    if (state.status !== 'playing' && state.status !== 'serving') return;
    var b = state.ball;
    Storage.set(SAVE_KEY, {
      v: 1,
      mode: state.mode,
      level: state.level,
      score: state.score,
      lives: state.lives,
      status: state.status,
      paddleX: state.paddleX,
      ball: { x: b.x, y: b.y, vx: b.vx, vy: b.vy },
      bricks: state.bricks.map(function (br) {
        return [brickKey(br), br.hp];
      })
    });
  }

  // 「刚清空第 N 关」的极简记录：此时棋盘已空、无法直接恢复，
  // 下次进来直接从第 N+1 关接着打。
  function saveResumeAfter(levelIndex) {
    Storage.set(SAVE_KEY, { v: 1, resumeAfter: levelIndex });
  }

  function discardState() {
    Storage.remove(SAVE_KEY);
  }

  function loadState() {
    var d = Storage.get(SAVE_KEY, null);
    if (!d || d.v !== 1) return false;

    // 情况一：上次在过关遮罩处退出
    if (typeof d.resumeAfter === 'number') {
      var next = d.resumeAfter + 1;
      if (next < 0 || next >= LEVELS.length) return false;
      applyMode(VIEWS[d.mode] ? d.mode : selectMode());
      startLevel(next);
      return true;
    }
    if (typeof d.level !== 'number' || d.level < 0 || d.level >= LEVELS.length) return false;
    if (d.status !== 'playing' && d.status !== 'serving') return false;
    if (typeof d.score !== 'number' || typeof d.lives !== 'number') return false;
    if (!Array.isArray(d.bricks) || !d.bricks.length) return false;

    state.level = d.level;
    applyMode(VIEWS[d.mode] ? d.mode : selectMode());   // 按关卡重建砖块

    // 按存档还原每块砖的剩余血量（已被打掉的不恢复）
    var hpMap = {};
    for (var i = 0; i < d.bricks.length; i++) {
      var item = d.bricks[i];
      if (Array.isArray(item) && item.length === 2) hpMap[item[0]] = item[1];
    }
    state.bricks = state.bricks.filter(function (br) {
      var k = brickKey(br);
      if (!(k in hpMap)) return false;
      br.hp = clamp(hpMap[k] | 0, 1, br.maxHp);
      return true;
    });
    if (!state.bricks.length) return false;

    state.score = Math.max(0, d.score | 0);
    state.lives = clamp(d.lives | 0, 1, START_LIVES * 4);

    var half = L.paddleW / 2;
    state.paddleX = clamp(
      typeof d.paddleX === 'number' ? d.paddleX : view.w / 2, half, view.w - half);
    state.paddleTargetX = state.paddleX;

    var b = state.ball;
    if (d.status === 'playing' && d.ball &&
        isFinite(d.ball.x) && isFinite(d.ball.y) &&
        isFinite(d.ball.vx) && isFinite(d.ball.vy)) {
      b.x = clamp(d.ball.x, BALL_R, view.w - BALL_R);
      b.y = d.ball.y;
      b.vx = d.ball.vx;
      b.vy = d.ball.vy;
      state.status = 'playing';
    } else {
      setupServe();
    }

    updateStats();
    saveMaxLevel();
    return true;
  }

  function updateStats() {
    scoreEl.textContent = state.score.toLocaleString('zh-CN');
    livesEl.textContent = String(Math.max(0, state.lives));
    levelEl.textContent = String(state.level + 1);
    maxLevelEl.textContent = state.maxLevel > 0 ? String(state.maxLevel) : '—';
    clearedEl.textContent = String(state.cleared);
    page.renderBest(page.getBest());
  }

  function setStatus(text) {
    statusEl.textContent = text || '';
  }

  /* ------------------------------------------------------------------ *
   *  暂停
   * ------------------------------------------------------------------ */

  function setPaused(paused) {
    if (state.status !== 'playing' && state.status !== 'serving') paused = false;
    if (state.paused === paused) return;

    state.paused = paused;
    pauseBtn.textContent = paused ? '▶ 继续' : '⏸ 暂停';

    if (paused) {
      saveState();        // 暂停即落盘
      showOverlay({
        icon: '⏸️',
        title: '已暂停',
        text: '按 P 或点击「继续」回到游戏。',
        actionLabel: '继续',
        onAction: function () {
          setPaused(false);
        }
      });
      setStatus('已暂停');
    } else {
      hideOverlay();
      setStatus('');
    }
  }

  /* ------------------------------------------------------------------ *
   *  遮罩
   * ------------------------------------------------------------------ */

  function showOverlay(options) {
    overlay.innerHTML = '';
    overlay.hidden = false;

    var primary = UI.el('button', {
      class: 'btn' + (options.danger ? ' btn--danger' : ''),
      type: 'button',
      text: options.actionLabel || '确定'
    });
    primary.addEventListener('click', function () {
      if (options.onAction) options.onAction();
    });

    overlay.appendChild(UI.el('div', {
      class: 'overlay__icon', 'aria-hidden': 'true', text: options.icon || '🎯'
    }));
    overlay.appendChild(UI.el('h2', { class: 'overlay__title', text: options.title || '' }));
    overlay.appendChild(UI.el('p', { class: 'overlay__text', text: options.text || '' }));
    overlay.appendChild(UI.el('div', { class: 'overlay__actions' }, [primary]));
  }

  function hideOverlay() {
    overlay.hidden = true;
    overlay.innerHTML = '';
  }

  /* ------------------------------------------------------------------ *
   *  输入
   * ------------------------------------------------------------------ */

  function canvasX(e) {
    var rect = canvas.getBoundingClientRect();
    var w = rect && rect.width ? rect.width : view.w;
    return ((e.clientX - (rect ? rect.left : 0)) / w) * view.w;
  }

  function isTypingTarget(e) {
    var tag = e.target && e.target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA';
  }

  canvas.addEventListener('pointerdown', function (e) {
    if (isTypingTarget(e) || state.paused) return;
    state.pointerDown = true;
    state.pointerStart = { x: e.clientX, y: e.clientY };
    if (e.pointerType === 'mouse') {
      state.paddleTargetX = canvasX(e);
    } else {
      state.touchDrag = { startX: canvasX(e), paddleX: state.paddleX };
    }
  });

  canvas.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'mouse') {
      if (state.paused) return;
      state.paddleTargetX = canvasX(e);
      return;
    }
    if (state.paused || !state.pointerDown || !state.touchDrag) return;
    state.paddleTargetX = state.touchDrag.paddleX + (canvasX(e) - state.touchDrag.startX);
  });

  global.addEventListener('pointerup', function (e) {
    var wasDown = state.pointerDown;
    var start = state.pointerStart;
    state.pointerDown = false;
    state.pointerStart = null;
    state.touchDrag = null;
    if (!wasDown || state.paused) return;
    if (state.status !== 'serving') return;

    // 轻点才发球，避免拖动挡板时误发
    if (start && Math.abs(e.clientX - start.x) < 8 && Math.abs(e.clientY - start.y) < 8) {
      state.serveOffset = clamp(
        (canvasX(e) - state.paddleX) / (L.paddleW / 2), -1, 1);
      setStatus('');
      serve();
    }
  });

  global.addEventListener('pointercancel', function () {
    state.pointerDown = false;
    state.pointerStart = null;
    state.touchDrag = null;
  });

  global.addEventListener('keydown', function (e) {
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if ((tag === 'BUTTON' || tag === 'A') && (e.key === ' ' || e.key === 'Enter')) return;

    var k = e.key;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') {
      state.keys.left = true;
      e.preventDefault();
    } else if (k === 'ArrowRight' || k === 'd' || k === 'D') {
      state.keys.right = true;
      e.preventDefault();
    } else if (k === ' ') {
      e.preventDefault();
      if (!state.paused && state.status === 'serving') {
        state.serveOffset = 0;
        setStatus('');
        serve();
      }
    } else if (k === 'p' || k === 'P' || k === 'Escape') {
      e.preventDefault();
      setPaused(!state.paused);
    }
  });

  global.addEventListener('keyup', function (e) {
    var k = e.key;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') state.keys.left = false;
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') state.keys.right = false;
  });

  // 切走标签页 / 窗口失焦：自动暂停，回来需手动继续（与仓库其他游戏一致）。
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      saveState();        // 切后台即落盘
      setPaused(true);
    }
  });
  global.addEventListener('blur', function () {
    setPaused(true);
  });

  /* ------------------------------------------------------------------ *
   *  启动
   * ------------------------------------------------------------------ */

  page.onNewGame(resetGame);

  readTheme();
  state.perfMode = (Storage.get(PERF_KEY, 0) | 0) === 1;
  perfBtn.textContent = state.perfMode ? '✨ 效果' : '⚡ 性能';

  // 先按设备选视口，再初始化画面
  applyMode(selectMode());

  state.cleared = Storage.get(CLEAR_KEY, 0) | 0;
  state.maxLevel = Storage.get(LEVEL_KEY, 0) | 0;
  updateStats();

  ruleEl.textContent = '点击 / 空格发球 · 鼠标、拖动或 ←→ 移动挡板 · P 暂停' +
    (LEVELS[0].hint ? ' · ' + LEVELS[0].hint : '');

  if (global.matchMedia) {
    var modeQuery = '(hover: hover) and (pointer: fine) and (min-width: 640px)';
    var onModeChange = function () {
      var mode = selectMode();
      if (mode !== state.mode) {
        applyMode(mode);
        setStatus(mode === 'landscape' ? '已切换到横版 640×480' : '已切换到竖版 480×640');
      }
    };
    try {
      var mq = global.matchMedia(modeQuery);
      if (mq.addEventListener) mq.addEventListener('change', onModeChange);
      else if (mq.addListener) mq.addListener(onModeChange);
    } catch (err) { /* 老浏览器忽略 */ }

    var themeQuery = '(prefers-color-scheme: dark)';
    var onThemeChange = function () {
      readTheme();
      draw();
    };
    try {
      var tmq = global.matchMedia(themeQuery);
      if (tmq.addEventListener) tmq.addEventListener('change', onThemeChange);
      else if (tmq.addListener) tmq.addListener(onThemeChange);
    } catch (err) { /* 老浏览器忽略 */ }
  }

  global.addEventListener('resize', function () {
    resizeCanvas();
  });

  if (!loadState()) startLevel(0);
  page.renderBest(page.getBest());

  state.lastFrameAt = (typeof performance !== 'undefined' && performance.now)
    ? performance.now() : Date.now();
  state.rafId = requestAnimationFrame(loop);

  /* 只在测试环境暴露（加载本文件前设置 window.__BREAKOUT_TEST__ = true）。 */
  if (global.__BREAKOUT_TEST__) {
    global.__BREAKOUT__ = {
      state: state,
      view: view,
      layout: L,
      serve: serve,
      setPaused: setPaused,
      setPerfMode: setPerfMode,
      startLevel: startLevel,
      nextLevel: nextLevel,
      resetGame: resetGame,
      applyMode: applyMode,
      computeLayout: computeLayout,
      buildBricks: buildBricks,
      stepPhysics: stepPhysics,
      updatePaddle: updatePaddle,
      draw: draw,
      saveState: saveState,
      loadState: loadState,
      discardState: discardState,
      fps: function () { return fpsValue; }
    };
  }
})(window);
