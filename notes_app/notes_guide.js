/* =====================================================================
   notes_guide.js ― 整列ガイド（自由配置の図形を動かすとき、端・中央がそろう位置に吸い付き、線を出す）

   ・基準：ほかの図形の「左端・中央・右端」「上端・中央・下端」と、本文の列の左端・中央・右端
   ・縦と横それぞれ、一番近い1つにだけ吸い付く（6px 以内）。Alt を押している間は吸い付かない
   ・線は「吸い付いた後の位置」で本当にそろっているものだけ出す
   ・形は見た目どおりで測る（回転した図形は回転後の外枠、手書きは線そのもの、線・矢印は両端）
   ・基準の一覧は、つかんだ瞬間に1回だけ作る（画面の近くの図形だけ）
   ・1つでも複数（まとめた外枠）でも同じ仕組み。線は保存にも「元に戻す」にも入らない
   ・オン／オフは道具バー（↖選択）の「整列ガイド」。好みとしてブラウザに覚える
   ・角度のガイド：回転・線の端を動かす間、角度の札（0〜359°）を出す。45°ごとの前後4°以内で吸い付き、その向きの線を出す
   窓口：Notes.Guide.begin(動かす図形の配列) → { move(dx, dy, alt) → {dx, dy}, end() }（notes_free.js が呼ぶ）
         Notes.Guide.snapAngle / snapLineEnd / showAngle / clear … 回転と線の端（notes_free.js の startHandle が呼ぶ）
         Notes.Guide.beginResize(図形, つまみ, 元の形, 要素) → { move(w, h, 比率を保つ, alt, 指先) → {w, h}, end() } … 伸縮
         Notes.Guide._.solve … 計算だけ（画面なしで試せる）
   ===================================================================== */
window.Notes = window.Notes || {};
(function () {
  "use strict";
  const N = window.Notes;
  const TOL = 6;          // 何 px 以内なら吸い付くか
  const MARGIN = 400;     // 画面の外、どこまでの図形を基準にするか（上下）
  const KEY = "nb-guides";
  let on = true;
  try { on = localStorage.getItem(KEY) !== "0"; } catch (_) {}

  /* ---------------- 計算（画面なしで試せる部分） ----------------
     box  … 動かすものの、動かす前の外枠 { l, t, r, b }
     refs … { xs: [{ v, a, b, col }], ys: [...] }  v＝基準の位置、a〜b＝その基準の線の伸びる範囲（col は本文の列）
     dx, dy … 今の移動量。返り値 { dx, dy, lines:[{ axis:"x"|"y", v, a, b, col }] } */
  function pick(vals, refs, d, tol) {
    let best = null;
    for (const p of vals) for (const r of refs) {
      const diff = r.v - (p + d);
      if (Math.abs(diff) <= tol && (best === null || Math.abs(diff) < Math.abs(best))) best = diff;
    }
    return best === null ? d : d + best;
  }
  function lines(axis, vals, refs, lo, hi) {
    const out = new Map();
    for (const r of refs) {
      if (!vals.some(p => Math.abs(r.v - p) < 0.5)) continue;
      const a = r.col ? lo - 16 : Math.min(r.a, lo), b = r.col ? hi + 16 : Math.max(r.b, hi);
      const k = Math.round(r.v * 2) / 2, cur = out.get(k);
      if (cur) { cur.a = Math.min(cur.a, a); cur.b = Math.max(cur.b, b); cur.col = cur.col && r.col; }
      else out.set(k, { axis, v: r.v, a, b, col: !!r.col });
    }
    return [...out.values()];
  }
  function solve(box, refs, dx, dy, tol = TOL) {
    const sx = pick([box.l, (box.l + box.r) / 2, box.r], refs.xs, dx, tol);
    const sy = pick([box.t, (box.t + box.b) / 2, box.b], refs.ys, dy, tol);
    const m = { l: box.l + sx, r: box.r + sx, t: box.t + sy, b: box.b + sy };
    return {
      dx: sx, dy: sy,
      lines: lines("x", [m.l, (m.l + m.r) / 2, m.r], refs.xs, m.t, m.b)
        .concat(lines("y", [m.t, (m.t + m.b) / 2, m.b], refs.ys, m.l, m.r)),
    };
  }

  /* ---------------- 見た目どおりの外枠 ---------------- */
  const F = () => N.Free._;
  function vbox(o) {
    const d = F().elOf(o.id); if (!d || d.style.display === "none") return null;
    const b = F().boxOf(o); if (!b) return null;
    if (b.x1 != null) return { l: b.l, t: b.t, r: b.l + b.w, b: b.t + b.h };          // 線・矢印：両端
    const h = o.kind === "text" ? d.offsetHeight : b.h;
    const cx = b.l + b.w / 2, cy = b.t + h / 2, rad = (o.rot || 0) * Math.PI / 180, c = Math.cos(rad), s = Math.sin(rad);
    if (o.kind === "ellipse") {
      const ex = Math.hypot(b.w / 2 * c, h / 2 * s), ey = Math.hypot(b.w / 2 * s, h / 2 * c);
      return { l: cx - ex, r: cx + ex, t: cy - ey, b: cy + ey };
    }
    let pts, pad = 0;
    if (o.kind === "ink" && o.pts && o.pts.length) {                                  // 手書き：線そのもの（箱の余白は除く）
      pts = o.pts.map(q => [b.l + q[0] * b.w, b.t + q[1] * b.h]);
      pad = o.pen === "marker" ? (o.sw || 2) * 2 : (o.sw || 2) / 2;
    } else if (o.kind === "triangle") pts = [[cx, b.t], [b.l + b.w, b.t + h], [b.l, b.t + h]];
    else pts = [[b.l, b.t], [b.l + b.w, b.t], [b.l + b.w, b.t + h], [b.l, b.t + h]];
    let l = Infinity, t = Infinity, r = -Infinity, bt = -Infinity;
    pts.forEach(([x, y]) => {
      const X = cx + (x - cx) * c - (y - cy) * s, Y = cy + (x - cx) * s + (y - cy) * c;
      l = Math.min(l, X); r = Math.max(r, X); t = Math.min(t, Y); bt = Math.max(bt, Y);
    });
    return { l: l - pad, t: t - pad, r: r + pad, b: bt + pad };
  }
  const union = bs => bs.reduce((u, x) => ({ l: Math.min(u.l, x.l), t: Math.min(u.t, x.t), r: Math.max(u.r, x.r), b: Math.max(u.b, x.b) }));

  /* ---------------- 線を描く ---------------- */
  function layerG() {
    const L = F().layer; if (!L) return null;
    let g = L.querySelector(":scope > .nb-fguides");
    if (!g) { g = document.createElement("div"); g.className = "nb-fguides"; L.appendChild(g); }
    return g;
  }
  function draw(ls, extra = "") {
    const g = layerG(); if (!g) return;
    g.innerHTML = ls.map(x => x.axis === "x"
      ? `<div class="nb-gl v${x.col ? " col" : ""}" style="left:${x.v}px;top:${x.a}px;height:${x.b - x.a}px"></div>`
      : `<div class="nb-gl h${x.col ? " col" : ""}" style="top:${x.v}px;left:${x.a}px;width:${x.b - x.a}px"></div>`).join("") + extra;
  }
  function clear() { const L = F().layer, g = L && L.querySelector(":scope > .nb-fguides"); if (g) g.remove(); }
  const keys = e => { if (e.key === "Alt") e.preventDefault(); };   // Alt で画面上のメニューに移らないように
  const listenAlt = add => { const f = add ? "addEventListener" : "removeEventListener"; document[f]("keydown", keys); document[f]("keyup", keys); };

  /* 基準を集める（つかんだ瞬間に1回だけ）：ids 以外の図形の端・中央と本文の列。sizes は同じ大きさにそろえる用（線・矢印は除く） */
  function collect(ids) {
    const LR = F().layerRect(), V = F().parts();
    const sr = V.scroll.getBoundingClientRect(), top = sr.top - LR.top - MARGIN, bot = sr.bottom - LR.top + MARGIN;
    const refs = { xs: [], ys: [] }, sizes = [];
    F().list().forEach(o => {
      if (ids.has(o.id)) return;
      const v = vbox(o); if (!v || v.b < top || v.t > bot) return;
      [v.l, (v.l + v.r) / 2, v.r].forEach(x => refs.xs.push({ v: x, a: v.t, b: v.b }));
      [v.t, (v.t + v.b) / 2, v.b].forEach(y => refs.ys.push({ v: y, a: v.l, b: v.r }));
      if (o.kind !== "line" && o.kind !== "arrow") sizes.push(v);
    });
    const cr = V.blocks.getBoundingClientRect(), cl = cr.left - LR.left, cw = cr.width;
    [cl, cl + cw / 2, cl + cw].forEach(x => refs.xs.push({ v: x, col: true }));
    return { refs, sizes };
  }

  /* ---------------- 動かし始め ---------------- */
  function begin(moving) {
    if (!on || !N.Free || !moving.length) return null;
    const ids = new Set(moving.map(o => o.id));
    const mb = moving.map(vbox).filter(Boolean);
    if (!mb.length) return null;
    const box = union(mb);
    const { refs } = collect(ids);
    listenAlt(true);
    return {
      move(dx, dy, alt) {
        if (alt) { draw([]); return { dx, dy }; }
        const r = solve(box, refs, dx, dy);
        draw(r.lines);
        return { dx: r.dx, dy: r.dy };
      },
      end() { clear(); listenAlt(false); },
    };
  }

  /* ---------------- 伸縮のガイド ----------------
     ・引っぱっている辺だけが、ほかの図形・本文の列の端・中央に吸い付く（反対の辺は動かさない）
     ・ほかの図形と同じ幅・同じ高さになる所でも吸い付き、そろった相手に「＝」の印を出す
       （印は変えていない向きでも出す。例：高さを変えている間も、幅が同じなら「＝」）
     ・引っぱっている間は大きさ（見た目の幅 × 高さ）の札を出す
     ・回転している図形は吸い付かない（札だけ）。比率を保つとき（Shift・手書きの角）は近いほうの1辺だけ合わせ、もう1辺は比率で決める
     ・テキストは高さが文字の量で決まるので、幅だけ
     見た目の辺 ＝ 箱の端 ＋ a×幅 ＋ b（ふつうの図形は a=0/1・b=0、手書きは線の端までの割合と線の太さの半分） */
  function edgeMap(o) {
    if (o.kind === "ink" && o.pts && o.pts.length) {
      const hw = o.pen === "marker" ? (o.sw || 2) * 2 : (o.sw || 2) / 2;
      const xs = o.pts.map(q => q[0]), ys = o.pts.map(q => q[1]);
      return { x: { lo: [Math.min(...xs), -hw], hi: [Math.max(...xs), hw] }, y: { lo: [Math.min(...ys), -hw], hi: [Math.max(...ys), hw] } };
    }
    return { x: { lo: [0, 0], hi: [1, 0] }, y: { lo: [0, 0], hi: [1, 0] } };
  }
  /* 1つの向き（横なら x）で、引っぱっている辺を吸い付かせる。f＝+1（右・下の辺）／−1（左・上の辺）、p0＝箱の端、s0＝元の大きさ、s＝今の大きさ
     返り値 { s: 吸い付いた大きさ, dist } か null */
  function snapSide(f, p0, s0, s, m, refs, sizes, tol) {
    const span = m.hi[0] - m.lo[0], visSize = v => span * v + (m.hi[1] - m.lo[1]);
    const edge = v => f > 0 ? p0 + m.hi[0] * v + m.hi[1] : p0 + s0 - v + m.lo[0] * v + m.lo[1];
    const slope = f > 0 ? m.hi[0] : m.lo[0] - 1;
    let best = null;
    const cur = edge(s);
    if (slope) for (const r of refs) {
      const d = r.v - cur;
      if (Math.abs(d) <= tol && (!best || Math.abs(d) < best.dist)) best = { s: s + d / slope, dist: Math.abs(d) };
    }
    const cs = visSize(s);
    if (span > 0.01) for (const z of sizes) {
      const d = z - cs;
      if (Math.abs(d) <= tol && (!best || Math.abs(d) < best.dist)) best = { s: s + d / span, dist: Math.abs(d) };
    }
    return best && best.s >= 12 ? best : null;
  }
  /* 計算だけ（画面なしで試せる）。g＝{ fx, fy, x0, y0, w0, h0, m, keep, noY }、w・h＝今の大きさ。返り値 { w, h } */
  function resizeSolve(g, w, h, refs, sizes, tol = TOL) {
    const bx = g.fx ? snapSide(g.fx, g.x0, g.w0, w, g.m.x, refs.xs, sizes.w, tol) : null;
    const by = g.fy && !g.noY ? snapSide(g.fy, g.y0, g.h0, h, g.m.y, refs.ys, sizes.h, tol) : null;
    if (g.keep) {
      if (bx && (!by || bx.dist <= by.dist)) return { w: bx.s, h: g.h0 * bx.s / g.w0 };
      if (by) return { w: g.w0 * by.s / g.h0, h: by.s };
      return { w, h };
    }
    return { w: bx ? bx.s : w, h: by ? by.s : h };
  }
  function beginResize(o, hdl, a0, d) {
    if (!N.Free) return null;
    const fx = hdl.includes("e") ? 1 : hdl.includes("w") ? -1 : 0, fy = hdl.includes("s") ? 1 : hdl.startsWith("n") ? -1 : 0;
    const rotated = !!(o.rot && Math.round(o.rot) % 360);
    const m = edgeMap(o), noY = o.kind === "text";
    const { refs, sizes } = collect(new Set([o.id]));
    const sz = { w: sizes.map(v => v.r - v.l), h: sizes.map(v => v.b - v.t) };
    // テキストの見た目の高さ＝「指定の高さ」と「文字の量で決まる高さ」の大きいほう（表示の更新を待たずに測る）
    const textH = h => {
      if (!noY || !d) return h;
      const mh = d.style.minHeight; d.style.minHeight = "0px";
      const c = d.offsetHeight; d.style.minHeight = mh;
      return Math.max(h, c);
    };
    // 見た目の外枠（回転なし）
    const visBox = (w, h) => {
      const x = fx < 0 ? a0.x + a0.w - w : a0.x, y = fy < 0 ? a0.y + a0.h - h : a0.y;
      const hv = textH(h);
      return { l: x + m.x.lo[0] * w + m.x.lo[1], r: x + m.x.hi[0] * w + m.x.hi[1], t: y + m.y.lo[0] * hv + m.y.lo[1], b: y + m.y.hi[0] * hv + m.y.hi[1] };
    };
    listenAlt(true);
    return {
      move(w, h, keep, alt, pt) {
        let ls = [], marks = "";
        if (on && !alt && !rotated) {
          ({ w, h } = resizeSolve({ fx, fy, x0: a0.x, y0: a0.y, w0: a0.w, h0: a0.h, m, keep, noY }, w, h, refs, sz));
          const v = visBox(w, h);
          if (fx) ls = ls.concat(lines("x", [fx > 0 ? v.r : v.l], refs.xs, v.t, v.b));
          if (fy && !noY) ls = ls.concat(lines("y", [fy > 0 ? v.b : v.t], refs.ys, v.l, v.r));
          const mark = (x, y) => `<div class="nb-gsame" style="left:${x}px;top:${y}px">＝</div>`;
          let sameW = false, sameH = false;
          sizes.forEach(z => {
            // 変えていない向きでも、同じ幅・同じ高さなら知らせる（吸い付きは引っぱっている辺だけ）
            // 印は図形の内側に出す（幅＝右下の角の内、高さ＝左の辺の内）。外や辺の真ん中だと、すぐ隣の図形のつまみ（回転など）に重なる
            if (Math.abs((z.r - z.l) - (v.r - v.l)) < 0.5) { marks += mark(z.r - 16, z.b - 14); sameW = true; }
            if (!noY && Math.abs((z.b - z.t) - (v.b - v.t)) < 0.5) { marks += mark(z.l + 16, (z.t + z.b) / 2); sameH = true; }
          });
          if (sameW) marks += mark(v.r - 16, v.b - 14);
          if (sameH) marks += mark(v.l + 16, (v.t + v.b) / 2);
        }
        const v = visBox(w, h);
        const label = rotated ? `${Math.round(w)} × ${Math.round(textH(h))}` : `${Math.round(v.r - v.l)} × ${Math.round(v.b - v.t)}`;
        draw(ls, marks + `<div class="nb-gang" style="left:${pt.x + 16}px;top:${pt.y + 16}px">${label}</div>`);
        return { w, h };
      },
      end() { clear(); listenAlt(false); },
    };
  }

  /* ---------------- 角度のガイド（回転・線の向き） ----------------
     ・ドラッグ中は角度の札（0〜359°）をいつも出す
     ・45°ごと（0・45・90…）の前後4°以内なら、その角度に吸い付く（Alt・オフのときは吸い付かない）
     ・キリの良い角度のときは、札をピンクにし、その向きの線を出す */
  const ANG_STEP = 45, ANG_TOL = 4;
  const deg360 = d => ((Math.round(d) % 360) + 360) % 360;
  const isRound = d => Math.abs(d / ANG_STEP - Math.round(d / ANG_STEP)) < 1e-6;
  function snapAngle(deg, noSnap, tol = ANG_TOL) {
    const n = Math.round(deg / ANG_STEP) * ANG_STEP;
    if (on && !noSnap && Math.abs(deg - n) <= tol) return n;
    return deg;
  }
  /* 線の端を動かす：f＝動かさない端、p＝動かしている端。向きが45°ごとに近ければ、長さを保ったまま向きをそろえる */
  function snapLineEnd(f, p, noSnap) {
    const dx = p.x - f.x, dy = p.y - f.y, len = Math.hypot(dx, dy);
    if (len < 1) return { p, deg: 0 };
    const raw = Math.atan2(dy, dx) * 180 / Math.PI, deg = snapAngle(raw, noSnap);
    if (deg === raw) return { p, deg };
    const r = deg * Math.PI / 180;
    return { p: { x: f.x + len * Math.cos(r), y: f.y + len * Math.sin(r) }, deg };
  }
  /* 札と線を出す。deg＝表示する角度（右回りが＋）、pt＝札を出す所（指先）、axis＝{cx, cy, len, deg} 線を引く中心と向き */
  function showAngle(deg, pt, axis, alt) {
    const g = layerG(); if (!g) return;
    const good = !alt && isRound(deg);
    let h = `<div class="nb-gang${good ? " on" : ""}" style="left:${pt.x + 16}px;top:${pt.y + 16}px">${deg360(deg)}°</div>`;
    if (good && axis) {
      const r = axis.deg * Math.PI / 180, L = axis.len / 2 + 40;
      h += `<div class="nb-gl r" style="left:${axis.cx - Math.cos(r) * L}px;top:${axis.cy - Math.sin(r) * L}px;width:${L * 2}px;transform:rotate(${axis.deg}deg)"></div>`;
    }
    g.innerHTML = h;
  }

  /* ---------------- 道具バー（↖選択）のオン／オフ ---------------- */
  function bar(box) {
    const b = document.createElement("button");
    b.className = "nb-tool" + (on ? " on" : "");
    b.innerHTML = `<span class="i">⊹</span>整列ガイド`;
    b.title = "動かすとき、ほかの図形や本文の端・中央にそろえる（Alt を押している間は止まる）";
    b.onclick = () => { on = !on; try { localStorage.setItem(KEY, on ? "1" : "0"); } catch (_) {} F().drawTools(); };
    box.appendChild(b);
    const h = document.createElement("span"); h.className = "nb-tool-hint";
    h.textContent = "押して選ぶ（Shift で追加）・ダブルクリックで文字";
    box.appendChild(h);
  }
  if (N.Free) N.Free._.optionBars.select = bar;

  N.Guide = { begin, beginResize, snapAngle, snapLineEnd, showAngle, clear: () => N.Free && clear(), get on() { return on; }, _: { solve, resizeSolve, vbox, deg360 } };
})();
