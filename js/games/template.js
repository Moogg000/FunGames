/*
 * template.js — 新小游戏的起点模板。
 *
 * 复制本文件为 js/games/<your-game>.js，改掉游戏名称，然后实现下面标注的
 * 几个部分。其余一切（标题栏、返回链接、最佳成绩徽章、新游戏按钮、提示
 * 弹窗、localStorage、响应式布局）都已由框架提供。
 *
 * 框架约定：
 *   - 每个游戏文件一个 IIFE，不向全局暴露任何东西。
 *   - 所有需要持久化的数据都通过 FunGamesStorage 读写，键名以 "<game-id>:" 开头。
 *   - 页面框架来自 FunGamesUI.createPage()，你的界面挂到 page.main 里。
 *   - 键盘、触屏和鼠标输入都要支持。
 *   - 最高分：开局时调用 page.beginRun()，成绩变化时调用 page.setBest(value)。
 *     框架会自动实时刷新徽章，并在打破纪录时弹出不遮挡操作的提示。
 */
(function (global) {
  'use strict';

  var Storage = global.FunGamesStorage;
  var UI = global.FunGamesUI;

  var GAME_ID = 'template';
  var BEST_KEY = GAME_ID + ':best';
  var STATE_KEY = GAME_ID + ':state';

  /* 1. 页面框架 --------------------------------------------------------------
   * createPage() 会生成吸顶标题栏（返回链接、标题、最佳成绩徽章、新游戏
   * 按钮），以及一个 <main> 挂载节点和一个提示弹窗容器。
   */
  var page = UI.createPage({
    title: '模板游戏',
    subtitle: '写在标题下方的一句话说明',
    backHref: '../index.html',
    best: {
      storageKey: BEST_KEY,
      label: '最高分数',
      format: function (value) {
        return Number(value).toLocaleString('zh-CN');
      }
      // lowerIsBetter: true   // 计时类纪录请打开这一行
    }
  });

  /* 2. 你的界面 --------------------------------------------------------------
   * 在 page.main 里搭建游戏。可以用 UI.el(tag, props, children) 简化代码，
   * 也可以直接用 document.createElement。
   */
  var statusEl = UI.el('p', { class: 'panel__hint', text: '分数：0' });

  var score = 0;

  var panel = UI.el('section', { class: 'panel' }, [
    UI.el('h2', { class: 'panel__title', text: '我的游戏' }),
    statusEl,
    UI.el('p', { class: 'panel__hint' }, [
      '在这里写上玩法规则和的操作说明（键盘、触屏和鼠标）。'
    ])
  ]);

  var actionBtn = UI.el('button', {
    class: 'btn',
    type: 'button',
    text: '点我得分'
  });
  actionBtn.addEventListener('click', function () {
    score += 1;
    statusEl.textContent = '分数：' + score;
    if (score > 0) page.setBest(score);
  });

  page.main.appendChild(panel);
  page.main.appendChild(actionBtn);

  // 把页面框架挂到页面上。FunGames 的每个页面都有 <div id="app">。
  document.getElementById('app').appendChild(page.root);

  /* 3. 游戏状态 --------------------------------------------------------------
   * 当前这一局放在内存里，同时同步进 localStorage，这样刷新页面不会丢进度。
   */
  function save() {
    Storage.set(STATE_KEY, { score: score });
  }

  function load() {
    var data = Storage.get(STATE_KEY, null);
    if (!data || typeof data.score !== 'number') return false;
    score = data.score;
    statusEl.textContent = '分数：' + score;
    return true;
  }

  function reset() {
    score = 0;
    statusEl.textContent = '分数：0';
    // 告知框架「新的一局开始了」，破纪录提示会以这一局开始时的成绩为基准。
    page.beginRun();
    save();
  }

  page.onNewGame(reset);

  /* 4. 输入 ------------------------------------------------------------------
   * 触屏：UI.onSwipe(element, function (dir) { ... });   -> 'up'/'down'/'left'/'right'
   * 键盘：global.addEventListener('keydown', ...);
   * 长按 / 轻点：pointerdown + 计时器 + pointerup（参考 minesweeper.js）。
   */

  if (!load()) reset();
})(window);
