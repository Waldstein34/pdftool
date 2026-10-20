/* =====================================================================
   pdf_markup.js ― 文字に沿った蛍光ペン・下線・取り消し線（Xodo・Acrobat と同じ「文字を選ぶ → その場のメニュー」）

   ・PDF の文字を選ぶと、選んだ所のすぐ下に小さなメニューが出る：蛍光ペン・下線・取り消し線・コピー
     ボタンの下の帯が今の色。「▾」で色を選ぶ（Word と同じ）。色は種類ごとに覚える（蛍光ペンは黄、下線・取り消し線は赤から）
   ・付けたあとの色は、選択の道具で印を右クリック →「線の色」で変える（ノートの右クリックのメニュー。Acrobat と同じ）
   ・印は、選んだ範囲を1行ずつの四角にして、書き込みの種類「mark」として残す
       { kind:"mark", style:"hl"|"ul"|"st", stroke:色の名前, anchor:"pdf:doc:頁", x, dy, w, h（ページの幅を1とした割合） }
     ほかの書き込みと同じく、選ぶ・動かす・消す・元に戻す・書き込みごと保存・印刷・変換に入る
     （描き方 kindRender.mark は notes_pdfout.js の焼き付けでもそのまま使われる）
   ・最後に使った色と種類を覚える（ブラウザに保存。使う人ごとの好み）
   ===================================================================== */
(() => {
  "use strict";
  const P = window.PdfTool, N = window.Notes;
  if (!P || !P.hooks || !N || !N.Free || !N.Editor) return;
  const S = P._S, E = N.Editor, F = N.Free._;
  const KEY = "pdftool.markup";
  // 蛍光ペンの色（明るい色を薄く重ねる）と、下線・取り消し線の色（はっきりした色）。名前はノートの色の名前と同じ
  const HL = { yellow: "#ffd400", green: "#5ee07a", blue: "#5cb8ff", pink: "#ff7ec4", orange: "#ffa53d", purple: "#c49bff",
    red: "#ff6b6b", brown: "#d9a77a", gray: "#bdbdbd", black: "#8a8a8a", ink: "#ffd400" };
  const LINE = { red: "#e03131", blue: "#1f6fe0", green: "#1f9d55", black: "#000000", orange: "#e8590c", purple: "#7b3fe4",
    pink: "#d6338a", yellow: "#d4a300", brown: "#8b5a2b", gray: "#6b6b6b", ink: "#000000" };
  const PICK = { hl: ["yellow", "green", "blue", "pink", "orange", "purple", "red", "brown", "gray"],
    ul: ["red", "blue", "green", "black", "orange", "purple", "pink", "yellow", "brown", "gray"] };
  PICK.st = PICK.ul;
  const NAMES = { hl: "蛍光ペン", ul: "下線", st: "取り消し線" };
  const LS = {
    get() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } },
    set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* 覚えられなくても使える */ } },
  };
  let pref = Object.assign({ hl: "yellow", ul: "red", st: "red" }, LS.get());
  delete pref.color; delete pref.style;     // 前の形の覚え方は使わない

  /* ---------------- 描き方（画面と焼き付けで同じ） ---------------- */
  F.kindRender.mark = (o, b) => {
    const c = o.stroke in HL ? o.stroke : (o.style === "hl" ? "yellow" : "red"), w = Math.max(1, b.w), h = Math.max(1, b.h);
    let shape;
    if (o.style === "ul") { const t = Math.max(1, h * 0.07); shape = `<rect x="0" y="${(h * 0.9 - t).toFixed(2)}" width="${w}" height="${t.toFixed(2)}" fill="${LINE[c]}"/>`; }
    else if (o.style === "st") { const t = Math.max(1, h * 0.07); shape = `<rect x="0" y="${(h * 0.52 - t / 2).toFixed(2)}" width="${w}" height="${t.toFixed(2)}" fill="${LINE[c]}"/>`; }
    else shape = `<rect x="0" y="0" width="${w}" height="${h}" fill="${HL[c]}" fill-opacity="0.38"/>`;
    return `<svg width="${w}" height="${h}" overflow="visible">${shape}</svg>`;
  };

  /* ---------------- 印を付ける ---------------- */
  function mark(style, color) {
    const pages = P.selLines();
    if (!pages.length) return;
    E.settle();
    const list = E.freeList();
    let z = Math.max(0, ...list.map(o => o.z || 0));
    const r4 = v => Math.round(v * 10000) / 10000;
    for (const pg of pages) {
      for (const L of pg.lines) {
        list.push({ id: "m" + Math.random().toString(16).slice(2, 11), kind: "mark", style, stroke: color, anchor: `pdf:doc:${pg.n}`,
          x: r4(L.l / pg.width), dy: r4(L.t / pg.width), w: r4((L.r - L.l) / pg.width), h: r4((L.b - L.t) / pg.width), rot: 0, z: ++z });
      }
    }
    E.changed();
    N.Free.render();
    pref[style] = color; LS.set(pref);
    getSelection().removeAllRanges();
    hide();
  }
  P.mark = mark;

  /* ---------------- 選んだ所のメニュー（Word 風：ボタン＋今の色の帯＋▾で色） ---------------- */
  let bar = null, openPal = null;
  function hide() { if (bar) { bar.hidden = true; closePal(); } }
  function closePal() { openPal = null; if (bar) bar.querySelector(".pt-mkpal").hidden = true; }
  const colorOf = (style, c) => (style === "hl" ? HL : LINE)[c];
  function paintBar() {
    for (const st of ["hl", "ul", "st"]) bar.querySelector(`[data-mk="${st}"] .pt-mkc`).style.background = colorOf(st, pref[st]);
  }
  function palette(style) {
    const pal = bar.querySelector(".pt-mkpal");
    pal.innerHTML = `<span class="pt-mkpt">${NAMES[style]}の色</span>` + PICK[style].map(c =>
      `<button class="pt-mk${pref[style] === c ? " on" : ""}" data-pc="${c}" title="${c}" style="--c:${colorOf(style, c)}"></button>`).join("");
    pal.hidden = false; openPal = style;
  }
  function build() {
    bar = document.createElement("div");
    bar.className = "pt-markbar";
    bar.hidden = true;                       // 出すのは show() の中で（色の帯と位置を決めてから）
    const btn = (st, label) => `<span class="pt-mkg"><button class="pt-mkb" data-mk="${st}" title="${NAMES[st]}（今の色で付ける）">${label}<i class="pt-mkc"></i></button>`
      + `<button class="pt-mkdd" data-dd="${st}" title="${NAMES[st]}の色を選ぶ">▾</button></span>`;
    bar.innerHTML = `<div class="pt-mkrow">${btn("hl", "蛍光ペン")}${btn("ul", "<u>下線</u>")}${btn("st", "<s>取り消し線</s>")}`
      + `<span class="pt-mksep"></span><button class="pt-mkb" data-mk="copy" title="コピー（Ctrl＋C）">コピー</button></div>`
      + `<div class="pt-mkpal" hidden></div>`;
    bar.addEventListener("pointerdown", e => e.preventDefault());         // 押しても選んだ範囲が消えないように
    bar.addEventListener("click", e => {
      const dd = e.target.closest("[data-dd]");
      if (dd) { openPal === dd.dataset.dd ? closePal() : palette(dd.dataset.dd); return; }
      const pc = e.target.closest("[data-pc]");
      if (pc) { mark(openPal, pc.dataset.pc); return; }                    // 色を選ぶと、その色ですぐ付ける（Word と同じ）
      const b = e.target.closest("[data-mk]"); if (!b) return;
      const k = b.dataset.mk;
      if (k === "copy") { navigator.clipboard && navigator.clipboard.writeText(getSelection().toString()).catch(() => document.execCommand("copy")); hide(); return; }
      mark(k, pref[k]);
    });
    document.body.appendChild(bar);
  }
  function show() {
    const pages = P.selLines();
    if (!pages.length || !S.doc) return hide();
    // 選んだ範囲のいちばん下の行の、左下に出す
    const last = pages[pages.length - 1], L = last.lines[last.lines.length - 1];
    const pr = S.pages[last.n - 1].el.getBoundingClientRect();
    if (!bar) build();
    if (!bar.hidden) return;                 // 出ている間は動かさない（色を選んでいる最中など）
    paintBar(); closePal();
    bar.hidden = false;
    const bw = bar.offsetWidth || 320, bh = bar.offsetHeight || 40;
    let x = pr.left + L.l, y = pr.top + L.b + 8;
    if (y + bh + 60 > innerHeight - 8) y = pr.top + pages[0].lines[0].t - bh - 8;   // 下に入らなければ上に
    x = Math.max(8, Math.min(x, innerWidth - bw - 8));
    bar.style.left = x + "px"; bar.style.top = y + "px";
  }
  // 選び終わったとき（指を離したとき・Shift＋矢印で選んだとき）に出す。選び直し中・何もないときは隠す
  document.addEventListener("pointerup", () => setTimeout(show, 0));
  document.addEventListener("keyup", e => { if (e.shiftKey) setTimeout(show, 0); });
  P.hooks.select.push(() => { const s = getSelection(); if (!s || s.isCollapsed) hide(); });
  P.hooks.close.push(hide);
  P.hooks.mount.push(app => app.querySelector(".pt-view").addEventListener("scroll", hide, { passive: true }));
})();
