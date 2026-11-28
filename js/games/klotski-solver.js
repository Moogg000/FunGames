/*
 * klotski-solver.js — 数字华容道求解器（纯逻辑，零 DOM，可独立在 Node 里测试）。
 *
 * 棋盘用一维数组表示：长度 n*n，取值 1..n*n-1 为数字块，0 为空格。
 * 目标状态为 [1, 2, ..., n*n-1, 0]。
 *
 * 提示用 **IDA\*（迭代加深 A*）**：
 *   启发函数 h = 曼哈顿距离 + 2 × 线性冲突数（两者都是可采纳的，不会高估）。
 *   - 曼哈顿距离：每个数字块到目标位置的横纵距离之和；
 *   - 线性冲突：同一行（列）里两个都已归位行（列）、但左右（上下）顺序颠倒，
 *     每发生一次至少要额外花 2 步，所以加 2。它能显著减少搜索节点。
 *
 * 出于性能考虑加了时间 / 节点上限。若超限求不出最优解，会退化为「贪心建议」：
 * 在所有合法走法里挑让 h 最小的那一步，保证玩家永远能拿到一个可用的提示。
 */
(function (global) {
  'use strict';

  var BLANK = 0;

  /* ------------------------------------------------------------------ *
   *  邻居表：按尺寸缓存「每个下标的上下左右邻居」
   * ------------------------------------------------------------------ */

  var NEIGHBORS = {};

  function neighborsOf(n) {
    if (NEIGHBORS[n]) return NEIGHBORS[n];
    var table = [];
    for (var i = 0; i < n * n; i++) {
      var r = (i / n) | 0;
      var c = i % n;
      var list = [];
      if (r > 0) list.push(i - n);
      if (r < n - 1) list.push(i + n);
      if (c > 0) list.push(i - 1);
      if (c < n - 1) list.push(i + 1);
      table.push(list);
    }
    NEIGHBORS[n] = table;
    return table;
  }

  /* ------------------------------------------------------------------ *
   *  启发函数
   * ------------------------------------------------------------------ */

  function manhattan(tiles, n) {
    var sum = 0;
    for (var i = 0; i < tiles.length; i++) {
      var v = tiles[i];
      if (v === BLANK) continue;
      var gi = v - 1;
      sum += Math.abs(((i / n) | 0) - ((gi / n) | 0)) +
        Math.abs((i % n) - (gi % n));
    }
    return sum;
  }

  /* 线性冲突：同一行/列中，两块都已处于目标行/列但彼此顺序颠倒，每次 +2。 */
  function linearConflict(tiles, n) {
    var extra = 0;
    var r, c, i, j, a, b;

    for (r = 0; r < n; r++) {
      for (i = 0; i < n; i++) {
        a = tiles[r * n + i];
        if (a === BLANK || ((a - 1) / n | 0) !== r) continue;
        for (j = i + 1; j < n; j++) {
          b = tiles[r * n + j];
          if (b === BLANK || ((b - 1) / n | 0) !== r) continue;
          if (a > b) extra += 2;
        }
      }
    }

    for (c = 0; c < n; c++) {
      for (i = 0; i < n; i++) {
        a = tiles[i * n + c];
        if (a === BLANK || ((a - 1) % n) !== c) continue;
        for (j = i + 1; j < n; j++) {
          b = tiles[j * n + c];
          if (b === BLANK || ((b - 1) % n) !== c) continue;
          if (a > b) extra += 2;
        }
      }
    }
    return extra;
  }

  function heuristic(tiles, n) {
    return manhattan(tiles, n) + linearConflict(tiles, n);
  }

  /* ------------------------------------------------------------------ *
   *  工具
   * ------------------------------------------------------------------ */

  function solvedTiles(n) {
    var out = [];
    for (var i = 1; i <= n * n - 1; i++) out.push(i);
    out.push(BLANK);
    return out;
  }

  function isSolved(tiles, n) {
    for (var i = 0; i < tiles.length - 1; i++) {
      if (tiles[i] !== i + 1) return false;
    }
    return tiles[tiles.length - 1] === BLANK;
  }

  function clone(tiles) {
    return tiles.slice();
  }

  /* ------------------------------------------------------------------ *
   *  打乱：从完成状态随机走 steps 步，必然可解。
   *  刻意不走回头路，避免「走一步退一步」这种无效打乱。
   * ------------------------------------------------------------------ */

  function scramble(n, steps, random) {
    var rng = random || Math.random;
    var tiles = solvedTiles(n);
    var nb = neighborsOf(n);
    var blank = tiles.length - 1;
    var prev = -1;

    for (var k = 0; k < steps; k++) {
      var options = nb[blank].filter(function (p) { return p !== prev; });
      var pick = options[Math.floor(rng() * options.length)];
      tiles[blank] = tiles[pick];
      tiles[pick] = BLANK;
      prev = blank;
      blank = pick;
    }

    // 极小概率走出来还是完成态，就再走远一点。
    if (isSolved(tiles, n)) return scramble(n, steps + n, rng);
    return tiles;
  }

  /* ------------------------------------------------------------------ *
   *  IDA*
   * ------------------------------------------------------------------ */

  var TIMEOUT = {};

  function idaStar(tiles, n, options) {
    options = options || {};
    var deadline = Date.now() + (options.timeLimit || 1500);
    var nodeLimit = options.nodeLimit || 4000000;

    var state = clone(tiles);
    var nb = neighborsOf(n);
    var nodes = 0;
    var found = false;
    var path = [];

    function dfs(g, bound, prev) {
      nodes++;
      if ((nodes & 1023) === 0) {
        if (Date.now() > deadline || nodes > nodeLimit) throw TIMEOUT;
      }

      var h = heuristic(state, n);
      var f = g + h;
      if (f > bound) return f;
      if (h === 0) {
        found = true;
        return 0;
      }

      var blank = state.indexOf(BLANK);
      var list = nb[blank];
      var min = Infinity;

      for (var k = 0; k < list.length; k++) {
        var p = list[k];
        if (p === prev) continue;   // 不走回头路

        state[blank] = state[p];
        state[p] = BLANK;
        path.push(p);

        var t = dfs(g + 1, bound, blank);

        if (found) return 0;

        path.pop();
        state[p] = state[blank];
        state[blank] = BLANK;

        if (t < min) min = t;
      }
      return min;
    }

    var bound = heuristic(state, n);
    try {
      while (!found) {
        var t = dfs(0, bound, -1);
        if (found) break;
        if (t === Infinity) return { found: false, moves: [], nodes: nodes, complete: false };
        bound = t;
      }
    } catch (err) {
      if (err !== TIMEOUT) throw err;
      return { found: false, moves: [], nodes: nodes, complete: false, timeout: true };
    }

    return {
      found: true,
      moves: path.slice(),
      nodes: nodes,
      complete: true,
      length: path.length
    };
  }

  /* 贪心兜底：挑让启发值下降最多的一步，保证永远有提示可用。 */
  function greedyMove(tiles, n) {
    var blank = tiles.indexOf(BLANK);
    var nb = neighborsOf(n);
    var best = heuristic(tiles, n);
    var bestPick = -1;

    var state = clone(tiles);
    for (var k = 0; k < nb[blank].length; k++) {
      var p = nb[blank][k];
      state[blank] = state[p];
      state[p] = BLANK;
      var h = heuristic(state, n);
      state[p] = state[blank];
      state[blank] = BLANK;
      if (h < best) {
        best = h;
        bestPick = p;
      }
    }
    return bestPick;
  }

  /* ------------------------------------------------------------------ *
   *  加权 IDA*（兜底求解器）
   *
   * 最优解在大棋盘上很深，IDA* 会超时。把 f = g + W·h（W > 1）后搜索更
   * 偏向目标，能很快找出一条**不一定最短但一定有效**的解法；内存只占一条
   * 搜索路径，不像 A* 那样需要哈希表。用于「提示」这种只需要一步的场景。
   * ------------------------------------------------------------------ */

  function keyOf(tiles) {
    var s = '';
    for (var i = 0; i < tiles.length; i++) s += String.fromCharCode(tiles[i] + 1);
    return s;
  }

  function weightedIdaStar(tiles, n, options) {
    options = options || {};
    var W = options.weight || 2;
    var deadline = Date.now() + (options.timeLimit || 1500);
    var nodeLimit = options.nodeLimit || 2000000;
    var maxBound = options.maxBound || 400;

    var state = clone(tiles);
    var nb = neighborsOf(n);
    var nodes = 0;
    var found = false;
    var path = [];
    var inPath = {};
    inPath[keyOf(state)] = true;

    function dfs(g, bound, prev) {
      nodes++;
      if ((nodes & 1023) === 0 && (Date.now() > deadline || nodes > nodeLimit)) {
        throw TIMEOUT;
      }

      var h = heuristic(state, n);
      var f = g + W * h;
      if (f > bound) return f;
      if (h === 0) {
        found = true;
        return 0;
      }

      var blank = state.indexOf(BLANK);
      var list = nb[blank];
      var min = Infinity;

      for (var k = 0; k < list.length; k++) {
        var p = list[k];
        if (p === prev) continue;

        state[blank] = state[p];
        state[p] = BLANK;

        var key = keyOf(state);
        if (inPath[key]) {
          state[p] = state[blank];
          state[blank] = BLANK;
          continue;
        }

        inPath[key] = true;
        path.push(p);

        var t = dfs(g + 1, bound, blank);

        if (found) return 0;

        path.pop();
        delete inPath[key];

        state[p] = state[blank];
        state[blank] = BLANK;

        if (t < min) min = t;
      }
      return min;
    }

    var bound = W * heuristic(state, n);
    try {
      while (!found) {
        var t = dfs(0, bound, -1);
        if (found) break;
        if (t === Infinity || t > maxBound) {
          return { found: false, moves: [], nodes: nodes, complete: false };
        }
        bound = t;
      }
    } catch (err) {
      if (err !== TIMEOUT) throw err;
      return { found: false, moves: [], nodes: nodes, complete: false, timeout: true };
    }

    return {
      found: true,
      moves: path.slice(),
      nodes: nodes,
      complete: true,
      suboptimal: true,
      length: path.length
    };
  }

  /*
   * 对外主接口：求解当前局面。
   *   solve(tiles, n, { timeLimit, nodeLimit, random })
   * 返回 { found, moves, nodes, complete, timeout?, length? }
   *   moves 是「依次要滑动的数字块所在下标」。
   */
  function solve(tiles, n, options) {
    options = options || {};
    if (isSolved(tiles, n)) {
      return { found: true, moves: [], nodes: 0, complete: true, length: 0 };
    }

    // 先求最优解；超时或超节点就退化为加权搜索（次优但有效）。
    var result = idaStar(tiles, n, {
      timeLimit: options.timeLimit || 1500,
      nodeLimit: options.nodeLimit || 4000000
    });

    if (!result.found) {
      result = weightedIdaStar(tiles, n, {
        timeLimit: options.fallbackTimeLimit || 1500,
        nodeLimit: options.nodeLimit || 2000000,
        weight: options.weight || 2
      });
    }

    // 仍然失败才用单步贪心，保证玩家点提示永远有反馈。
    if (!result.found || !result.moves.length) {
      var pick = greedyMove(tiles, n);
      if (pick >= 0) {
        result.found = true;
        result.moves = [pick];
        result.greedy = true;
      }
    }
    return result;
  }

  global.KlotskiSolver = {
    BLANK: BLANK,
    neighborsOf: neighborsOf,
    manhattan: manhattan,
    linearConflict: linearConflict,
    heuristic: heuristic,
    solvedTiles: solvedTiles,
    isSolved: isSolved,
    scramble: scramble,
    solve: solve,
    greedyMove: greedyMove,
    weightedIdaStar: weightedIdaStar,
    keyOf: keyOf
  };
})(typeof window !== 'undefined' ? window : globalThis);
