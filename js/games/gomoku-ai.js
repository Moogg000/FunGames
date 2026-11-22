/*
 * gomoku-ai.js — 五子棋 AI 引擎（纯逻辑，不碰 DOM，可独立测试）。
 *
 * 棋盘：25 x 25，用一维数组表示，0 = 空，1 = 人类（黑），2 = AI（白）。
 *
 * 两套 AI：
 *   简单 —— 启发式评分，只看一步。对每个候选空位计算
 *           「AI 下在这里的得分（进攻） + 对手下在这里的得分（防守）× 权重」，
 *           再加上少量随机扰动，取综合分最高者。
 *   困难 —— Minimax 博弈树 + Alpha-Beta 剪枝，迭代加深（受时间预算约束），
 *           配合置换表（加法 Zobrist 哈希）与着法排序。
 *
 * 评估函数：把棋盘上所有「连续 5 格」的窗口按形状打分（活四 / 冲四 / 活三 /
 * 眠三 / 活二 …），AI 的形状分减去对手形状分即棋盘分。搜索时用增量方式维护
 * 两侧形状分（每落一子只重算包含该格的窗口），避免每次都全盘扫描。
 *
 * 所有坐标换算：index = row * SIZE + col。
 */
(function (global) {
  'use strict';

  var SIZE = 25;
  var CELL_COUNT = SIZE * SIZE;
  var EMPTY = 0;
  var HUMAN = 1;
  var AI = 2;

  var DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

  var WIN_SCORE = 100000000;

  /*
   * 形状分值表：SHAPE[count][open]，count 为窗口内该方子的个数，
   * open 为窗口两端开放的个数（0/1/2）。窗口内只要有对方子则整个窗口记 0。
   */
  var SHAPE = {
    5: 10000000,
    4: [0, 100000, 1000000],   // 冲四 / 活四
    3: [0, 2000, 200000],       // 眠三 / 活三
    2: [0, 200, 2000],          // 眠二 / 活二
    1: [0, 0, 0]                // 单子不计分（避免评估被散子噪声主导）
  };

  var WEIGHTS = {
    attack: 1.0,     // 进攻权重
    defense: 0.9,    // 防守权重
    easyNoise: 800   // 简单档随机扰幅
  };

  var CANDIDATE_RANGE = 2;

  var TT_MAX = 200000;   // 置换表容量上限

  /* ------------------------------------------------------------------ *
   *  预计算：所有长度为 5 的窗口（含两侧边界格）
   * ------------------------------------------------------------------ */

  var WIN_CELLS = [];   // 扁平存储：每窗 5 个格子下标
  var WIN_BEFORE = [];  // 窗口前一格（-1 表示出界）
  var WIN_AFTER = [];   // 窗口后一格
  var WIN_COUNT = 0;
  var CELL_WINS = [];   // 每个格子出现在哪些窗口里

  (function buildWindows() {
    var r, c, d, k;
    for (r = 0; r < CELL_COUNT; r++) CELL_WINS.push([]);

    for (d = 0; d < DIRS.length; d++) {
      var dr = DIRS[d][0];
      var dc = DIRS[d][1];
      for (r = 0; r < SIZE; r++) {
        for (c = 0; c < SIZE; c++) {
          var er = r + dr * 4;
          var ec = c + dc * 4;
          if (er < 0 || er >= SIZE || ec < 0 || ec >= SIZE) continue;

          var w = WIN_COUNT++;
          var base = w * 5;
          for (k = 0; k < 5; k++) {
            var idx = (r + dr * k) * SIZE + (c + dc * k);
            WIN_CELLS[base + k] = idx;
            CELL_WINS[idx].push(w);
          }

          var br = r - dr;
          var bc = c - dc;
          WIN_BEFORE[w] = (br >= 0 && br < SIZE && bc >= 0 && bc < SIZE)
            ? br * SIZE + bc : -1;

          var ar = er + dr;
          var ac = ec + dc;
          WIN_AFTER[w] = (ar >= 0 && ar < SIZE && ac >= 0 && ac < SIZE)
            ? ar * SIZE + ac : -1;

          // 落子不只会改变「包含该格」的窗口，还会改变以该格为边界的窗口的
          // 开放端数量，所以边界格也要登记，否则增量评分会算错。
          if (WIN_BEFORE[w] >= 0) CELL_WINS[WIN_BEFORE[w]].push(w);
          if (WIN_AFTER[w] >= 0) CELL_WINS[WIN_AFTER[w]].push(w);
        }
      }
    }
  })();

  /* ------------------------------------------------------------------ *
   *  加法 Zobrist 哈希（用于置换表）。用确定性的 PRNG，结果可复现。
   * ------------------------------------------------------------------ */

  /*
   * 双分量 Zobrist 哈希（用于置换表）。两个 26 位异或哈希组合成 52 位键，
   * 碰撞概率约 2^-52，且全程只用整数运算，结果可复现。
   * 不用「加法哈希」是因为它是线性的，不同局面容易产生大量碰撞。
   */
  var HASH_MULT = 67108864; // 2^26
  var Z1 = new Float64Array(CELL_COUNT * 2);
  var Z2 = new Float64Array(CELL_COUNT * 2);

  (function buildHash() {
    var seed = 0x2f6e2b1;
    function next() {
      seed |= 0;
      seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0);
    }
    for (var i = 0; i < CELL_COUNT * 2; i++) {
      Z1[i] = next() % HASH_MULT;
      Z2[i] = next() % HASH_MULT;
    }
  })();

  function hashKey(h1, h2) {
    return h1 * HASH_MULT + h2;
  }

  function computeHash(board) {
    var h1 = 0;
    var h2 = 0;
    for (var i = 0; i < CELL_COUNT; i++) {
      var v = board[i];
      if (v !== EMPTY) {
        var j = i * 2 + v;
        h1 ^= Z1[j];
        h2 ^= Z2[j];
      }
    }
    return [h1, h2];
  }

  /* ------------------------------------------------------------------ *
   *  形状评分
   * ------------------------------------------------------------------ */

  /*
   * count = 窗口内该方子的个数，open = 两端开放的个数（0/1/2）。
   * 命中窗口内若有对方子，整个窗口记 0（被堵死）。
   */
  function shapeScore(count, open) {
    if (count >= 5) return SHAPE[5];
    if (open === 0) return 0;
    return SHAPE[count][open];
  }

  function windowScore(board, w, player) {
    var opp = player === AI ? HUMAN : AI;
    var base = w * 5;
    var count = 0;
    for (var k = 0; k < 5; k++) {
      var v = board[WIN_CELLS[base + k]];
      if (v === player) count++;
      else if (v === opp) return 0;
    }
    if (count === 0) return 0;

    var open = 0;
    var b = WIN_BEFORE[w];
    var a = WIN_AFTER[w];
    if (b >= 0 && board[b] === EMPTY) open++;
    if (a >= 0 && board[a] === EMPTY) open++;
    return shapeScore(count, open);
  }

  /* 全盘扫描两侧形状分（只在开局/读档时用一次）。 */
  function computeScores(board) {
    var scores = [0, 0, 0];
    for (var w = 0; w < WIN_COUNT; w++) {
      scores[AI] += windowScore(board, w, AI);
      scores[HUMAN] += windowScore(board, w, HUMAN);
    }
    return scores;
  }

  /* ------------------------------------------------------------------ *
   *  增量维护：落子 / 撤销只重算受影响的窗口
   * ------------------------------------------------------------------ */

  function applyMove(board, idx, player, scores) {
    var wins = CELL_WINS[idx];
    var i, w;
    if (scores) {
      for (i = 0; i < wins.length; i++) {
        w = wins[i];
        scores[AI] -= windowScore(board, w, AI);
        scores[HUMAN] -= windowScore(board, w, HUMAN);
      }
    }
    board[idx] = player;
    if (scores) {
      for (i = 0; i < wins.length; i++) {
        w = wins[i];
        scores[AI] += windowScore(board, w, AI);
        scores[HUMAN] += windowScore(board, w, HUMAN);
      }
    }
  }

  function undoMove(board, idx, player, scores) {
    var wins = CELL_WINS[idx];
    var i, w;
    if (scores) {
      for (i = 0; i < wins.length; i++) {
        w = wins[i];
        scores[AI] -= windowScore(board, w, AI);
        scores[HUMAN] -= windowScore(board, w, HUMAN);
      }
    }
    board[idx] = EMPTY;
    if (scores) {
      for (i = 0; i < wins.length; i++) {
        w = wins[i];
        scores[AI] += windowScore(board, w, AI);
        scores[HUMAN] += windowScore(board, w, HUMAN);
      }
    }
  }

  /*
   * 某方在 idx 落子后，该方形状分的增量（只重算包含 idx 的窗口）。
   * 这是「一步启发式」的核心：进攻分与防守分都用它。
   */
  function moveHeuristic(board, idx, player) {
    var wins = CELL_WINS[idx];
    var before = 0;
    var after = 0;
    var i, w;
    for (i = 0; i < wins.length; i++) {
      w = wins[i];
      before += windowScore(board, w, player);
    }
    board[idx] = player;
    for (i = 0; i < wins.length; i++) {
      w = wins[i];
      after += windowScore(board, w, player);
    }
    board[idx] = EMPTY;
    return after - before;
  }

  /* 轻量级排序分：四方向连子长度的平方和，O(32)。 */
  function quickMoveScore(board, idx, player) {
    var r = (idx / SIZE) | 0;
    var c = idx % SIZE;
    var total = 0;
    for (var d = 0; d < 4; d++) {
      var dr = DIRS[d][0];
      var dc = DIRS[d][1];
      var n = 1;
      var i;
      for (i = 1; i < 5; i++) {
        var nr = r + dr * i;
        var nc = c + dc * i;
        if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE) break;
        if (board[nr * SIZE + nc] !== player) break;
        n++;
      }
      for (i = 1; i < 5; i++) {
        var nr2 = r - dr * i;
        var nc2 = c - dc * i;
        if (nr2 < 0 || nr2 >= SIZE || nc2 < 0 || nc2 >= SIZE) break;
        if (board[nr2 * SIZE + nc2] !== player) break;
        n++;
      }
      total += n * n;
    }
    return total;
  }

  /* ------------------------------------------------------------------ *
   *  走法生成
   * ------------------------------------------------------------------ */

  /* 已有棋子附近 CANDIDATE_RANGE 格内的空位。 */
  function candidateMoves(board) {
    var marked = new Uint8Array(CELL_COUNT);
    var any = false;
    var i, r, c, dr, dc, nr, nc;

    for (i = 0; i < CELL_COUNT; i++) {
      if (board[i] === EMPTY) continue;
      any = true;
      r = (i / SIZE) | 0;
      c = i % SIZE;
      for (dr = -CANDIDATE_RANGE; dr <= CANDIDATE_RANGE; dr++) {
        for (dc = -CANDIDATE_RANGE; dc <= CANDIDATE_RANGE; dc++) {
          nr = r + dr;
          nc = c + dc;
          if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE) continue;
          marked[nr * SIZE + nc] = 1;
        }
      }
    }

    if (!any) {
      var mid = (SIZE / 2) | 0;
      return [mid * SIZE + mid];
    }

    var out = [];
    for (i = 0; i < CELL_COUNT; i++) {
      if (marked[i] && board[i] === EMPTY) out.push(i);
    }
    return out;
  }

  /* idx 处的子是否成五连。 */
  function winsAt(board, idx) {
    var player = board[idx];
    if (player === EMPTY) return false;
    var r = (idx / SIZE) | 0;
    var c = idx % SIZE;

    for (var d = 0; d < 4; d++) {
      var dr = DIRS[d][0];
      var dc = DIRS[d][1];
      var count = 1;
      var i;
      for (i = 1; i < 5; i++) {
        var nr = r + dr * i;
        var nc = c + dc * i;
        if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE) break;
        if (board[nr * SIZE + nc] !== player) break;
        count++;
      }
      for (i = 1; i < 5; i++) {
        var nr2 = r - dr * i;
        var nc2 = c - dc * i;
        if (nr2 < 0 || nr2 >= SIZE || nc2 < 0 || nc2 >= SIZE) break;
        if (board[nr2 * SIZE + nc2] !== player) break;
        count++;
      }
      if (count >= 5) return true;
    }
    return false;
  }

  /* 某方是否存在一步制胜的着法。 */
  function findWinningMove(board, player) {
    var cands = candidateMoves(board);
    for (var i = 0; i < cands.length; i++) {
      var idx = cands[i];
      board[idx] = player;
      var win = winsAt(board, idx);
      board[idx] = EMPTY;
      if (win) return idx;
    }
    return -1;
  }

  /* ------------------------------------------------------------------ *
   *  置换表
   * ------------------------------------------------------------------ */

  var TT = new Map();
  var TT_EXACT = 0;
  var TT_LOWER = 1;
  var TT_UPPER = 2;

  function ttClear() {
    TT.clear();
  }

  function ttSize() {
    return TT.size;
  }

  /* ------------------------------------------------------------------ *
   *  着法排序：先用轻量分筛出前若干，再用完整启发式分排序
   * ------------------------------------------------------------------ */

  function moveLimit(depth) {
    if (depth >= 6) return 8;
    if (depth === 5) return 10;
    if (depth === 4) return 12;
    if (depth === 3) return 16;
    return 22;
  }

  function orderedMoves(board, player, ctx, depth, h1, h2) {
    var cands = candidateMoves(board);
    if (!cands.length) return [];

    var opp = player === AI ? HUMAN : AI;
    var quick = [];
    for (var i = 0; i < cands.length; i++) {
      var idx = cands[i];
      var q = quickMoveScore(board, idx, player) + quickMoveScore(board, idx, opp) * 0.5;
      quick.push([q, idx]);
    }
    quick.sort(function (a, b) { return b[0] - a[0]; });

    var poolSize = Math.min(quick.length, 24);
    var full = [];
    for (var j = 0; j < poolSize; j++) {
      var id = quick[j][1];
      var h = moveHeuristic(board, id, player) * WEIGHTS.attack +
        moveHeuristic(board, id, opp) * WEIGHTS.defense;
      full.push([h, id]);
    }
    full.sort(function (a, b) { return b[0] - a[0]; });

    var limit = ctx && ctx.moveLimit ? ctx.moveLimit : moveLimit(depth);
    var out = [];
    for (var k = 0; k < full.length && k < limit; k++) out.push(full[k][1]);

    // 置换表着法优先，提升剪枝效率。
    if (h1 !== undefined && ctx && ctx.tt) {
      var entry = ctx.tt.get(hashKey(h1, h2));
      if (entry && entry.flag === TT_EXACT && entry.best >= 0) {
        var pos = out.indexOf(entry.best);
        if (pos > 0) {
          out.splice(pos, 1);
          out.unshift(entry.best);
        } else if (pos < 0 && out.length < limit + 4) {
          out.unshift(entry.best);
        }
      }
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   *  搜索
   * ------------------------------------------------------------------ */

  function search(board, depth, alpha, beta, maximizing, lastIdx, scores, ctx, h1, h2) {
    ctx.nodes++;
    if ((ctx.nodes & 2047) === 0 && Date.now() > ctx.deadline) {
      ctx.aborted = true;
    }
    var hash = hashKey(h1, h2);

    if (lastIdx >= 0 && winsAt(board, lastIdx)) {
      // 快赢慢输：剩余层数越多（depth 越大）说明越早结束。
      return maximizing ? (-WIN_SCORE - depth) : (WIN_SCORE + depth);
    }
    if (depth <= 0) {
      return scores[AI] - scores[HUMAN] * WEIGHTS.defense;
    }

    var player = maximizing ? AI : HUMAN;
    var moves = orderedMoves(board, player, ctx, depth, h1, h2);
    if (!moves.length) return 0; // 棋盘已满：平局

    var entry = ctx.tt ? ctx.tt.get(hash) : null;
    var ttBest = -1;
    if (entry && entry.depth >= depth) {
      ttBest = entry.best;
      if (entry.flag === TT_EXACT) return entry.score;
      if (entry.flag === TT_LOWER && entry.score > alpha) alpha = entry.score;
      else if (entry.flag === TT_UPPER && entry.score < beta) beta = entry.score;
      if (alpha >= beta) return entry.score;
    }

    var originalAlpha = alpha;
    var originalBeta = beta;
    var best = maximizing ? -Infinity : Infinity;
    var bestIdx = -1;
    var i, idx, value, childH1, childH2, j;

    for (i = 0; i < moves.length; i++) {
      idx = moves[i];
      j = idx * 2 + player;
      childH1 = h1 ^ Z1[j];
      childH2 = h2 ^ Z2[j];
      applyMove(board, idx, player, scores);
      value = search(board, depth - 1, alpha, beta, !maximizing, idx, scores, ctx, childH1, childH2);
      undoMove(board, idx, player, scores);

      if (ctx.aborted) return bestIdx >= 0 ? best : value;

      if (maximizing) {
        if (value > best) { best = value; bestIdx = idx; }
        if (value > alpha) alpha = value;
      } else {
        if (value < best) { best = value; bestIdx = idx; }
        if (value < beta) beta = value;
      }
      if (alpha >= beta) break;
    }

    if (bestIdx < 0) bestIdx = moves[0];

    var flag = TT_EXACT;
    if (best <= originalAlpha) flag = TT_UPPER;
    else if (best >= originalBeta) flag = TT_LOWER;

    if (ctx.tt) {
      if (ctx.tt.size >= TT_MAX) ttClear();
      ctx.tt.set(hash, { depth: depth, score: best, flag: flag, best: bestIdx });
    }

    return best;
  }

  /* 根节点搜索：返回 { index, score, depth }。 */
  function searchRoot(board, depth, ctx, scores, h1, h2, limit) {
    var moves = orderedMoves(board, AI, ctx, depth, h1, h2);
    if (!moves.length) return { index: -1, score: 0, depth: depth };

    // 限制根节点宽度，但保证包含所有「明显最好」的着法。
    if (limit && moves.length > limit) moves = moves.slice(0, limit);

    var alpha = -Infinity;
    var best = -Infinity;
    var bestMoves = [];
    var i, idx, value;

    for (i = 0; i < moves.length; i++) {
      idx = moves[i];
      var j = idx * 2 + AI;
      applyMove(board, idx, AI, scores);
      value = search(board, depth - 1, alpha, Infinity, false, idx, scores, ctx,
        h1 ^ Z1[j], h2 ^ Z2[j]);
      undoMove(board, idx, AI, scores);

      if (ctx.aborted) break;

      if (value > best) {
        best = value;
        bestMoves = [idx];
      } else if (value === best) {
        bestMoves.push(idx);
      }
      if (value > alpha) alpha = value;
    }

    if (!bestMoves.length) bestMoves = [moves[0]];
    var pick = bestMoves[Math.floor(Math.random() * bestMoves.length)];
    return { index: pick, score: best, depth: depth };
  }

  /* ------------------------------------------------------------------ *
   *  选牌
   * ------------------------------------------------------------------ */

  function other(player) {
    return player === AI ? HUMAN : AI;
  }

  /*
   * 简单档：一步启发式。
   * score = 进攻分（我方下这里） + 防守分（对手下这里）× DEFENSE_W + 随机扰动
   * player 默认是 AI，测试时也可以传 HUMAN 来模拟人类方的同等策略。
   */
  function chooseEasy(board, random, player) {
    var rng = random || Math.random;
    var me = player || AI;
    var opp = other(me);
    var cands = candidateMoves(board);
    if (!cands.length) return -1;

    var best = -Infinity;
    var bestMoves = [];
    for (var i = 0; i < cands.length; i++) {
      var idx = cands[i];
      var attack = moveHeuristic(board, idx, me);
      var defense = moveHeuristic(board, idx, opp);
      var score = attack * WEIGHTS.attack + defense * WEIGHTS.defense;
      score += (rng() - 0.5) * 2 * WEIGHTS.easyNoise;

      if (score > best) {
        best = score;
        bestMoves = [idx];
      } else if (score === best) {
        bestMoves.push(idx);
      }
    }
    return bestMoves[Math.floor(rng() * bestMoves.length)];
  }

  /* 困难档：固定层数的 Alpha-Beta（同步，主要用于测试与对比）。 */
  function chooseHard(board, options) {
    options = options || {};
    var depth = options.depth || 4;
    var ctx = {
      tt: options.useTT === false ? null : TT,
      deadline: Date.now() + (options.timeBudget || 60000),
      aborted: false,
      nodes: 0,
      moveLimit: options.moveLimit || 0
    };

    // 一步制胜 / 封堵对手一步制胜，直接返回，不浪费搜索。
    var win = findWinningMove(board, AI);
    if (win >= 0) return { index: win, score: WIN_SCORE, depth: 1, nodes: 0 };
    var block = findWinningMove(board, HUMAN);
    if (block >= 0) return { index: block, score: WIN_SCORE - 1, depth: 1, nodes: 0 };

    var scores = computeScores(board);
    var h = computeHash(board);

    var result = searchRoot(board, depth, ctx, scores, h[0], h[1], options.rootLimit || 24);
    result.nodes = ctx.nodes;
    return result;
  }

  /*
   * 困难档：迭代加深 + 时间预算，异步执行（每轮深度之间让出主线程）。
   * onDone({ index, score, depth, nodes })
   */
  function chooseMoveAsync(board, difficulty, options, onDone) {
    options = options || {};
    var timeBudget = options.timeBudget || 1000;
    var maxDepth = options.maxDepth || 5;

    if (difficulty !== 'hard') {
      var easyIndex = chooseEasy(board, options.random);
      setTimeout(function () {
        onDone({ index: easyIndex, score: 0, depth: 1, nodes: 0 });
      }, 0);
      return;
    }

    var win = findWinningMove(board, AI);
    if (win >= 0) {
      setTimeout(function () { onDone({ index: win, score: WIN_SCORE, depth: 1, nodes: 0 }); }, 0);
      return;
    }
    var block = findWinningMove(board, HUMAN);
    if (block >= 0) {
      setTimeout(function () { onDone({ index: block, score: WIN_SCORE - 1, depth: 1, nodes: 0 }); }, 0);
      return;
    }

    var ctx = {
      tt: options.useTT === false ? null : TT,
      deadline: Date.now() + timeBudget,
      aborted: false,
      nodes: 0,
      moveLimit: options.moveLimit || 0
    };
    var scores = computeScores(board);
    var h = computeHash(board);

    var best = { index: -1, score: -Infinity, depth: 0, nodes: 0 };
    var depth = 1;

    function iterate() {
      if (ctx.aborted) {
        finish();
        return;
      }
      var result = searchRoot(board, depth, ctx, scores, h[0], h[1], options.rootLimit || 24);
      if (result.index >= 0 && !ctx.aborted) {
        best = result;
        best.nodes = ctx.nodes;
      }
      if (ctx.aborted) {
        finish();
        return;
      }
      var remaining = ctx.deadline - Date.now();
      if (depth >= maxDepth || remaining < 80) {
        finish();
        return;
      }
      depth++;
      setTimeout(iterate, 0);
    }

    function finish() {
      if (best.index < 0) {
        // 时间耗尽且第一轮没跑完：退化为一步启发式。
        best = { index: chooseEasy(board), score: 0, depth: 1, nodes: ctx.nodes };
      }
      onDone(best);
    }

    setTimeout(iterate, 0);
  }

  /* ------------------------------------------------------------------ */

  global.GomokuAI = {
    SIZE: SIZE,
    CELL_COUNT: CELL_COUNT,
    EMPTY: EMPTY,
    HUMAN: HUMAN,
    AI: AI,
    DIRS: DIRS,
    WIN_SCORE: WIN_SCORE,
    SHAPE: SHAPE,
    WEIGHTS: WEIGHTS,
    CANDIDATE_RANGE: CANDIDATE_RANGE,

    shapeScore: shapeScore,
    windowScore: windowScore,
    computeScores: computeScores,
    applyMove: applyMove,
    undoMove: undoMove,
    moveHeuristic: moveHeuristic,
    quickMoveScore: quickMoveScore,
    candidateMoves: candidateMoves,
    winsAt: winsAt,
    findWinningMove: findWinningMove,
    orderedMoves: orderedMoves,
    search: search,
    searchRoot: searchRoot,
    chooseEasy: chooseEasy,
    chooseHard: chooseHard,
    chooseMoveAsync: chooseMoveAsync,
    ttClear: ttClear,
    ttSize: ttSize,
    idx: function (r, c) { return r * SIZE + c; },
    rowOf: function (idx) { return (idx / SIZE) | 0; },
    colOf: function (idx) { return idx % SIZE; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
