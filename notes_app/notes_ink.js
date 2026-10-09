/* =====================================================================
   notes_ink.js ― 手書き（ペン・消しゴム・投げ縄・手書き→図形）

   ✒ ペン   ：ペン／マーカー（半透明で太め）／点線。色・太さを選ぶ。
              ペンタブレット・Surfaceペンなどは押す強さ（筆圧）で太さが変わる。マウスは一定の太さ
              描き終わりにペンを止めたまま約0.8秒待つと、直線・矢印・四角・丸・三角に整う（オン／オフ可）
   ⌫ 消しゴム：線ごと消す／触れた部分だけ消す（線が分かれる）。大きさ3段階
   ⬚ 投げ縄 ：ぐるっと囲んだ図形・線をまとめて選ぶ（あとは「選択」と同じ操作）
   描いた線は kind:"ink" の図形として notes_free.js に渡す（選択・移動・伸縮・回転・右クリックは共通）。
   データ：{ kind:"ink", pen:"pen|marker|dash", stroke, sw, pts:[[x,y,(筆圧)]…] }
           pts の x,y は、その図形の箱の中の割合（0〜1）。箱を伸ばせば線も伸びる
   ===================================================================== */
window.Notes = window.Notes || {};
(function () {
  "use strict";
  const N = window.Notes;
  if (!N.Free) return;
  const F = N.Free._;
  const E = () => N.Editor;
  const el = (...a) => N._el(...a);
  const LS = {
    get(k, fb) { try { const v = localStorage.getItem(k); return v === null ? fb : JSON.parse(v); } catch (e) { return fb; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  const PEN = Object.assign({ pen: "pen", stroke: "ink", sw: 2, shape: true, mstroke: "yellow" }, LS.get("notes.pen", {}));
  const ERASER = Object.assign({ mode: "stroke", size: 16 }, LS.get("notes.eraser", {}));
  const HOLD_MS = 800;

  /* ---------------- 線の形を作る ---------------- */
  // 点を整える：近すぎる点を間引き、位置と筆圧をなめらかにならす（手ぶれ・マウスの1px単位のカクカクを消す）
  function tidy(p) {
    if (p.length < 3) return p.map(q => q.slice());
    const out = [p[0].slice()];
    for (let i = 1; i < p.length - 1; i++) if (dist(p[i], out[out.length - 1]) >= 2) out.push(p[i].slice());
    out.push(p[p.length - 1].slice());
    for (let k = 0; k < 2; k++) {
      const c = out.map(q => q.slice());
      for (let i = 1; i < out.length - 1; i++) {
        out[i][0] = (c[i - 1][0] + c[i][0] * 2 + c[i + 1][0]) / 4;
        out[i][1] = (c[i - 1][1] + c[i][1] * 2 + c[i + 1][1]) / 4;
        if (c[i][2] != null && c[i - 1][2] != null && c[i + 1][2] != null) out[i][2] = (c[i - 1][2] + c[i][2] * 2 + c[i + 1][2]) / 4;
      }
    }
    return out;
  }
  const hasPressure = pts => pts.some(q => q[2] != null);
  const f2 = n => n.toFixed(2);
  // なめらかな線（同じ太さ）：点の中間を通る曲線でつなぐ
  function smoothPath(p) {
    if (!p.length) return "";
    if (p.length === 1) return `M${f2(p[0][0])} ${f2(p[0][1])}L${f2(p[0][0] + 0.01)} ${f2(p[0][1] + 0.01)}`;
    let d = `M${f2(p[0][0])} ${f2(p[0][1])}`;
    for (let i = 1; i < p.length - 1; i++) d += `Q${f2(p[i][0])} ${f2(p[i][1])} ${f2((p[i][0] + p[i + 1][0]) / 2)} ${f2((p[i][1] + p[i + 1][1]) / 2)}`;
    const l = p[p.length - 1];
    return d + `L${f2(l[0])} ${f2(l[1])}`;
  }
  // 筆圧つきの線：点ごとの太さで左右のふちを作り、曲線でつないで塗る。端は丸を置いて閉じる
  function pressureSvg(p, sw, col) {
    if (p.length < 2) return "";
    const rad = p.map(q => Math.max(0.4, sw * (0.25 + (q[2] ?? 0.5) * 1.1) / 2));
    const L = [], R = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[Math.max(0, i - 1)], b = p[Math.min(p.length - 1, i + 1)];
      let tx = b[0] - a[0], ty = b[1] - a[1]; const len = Math.hypot(tx, ty) || 1; tx /= len; ty /= len;
      L.push([p[i][0] - ty * rad[i], p[i][1] + tx * rad[i]]); R.push([p[i][0] + ty * rad[i], p[i][1] - tx * rad[i]]);
    }
    const side = q => { let d = ""; for (let i = 1; i < q.length - 1; i++) d += `Q${f2(q[i][0])} ${f2(q[i][1])} ${f2((q[i][0] + q[i + 1][0]) / 2)} ${f2((q[i][1] + q[i + 1][1]) / 2)}`; return d + `L${f2(q[q.length - 1][0])} ${f2(q[q.length - 1][1])}`; };
    const Rr = R.slice().reverse();
    const d = `M${f2(L[0][0])} ${f2(L[0][1])}${side(L)}L${f2(Rr[0][0])} ${f2(Rr[0][1])}${side(Rr)}Z`;
    const a = p[0], z = p[p.length - 1];
    return `<path d="${d}" style="fill:${col}"/><circle cx="${f2(a[0])}" cy="${f2(a[1])}" r="${f2(rad[0])}" style="fill:${col}"/>` +
      `<circle cx="${f2(z[0])}" cy="${f2(z[1])}" r="${f2(rad[rad.length - 1])}" style="fill:${col}"/>`;
  }
  function strokeSvg(o, raw) {      // raw：その箱の中の px 座標
    const col = F.strokeCss(o.stroke || "ink"), sw = o.sw || 2;
    const pts = tidy(raw);
    if (o.pen === "pen" && hasPressure(pts)) { const svg = pressureSvg(pts, sw, col); if (svg) return svg; }
    const w = o.pen === "marker" ? sw * 4 : sw;
    const extra = o.pen === "marker" ? "opacity:.38;" : o.pen === "dash" ? `stroke-dasharray:${sw * 3} ${sw * 2.2};` : "";
    return `<path d="${smoothPath(pts)}" style="fill:none;stroke:${col};stroke-width:${w}px;stroke-linecap:round;stroke-linejoin:round;${extra}"/>`;
  }
  // 図形として描く（箱の大きさに合わせて毎回作り直す）
  F.kindRender.ink = (o, b) => {
    const pts = (o.pts || []).map(q => q.length > 2 ? [q[0] * b.w, q[1] * b.h, q[2]] : [q[0] * b.w, q[1] * b.h]);   // 筆圧がない点に「なし」の欄を作らない
    const hitW = Math.max(14, (o.pen === "marker" ? (o.sw || 2) * 4 : o.sw || 2) + 10);
    return `<svg width="${b.w}" height="${b.h}" overflow="visible">${strokeSvg(o, pts)}` +
      `<path class="hit" d="${smoothPath(tidy(pts))}" style="fill:none;stroke:transparent;stroke-width:${hitW}px;stroke-linecap:round"/></svg>`;
  };

  /* 線の点を紙の上の座標（abs）で返す（回転も反映） */
  function inkAbsPoints(o) {
    const a = F.getAbs(o); if (!a) return null;
    const r = (o.rot || 0) * Math.PI / 180, cos = Math.cos(r), sin = Math.sin(r), cx = a.x + a.w / 2, cy = a.y + a.h / 2;
    return (o.pts || []).map(q => {
      const x = a.x + q[0] * a.w - cx, y = a.y + q[1] * a.h - cy;
      return [cx + x * cos - y * sin, cy + x * sin + y * cos, q[2]];
    });
  }
  /* abs の点の並びから、ink の図形を作る（箱は点を囲む大きさ） */
  function makeInk(pts, style, anchorPt, z) {
    if (pts.length < 1) return null;
    const sw = style.sw || 2, pad = (style.pen === "marker" ? sw * 2 : sw) + 3;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    pts.forEach(q => { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); });
    const box = { x: x0 - pad, y: y0 - pad, w: Math.max(1, x1 - x0) + pad * 2, h: Math.max(1, y1 - y0) + pad * 2 };
    const r4 = v => Math.round(v * 10000) / 10000;
    const o = { kind: "ink", pen: style.pen, stroke: style.stroke, sw,
      pts: pts.map(q => q[2] != null ? [r4((q[0] - box.x) / box.w), r4((q[1] - box.y) / box.h), Math.round(q[2] * 100) / 100] : [r4((q[0] - box.x) / box.w), r4((q[1] - box.y) / box.h)]) };
    F.add(o, box, anchorPt || { x: pts[0][0], y: pts[0][1] });
    if (z != null) o.z = z;
    return o;
  }

  /* ---------------- 手書き→図形 ---------------- */
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  function lineDev(pts, a, b) {
    const L = dist(a, b) || 1;
    return Math.max(...pts.map(p => Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / L));
  }
  function rdp(pts, eps) {
    if (pts.length < 3) return pts;
    let idx = 0, mx = 0; const a = pts[0], b = pts[pts.length - 1];
    for (let i = 1; i < pts.length - 1; i++) { const d = lineDev([pts[i]], a, b); if (d > mx) { mx = d; idx = i; } }
    if (mx <= eps) return [a, b];
    return rdp(pts.slice(0, idx + 1), eps).slice(0, -1).concat(rdp(pts.slice(idx), eps));
  }
  function recognize(pts) {
    if (pts.length < 5) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    pts.forEach(q => { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); });
    const w = x1 - x0, h = y1 - y0, diag = Math.hypot(w, h);
    if (diag < 24) return null;
    const first = pts[0], last = pts[pts.length - 1], box = { x: x0, y: y0, w: Math.max(w, 8), h: Math.max(h, 8) };
    const closed = dist(first, last) < Math.max(18, diag * 0.22);
    if (!closed) {
      const len = dist(first, last);
      if (len > 20 && lineDev(pts, first, last) < Math.max(6, len * 0.06)) return { kind: "line", p1: first, p2: last };
      // 矢印：始まりから一番遠い点（先端）まではまっすぐで、そこから少し折り返している
      let ti = 0, td = 0; pts.forEach((p, i) => { const d = dist(first, p); if (d > td) { td = d; ti = i; } });
      const tip = pts[ti], shaft = pts.slice(0, ti + 1), head = pts.slice(ti);
      if (head.length >= 3 && td > 30 && lineDev(shaft, first, tip) < Math.max(8, td * 0.08)) {
        const hl = Math.max(...head.map(p => dist(p, tip)));
        if (hl > td * 0.08 && hl < td * 0.5) return { kind: "arrow", p1: first, p2: tip };
      }
      return null;
    }
    // 閉じた形は始まりと終わりが重なるので、始まりから一番遠い点で2つに分けてから角を数える
    let fi = 0, fd = 0; pts.forEach((p, i) => { const d = dist(first, p); if (d > fd) { fd = d; fi = i; } });
    const eps = diag * 0.07;
    const simp = rdp(pts.slice(0, fi + 1), eps).concat(rdp(pts.slice(fi).concat([first]), eps).slice(1));
    const corners = simp.length - 1;
    if (corners === 3) return { kind: "triangle", box };
    if (corners === 4 || corners === 5) return { kind: "rect", box };
    return { kind: "ellipse", box };
  }
  function shapePreview(s, col, sw) {
    const st = `fill:none;stroke:${col};stroke-width:${sw}px;stroke-linecap:round`;
    if (s.kind === "line" || s.kind === "arrow") return `<line x1="${s.p1[0]}" y1="${s.p1[1]}" x2="${s.p2[0]}" y2="${s.p2[1]}" style="${st}"/>`;
    const b = s.box;
    if (s.kind === "rect") return `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="3" style="${st}"/>`;
    if (s.kind === "ellipse") return `<ellipse cx="${b.x + b.w / 2}" cy="${b.y + b.h / 2}" rx="${b.w / 2}" ry="${b.h / 2}" style="${st}"/>`;
    return `<polygon points="${b.x + b.w / 2},${b.y} ${b.x + b.w},${b.y + b.h} ${b.x},${b.y + b.h}" style="${st}"/>`;
  }

  // まとめて届いた細かい動き。空のとき（環境によってはある）は、そのイベント自身を使う
  const coalesced = ev => { const c = ev.getCoalescedEvents ? ev.getCoalescedEvents() : []; return c && c.length ? c : [ev]; };

  /* ---------------- ✒ ペン ---------------- */
  function overlay() {
    const layer = F.layer;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "nb-inklive");
    svg.setAttribute("width", layer.clientWidth); svg.setAttribute("height", layer.clientHeight);
    layer.appendChild(svg);
    return svg;
  }
  function startPen(e) {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault();
    const layer = F.layer, LR = F.layerRect();
    try { layer.setPointerCapture(e.pointerId); } catch (_) {}
    const style = { pen: PEN.pen, stroke: PEN.pen === "marker" ? PEN.mstroke : PEN.stroke, sw: PEN.sw };
    const usesP = e.pointerType === "pen";
    const pts = [];
    const pushEv = ev => {
      let q = [ev.clientX - LR.left, ev.clientY - LR.top];
      if (usesP && ev.pressure > 0) q.push(ev.pressure);
      const l = pts[pts.length - 1];
      if (l) {                        // 手ぶれ補正：前の点から半分だけ進める（線が少し遅れてついてくる）
        const k = 0.5; q = [l[0] + (q[0] - l[0]) * k, l[1] + (q[1] - l[1]) * k].concat(q.length > 2 ? [q[2]] : []);
      }
      if (!l || dist(l, q) >= 0.8) pts.push(q);
    };
    pushEv(e);
    const svg = overlay(), col = F.strokeCss(style.stroke);
    let shape = null, holdTimer = 0, lastMove = pts[0];
    const draw = () => { svg.innerHTML = shape ? shapePreview(shape, col, style.sw) : strokeSvg(style, pts); };
    const arm = () => {
      clearTimeout(holdTimer);
      if (!PEN.shape || style.pen === "marker") return;
      holdTimer = setTimeout(() => { shape = recognize(pts); if (shape) { draw(); svg.classList.add("snap"); } }, HOLD_MS);
    };
    draw(); arm();
    const mv = ev => {
      if (ev.pointerId !== e.pointerId) return;
      coalesced(ev).forEach(pushEv);
      const q = pts[pts.length - 1];
      if (dist(q, lastMove) > 3) { lastMove = q; if (!shape) arm(); }
      if (!shape) draw();
    };
    const up = ev => {
      if (ev.pointerId !== e.pointerId) return;
      layer.removeEventListener("pointermove", mv); layer.removeEventListener("pointerup", up); layer.removeEventListener("pointercancel", up);
      clearTimeout(holdTimer);
      svg.remove();
      E().settle();
      if (shape) {
        const o = { kind: shape.kind, stroke: style.stroke, sw: style.sw };
        if (shape.p1) F.add(o, { p1: { x: shape.p1[0], y: shape.p1[1] }, p2: { x: shape.p2[0], y: shape.p2[1] } }, { x: shape.p1[0], y: shape.p1[1] });
        else { o.fill = "none"; F.add(o, shape.box, { x: shape.box.x, y: shape.box.y }); }
      } else makeInk(pts, style);
      E().changed();
      N.Free.render();
    };
    layer.addEventListener("pointermove", mv); layer.addEventListener("pointerup", up); layer.addEventListener("pointercancel", up);
  }

  /* ---------------- ⌫ 消しゴム ---------------- */
  function segDist(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
    let t = L ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L : 0; t = Math.max(0, Math.min(1, t));
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  }
  function densify(pts, step) {       // 点の間が広いと部分消しが効かないので、間に点を足す
    const out = [];
    pts.forEach((q, i) => {
      if (i) { const a = pts[i - 1], d = dist(a, q), n = Math.floor(d / step);
        for (let k = 1; k < n; k++) { const t = k / n; out.push([a[0] + (q[0] - a[0]) * t, a[1] + (q[1] - a[1]) * t, a[2] != null && q[2] != null ? a[2] + (q[2] - a[2]) * t : a[2]]); } }
      out.push(q);
    });
    return out;
  }
  function startEraser(e) {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault();
    const layer = F.layer, LR = F.layerRect();
    try { layer.setPointerCapture(e.pointerId); } catch (_) {}
    const R = ERASER.size;
    const ring = el("div", "nb-eraser"); ring.style.width = ring.style.height = R * 2 + "px"; layer.appendChild(ring);
    let changed = false;
    E().settle();
    const at = ev => {
      const p = [ev.clientX - LR.left, ev.clientY - LR.top];
      ring.style.left = p[0] - R + "px"; ring.style.top = p[1] - R + "px";
      const arr = F.list();
      for (let i = arr.length - 1; i >= 0; i--) {
        const o = arr[i]; if (o.kind !== "ink") continue;
        const ap = inkAbsPoints(o); if (!ap) continue;
        const reach = R + (o.pen === "marker" ? o.sw * 2 : (o.sw || 2) / 2);
        const hit = ap.length === 1 ? dist(ap[0], p) <= reach : ap.some((q, k) => k && segDist(p, ap[k - 1], q) <= reach);
        if (!hit) continue;
        changed = true;
        arr.splice(i, 1);
        if (ERASER.mode === "part") {      // 触れた点を抜いて、残りを別々の線にする
          const dense = densify(ap, Math.max(2, R / 3)), segs = []; let cur = [];
          dense.forEach(q => { if (dist(q, p) <= reach) { if (cur.length > 1) segs.push(cur); cur = []; } else cur.push(q); });
          if (cur.length > 1) segs.push(cur);
          segs.forEach(sg => makeInk(sg, { pen: o.pen, stroke: o.stroke, sw: o.sw }, { x: sg[0][0], y: sg[0][1] }, o.z));
        }
      }
      if (changed) N.Free.render();
      layer.appendChild(ring);
    };
    at(e);
    const mv = ev => { if (ev.pointerId === e.pointerId) coalesced(ev).forEach(at); };
    const up = ev => {
      if (ev.pointerId !== e.pointerId) return;
      layer.removeEventListener("pointermove", mv); layer.removeEventListener("pointerup", up); layer.removeEventListener("pointercancel", up);
      ring.remove();
      if (changed) { E().changed(); N.Free.render(); }
    };
    layer.addEventListener("pointermove", mv); layer.addEventListener("pointerup", up); layer.addEventListener("pointercancel", up);
  }

  /* ---------------- ⬚ 投げ縄 ---------------- */
  function inside(p, poly) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  }
  function startLasso(e) {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault();
    const layer = F.layer, LR = F.layerRect();
    try { layer.setPointerCapture(e.pointerId); } catch (_) {}
    const poly = [[e.clientX - LR.left, e.clientY - LR.top]];
    const svg = overlay();
    const draw = () => { svg.innerHTML = `<polygon points="${poly.map(q => q.join(",")).join(" ")}" class="lasso"/>`; };
    const mv = ev => { if (ev.pointerId !== e.pointerId) return; const q = [ev.clientX - LR.left, ev.clientY - LR.top]; if (dist(q, poly[poly.length - 1]) > 3) { poly.push(q); draw(); } };
    const up = ev => {
      if (ev.pointerId !== e.pointerId) return;
      layer.removeEventListener("pointermove", mv); layer.removeEventListener("pointerup", up); layer.removeEventListener("pointercancel", up);
      svg.remove();
      if (poly.length < 3) return;
      // 囲みの中に「真ん中」が入っている図形（手書きは、点の半分以上が入っている線）を選ぶ
      const ids = F.list().filter(o => {
        if (o.kind === "ink") { const ap = inkAbsPoints(o); return ap && ap.filter(q => inside(q, poly)).length >= ap.length / 2; }
        const b = F.boxOf(o); if (!b) return false;
        return inside([b.l + b.w / 2, b.t + b.h / 2], poly);
      }).map(o => o.id);
      if (!ids.length) return;
      N.Free.setMode("select");
      N.Free.select(ids);
    };
    layer.addEventListener("pointermove", mv); layer.addEventListener("pointerup", up); layer.addEventListener("pointercancel", up);
  }

  /* ---------------- 道具バーの設定 ---------------- */
  function seg(box, items, cur, fn) {
    const g = el("div", "nb-seg");
    items.forEach(([v, label]) => { const b = el("button", v === cur ? "on" : "", label); b.onclick = () => fn(v); g.appendChild(b); });
    box.appendChild(g);
  }
  F.optionBars.pen = box => {
    seg(box, [["pen", "ペン"], ["marker", "マーカー"], ["dash", "点線"]], PEN.pen, v => { PEN.pen = v; save(); });
    const key = PEN.pen === "marker" ? "mstroke" : "stroke";
    const dots = el("div", "nb-dots");
    ["ink", "black"].concat(F.COLORS).forEach(c => {
      const b = el("button", "nb-dot" + (PEN[key] === c ? " on" : "")); b.title = c === "ink" ? "標準" : c === "black" ? "黒" : c;
      b.style.background = F.strokeCss(c); b.onclick = () => { PEN[key] = c; save(); }; dots.appendChild(b);
    });
    box.appendChild(dots);
    seg(box, [1, 2, 3, 5, 8].map(w => [w, `<span style="display:inline-block;width:14px;height:${Math.min(w, 8)}px;background:currentColor;border-radius:4px;vertical-align:middle"></span>`]), PEN.sw, v => { PEN.sw = v; save(); });
    const sh = el("button", "nb-toggle" + (PEN.shape ? " on" : ""), "◇ 図形に整える");
    sh.title = "描き終わりにペンを止めて約0.8秒待つと、直線・矢印・四角・丸・三角に整える";
    sh.onclick = () => { PEN.shape = !PEN.shape; save(); };
    box.appendChild(sh);
    function save() { LS.set("notes.pen", PEN); F.drawTools(); }
  };
  F.optionBars.eraser = box => {
    seg(box, [["stroke", "線ごと消す"], ["part", "部分だけ消す"]], ERASER.mode, v => { ERASER.mode = v; save(); });
    seg(box, [[8, "小"], [16, "中"], [28, "大"]], ERASER.size, v => { ERASER.size = v; save(); });
    function save() { LS.set("notes.eraser", ERASER); F.drawTools(); }
  };
  F.optionBars.lasso = box => box.appendChild(el("span", "nb-tool-hint", "ぐるっと囲むと、中の図形や線をまとめて選べます"));
  F.toolHandlers.pen = startPen;
  F.toolHandlers.eraser = startEraser;
  F.toolHandlers.lasso = startLasso;
  N.Ink = { recognize, inkAbsPoints, PEN, ERASER };
})();
