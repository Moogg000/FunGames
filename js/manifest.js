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
  }
];
