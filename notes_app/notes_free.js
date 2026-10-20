/* =====================================================================
   notes_free.js ― 自由配置（ページ全体を自由帳にする）

   ・文章の上・行間・左右の余白・最後の行より下・PDF のページの上まで、どこにでも
     図形・付箋・テキスト・矢印・手書き（notes_ink.js）を置ける
   ・結びつけ（anchor）：
       行の id        … その行の上端からの距離（dy, px）。上に行を足すと一緒に動く。x は本文の列の左端から（px）
       "pdf:行id:頁"  … PDF のそのページ。位置と大きさは「ページの幅を1」とした割合で覚える（表示の大きさが変わっても追従）
       null           … ページの上端（タイトルより上）
   ・道具バー：✎文章／↖選択／（ペン・消しゴム・投げ縄 … notes_ink.js）／図形／付箋／テキスト
   ・選択：押して選ぶ、Shift＋押すで追加。1つなら8方向の伸縮・回転・線の両端、複数ならまとめて移動・複製・削除・色・重なり順
   ・動かすとき、notes_guide.js があれば整列ガイド（端・中央にそろえて吸い付く）を使う
   データ（ページの free）：
     箱の形 { id, kind:"rect|ellipse|triangle|note|text|ink", anchor, x, dy, w, h, rot, z, stroke, fill, sw, tc, fs, text, (ink: pen, pts) }
       付箋・テキストの ff＝書体（FONTS の名前。なければ標準）、fsr＝PDF の上での文字の大きさ（ページの幅を1とした割合。拡大縮小についていく）
       tc は色の名前のほか "#rrggbb" も使える（PDF の文字の色に合わせたとき）
     線     { id, kind:"line|arrow", anchor, p1:{x,dy}, p2:{x,dy}, z, stroke, sw }
   図形の一覧そのものは Notes.Editor が持つ（本文と同じ「元に戻す」の履歴に入れるため）。
   位置の計算は「紙の上の座標（abs, px）」を中心に行い、保存するときだけ結びつけ先の単位に直す（getAbs / setAbs）。
   ===================================================================== */
window.Notes = window.Notes || {};
(function () {
  "use strict";
  const N = window.Notes;
  const E = () => N.Editor;
  const el = (...a) => N._el(...a);
  const esc = s => N._esc(s);
  const rid = () => "f" + Math.random().toString(16).slice(2, 11);
  const COLORS = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"];
  // 書体（ff）：名前 → [見出し, 画面の書体]。書体にない文字は標準の書体で出す（書き込みごと保存も同じ順で選ぶ）
  const FONTS = {
    mincho: ["ＭＳ 明朝", "'MS Mincho','ＭＳ 明朝'"], gothic: ["ＭＳ ゴシック", "'MS Gothic','ＭＳ ゴシック'"],
    yumincho: ["游明朝", "'Yu Mincho','游明朝'"], yugothic: ["游ゴシック", "'Yu Gothic','游ゴシック'"], meiryo: ["メイリオ", "Meiryo,'メイリオ'"],
    bizmincho: ["BIZ UD明朝", "'BIZ UDMincho'"], bizgothic: ["BIZ UDゴシック", "'BIZ UDGothic'"],
    century: ["Century", "Century"], times: ["Times New Roman", "'Times New Roman'"], arial: ["Arial", "Arial"],
  };
  const fontCss = ff => FONTS[ff] ? `${FONTS[ff][1]},var(--nb-font,sans-serif)` : "";
  const PT_SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 36];     // PDF の上の文字の大きさ（pt。Word と同じ並び）
  const TOOLS = [
    ["text", "✎", "文章"], ["select", "↖", "選択"], null,
    ["pen", "✒", "ペン"], ["eraser", "⌫", "消しゴム"], ["lasso", "⬚", "投げ縄"], null,
    ["rect", "▢", "四角"], ["ellipse", "◯", "丸"], ["triangle", "△", "三角"], ["line", "―", "線"], ["arrow", "➝", "矢印"], null,
    ["note", "🗒", "付箋"], ["textbox", "T", "テキスト"], ["icon", "★", "アイコン"],
  ];
  const SHAPE_TOOLS = new Set(["rect", "ellipse", "triangle", "line", "arrow", "note", "textbox"]);
  const BOX = new Set(["rect", "ellipse", "triangle", "note", "text", "ink", "icon"]);
  const LINE = new Set(["line", "arrow"]);
  const DEF = { rect: [160, 100], ellipse: [140, 100], triangle: [140, 120], note: [180, 150], text: [220, 40], line: [160, 0], arrow: [160, 0] };
  const EDGE = 4;

  // 拡張の窓口（notes_ink.js などが登録する）
  const kindRender = {};     // 種類 → (o, 表示の箱) => 中身の HTML（大きさが変わるたびに作り直す）
  const toolHandlers = {};   // 道具 → (pointerdown のイベント) => void
  const optionBars = {};     // 道具 → (入れ物) => void（道具バーの右側に設定を出す）
  const createHooks = [];    // PDF の上に付箋・テキストを置いたとき (o, { fx, fy：押した所（ページの幅を1とした割合）, small, frame }) => void

  let V = null;              // 今のページの部品 { scroll, page, title, blocks, tools, layer, ro }
  let mode = "text", editing = null;
  let sel = new Set();
  let tops = new Map(), order = [], colLeft = 0, LR = null;

  const list = () => E().freeList();
  const find = id => list().find(o => o.id === id);
  const one = () => sel.size === 1 ? find([...sel][0]) : null;

  /* ---------------- 色（名前 → テーマの色） ---------------- */
  // ink＝標準（テーマの文字色）、black・white＝テーマに関係なく真っ黒・真っ白
  const strokeCss = c => /^#[0-9a-f]{6}$/i.test(c || "") ? c : c === "none" ? "transparent" : c === "ink" || !c ? "var(--nb-text)" : c === "white" ? "#fff" : c === "black" ? "#000" : `var(--nb-c-${c})`;
  const fillCss = c => !c || c === "none" ? "transparent" : c === "paper" ? "var(--nb-paper)" : c === "white" ? "#fff" : `var(--nb-h-${c})`;
  const noteCss = c => `var(--nb-n-${COLORS.includes(c) ? c : "yellow"})`;

  /* ---------------- 結びつけ先の測定 ---------------- */
  function measure() {
    LR = V.layer.getBoundingClientRect();
    colLeft = V.blocks.getBoundingClientRect().left - LR.left;
    tops = new Map(); order = [];
    V.blocks.querySelectorAll(":scope > .nb-b").forEach(d => {
      if (d.hidden) return;
      const t = d.getBoundingClientRect().top - LR.top;
      tops.set(d.dataset.id, t); order.push([d.dataset.id, t]);
    });
    tops.set(null, V.page.getBoundingClientRect().top - LR.top);
  }
  function anchorTop(a) {
    if (a != null && tops.has(a)) return tops.get(a);
    if (a != null) {          // 行が見えない（消えた・折りたたみの中）ときは、手前の見える行
      const ids = E().getBlocks().map(b => b.id), i = ids.indexOf(a);
      for (let j = i - 1; j >= 0; j--) if (tops.has(ids[j])) return tops.get(ids[j]);
    }
    return tops.get(null);
  }
  function pdfPage(a) {        // "pdf:行id:頁" → ページの要素
    const [, bid, n] = a.split(":");
    const pg = V.blocks.querySelector(`.nb-b[data-id="${bid}"] .nb-pdf-page[data-n="${n}"]`);
    return pg && !pg.closest(".nb-b").hidden ? pg : null;
  }
  /* 結びつけ先の「原点と縮尺」。PDF のページがまだ描かれていなければ null（表示を待つ） */
  function frame(a) {
    if (typeof a === "string" && a.startsWith("pdf:")) {
      const pg = pdfPage(a); if (!pg) return null;
      const r = pg.getBoundingClientRect();
      return { ox: r.left - LR.left, oy: r.top - LR.top, s: r.width || 1, pdf: true };
    }
    return { ox: colLeft, oy: anchorTop(a), s: 1, pdf: false };
  }
  function anchorFor(y) {
    let best = null;
    for (const [id, t] of order) { if (t <= y + 1) best = id; else break; }
    return best;
  }
  function anchorAt(x, y) {    // その点が PDF のページの上なら、そのページ。そうでなければ真上の行
    for (const pg of V.blocks.querySelectorAll(".nb-pdf-page")) {
      if (pg.closest(".nb-b").hidden) continue;
      const r = pg.getBoundingClientRect(), l = r.left - LR.left, t = r.top - LR.top;
      if (x >= l && x <= l + r.width && y >= t && y <= t + r.height) return `pdf:${pg.closest(".nb-b").dataset.id}:${pg.dataset.n}`;
    }
    return anchorFor(y);
  }

  /* ---------------- 紙の上の座標（abs）との変換 ---------------- */
  function getAbs(o) {
    const f = frame(o.anchor); if (!f) return null;
    if (LINE.has(o.kind)) return { p1: { x: f.ox + o.p1.x * f.s, y: f.oy + o.p1.dy * f.s }, p2: { x: f.ox + o.p2.x * f.s, y: f.oy + o.p2.dy * f.s }, pdf: f.pdf };
    return { x: f.ox + o.x * f.s, y: f.oy + o.dy * f.s, w: o.w * f.s, h: o.h * f.s, pdf: f.pdf };
  }
  function setAbs(o, a) {
    const f = frame(o.anchor) || frame(null);
    const r = v => Math.round(v * 10000) / 10000;
    if (LINE.has(o.kind)) {
      o.p1 = { x: r((a.p1.x - f.ox) / f.s), dy: r((a.p1.y - f.oy) / f.s) };
      o.p2 = { x: r((a.p2.x - f.ox) / f.s), dy: r((a.p2.y - f.oy) / f.s) };
    } else {
      o.x = r((a.x - f.ox) / f.s); o.dy = r((a.y - f.oy) / f.s); o.w = r(a.w / f.s); o.h = r(a.h / f.s);
    }
  }
  const topLeftOf = a => a.p1 ? { x: Math.min(a.p1.x, a.p2.x), y: Math.min(a.p1.y, a.p2.y) } : { x: a.x, y: a.y };
  /* 置き場所が変わったら、結びつけ先を選び直す（見た目の位置は変えない）。pt を渡すとその点で選ぶ */
  function reanchor(o, pt) {
    const a = getAbs(o); if (!a) return;
    const p = pt || topLeftOf(a);
    o.anchor = anchorAt(p.x, p.y);
    setAbs(o, a);
  }
  /* 表示の箱：本文の行に結びついたものは、窓が狭いとき左端で止める（保存位置は変えない） */
  function boxOf(o) {
    const a = getAbs(o); if (!a) return null;
    if (a.p1) {
      let x1 = a.p1.x, x2 = a.p2.x;
      const push = a.pdf ? 0 : Math.max(0, EDGE - Math.min(x1, x2)); x1 += push; x2 += push;
      const y1 = a.p1.y, y2 = a.p2.y;
      return { x1, y1, x2, y2, l: Math.min(x1, x2), t: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
    }
    return { l: a.pdf ? a.x : Math.max(EDGE, a.x), t: a.y, w: a.w, h: a.h };
  }

  /* ---------------- 描く ---------------- */
  function shapeSvg(o) {
    const sw = o.sw || 2, st = strokeCss(o.stroke || "ink"), fi = fillCss(o.fill);
    const common = `fill="none" style="stroke:${st};fill:${fi};stroke-width:${sw}px" vector-effect="non-scaling-stroke"`;
    const inner = o.kind === "rect" ? `<rect x="0" y="0" width="100" height="100" rx="3" ${common}/>`
      : o.kind === "ellipse" ? `<ellipse cx="50" cy="50" rx="50" ry="50" ${common}/>`
      : `<polygon points="50,0 100,100 0,100" ${common}/>`;
    return `<svg viewBox="-1 -1 102 102" preserveAspectRatio="none" width="100%" height="100%" overflow="visible">${inner}</svg>`;
  }
  function lineSvg(o, b) {
    const P = 14 + (o.sw || 2) * 2, sw = o.sw || 2, st = strokeCss(o.stroke || "ink");
    const ax = b.x1 - b.l + P, ay = b.y1 - b.t + P, bx = b.x2 - b.l + P, by = b.y2 - b.t + P;
    let head = "", ex = bx, ey = by;
    if (o.kind === "arrow") {
      const len = Math.hypot(bx - ax, by - ay) || 1, ux = (bx - ax) / len, uy = (by - ay) / len;
      const hl = 9 + sw * 2.2, hw = hl * 0.55;
      ex = bx - ux * hl * 0.8; ey = by - uy * hl * 0.8;
      head = `<polygon points="${bx},${by} ${bx - ux * hl - uy * hw},${by - uy * hl + ux * hw} ${bx - ux * hl + uy * hw},${by - uy * hl - ux * hw}" style="fill:${st}"/>`;
    }
    return { P, svg: `<svg width="${b.w + P * 2}" height="${b.h + P * 2}"><line x1="${ax}" y1="${ay}" x2="${ex}" y2="${ey}" style="stroke:${st};stroke-width:${sw}px;stroke-linecap:round"/>` +
      `<line class="hit" x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" style="stroke:transparent;stroke-width:${Math.max(14, sw + 10)}px"/>${head}</svg>` };
  }
  const textHtml = t => esc(t || "").replace(/\n/g, "<br>");

  function build(o) {
    const d = el("div", "nb-fo k-" + o.kind); d.dataset.id = o.id;
    if (LINE.has(o.kind) || kindRender[o.kind]) return d;
    if (o.kind === "note") {
      d.style.background = noteCss(o.fill);
      d.innerHTML = `<div class="nb-fotx" style="font-size:${o.fs || 14}px;${o.ff ? `font-family:${fontCss(o.ff)};` : ""}color:${o.tc && o.tc !== "ink" ? strokeCss(o.tc) : "#3a3200"}">${textHtml(o.text)}</div>`;
    } else if (o.kind === "text") {
      d.innerHTML = `<div class="nb-fotx" style="font-size:${o.fs || 16}px;${o.ff ? `font-family:${fontCss(o.ff)};` : ""}color:${strokeCss(o.tc || "ink")}">${textHtml(o.text)}</div>`;
    } else d.innerHTML = shapeSvg(o);
    return d;
  }
  function place(d, o) {
    const b = boxOf(o);
    if (!b) { d.style.display = "none"; return null; }
    d.style.display = "";
    if (LINE.has(o.kind)) {
      const { P, svg } = lineSvg(o, b);
      d.innerHTML = svg;
      Object.assign(d.style, { left: b.l - P + "px", top: b.t - P + "px", width: b.w + P * 2 + "px", height: b.h + P * 2 + "px", zIndex: 10 + (o.z || 0), transform: "" });
      return b;
    }
    Object.assign(d.style, { left: b.l + "px", top: b.t + "px", width: b.w + "px", zIndex: 10 + (o.z || 0), transform: o.rot ? `rotate(${o.rot}deg)` : "" });
    d.style.height = o.kind === "text" ? "auto" : b.h + "px";
    d.style.minHeight = o.kind === "text" ? b.h + "px" : "";
    if (kindRender[o.kind]) d.innerHTML = kindRender[o.kind](o, b);
    if (o.fsr && (o.kind === "note" || o.kind === "text")) {      // PDF の上の文字は、ページの幅に合わせた大きさ
      const f = frame(o.anchor), tx = d.querySelector(".nb-fotx");
      if (f && f.pdf && tx) tx.style.fontSize = o.fsr * f.s + "px";
    }
    return b;
  }
  const elOf = id => V.layer.querySelector(`.nb-fo[data-id="${id}"]`);

  /* 全部を描き直す（ページを開いたとき・元に戻したとき・行やPDFの位置が変わったとき） */
  function render() {
    if (!V || !V.layer.isConnected) return;
    measure();
    const keepEdit = editing && find(editing);
    V.layer.querySelectorAll(".nb-fo").forEach(n => { if (!keepEdit || n.dataset.id !== editing) n.remove(); });
    let bottom = 0;
    [...list()].sort((a, b) => (a.z || 0) - (b.z || 0)).forEach(o => {
      let d = keepEdit && o.id === editing ? elOf(o.id) : null;
      if (!d) { d = build(o); V.layer.appendChild(d); }
      const b = place(d, o);
      if (b) bottom = Math.max(bottom, b.t + (o.kind === "text" ? d.offsetHeight : b.h));
    });
    [...sel].forEach(id => { if (!find(id)) sel.delete(id); });
    drawSel();
    grow(bottom);
  }
  function grow(bottom) {      // 紙を伸ばす：一番下の図形より 240px 下まで
    const pageTop = tops.get(null);
    const need = Math.max(0, bottom - pageTop + 240);
    const cur = parseFloat(V.page.style.minHeight) || 0;
    if (Math.abs(cur - need) > 2) V.page.style.minHeight = need ? need + "px" : "";
    V.layer.style.height = Math.max(V.page.offsetTop + V.page.offsetHeight, bottom + 240) + "px";
  }
  function relayout() { if (V && V.layer.isConnected) render(); }

  /* ---------------- 選択の枠とつまみ ---------------- */
  function drawSel() {
    V.layer.querySelectorAll(".nb-fsel").forEach(n => n.remove());
    V.layer.querySelectorAll(".nb-fo.sel").forEach(n => n.classList.remove("sel"));
    if (!sel.size) return;
    sel.forEach(id => { const d = elOf(id); if (d) d.classList.add("sel"); });
    const s = el("div", "nb-fsel");
    const o = one();
    if (o) {
      s.dataset.id = o.id;
      const d = elOf(o.id), b = boxOf(o); if (!b) return;
      if (LINE.has(o.kind)) {
        s.classList.add("ln");
        Object.assign(s.style, { left: "0px", top: "0px", width: "0px", height: "0px" });
        [["p1", b.x1, b.y1], ["p2", b.x2, b.y2]].forEach(([k, x, y]) => {
          const h = el("span", "nb-fh pt"); h.dataset.h = k; h.style.left = x - 6 + "px"; h.style.top = y - 6 + "px"; s.appendChild(h);
        });
      } else {
        const hh = o.kind === "text" && d ? d.offsetHeight : b.h;
        Object.assign(s.style, { left: b.l + "px", top: b.t + "px", width: b.w + "px", height: hh + "px", transform: o.rot ? `rotate(${o.rot}deg)` : "" });
        ["nw", "n", "ne", "e", "se", "s", "sw", "w"].forEach(k => { const h = el("span", "nb-fh " + k); h.dataset.h = k; s.appendChild(h); });
        const r = el("span", "nb-fh rot"); r.dataset.h = "rot"; r.title = "回転（Shift で15°刻み）"; s.appendChild(r);
      }
    } else {
      // 複数：全体を囲む点線の枠（つまみなし）
      let l = Infinity, t = Infinity, rr = -Infinity, bb = -Infinity;
      sel.forEach(id => { const d = elOf(id); if (!d || d.style.display === "none") return; const r = d.getBoundingClientRect(); l = Math.min(l, r.left - LR.left); t = Math.min(t, r.top - LR.top); rr = Math.max(rr, r.right - LR.left); bb = Math.max(bb, r.bottom - LR.top); });
      if (l === Infinity) return;
      s.classList.add("multi");
      Object.assign(s.style, { left: l + "px", top: t + "px", width: rr - l + "px", height: bb - t + "px" });
      s.appendChild(el("span", "nb-fcount", `${sel.size}個`));
    }
    V.layer.appendChild(s);
  }
  function select(ids, add) {
    ids = Array.isArray(ids) ? ids : ids ? [ids] : [];
    if (!add) sel = new Set();
    ids.forEach(id => sel.add(id));
    if (editing && !sel.has(editing)) stopEdit();
    drawSel();
  }

  /* ---------------- 道具バー ---------------- */
  function drawTools() {
    if (!V || !V.tools) return;
    V.tools.innerHTML = "";
    TOOLS.forEach(t => {
      if (!t) { V.tools.appendChild(el("span", "sep")); return; }
      if (!SHAPE_TOOLS.has(t[0]) && !["text", "select"].includes(t[0]) && !toolHandlers[t[0]]) return;   // 拡張がない道具は出さない
      const b = el("button", "nb-tool" + (mode === t[0] ? " on" : ""), `<span class="i">${t[1]}</span>${t[2]}`);
      b.dataset.mode = t[0]; b.title = t[2];
      b.onclick = () => setMode(t[0]);
      V.tools.appendChild(b);
    });
    const right = el("div", "nb-tool-opts");
    if (optionBars[mode]) optionBars[mode](right);
    else right.appendChild(el("span", "nb-tool-hint", { text: "", select: "押して選ぶ（Shift で追加）・ダブルクリックで文字" }[mode] ?? "紙の上をドラッグして置く（クリックでも置ける）"));
    V.tools.appendChild(right);
  }
  function setMode(m) {
    mode = m;
    if (m === "text") { sel = new Set(); stopEdit(); }
    if (V) { V.layer.dataset.mode = m; drawTools(); drawSel(); }
  }

  /* ---------------- 置く（ドラッグで大きさを決める） ---------------- */
  function startCreate(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    const lr = V.layer.getBoundingClientRect();
    const sx = e.clientX - lr.left, sy = e.clientY - lr.top;
    const kind = mode === "textbox" ? "text" : mode;
    const ghost = el("div", "nb-fghost" + (LINE.has(kind) ? " line" : ""));
    V.layer.appendChild(ghost);
    let ex = sx, ey = sy;
    const mv = ev => {
      ex = ev.clientX - lr.left; ey = ev.clientY - lr.top;
      if (LINE.has(kind)) {
        const len = Math.hypot(ex - sx, ey - sy), ang = Math.atan2(ey - sy, ex - sx) * 180 / Math.PI;
        Object.assign(ghost.style, { left: sx + "px", top: sy + "px", width: len + "px", transform: `rotate(${ang}deg)` });
      } else Object.assign(ghost.style, { left: Math.min(sx, ex) + "px", top: Math.min(sy, ey) + "px", width: Math.abs(ex - sx) + "px", height: Math.abs(ey - sy) + "px" });
    };
    const up = () => {
      document.removeEventListener("pointermove", mv); document.removeEventListener("pointerup", up);
      ghost.remove();
      create(kind, sx, sy, ex, ey);
    };
    document.addEventListener("pointermove", mv); document.addEventListener("pointerup", up);
  }
  /* 図形を1つ足す（abs で形を渡す）。notes_ink.js からも使う */
  function add(o, abs, anchorPt) {
    measure();
    o.id = o.id || rid();
    o.z = Math.max(0, ...list().map(x => x.z || 0)) + 1;
    o.anchor = null;
    if (!LINE.has(o.kind)) o.rot = o.rot || 0;
    setAbs(o, abs);
    reanchor(o, anchorPt);
    list().push(o);
    return o;
  }
  function create(kind, sx, sy, ex, ey) {
    E().settle();
    const small = Math.hypot(ex - sx, ey - sy) < 8;
    const [dw, dh] = DEF[kind];
    const o = { kind };
    let abs;
    if (LINE.has(kind)) {
      if (small) { ex = sx + dw; ey = sy; }
      abs = { p1: { x: sx, y: sy }, p2: { x: ex, y: ey } };
      o.stroke = "ink"; o.sw = 2;
    } else {
      let l = Math.min(sx, ex), t = Math.min(sy, ey), w = Math.abs(ex - sx), h = Math.abs(ey - sy);
      if (small || w < 12 || h < 12) { w = dw; h = dh; l = sx - (small ? w / 2 : 0); t = sy - (small ? h / 2 : 0); }
      abs = { x: l, y: t, w, h };
      if (kind === "note") { o.fill = "yellow"; o.fs = 14; o.text = ""; }
      else if (kind === "text") { o.tc = "ink"; o.fs = 16; o.text = ""; }
      else { o.stroke = "ink"; o.fill = "none"; o.sw = 2; }
    }
    add(o, abs, { x: sx, y: sy });
    const f = o.fs && frame(o.anchor);
    if (f && f.pdf) {          // PDF の上では、文字の大きさもページの幅に対する割合で覚える（拡大縮小についていく）
      o.fsr = Math.round(o.fs / f.s * 100000) / 100000;
      createHooks.forEach(h => h(o, { fx: (sx - f.ox) / f.s, fy: (sy - f.oy) / f.s, small, frame: f }));   // pdf_font.js：近くの文字に合わせる
    }
    E().changed();
    setMode("select");
    sel = new Set([o.id]);
    render();
    if (kind === "note" || kind === "text") startEdit(o.id);
  }

  /* ---------------- 動かす（選んでいるものをまとめて）・伸縮・回転 ---------------- */
  function startMove(e, id) {
    const o = find(id); if (!o || e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    if (document.activeElement && document.activeElement.blur && editing !== id) document.activeElement.blur();
    if (e.shiftKey) { if (sel.has(id)) sel.delete(id); else sel.add(id); drawSel(); return; }
    if (!sel.has(id)) select(id);
    const items = [...sel].map(find).filter(Boolean).map(x => ({ o: x, a: getAbs(x) })).filter(x => x.a);
    const sx = e.clientX, sy = e.clientY;
    let moved = false, guide = null;
    const mv = ev => {
      let dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (!moved && Math.hypot(dx, dy) < 3) return;
      if (!moved) { moved = true; E().settle(); guide = N.Guide ? N.Guide.begin(items.map(x => x.o)) : null; }
      if (guide) ({ dx, dy } = guide.move(dx, dy, ev.altKey));   // 整列ガイド（notes_guide.js）
      items.forEach(({ o, a }) => {
        const n = a.p1 ? { p1: { x: a.p1.x + dx, y: a.p1.y + dy }, p2: { x: a.p2.x + dx, y: a.p2.y + dy } } : { x: a.x + dx, y: a.y + dy, w: a.w, h: a.h };
        setAbs(o, n); const d = elOf(o.id); if (d) place(d, o);
      });
      drawSel();
    };
    const up = () => {
      document.removeEventListener("pointermove", mv); document.removeEventListener("pointerup", up);
      if (guide) guide.end();
      if (moved) { items.forEach(({ o }) => reanchor(o)); E().changed(); render(); }
    };
    document.addEventListener("pointermove", mv); document.addEventListener("pointerup", up);
  }
  function startHandle(e, id, h) {
    const o = find(id); if (!o) return;
    e.preventDefault(); e.stopPropagation();
    E().settle();
    measure();                 // スクロールした後でも、回転の中心がずれないように測り直す
    const a0 = getAbs(o); if (!a0) return;
    const d = elOf(id);
    const b0 = boxOf(o);
    const cx = b0.l + b0.w / 2, cy = b0.t + (o.kind === "text" && d ? d.offsetHeight : b0.h) / 2;
    const sx = e.clientX, sy = e.clientY;
    const G = N.Guide, pt = ev => ({ x: ev.clientX - LR.left, y: ev.clientY - LR.top });   // 角度の札とガイド（notes_guide.js）
    const rz = G && G.beginResize && !LINE.has(o.kind) && h !== "rot" ? G.beginResize(o, h, a0, d) : null;   // 伸縮のガイド
    const mv = ev => {
      if (LINE.has(o.kind)) {
        const n = { p1: { ...a0.p1 }, p2: { ...a0.p2 } }, k = h === "p1" ? "p2" : "p1";
        let p = { x: a0[h].x + ev.clientX - sx, y: a0[h].y + ev.clientY - sy };
        if (G) {
          const r = G.snapLineEnd(a0[k], p, ev.altKey); p = r.p;
          const deg = h === "p2" ? r.deg : r.deg + 180;     // 表示は p1 → p2 の向き
          G.showAngle(deg, pt(ev), { cx: (a0[k].x + p.x) / 2, cy: (a0[k].y + p.y) / 2, len: Math.hypot(p.x - a0[k].x, p.y - a0[k].y), deg: r.deg }, ev.altKey);
        }
        n[h] = p;
        setAbs(o, n);
      } else if (h === "rot") {
        let ang = Math.atan2(ev.clientY - LR.top - cy, ev.clientX - LR.left - cx) * 180 / Math.PI + 90;
        if (ev.shiftKey) ang = Math.round(ang / 15) * 15;
        else if (G) ang = G.snapAngle(ang, ev.altKey);
        o.rot = Math.round(((ang % 360) + 540) % 360 - 180);
        if (G) G.showAngle(o.rot, pt(ev), { cx, cy, len: Math.max(b0.w, b0.h), deg: o.rot }, ev.altKey);
      } else {
        // 回転していても、図形の向きに沿って伸び縮みさせる（反対側の辺は動かさない）
        const r = (o.rot || 0) * Math.PI / 180, cos = Math.cos(r), sin = Math.sin(r);
        const dx = ev.clientX - sx, dy = ev.clientY - sy;
        const lx = dx * cos + dy * sin, ly = -dx * sin + dy * cos;
        const fx = h.includes("e") ? 1 : h.includes("w") ? -1 : 0, fy = h.includes("s") ? 1 : h.startsWith("n") ? -1 : 0;
        let w = Math.max(12, a0.w + fx * lx), hh = Math.max(12, a0.h + fy * ly);
        const keep = (ev.shiftKey || o.kind === "ink") && fx && fy;
        if (keep) { const k = Math.max(w / a0.w, hh / a0.h); w = a0.w * k; hh = a0.h * k; }
        if (rz) ({ w, h: hh } = rz.move(w, hh, keep, ev.altKey, pt(ev)));
        const ox = fx * (w - a0.w) / 2, oy = fy * (hh - a0.h) / 2;
        const ccx = a0.x + a0.w / 2 + ox * cos - oy * sin, ccy = a0.y + a0.h / 2 + ox * sin + oy * cos;
        setAbs(o, { x: ccx - w / 2, y: ccy - hh / 2, w, h: hh });
      }
      if (d) place(d, o); drawSel();
    };
    const up = () => {
      document.removeEventListener("pointermove", mv); document.removeEventListener("pointerup", up);
      if (rz) rz.end(); else if (G) G.clear();
      reanchor(o); E().changed(); render();
    };
    document.addEventListener("pointermove", mv); document.addEventListener("pointerup", up);
  }

  /* ---------------- 文字を入れる（付箋・テキスト） ---------------- */
  function startEdit(id) {
    const o = find(id); if (!o || !(o.kind === "note" || o.kind === "text")) return;
    const d = elOf(id); if (!d) return;
    const tx = d.querySelector(".nb-fotx");
    select(id); editing = id;
    d.classList.add("editing");
    tx.contentEditable = "true"; tx.spellcheck = false;
    tx.focus();
    const r = document.createRange(); r.selectNodeContents(tx); r.collapse(false);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    E().settle();
  }
  function stopEdit() {
    if (!editing) return;
    const id = editing; editing = null;
    const d = V && elOf(id);
    if (d) { d.classList.remove("editing"); const tx = d.querySelector(".nb-fotx"); if (tx) { tx.contentEditable = "false"; tx.blur(); } }
    E().settle();
    relayout();
  }

  /* ---------------- 右クリックメニュー ---------------- */
  function menu(e, id) {
    e.preventDefault(); e.stopPropagation();
    const o = find(id); if (!o) return;
    if (!sel.has(id)) select(id);
    const many = sel.size > 1, targets = [...sel].map(find).filter(Boolean);
    const pin = el("div"); Object.assign(pin.style, { position: "fixed", left: e.clientX + "px", top: e.clientY + "px", width: "1px", height: "1px" });
    document.body.appendChild(pin);
    const commit = fn => { E().settle(); targets.forEach(fn); E().changed(); render(); };
    N._openPop(pin, p => {
      p.classList.add("nb-fmenu");
      const grid = (title, opts, cur, fn) => {
        p.insertAdjacentHTML("beforeend", `<div class="cat">${title}</div>`);
        const g = el("div", "nb-cgrid");
        opts.forEach(([k, label, css]) => {
          const b = el("button", "nb-csw" + (k === cur ? " cur" : ""), `<span style="display:block;width:18px;height:18px;margin:auto;border-radius:50%;${css}"></span>`);
          b.title = label; b.onclick = () => commit(oo => fn(oo, k));
          g.appendChild(b);
        });
        p.appendChild(g);
      };
      const inkC = [["ink", "標準", "background:var(--nb-text)"], ["black", "黒", "background:#000;box-shadow:0 0 0 1px var(--nb-line)"]].concat(COLORS.map(k => [k, k, `background:${strokeCss(k)}`]));
      if (many) {
        if (targets.some(t => t.kind !== "note" && t.kind !== "text")) grid("線の色（まとめて）", inkC, null, (oo, k) => { if (oo.kind !== "note" && oo.kind !== "text") oo.stroke = k; });
      } else {
        if (o.kind === "note") grid("付箋の色", COLORS.map(k => [k, k, `background:${noteCss(k)};border:1px solid var(--nb-line)`]), o.fill || "yellow", (oo, k) => { oo.fill = k; });
        if (o.kind === "text" || o.kind === "note") grid("文字の色", inkC, o.tc || "ink", (oo, k) => { oo.tc = k; });
        if (!["note", "text"].includes(o.kind)) grid("線の色", inkC, o.stroke || "ink", (oo, k) => { oo.stroke = k; });
        if (["rect", "ellipse", "triangle"].includes(o.kind)) grid("塗り", [["none", "なし", "background:transparent;border:1px dashed var(--nb-sub)"], ["paper", "紙の色", "background:var(--nb-paper);border:1px solid var(--nb-line)"]].concat(COLORS.map(k => [k, k, `background:${fillCss(k)};border:1px solid var(--nb-line)`])), o.fill || "none", (oo, k) => { oo.fill = k; });
        if (!["note", "text"].includes(o.kind)) {
          p.insertAdjacentHTML("beforeend", `<div class="cat">線の太さ</div>`);
          const row = el("div", "nb-swrow");
          [1, 2, 3, 5, 8].forEach(w => { const b = el("button", "nb-csw" + ((o.sw || 2) === w ? " cur" : ""), `<span style="display:block;margin:auto;width:20px;height:${w}px;background:var(--nb-text);border-radius:${w}px"></span>`); b.onclick = () => commit(oo => { oo.sw = w; }); row.appendChild(b); });
          p.appendChild(row);
        }
        if (o.kind === "text" || o.kind === "note") {
          // 書体（Word と同じく一覧から選ぶ）
          p.insertAdjacentHTML("beforeend", `<div class="cat">書体</div>`);
          const fs = el("select", "nb-fontsel");
          fs.innerHTML = `<option value="">標準</option>` + Object.entries(FONTS).map(([k, v]) => `<option value="${k}"${o.ff === k ? " selected" : ""} style="font-family:${v[1]}">${v[0]}</option>`).join("");
          fs.onchange = () => commit(oo => { if (fs.value) oo.ff = fs.value; else delete oo.ff; });
          p.appendChild(fs);
          // 大きさ：PDF の上で、ページの大きさ（pt）が分かるときは pt で選ぶ（拡大縮小についていく）
          const f = frame(o.anchor), pg = f && f.pdf ? pdfPage(o.anchor) : null, pw = pg ? +pg.dataset.pw || 0 : 0;
          if (pw) {
            p.insertAdjacentHTML("beforeend", `<div class="cat">文字の大きさ（pt）</div>`);
            const ss = el("select", "nb-fontsel"), now = o.fsr ? Math.round(o.fsr * pw * 10) / 10 : 0;
            const sizes = PT_SIZES.includes(now) || !now ? PT_SIZES : PT_SIZES.concat(now).sort((a, b) => a - b);
            ss.innerHTML = sizes.map(v => `<option value="${v}"${v === now ? " selected" : ""}>${v}</option>`).join("");
            ss.onchange = () => commit(oo => { oo.fsr = Math.round(+ss.value / pw * 100000) / 100000; });
            p.appendChild(ss);
          } else {
            p.insertAdjacentHTML("beforeend", `<div class="cat">文字の大きさ</div>`);
            const row = el("div", "nb-swrow");
            const cur = o.fsr && f && f.pdf ? Math.round(o.fsr * f.s) : (o.fs || 16);
            [12, 14, 16, 20, 28, 40].forEach(v => { const b = el("button", "nb-csw" + (cur === v ? " cur" : ""), `<span style="font-size:${Math.min(v, 20)}px">${v}</span>`); b.onclick = () => commit(oo => { oo.fs = v; if (f && f.pdf) oo.fsr = Math.round(v / f.s * 100000) / 100000; }); row.appendChild(b); });
            p.appendChild(row);
          }
        }
      }
      p.appendChild(el("hr"));
      const item = (ic, label, fn, cls) => { const it = el("button", "it" + (cls ? " " + cls : ""), `<span class="ic">${ic}</span><div>${label}</div>`); it.onclick = () => { N._closePop(); fn(); }; p.appendChild(it); };
      if (!many && (o.kind === "note" || o.kind === "text")) item("✎", "文字を書く", () => startEdit(id));
      item("⤒", "最前面へ", () => zorder("front"));
      if (!many) { item("↑", "前面へ", () => zorder("up")); item("↓", "背面へ", () => zorder("down")); }
      item("⤓", "最背面へ", () => zorder("back"));
      p.appendChild(el("hr"));
      item("⧉", "複製（Ctrl+D）", duplicate);
      item("🗑", "削除（Delete）", removeSel, "danger");
    });
    setTimeout(() => pin.remove(), 0);
  }
  function zorder(how) {
    E().settle();
    const arr = [...list()].sort((a, b) => (a.z || 0) - (b.z || 0));
    const picked = arr.filter(o => sel.has(o.id)), rest = arr.filter(o => !sel.has(o.id));
    let res;
    if (how === "front") res = rest.concat(picked);
    else if (how === "back") res = picked.concat(rest);
    else {
      res = arr.slice(); const i = res.indexOf(picked[0]), j = how === "up" ? i + 1 : i - 1;
      if (j < 0 || j >= res.length) return;
      [res[i], res[j]] = [res[j], res[i]];
    }
    res.forEach((o, k) => { o.z = k + 1; });
    E().changed(); render();
  }
  function duplicate() {
    if (!sel.size) return;
    E().settle();
    let z = Math.max(...list().map(x => x.z || 0));
    const made = [];
    [...sel].map(find).filter(Boolean).forEach(o => {
      const a = getAbs(o); if (!a) return;
      const c = JSON.parse(JSON.stringify(o)); c.id = rid(); c.z = ++z;
      setAbs(c, a.p1 ? { p1: { x: a.p1.x + 20, y: a.p1.y + 20 }, p2: { x: a.p2.x + 20, y: a.p2.y + 20 } } : { x: a.x + 20, y: a.y + 20, w: a.w, h: a.h });
      list().push(c); made.push(c.id);
    });
    E().changed(); sel = new Set(made); render();
  }
  function removeSel() {
    if (!sel.size) return;
    E().settle();
    const arr = list();
    for (let i = arr.length - 1; i >= 0; i--) if (sel.has(arr[i].id)) arr.splice(i, 1);
    if (editing && sel.has(editing)) editing = null;
    sel = new Set();
    E().changed(); render();
  }
  function nudge(dx, dy) {
    if (!sel.size) return;
    E().settle();
    [...sel].map(find).filter(Boolean).forEach(o => {
      const a = getAbs(o); if (!a) return;
      setAbs(o, a.p1 ? { p1: { x: a.p1.x + dx, y: a.p1.y + dy }, p2: { x: a.p2.x + dx, y: a.p2.y + dy } } : { x: a.x + dx, y: a.y + dy, w: a.w, h: a.h });
      reanchor(o);
    });
    E().changed(); render();
  }

  /* ---------------- イベント ---------------- */
  function bindLayer(layer) {
    layer.addEventListener("pointerdown", e => {
      if (e.target.closest(".nb-fh")) { const s = e.target.closest(".nb-fsel"); startHandle(e, s.dataset.id, e.target.dataset.h); return; }
      if (toolHandlers[mode]) { toolHandlers[mode](e); return; }
      const fo = e.target.closest(".nb-fo");
      if (SHAPE_TOOLS.has(mode) && !(fo && editing === fo.dataset.id)) { startCreate(e); return; }
      if (!fo) { if (editing) stopEdit(); if (sel.size) { sel = new Set(); drawSel(); } return; }   // 空いている所を押したら選択を外す
      if (editing === fo.dataset.id && e.target.closest(".nb-fotx")) return;   // 文字を書いている最中は、ふつうにカーソル操作
      const o = find(fo.dataset.id);
      if (o && LINE.has(o.kind) && !e.target.closest(".hit,polygon")) return;
      startMove(e, fo.dataset.id);
    });
    layer.addEventListener("dblclick", e => { const fo = e.target.closest(".nb-fo"); if (fo && mode === "select") startEdit(fo.dataset.id); });
    layer.addEventListener("contextmenu", e => { const fo = e.target.closest(".nb-fo"); if (fo && mode === "select") menu(e, fo.dataset.id); });
    layer.addEventListener("input", e => {
      const fo = e.target.closest(".nb-fo"); if (!fo || editing !== fo.dataset.id) return;
      const o = find(fo.dataset.id); o.text = e.target.innerText.replace(/\n$/, "");
      E().changed("type");
      if (o.kind === "text") drawSel();
    });
    layer.addEventListener("paste", e => {
      if (!e.target.closest(".nb-fotx")) return;
      e.preventDefault(); document.execCommand("insertText", false, e.clipboardData.getData("text/plain") || "");
    });
  }
  document.addEventListener("pointerdown", e => {
    if (!V || !V.layer.isConnected) return;
    if (e.target.closest && e.target.closest(".nb-free,.nb-tools,.nb-pop")) return;
    if (editing) stopEdit();
    if (sel.size) { sel = new Set(); drawSel(); }
  }, true);
  document.addEventListener("keydown", e => {
    if (!V || !V.layer.isConnected || V.layer.offsetParent === null) return;
    if (editing) { if (e.key === "Escape") { e.preventDefault(); stopEdit(); } return; }
    const a = document.activeElement;
    if (a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return;
    if (e.key === "Escape" && mode !== "text") { e.preventDefault(); if (sel.size) { sel = new Set(); drawSel(); } else setMode("text"); return; }
    if (!sel.size) return;
    const k = e.key.toLowerCase();
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); removeSel(); return; }
    if ((e.ctrlKey || e.metaKey) && k === "d") { e.preventDefault(); duplicate(); return; }
    if (e.key === "Enter") { const o = one(); if (o && (o.kind === "note" || o.kind === "text")) { e.preventDefault(); startEdit(o.id); } return; }
    const step = e.shiftKey ? 10 : 1, mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (mv) { e.preventDefault(); nudge(mv[0], mv[1]); }
  });
  addEventListener("resize", () => relayout());

  /* ---------------- ページごとの準備 ---------------- */
  function mount(v) {
    if (V && V.ro) V.ro.disconnect();
    editing = null; sel = new Set();
    const layer = el("div", "nb-free");
    v.scroll.classList.add("nb-hasfree");
    v.scroll.appendChild(layer);
    V = Object.assign({}, v, { layer });
    layer.dataset.mode = mode;
    bindLayer(layer);
    drawTools();
    V.ro = new ResizeObserver(() => relayout());     // 文章が増減して行の位置が変わったら、図形も置き直す
    V.ro.observe(v.blocks); V.ro.observe(v.title); V.ro.observe(v.scroll);
    render();
  }

  if (N.Editor) N.Editor.hooks.afterRender.push(() => relayout());
  N.Free = {
    mount, render: relayout, setMode, select,
    get mode() { return mode; }, get selected() { return [...sel][0] || null; }, get selection() { return [...sel]; },
    // notes_ink.js などが使う窓口
    _: { list, find, getAbs, setAbs, reanchor, boxOf, add, elOf, measure, strokeCss, fillCss, noteCss, lineSvg, layerRect: () => (measure(), LR), parts: () => V,
         get layer() { return V && V.layer; }, kindRender, toolHandlers, optionBars, createHooks, drawTools, COLORS, FONTS, fontCss, frame, pdfPage },
  };
})();
