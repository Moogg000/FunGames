/*
 * manifest.js — the single source of truth for the game library.
 *
 * Adding a new game = adding one object here (plus the game's own files).
 * The home page renders itself from this list, so no HTML editing required.
 *
 * Fields:
 *   id         unique slug, used for storage keys and CSS/JS file naming
 *   title      display name shown on the card and in the game's title bar
 *   description short one-liner shown on the card
 *   icon       emoji or short text used as the card thumbnail
 *   href       path to the game page, relative to the site root
 *   tags       free-form words used by the home page filter
 *   best       optional: { key, label, format, lowerIsBetter, read }
 *              key           storage key (without the "fungames:" prefix)
 *              label         text shown before the value, e.g. "最高分数"
 *              format(value) optional formatter
 *              lowerIsBetter true for time-based records
 *              read()        optional: 自定义如何从 storage 取出要展示的值
 *                            （用于「一个游戏有多份纪录」的情况，例如分难度）
 */
window.FUN_GAMES = [
  {
    id: 'minesweeper',
    title: '扫雷',
    description: '揭开所有安全格子，别碰到地雷。',
    icon: '💣',
    href: 'games/minesweeper.html',
    tags: ['逻辑', '经典', '格子'],
    best: {
      label: '最佳时间',
      lowerIsBetter: true,
      // 扫雷按难度分别保存：minesweeper:best:beginner / intermediate / expert。
      // 首页卡片展示所有难度中最快的一次。
      read: function () {
        var names = { beginner: '初级', intermediate: '中级', expert: '高级' };
        var best = null;
        ['beginner', 'intermediate', 'expert'].forEach(function (id) {
          var value = FunGamesStorage.get('minesweeper:best:' + id, null);
          if (typeof value === 'number' && (best === null || value < best.value)) {
            best = { value: value, name: names[id] };
          }
        });
        return best;
      },
      format: function (v) {
        var m = Math.floor(v.value / 60);
        var s = v.value % 60;
        return m + ':' + (s < 10 ? '0' : '') + s + ' · ' + v.name;
      }
    }
  },
  {
    id: '2048',
    title: '2048',
    description: '滑动方块、合并数字，挑战 2048。',
    icon: '🔢',
    href: 'games/2048.html',
    tags: ['益智', '数字', '经典'],
    best: {
      key: '2048:best',
      label: '最高分数',
      format: function (v) {
        return Number(v).toLocaleString('zh-CN');
      }
    }
  },
  {
    id: 'snake',
    title: '贪吃蛇',
    description: '吃食物不断变长，别撞墙、别咬到自己。',
    icon: '🐍',
    href: 'games/snake.html',
    tags: ['街机', '经典', '反应'],
    best: {
      label: '最高分数',
      // 贪吃蛇按速度分别保存：snake:best:slow / normal / fast。
      // 首页卡片展示所有速度中最高的一次。
      read: function () {
        var names = { slow: '慢速', normal: '标准', fast: '快速' };
        var best = null;
        ['slow', 'normal', 'fast'].forEach(function (id) {
          var value = FunGamesStorage.get('snake:best:' + id, null);
          if (typeof value === 'number' && (best === null || value > best.value)) {
            best = { value: value, name: names[id] };
          }
        });
        return best;
      },
      format: function (v) {
        return Number(v.value).toLocaleString('zh-CN') + ' · ' + v.name;
      }
    }
  },
  {
    id: 'tetris',
    title: '俄罗斯方块',
    description: '堆叠方块、消除整行，挑战更高分。',
    icon: '🧱',
    href: 'games/tetris.html',
    tags: ['益智', '经典', '街机'],
    best: {
      key: 'tetris:best',
      label: '最高分数',
      format: function (v) {
        return Number(v).toLocaleString('zh-CN');
      }
    }
  },
  {
    id: 'tictactoe',
    title: '井字棋',
    description: '和 AI 对弈三子连线，挑战最长连胜。',
    icon: '⭕',
    href: 'games/tictactoe.html',
    tags: ['益智', '经典', '对战', 'AI'],
    best: {
      key: 'tictactoe:best',
      label: '最高连胜',
      format: function (v) {
        return v + ' 场';
      }
    }
  },
  {
    id: 'gomoku',
    title: '五子棋',
    description: '25 路棋盘，和 AI 对弈五子连珠。',
    icon: '⚫',
    href: 'games/gomoku.html',
    tags: ['益智', '经典', '对战', 'AI'],
    best: {
      key: 'gomoku:best',
      label: '最高连胜',
      format: function (v) {
        return v + ' 场';
      }
    }
  },
  {
    id: 'klotski',
    title: '数字华容道',
    description: '打乱数字方块，复原为 1…N，求解器支持单步提示与一键演示。',
    icon: '🧩',
    href: 'games/klotski.html',
    tags: ['益智', '经典', '滑块', 'AI'],
    best: {
      label: '最短时间',
      // 三个尺寸的用时不可比，首页卡片展示「其中最好的一成绩 + 它是几乘几」。
      read: function () {
        var names = { 3: '3×3', 4: '4×4', 5: '5×5' };
        var best = null;
        [3, 4, 5].forEach(function (n) {
          var value = FunGamesStorage.get('klotski:best:' + n, null);
          if (typeof value === 'number' && (best === null || value < best.value)) {
            best = { value: value, size: names[n] };
          }
        });
        return best;
      },
      format: function (v) {
        return FunGamesUI.formatClock(v.value) + ' · ' + v.size;
      }
    }
  }
];
