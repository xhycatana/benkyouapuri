// 記憶モデルの自動調整。自分の解答履歴から、忘却曲線の設定を当てはめる。
// ----------------------------------------------------------------------
// 解答履歴（history/）には、解答ごとに「いつ・どの問題を・正解したか」が残っている。
// これを問題ごとに時間順に再生して、「そのとき、何%で思い出せると予測していたか」と「実際はどうだったか」を突き合わせる。
// 予測の当たり具合は、対数損失（小さいほど良い）で測る。
//
// 過学習（手元のデータにだけ当てはまって、これから解く問題には当たらなくなること）を避けるため、次のことをしている。
//   ・設定は、少ない数（最大5つ）の、意味のある値だけ。ニューラルネットのような、データを丸暗記できる形は使わない
//   ・問題を5組に分けて、4組で設定を当てはめ、残りの1組（当てはめに一切使っていない問題）で、当たり具合を測る。これを5回行う
//     （問題ごとに分けるのは、「見ていない問題にも当たるか」を直接測れるため。履歴を、時間の前半・後半で分けると、
//       復習が深く進んだあとの寿命の伸び方を、前半だけでは決められず、検証が実際より悪く出る）
//   ・いまの設定からの離れ具合に罰を付ける（データが少ないときに、極端な値にならないように）
//   ・いまの式との差が、偶然とは考えにくい（標準誤差の 2.5 倍以上）ときだけ「おすすめ」にする。そうでなければ「いまのままでよい」と答える
//   ・結果は見せるだけ。設定を書き換えるのは、本人が「この設定にする」を押したときだけ（元にも戻せる）
//
// 次の手法を、同じ検証（当てはめに使っていない問題）で比べる。
//   いまの式      … いまの設定のまま
//   式A（調整）   … いまの式の数値（伸び・残す割合・初回の寿命）だけを、自分のデータに当てはめる
//   式B（調整）   … 式A に、曲線の裾の長さ（shape）と、間隔の効果（spacing）を足す。この2つが 0 なら、式A と同じ式
//   参考: 回帰    … ロジスティック回帰（AI の簡単なもの）。問題ごとの正解・不正解の回数なども使う。アプリにはまだ入れられない式で、
//                   「いまの式の作りに、改善の余地がどれだけ残っているか」を見る目安
//   基準          … 何も予測しない（当てはめに使った問題の平均の正答率で、いつも同じ確率を答える）。式が、これより良くなければ、意味がない
// 「いまの式」「式A」「式B」が、アプリに入れられる式。式そのものは memory.js の srsRetrievability・srsSpacingFactor
// （アプリの出題・更新と同じもの）を使う。
// ニューラルネットのような、もっと大きな AI は、いまの解答の数（数百〜千件）では、丸暗記して、これから解く問題には当たらなくなるので、使わない。

const TUNE_DAY_MS = 86400000;
const TUNE_BOUNDS = {
  ease: [1.3, 4.0], lapseKeep: [0, 0.6], firstInterval: [0.25, 7], shape: [0, 2], spacing: [0, 2], retryPenalty: [0.3, 1.0]
};
// 採点の対象は、設定（伸び・残す割合など）に関わらず、同じ解答にそろえる。これが設定で変わると、「難しい解答を、採点から外せる設定」が、見かけだけ有利になってしまう。
// 外すのは、「まだ一度も正解したことがない問題」の解答だけ（初めて間違えた直後の寿命は、どの設定でも同じになり、設定の良し悪しを測れないため）。
const TUNE_P_CLIP = 0.01;             // 予測は、1%〜99% に収めて採点する（極端な予測が、1回で損失を大きくしすぎないように）
const TUNE_PRIOR_WEIGHT = 25;         // いまの設定からの離れ具合への罰の強さ（範囲の全体の離れ具合 1 で、25）
const TUNE_FOLDS = 5;                 // 問題を、この数の組に分けて、検証する
const TUNE_MIN_SCORED = 120;          // 採点できる解答が、これより少ないときは、調整しない
const TUNE_MIN_ITEMS = 25;            // 問題の数が、これより少ないときは、調整しない（5組に分けると、1組が小さすぎる）
const TUNE_MIN_Z = 2.5;               // 検証での損失の改善が、ばらつき（標準誤差）の、これだけ倍以上あるときだけ、おすすめにする（偶然を、おすすめにしないため）
const TUNE_MIN_REL = 0.01;            // かつ、損失が、相対的に 1% 以上減っていること

// --- 履歴を、問題ごとの時間順の列にする ---
// raw: サーバーの kind=historyall の返事 { q: [...], e: [[問題の番号, 日時(ms), 正解(1/0), 前回からの経過日数, そのときの寿命]…] }
function tuneBuildSequences(raw) {
  const by = {};
  (raw.e || []).forEach(function (r) {
    const k = r[0];
    if (!by[k]) by[k] = [];
    by[k].push({ t: r[1], c: r[2] ? 1 : 0, e: (typeof r[3] === 'number') ? r[3] : null, l: (typeof r[4] === 'number' && r[4] > 0) ? r[4] : null,
      r: (typeof r[5] === 'number' && r[5] > 0) ? r[5] : 0 });   // r: 解き直しで、また間違えた回数（記録が無ければ 0）
  });
  return Object.keys(by).map(function (k, i) { const s = by[k].sort(function (a, b) { return a.t - b.t; }); s.id = i; return s; });
}

// 履歴を再生して、採点する。th: { ease, lapseKeep, firstInterval, shape, spacing }
// 採点するのは、時刻が [from, to) の解答のうち、前回の解答があって、予測できるもの。
// 戻り値: { n, loss（合計）, sumP（予測の合計）, sumC（正解の数）, finalLife: { 問題の番号: 最後の寿命 } }
function tuneReplay(seqs, th, retryBoost, from, to, wantFinal, perObs) {
  let n = 0, loss = 0, sumP = 0, sumC = 0;
  const losses = perObs ? [] : null;   // 採点した解答ごとの損失 { item: 問題の列の番号, v: 損失 }（設定が違っても、同じ解答が、同じ順に並ぶ）
  const finals = wantFinal ? [] : null;
  seqs.forEach(function (seq, seqIdx) {
    let life = 0, last = null, everCorrect = false;
    seq.forEach(function (en, idx) {
      // 履歴が始まる前から解いていた問題は、最初の記録に、そのときの寿命と経過日数が残っている。そこから始める
      if (idx === 0 && en.e !== null && en.l !== null) { life = en.l; last = en.t - en.e * TUNE_DAY_MS; everCorrect = true; }
      let p = null;
      if (last !== null && life > 0) p = srsRetrievability((en.t - last) / TUNE_DAY_MS, life, th.shape);
      if (p !== null && everCorrect && en.t >= from && en.t < to) {
        const pc = Math.min(1 - TUNE_P_CLIP, Math.max(TUNE_P_CLIP, p));
        const l1 = -(en.c ? Math.log(pc) : Math.log(1 - pc));
        loss += l1;
        if (losses) losses.push({ item: (seq.id !== undefined ? seq.id : seqIdx), v: l1 });
        sumP += pc; sumC += en.c; n++;
      }
      // 寿命の更新（memory.js の updateSrsMetrics と同じ）
      if (en.c) {
        everCorrect = true;
        life = (life > 0 && last !== null)
          ? Math.max(life * srsSpacingFactor(p, th.ease, th.spacing), th.firstInterval)
          : th.firstInterval;
      } else {
        life = Math.max((life > 0 ? life : 0) * th.lapseKeep, MIN_LIFESPAN_DAYS);
        // 間違えた問題は、その場で解き直して、正解すると、寿命がわずかに伸びる（解き直しそのものは履歴に残らないが、起きるものとして扱う）。
        // 解き直しで、また間違えた回数（en.r）があれば、その分、寿命が縮む（retryPenalty。memory.js の updateSrsMetrics と同じ）
        life *= retryBoost * Math.pow(th.retryPenalty, en.r);
      }
      last = en.t;
    });
    if (finals) finals.push(life);
  });
  return { n: n, loss: loss, sumP: sumP, sumC: sumC, finalLives: finals, losses: losses };
}

// --- 当てはめ ---
function tuneGrid(key) {
  const out = [];
  if (key === 'ease') for (let v = 1.3; v <= 4.0001; v += 0.05) out.push(Math.round(v * 100) / 100);
  else if (key === 'lapseKeep') for (let v = 0; v <= 0.6001; v += 0.025) out.push(Math.round(v * 1000) / 1000);
  else if (key === 'firstInterval') for (let v = 0.25; v <= 7.001; v *= 1.15) out.push(Math.round(v * 100) / 100);
  else if (key === 'shape' || key === 'spacing') for (let v = 0; v <= 2.0001; v += 0.1) out.push(Math.round(v * 10) / 10);
  else if (key === 'retryPenalty') for (let v = 0.3; v <= 1.0001; v += 0.05) out.push(Math.round(v * 100) / 100);
  return out;
}

// いまの設定からの離れ具合への罰。範囲の全体を 1 として、離れ具合の2乗（初回の寿命は、対数で測る）
function tunePenalty(th, center) {
  let s = 0;
  Object.keys(TUNE_BOUNDS).forEach(function (k) {
    const lo = TUNE_BOUNDS[k][0], hi = TUNE_BOUNDS[k][1];
    const d = (k === 'firstInterval')
      ? (Math.log(th[k]) - Math.log(center[k])) / (Math.log(hi) - Math.log(lo))
      : (th[k] - center[k]) / (hi - lo);
    s += d * d;
  });
  return TUNE_PRIOR_WEIGHT * s;
}

// 1つずつ値を動かして、よくなる方へ進める（座標降下）。free: 動かす設定。start: 出発点（いくつか試して、いちばん良いもの）
function tuneFit(seqs, free, starts, center, retryBoost, from, to) {
  const objective = function (th) { return tuneReplay(seqs, th, retryBoost, from, to, false).loss + tunePenalty(th, center); };
  let bestAll = null, bestObj = Infinity;
  starts.forEach(function (st) {
    let best = Object.assign({}, st);
    let obj = objective(best);
    for (let pass = 0; pass < 8; pass++) {
      let improved = false;
      free.forEach(function (k) {
        tuneGrid(k).forEach(function (v) {
          if (v === best[k]) return;
          const cand = Object.assign({}, best);
          cand[k] = v;
          const o = objective(cand);
          if (o < obj - 1e-9) { best = cand; obj = o; improved = true; }
        });
      });
      if (!improved) break;
    }
    if (obj < bestObj) { bestObj = obj; bestAll = best; }
  });
  return bestAll;
}

// 検証: 後半の、1解答あたりの損失と、予測と実際の平均
function tuneScore(seqs, th, retryBoost, from, to) {
  const r = tuneReplay(seqs, th, retryBoost, from, to, false);
  return { n: r.n, loss: r.n ? r.loss / r.n : null, meanP: r.n ? r.sumP / r.n : null, meanC: r.n ? r.sumC / r.n : null };
}

// --- 参考: ロジスティック回帰 ---
// 採点できる解答ごとに、特徴を集める（いまの設定で再生して）。特徴:
//   1, ln(1+経過日数), ln(寿命), ln(1+それまでの正解数), ln(1+それまでの不正解数), 前回は不正解か, いまの式の予測の logit
function tuneObservations(seqs, th, retryBoost) {
  const obs = [];
  seqs.forEach(function (seq) {
    let life = 0, last = null, nc = 0, nw = 0, lastWrong = 0, everCorrect = false;
    seq.forEach(function (en, idx) {
      if (idx === 0 && en.e !== null && en.l !== null) { life = en.l; last = en.t - en.e * TUNE_DAY_MS; everCorrect = true; }
      let p = null;
      if (last !== null && life > 0) p = srsRetrievability((en.t - last) / TUNE_DAY_MS, life, th.shape);
      if (p !== null && everCorrect) {
        const pc = Math.min(1 - TUNE_P_CLIP, Math.max(TUNE_P_CLIP, p));
        obs.push({ t: en.t, c: en.c, item: seq.id,
          x: [1, Math.log(1 + (en.t - last) / TUNE_DAY_MS), Math.log(life), Math.log(1 + nc), Math.log(1 + nw), lastWrong, Math.log(pc / (1 - pc))] });
      }
      if (en.c) {
        life = (life > 0 && last !== null) ? Math.max(life * srsSpacingFactor(p, th.ease, th.spacing), th.firstInterval) : th.firstInterval;
        nc++; lastWrong = 0; everCorrect = true;
      } else {
        life = Math.max((life > 0 ? life : 0) * th.lapseKeep, MIN_LIFESPAN_DAYS) * retryBoost * Math.pow(th.retryPenalty, en.r);
        nw++; lastWrong = 1;
      }
      last = en.t;
    });
  });
  return obs;
}

// 連立方程式 A x = b を解く（ガウスの消去法）
function tuneSolve(A, b) {
  const n = b.length;
  const M = A.map(function (row, i) { return row.concat([b[i]]); });
  for (let i = 0; i < n; i++) {
    let piv = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[piv][i])) piv = r;
    const tmp = M[i]; M[i] = M[piv]; M[piv] = tmp;
    const d = M[i][i] || 1e-12;
    for (let c = i; c <= n; c++) M[i][c] /= d;
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const f = M[r][i];
      if (f !== 0) for (let c = i; c <= n; c++) M[r][c] -= f * M[i][c];
    }
  }
  return M.map(function (row) { return row[n]; });
}

// 正則化つきのロジスティック回帰（ニュートン法）。lambda: 係数を小さく保つ強さ（切片には掛けない）
function tuneLogistic(obs, lambda) {
  const d = obs.length ? obs[0].x.length : 0;
  let w = new Array(d).fill(0);
  for (let iter = 0; iter < 30; iter++) {
    const g = new Array(d).fill(0);
    const H = Array.from({ length: d }, function () { return new Array(d).fill(0); });
    obs.forEach(function (o) {
      let z = 0;
      for (let i = 0; i < d; i++) z += w[i] * o.x[i];
      const p = 1 / (1 + Math.exp(-z));
      const s = p * (1 - p);
      for (let i = 0; i < d; i++) {
        g[i] += (p - o.c) * o.x[i];
        for (let j = 0; j < d; j++) H[i][j] += s * o.x[i] * o.x[j];
      }
    });
    for (let i = 1; i < d; i++) { g[i] += lambda * w[i]; H[i][i] += lambda; }
    for (let i = 0; i < d; i++) H[i][i] += 1e-6;
    const step = tuneSolve(H, g);
    let big = 0;
    for (let i = 0; i < d; i++) { w[i] -= step[i]; big = Math.max(big, Math.abs(step[i])); }
    if (big < 1e-6) break;
  }
  return w;
}

function tuneLogisticScore(w, obs, from, to) {
  let n = 0, loss = 0, sumP = 0, sumC = 0;
  obs.forEach(function (o) {
    if (o.t < from || o.t >= to) return;
    let z = 0;
    for (let i = 0; i < w.length; i++) z += w[i] * o.x[i];
    const p = Math.min(1 - TUNE_P_CLIP, Math.max(TUNE_P_CLIP, 1 / (1 + Math.exp(-z))));
    loss += -(o.c ? Math.log(p) : Math.log(1 - p));
    sumP += p; sumC += o.c; n++;
  });
  return { n: n, loss: n ? loss / n : null, meanP: n ? sumP / n : null, meanC: n ? sumC / n : null };
}

// 2つの手法の、損失の差（base − cand。正なら、cand が良い）が、偶然とは考えにくいかを調べる。
// la・lb: 同じ解答どうしを、同じ順に並べた、解答ごとの損失 { item, v }。
// 差の平均を、標準誤差で割る。同じ問題の解答は、互いに似ているので、標準誤差は、問題ごとにまとめて見積もる
// （解答ごとに独立だとすると、偶然を、本物と見間違えやすい）
function tunePairedLosses(la, lb) {
  const n = la.length;
  if (n === 0 || n !== lb.length) return { z: 0, gain: 0, n: n };
  const perItem = {};
  let sum = 0, sumBase = 0;
  for (let i = 0; i < n; i++) {
    const d = la[i].v - lb[i].v;
    sum += d; sumBase += la[i].v;
    const k = la[i].item;
    if (!perItem[k]) perItem[k] = { d: 0, m: 0 };
    perItem[k].d += d; perItem[k].m += 1;
  }
  const mean = sum / n;
  const items = Object.keys(perItem).map(function (k) { return perItem[k]; });
  const g = items.length;
  let ss = 0;
  items.forEach(function (it) { const r = it.d - mean * it.m; ss += r * r; });
  const se = g > 1 ? Math.sqrt(g / (g - 1) * ss) / n : Infinity;
  return { z: se > 0 ? mean / se : 0, gain: (sum / sumBase), n: n };
}

// 問題を、番号順に並べ替えたあと、組に割り当てる（毎回同じ結果になる乱数で）。戻り値: 問題ごとの組の番号
function tuneAssignFolds(count, folds) {
  let s = 12345;
  const rand = function () { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
  const order = Array.from({ length: count }, function (_, i) { return i; });
  for (let i = count - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const tmp = order[i]; order[i] = order[j]; order[j] = tmp; }
  const fold = new Array(count);
  order.forEach(function (idx, pos) { fold[idx] = pos % folds; });
  return fold;
}

// 全体の流れ。current: いまの設定（memorySettings）。戻り値は、画面に出す結果
function tuneRun(raw, current) {
  const seqs = tuneBuildSequences(raw);
  const retry = current.retryBoost;
  const cur = { ease: current.ease, lapseKeep: current.lapseKeep, firstInterval: current.firstInterval, shape: current.shape, spacing: current.spacing, retryPenalty: current.retryPenalty };
  const defaults = { ease: 2.5, lapseKeep: 0.2, firstInterval: 1.0, shape: 0, spacing: 0, retryPenalty: 1.0 };
  const retryEntries = (raw.e || []).filter(function (r) { return typeof r[5] === 'number' && r[5] > 0; }).length;
  const result = { entries: (raw.e || []).length, questions: seqs.length, scoredAll: 0, current: cur, status: '', candidates: [], retryEntries: retryEntries };

  const all = tuneScore(seqs, cur, retry, -Infinity, Infinity);
  result.scoredAll = all.n;
  if (all.n < TUNE_MIN_SCORED || seqs.length < TUNE_MIN_ITEMS) { result.status = 'few'; return result; }

  const freeA = ['ease', 'lapseKeep', 'firstInterval', 'retryPenalty'];
  const freeB = freeA.concat(['shape', 'spacing']);
  const startsA = [cur, Object.assign({}, defaults, { shape: cur.shape, spacing: cur.spacing })];
  const startsB = [cur, defaults];

  // 検証: 問題を TUNE_FOLDS 組に分けて、1組ずつ、残りで当てはめて測る。各手法の、検証での解答ごとの損失を、全部の組で集める
  const foldOf = tuneAssignFolds(seqs.length, TUNE_FOLDS);
  const kinds = ['base', 'cur', 'A', 'B', 'ref'];
  const oof = {};
  kinds.forEach(function (k) { oof[k] = { losses: [], n: 0, sumP: 0, sumC: 0 }; });
  const addScore = function (k, r) { oof[k].n += r.n; oof[k].sumP += r.sumP; oof[k].sumC += r.sumC; };
  const addLosses = function (k, list) { list.forEach(function (x) { oof[k].losses.push(x); }); };
  for (let f = 0; f < TUNE_FOLDS; f++) {
    const trainSeqs = seqs.filter(function (_, i) { return foldOf[i] !== f; });
    const testSeqs = seqs.filter(function (_, i) { return foldOf[i] === f; });
    const fitA = tuneFit(trainSeqs, freeA, startsA, cur, retry, -Infinity, Infinity);
    const fitB = tuneFit(trainSeqs, freeB, startsB, cur, retry, -Infinity, Infinity);
    [['cur', cur], ['A', fitA], ['B', fitB]].forEach(function (pair) {
      const r = tuneReplay(testSeqs, pair[1], retry, -Infinity, Infinity, false, true);
      addScore(pair[0], r); addLosses(pair[0], r.losses);
    });
    // 基準（何も予測しない）と、参考の回帰。どちらも、当てはめに使った問題だけで作る
    const trainObs = tuneObservations(trainSeqs, cur, retry);
    const testObs = tuneObservations(testSeqs, cur, retry);
    const mean = trainObs.length ? trainObs.reduce(function (a, o) { return a + o.c; }, 0) / trainObs.length : 0.5;
    const baseP = Math.min(1 - TUNE_P_CLIP, Math.max(TUNE_P_CLIP, mean));
    const w = tuneLogistic(trainObs, 5);
    testObs.forEach(function (o) {
      const lb = -(o.c ? Math.log(baseP) : Math.log(1 - baseP));
      oof.base.losses.push({ item: o.item, v: lb }); oof.base.n++; oof.base.sumP += baseP; oof.base.sumC += o.c;
      let z = 0;
      for (let i = 0; i < w.length; i++) z += w[i] * o.x[i];
      const pr = Math.min(1 - TUNE_P_CLIP, Math.max(TUNE_P_CLIP, 1 / (1 + Math.exp(-z))));
      oof.ref.losses.push({ item: o.item, v: -(o.c ? Math.log(pr) : Math.log(1 - pr)) }); oof.ref.n++; oof.ref.sumP += pr; oof.ref.sumC += o.c;
    });
  }
  const summary = function (k) {
    const o = oof[k];
    return { n: o.n, loss: o.n ? o.losses.reduce(function (a, x) { return a + x.v; }, 0) / o.n : null, meanP: o.n ? o.sumP / o.n : null, meanC: o.n ? o.sumC / o.n : null };
  };
  result.nTest = oof.cur.n;

  // 表に出す式A・式B の数値は、全部の問題で当てはめ直したもの（おすすめにするときの設定と同じ）
  const finalA = tuneFit(seqs, freeA, startsA, cur, retry, -Infinity, Infinity);
  const finalB = tuneFit(seqs, freeB, startsB, cur, retry, -Infinity, Infinity);
  result.candidates = [
    { name: '基準（平均の正答率で固定）', kind: 'base', test: summary('base') },
    { name: 'いまの式', kind: 'cur', th: cur, test: summary('cur') },
    { name: '式A（数値を調整）', kind: 'A', th: finalA, test: summary('A') },
    { name: '式B（新しい式に調整）', kind: 'B', th: finalB, test: summary('B') },
    { name: '参考: 回帰（AI の簡単なもの）', kind: 'ref', test: summary('ref') }
  ];

  // 選び方: 検証での損失が、いまの式より、偶然とは考えにくい差で小さいものだけ（差が、標準誤差の TUNE_MIN_Z 倍以上、かつ 1% 以上）。
  // 式B は、式A よりも、偶然とは考えにくい差で良いときだけ選ぶ
  const pairA = tunePairedLosses(oof.cur.losses, oof.A.losses);
  const pairB = tunePairedLosses(oof.cur.losses, oof.B.losses);
  const pairBA = tunePairedLosses(oof.A.losses, oof.B.losses);
  const okA = pairA.z >= TUNE_MIN_Z && pairA.gain >= TUNE_MIN_REL;
  const okB = pairB.z >= TUNE_MIN_Z && pairB.gain >= TUNE_MIN_REL;
  let pick = null;
  if (okB && (!okA || pairBA.z >= TUNE_MIN_Z)) pick = 'B';
  else if (okA) pick = 'A';
  result.gainA = pairA.gain; result.gainB = pairB.gain;
  result.zA = pairA.z; result.zB = pairB.z;
  // 参考の回帰が、アプリに入れられる式の最良より、はっきり良ければ、式の作りに、まだ改善の余地がある
  const bestDeployable = Math.min(summary('cur').loss, summary('A').loss, summary('B').loss);
  const refLoss = summary('ref').loss;
  result.refGap = (refLoss !== null) ? (bestDeployable - refLoss) / bestDeployable : null;
  const baseLoss = summary('base').loss;
  result.beatsBase = pick ? ((pick === 'B' ? summary('B').loss : summary('A').loss) <= baseLoss) : null;
  if (!pick) { result.status = 'keep'; return result; }

  result.status = 'tuned';
  result.pick = pick;
  result.recommended = (pick === 'B') ? finalB : finalA;
  result.gain = (pick === 'B') ? pairB.gain : pairA.gain;
  result.z = (pick === 'B') ? pairB.z : pairA.z;
  return result;
}

// --- 画面 ---
const STORAGE_KEY_MEMORY_BACKUP = 'flashmemo_memorySettings_backup';
let tuneLast = null;

function tuneSettingsText(th) {
  return '伸び ' + th.ease.toFixed(2) + ' 倍 ／ 残す ' + Math.round(th.lapseKeep * 100) + ' % ／ 初回の寿命 ' + th.firstInterval.toFixed(2) + ' 日' +
    ' ／ 曲線の裾 ' + th.shape.toFixed(1) + ' ／ 間隔の効果 ' + th.spacing.toFixed(1) + ' ／ 解き直しの失敗 ×' + th.retryPenalty.toFixed(2);
}

function tuneShowCurrent() {
  tuneCurrent.textContent = 'いまの設定: ' + tuneSettingsText(memorySettings);
  let hasBackup = false;
  try { hasBackup = !!localStorage.getItem(STORAGE_KEY_MEMORY_BACKUP); } catch (err) {}
  btnTuneRevert.classList.toggle('hidden', !hasBackup);
}

function tunePct(v) { return v === null ? '-' : (v * 100).toFixed(1) + ' %'; }

function tuneRender(r) {
  tuneResult.innerHTML = '';
  const add = function (cls, text) { const d = document.createElement('div'); d.className = cls; d.textContent = text; tuneResult.appendChild(d); return d; };
  add('text-slate-500', '解答 ' + r.entries + ' 件（' + r.questions + ' 問）。そのうち、2回目以降で予測と比べられる解答は ' + r.scoredAll + ' 件です。');
  add('text-[10px] text-slate-400', '解き直しで失敗した回数の記録がある解答: ' + r.retryEntries + ' 件' + (r.retryEntries < 30 ? '（まだ少ないので、解き直しの失敗の影響は、ほとんど調べられません。解くほど増えます）' : '') + '。');
  if (r.status === 'few') {
    add('font-bold text-slate-700', 'まだデータが少ないので、調整しません。もう少し解いてから、また試してください。');
    btnTuneApply.classList.add('hidden');
    return;
  }
  // 比べる表
  const table = document.createElement('div');
  table.className = 'border border-slate-200 divide-y divide-slate-200';
  const head = document.createElement('div');
  head.className = 'grid grid-cols-3 gap-1 p-1 text-slate-400';
  ['', '損失（小さいほど良い）', '予測 → 実際の正答率'].forEach(function (h) { const s = document.createElement('span'); s.textContent = h; head.appendChild(s); });
  table.appendChild(head);
  r.candidates.forEach(function (c) {
    const row = document.createElement('div');
    const picked = r.status === 'tuned' && c.kind === r.pick;
    row.className = 'grid grid-cols-3 gap-1 p-1' + (picked ? ' font-bold text-slate-900' : (c.kind === 'ref' || c.kind === 'base' ? ' text-slate-400' : ' text-slate-600'));
    [c.name, c.test.loss.toFixed(3), tunePct(c.test.meanP) + ' → ' + tunePct(c.test.meanC)].forEach(function (x) { const s = document.createElement('span'); s.textContent = x; row.appendChild(s); });
    table.appendChild(row);
  });
  tuneResult.appendChild(table);
  add('text-[10px] text-slate-400', '損失と正答率は、問題を5組に分けて、4組で当てはめ、残りの1組（当てはめに使っていない問題）で測った、' + r.nTest + ' 件の結果です。「いまの式」「式A」「式B」が、アプリに入れられる式です。「基準」と「参考」は、比べるためのものです。');
  if (r.refGap !== null && r.refGap >= 0.03) {
    add('text-[10px] text-slate-500', '参考の回帰が、アプリに入れられる式より ' + (r.refGap * 100).toFixed(1) + ' % 良く当たっています。式の作りに、まだ改善の余地があるかもしれません。');
  }

  if (r.status === 'keep') {
    add('font-bold text-slate-700', 'いまの設定のままでよさそうです。調整しても、当てはめに使っていない問題で、はっきりとは良くなりませんでした。');
    btnTuneApply.classList.add('hidden');
    return;
  }
  add('font-bold text-slate-900', 'おすすめ（' + (r.pick === 'B' ? '式B（新しい式）' : '式A（数値の調整）') + '。当てはめに使っていない問題で、いまの式より損失が ' + (r.gain * 100).toFixed(1) + ' % 減りました）');
  if (r.beatsBase === false) add('text-[10px] text-red-600', '注意: おすすめの式でも、何も予測しない「基準」ほどは当たっていません。いまの式よりは良くなりますが、式そのものの作りに、まだ無理があるかもしれません。');
  add('text-slate-700', tuneSettingsText(r.recommended));
  btnTuneApply.classList.remove('hidden');
}

btnTune.addEventListener('click', async function () {
  btnTune.disabled = true;
  tuneResult.textContent = '解答履歴を読み込んでいます…';
  btnTuneApply.classList.add('hidden');
  try {
    const raw = await api('/api/questions?kind=historyall');
    tuneResult.textContent = '調べています…';
    await new Promise(function (r) { setTimeout(r, 30); });   // 「調べています」を先に描く
    tuneLast = tuneRun(raw, memorySettings);
    tuneRender(tuneLast);
  } catch (err) {
    if (!err.unauthorized) tuneResult.textContent = '調べられませんでした: ' + err.message;
  } finally {
    btnTune.disabled = false;
  }
});

btnTuneApply.addEventListener('click', function () {
  if (!tuneLast || tuneLast.status !== 'tuned') return;
  try { localStorage.setItem(STORAGE_KEY_MEMORY_BACKUP, JSON.stringify(memorySettings)); } catch (err) {}   // 元に戻せるように、いまの設定を控える
  const rec = tuneLast.recommended;
  ['ease', 'lapseKeep', 'firstInterval', 'shape', 'spacing', 'retryPenalty'].forEach(function (k) { memorySettings[k] = rec[k]; });
  saveMemorySettings();
  applyMemorySettingsToUI();
  tuneShowCurrent();
  btnTuneApply.classList.add('hidden');
  tuneResult.textContent = 'この設定にしました。';
});

btnTuneRevert.addEventListener('click', function () {
  try {
    const b = JSON.parse(localStorage.getItem(STORAGE_KEY_MEMORY_BACKUP) || 'null');
    if (b && typeof b === 'object') {
      Object.keys(memorySettings).forEach(function (k) { if (typeof b[k] === 'number' && isFinite(b[k])) memorySettings[k] = b[k]; });
      saveMemorySettings();
      applyMemorySettingsToUI();
    }
    localStorage.removeItem(STORAGE_KEY_MEMORY_BACKUP);
  } catch (err) {}
  tuneShowCurrent();
  tuneResult.textContent = '元の設定に戻しました。';
});

// 歯車を開いたときに、いまの設定を出す
btnOpenSettings.addEventListener('click', tuneShowCurrent);
btnOpenSettingsHome.addEventListener('click', tuneShowCurrent);
