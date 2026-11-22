# 🎮 FunGames

一个基于 GitHub Pages 的静态网页小游戏合集。无构建步骤、无框架、无第三方依赖 —— 只有 HTML、CSS 和原生 JavaScript。

本仓库的定位是**框架优先**：首页从 manifest 自动渲染，所有游戏共用同一套页面框架和工具函数。以后要加小游戏，只需要复制一套模板，再在 manifest 里注册一次。

---

## ✨ 特性

- **零依赖** —— 纯 HTML5 + CSS + 原生 JavaScript，可离线运行。
- **GitHub Pages 就绪** —— 把 `main` 分支推上去，开启 Pages 即可。
- **响应式** —— 移动优先布局、`100dvh` 视口、安全区适配，棋盘按容器宽度自动缩放。
- **触屏 + 鼠标 + 键盘** —— 轻点、长按、右键、滑动、方向键 / WASD，必要时提供屏幕方向按钮。
- **本地存档** —— 最佳成绩和游戏进度保存在 `localStorage`（统一 `fungames:` 前缀）；storage 被禁用时自动降级到内存，游戏不会中断。
- **可访问性** —— 语义化标签、ARIA 标注、清晰的焦点样式、支持 `prefers-reduced-motion`。
- **浅色 / 深色主题** —— 自动跟随系统 `prefers-color-scheme`。
- **全中文界面**。

---

## 🚀 本地预览

### 方式一：使用自带的 `.preview-server.js`（推荐）

仓库根目录下的 [`.preview-server.js`](.preview-server.js) 是一个零依赖的静态预览服务器，专门用来在本地查看这个站点。

```bash
node .preview-server.js
```

看到下面的输出后，在浏览器打开 <http://127.0.0.1:8787/> 就能玩了：

```
Preview server running at http://127.0.0.1:8787/
Serving directory: C:\...\FunGames
```

关于这个脚本：

- **只监听 `127.0.0.1:8787`**，也就是只有本机能访问，不会把目录暴露到公网。
- 访问 `/` 会自动返回 `index.html`；路径不存在返回 `404`；带 `../` 的目录穿越请求会被拦截。
- 停止服务：在终端按 `Ctrl + C`。
- 它是**开发辅助工具**。GitHub Pages 是直接托管静态文件的，用不到它 —— 部署时不会被上传执行。

### 方式二：其他静态服务器

```bash
npx serve .
# 或者
php -S localhost:8000
```

> 也可以直接双击 `index.html` 打开，但部分浏览器在 `file://` 下会限制 `localStorage`，建议还是用本地服务器预览。

---

## 🗂 目录结构

```
.
├── .preview-server.js      # 本地预览服务器（开发用，见上文）
├── index.html              # 首页：渲染游戏列表
├── css/
│   └── style.css           # 全部样式（主题变量、布局、各游戏样式）
├── js/
│   ├── storage.js          # FunGamesStorage —— 带命名空间的 localStorage 封装
│   ├── ui.js               # FunGamesUI —— 共享页面框架与工具函数
│   ├── manifest.js         # ← 游戏注册表（加游戏就改这里）
│   ├── app.js              # 首页渲染逻辑（读取 manifest）
│   └── games/
│       ├── template.js     # ← 新游戏脚手架模板
│       ├── gomoku-ai.js    # ← 五子棋 AI 引擎（纯逻辑，可独立测试）
│       ├── minesweeper.js
│       ├── 2048.js
│       ├── snake.js
│       ├── tetris.js
│       └── tictactoe.js
├── games/
│   ├── template.html       # ← 新游戏页面模板
│   ├── minesweeper.html
│   ├── 2048.html
│   ├── snake.html
│   ├── tetris.html
│   ├── tictactoe.html
│   └── gomoku.html
└── README.md
```

### 共享组件

**`FunGamesStorage`**（`js/storage.js`）—— 请统一用它而不是直接操作 `localStorage`：

```js
FunGamesStorage.get('2048:best', 0)      // 读取（带默认值）
FunGamesStorage.set('2048:best', 2048)   // 写入（自动 JSON 序列化）
FunGamesStorage.remove('2048:state')
FunGamesStorage.isPersistent()           // storage 被禁用时返回 false
```

所有键都会自动加上 `fungames:` 前缀，不会和浏览器里其他数据冲突。

**`FunGamesUI`**（`js/ui.js`）—— 共享页面框架与工具：

```js
var page = FunGamesUI.createPage({
  title: '我的游戏',
  subtitle: '显示在标题下方的一句话',
  backHref: '../index.html',
  best: {
    storageKey: 'mygame:best',              // 也可以写成 () => 'mygame:best:' + diff
    label: '最高分数',
    format: function (v) { return v.toLocaleString('zh-CN'); },
    lowerIsBetter: false,                   // 计时类纪录改成 true
    recordMessage: '🎉 新的最高分！'         // 可选，自定义破纪录提示
  },
});

page.main.appendChild(/* 你的界面 */);        // 挂载节点
document.getElementById('app').appendChild(page.root);

page.onNewGame(reset);                       // 标题栏的「新游戏」按钮
page.beginRun();                             // 每局开始（含读取存档）时调用
page.setBest(score);                         // 成绩变化时调用：实时刷新 + 破纪录提示
page.toast('已保存！');                       // 临时提示
page.renderBest(value);                      // 手动刷新徽章

FunGamesUI.onSwipe(element, function (dir) { /* 'up'|'down'|'left'|'right' */ });
FunGamesUI.formatTime(seconds);              // 75 -> "1:15"
```

`createPage()` 会生成吸顶标题栏：返回链接、标题、最佳成绩徽章和「新游戏」按钮。游戏文件不需要重复写这些结构。

### 最高分与破纪录提示

框架已经把「记录最高分 + 实时显示 + 破纪录提示」封装成默认能力，**现有游戏以及以后新增的游戏，只要调用两个方法就能自动获得**：

| 方法 | 什么时候调用 | 作用 |
| --- | --- | --- |
| `page.beginRun()` | 每一局开始、或读取存档继续时 | 记下「本局开始时的最佳成绩」，作为判断是否破纪录的基准 |
| `page.setBest(value)` | 分数 / 成绩每次变化时 | 若比现有最佳更好，立刻写入 `localStorage` 并刷新标题栏徽章；本局第一次超越基准时，在页面底部弹出「🎉 新的最高分！」（计时类为「🎉 新纪录！」） |

几点说明：

- **实时显示**：徽章随 `setBest()` 的调用即时更新，不用手动刷新。
- **不遮挡界面**：提示是页面底部的 `toast`，设置了 `pointer-events: none`，不会盖住棋盘或按钮，也没有模态框。
- **每局只提示一次**：同一局里分数继续上涨时不会重复弹窗。
- **支持多份纪录**：`storageKey` 可以写成函数（例如按难度区分），`setBest()` 和徽章会自动使用当前对应的键。
- **可自定义文案**：用 `best.recordMessage` 覆盖默认提示。

---

## ➕ 添加一个新游戏

按照下面四步，大约两分钟就能上线一个游戏。

### 第 1 步：复制模板

```bash
cp games/template.html games/snake.html
cp js/games/template.js  js/games/snake.js
```

改掉 `games/snake.html` 里的 `<title>` 和 `<script src>`，让它指向新的 JS 文件。

### 第 2 步：实现游戏

打开 `js/games/snake.js`，按注释标注的 1–4 部分来写：

1. **页面框架** —— 填好 `title`、`subtitle` 和 `best`（存储键、标签、是否计时类）。
2. **你的界面** —— 在 `page.main` 里搭好游戏区域。
3. **游戏状态** —— 用 `FunGamesStorage` 保存 / 读取进度，写在 `save()`、`load()`、`reset()` 里。
4. **输入** —— 同时支持键盘、鼠标和触屏。

其中和「最高分」相关的只有两行，但**不能漏**：

```js
function reset() {
  // ...重置游戏状态...
  page.beginRun();   // 告知框架：新的一局开始了
}

function onScoreChanged() {
  page.setBest(score);   // 成绩变化时调用，自动实时显示 + 破纪录提示
}
```

### 第 3 步：在 `js/manifest.js` 中注册

```js
{
  id: 'snake',
  title: '贪吃蛇',
  description: '吃食物不断变长，别咬到自己的尾巴。',
  icon: '🐍',
  href: 'games/snake.html',
  tags: ['街机', '经典'],
  best: { key: 'snake:best', label: '最高分数' }
}
```

`best` 里：`key` 是存储键（会自动加 `fungames:` 前缀），`label` 是徽章上的文字。计时类把游戏里的 `lowerIsBetter` 设为 `true` 即可。

### 第 4 步：验证

刷新首页，新卡片会自动出现；进入游戏后：

- 标题栏应立即显示「最高分数：—」（还没有纪录时）。
- 玩一会儿，徽章会实时变成当前成绩。
- 打破自己之前的纪录时，页面底部弹出「🎉 新的最高分！」。

### 新游戏的注意事项

| 方面 | 建议 |
| --- | --- |
| 文件位置 | `games/<id>.html` + `js/games/<id>.js` |
| 存储键 | `<id>:best` 和 `<id>:state`（不要用裸名字） |
| 最高分 | `reset()` 里调用 `page.beginRun()`，成绩变化时调用 `page.setBest(value)` |
| 存档 | 每次有意义的变动都保存；启动时读取；数据不合法就重新开一局 |
| 输入 | 键盘和触屏都要支持；在游戏区域上正确设置 `touch-action` |
| 布局 | 挂在 `page.main` 里；棋盘宽度控制在 `min(100%, 440px)` 以内 |
| 样式 | 在 `css/style.css` 里加一个命名清晰的区块（例如 `.snake-…`），并复用现有主题变量 |
| 界面语言 | 中文 |

---

## 🎯 内置游戏

| 游戏 | 操作方式 | 存档内容 |
| --- | --- | --- |
| **扫雷** | 轻点 / 左键翻格 · 长按或右键插旗 · 键盘 Enter / 空格 · 「插旗模式」开关方便小屏操作 | 各难度最佳时间 |
| **2048** | 方向键 / WASD · 滑动 · 触屏显示屏幕方向按钮 | 完整棋盘 + 分数 + 最高分（刷新不丢） |
| **贪吃蛇** | 方向键 / WASD · 滑动 · 屏幕方向盘 · 空格暂停 · 三档速度 | 蛇身 + 食物 + 分数 + 速度（刷新续玩）· 各速度最高分 |
| **俄罗斯方块** | ← → 移动 · ↓ 软降 · ↑ 旋转 · 空格硬降 · P 暂停 · 轻点棋盘旋转 | 棋盘 + 当前 / 下一个方块 + 分数 + 等级（刷新续玩）· 最高分 |
| **井字棋** | 轻点格子 · 数字键 1-9 · Tab + Enter · 两档难度 AI | 当前棋盘 + 难度（刷新续玩）· 最高连胜 |
| **五子棋** | 点击棋盘落子 · 方向键 + Enter · 简单 / 困难两档 AI | 棋盘 + 难度（刷新续玩）· 最高连胜 + 战绩 |

---

## 🎨 主题

所有颜色都是 `css/style.css` 顶部 `:root` 里的 CSS 自定义属性，改一处即可整体换肤：

```css
:root {
  --bg: #f3f5fa;
  --surface: #ffffff;
  --accent: #3a6de0;
}
```

深色配色会通过 `@media (prefers-color-scheme: dark)` 自动生效。

---

## 🛠 常见问题

**改了代码要重新构建吗？**
不用。刷新浏览器即可。只有修改了 `js/manifest.js` 才需要刷新首页。

**为什么 `.preview-server.js` 是隐藏文件？**
因为它只是本地开发工具，不应该干扰站点结构。它不会被 GitHub Pages 执行，可以一直留在仓库里。

**游戏数据存在哪里？**
存在浏览器本地的 `localStorage` 里，键名以 `fungames:` 开头。清除浏览器站点数据会把纪录一起清掉。
