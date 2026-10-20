/* =====================================================================
   pdf_font.js ― 近くの文字と同じ書体・大きさ・色で書き込む（Acrobat の「テキストを追加」と同じ動き）

   ・テキストの道具で PDF のページをクリックすると、いちばん近い PDF の文字を調べて、
     その書体（ff）・大きさ（fsr＝ページの幅を1とした割合）・色（tc）で書き始める
       例：MS 明朝 10.5pt の「氏名：」の右をクリック → MS 明朝 10.5pt・黒で、その行の高さにそろえて書き始める
   ・書体の見分け方は PowerPoint 変換と同じ（pdf_convert.js の P.pickFont）。色はページの絵から文字の部分の色を拾う
   ・近くに文字がない（白紙など）ときは、いつもの大きさ・標準の書体
   ・あとから変えるときは、選択の道具で右クリック →「書体」「文字の大きさ（pt）」（notes_free.js）
   ・道具バーの「近くの文字に合わせる」で切れる（ブラウザに覚える）
   ===================================================================== */
(() => {
  "use strict";
  const P = window.PdfTool, N = window.Notes;
  if (!P || !P.hooks || !N || !N.Free || !N.Free._.createHooks) return;
  const S = P._S, F = N.Free._;
  const KEY = "pdftool.fontmatch";
  let on = true;
  try { on = localStorage.getItem(KEY) !== "off"; } catch (e) { /* 覚えられなくても使える */ }
  // PowerPoint 変換の書体名 → 書き込みの書体（ff）。ここにない書体（Calibri など）は標準の書体のまま
  const FF = { "MS Mincho": "mincho", "MS Gothic": "gothic", "Yu Mincho": "yumincho", "Yu Gothic": "yugothic", "Meiryo": "meiryo",
    "BIZ UDMincho": "bizmincho", "BIZ UDGothic": "bizgothic", "Century": "century", "Times New Roman": "times", "Arial": "arial" };

  /* ページの文字のかたまりを、ページの左上を原点とする pt の四角にする */
  function itemsOf(p) {
    if (!p.tc || !window.pdfjsLib) return [];
    if (p._fi) return p._fi;
    const vp = p.page.getViewport({ scale: 1 }), U = window.pdfjsLib.Util, out = [];
    for (const it of p.tc.items) {
      if (!("str" in it) || !it.str.trim()) continue;
      const t = U.transform(vp.transform, it.transform);
      const size = Math.hypot(t[2], t[3]);
      if (size < 2 || Math.abs(Math.atan2(t[1], t[0])) > 0.02) continue;     // 斜め・縦の文字は使わない
      const st = p.tc.styles[it.fontName] || {};
      if (st.vertical) continue;
      const asc = st.ascent || 0.88;
      out.push({ it, st, size, l: t[4], r: t[4] + it.width * vp.scale, top: t[5] - size * asc, bot: t[5] + size * (1 - asc), base: t[5] });
    }
    return (p._fi = out);
  }
  /* 文字の色：ページの絵の、その文字の四角の中で、白から遠い色の濃いほう3割の平均 */
  function colorOf(p, a) {
    const cv = p.cv; if (!cv) return null;
    const k = cv.width / p.w;
    const l = Math.max(0, Math.floor(a.l * k)), t = Math.max(0, Math.floor(a.top * k));
    const w = Math.min(cv.width - l, Math.ceil((a.r - a.l) * k)), h = Math.min(cv.height - t, Math.ceil((a.bot - a.top) * k));
    if (w < 1 || h < 1) return null;
    let d;
    try { d = cv.getContext("2d").getImageData(l, t, w, h).data; } catch (e) { return null; }
    const px = [];
    for (let i = 0; i < d.length; i += 4) { const ink = 765 - d[i] - d[i + 1] - d[i + 2]; if (ink > 150) px.push([ink, d[i], d[i + 1], d[i + 2]]); }
    if (!px.length) return null;
    px.sort((x, y) => y[0] - x[0]);
    const top = px.slice(0, Math.max(1, Math.ceil(px.length * 0.3)));
    const avg = j => { const v = Math.round(top.reduce((s, q) => s + q[j], 0) / top.length); return v < 4 ? 0 : v > 251 ? 255 : v; };   // 縁のにじみで少しずれた値は丸める
    const [r, g, b] = [avg(1), avg(2), avg(3)];
    if (Math.max(r, g, b) < 70 && Math.max(r, g, b) - Math.min(r, g, b) < 30) return "black";
    return "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("");
  }
  /* 押した所（pt）にいちばん近い文字。用紙の「氏名：」の右の空欄のように、同じ行で横に離れた文字を、
     すぐ上下の行の文字より優先する（横の距離は軽く、縦の距離は重く数える）。
     上下に離れすぎ（文字の大きさの2.5倍か 24pt より遠い）・横に離れすぎ（300pt より遠い）ときは null */
  function nearest(p, x, y) {
    let best = null, bd = Infinity;
    for (const a of itemsOf(p)) {
      const dx = x < a.l ? a.l - x : x > a.r ? x - a.r : 0, dy = y < a.top ? a.top - y : y > a.bot ? y - a.bot : 0;
      if (dy > Math.max(24, a.size * 2.5) || dx > 300) continue;
      const dist = dx * 0.2 + dy * 3;
      if (dist < bd) { bd = dist; best = a; }
    }
    return best;
  }
  /* 近くの文字の書体・大きさ・色 { ff, pt, tc, line:{top,bot} }（P.fontNear：テスト・ほかの部品用） */
  function fontNear(n, x, y) {
    const p = S.pages[n - 1]; if (!p) return null;
    const a = nearest(p, x, y); if (!a) return null;
    let raw = "";
    try { const f = p.page.commonObjs.get(a.it.fontName); raw = (f && (f.name || f.loadedName)) || ""; } catch (e) { /* 名前がなくても続ける */ }
    const fam = a.st.fontFamily || "";
    const face = P.pickFont ? P.pickFont(raw, /serif/i.test(fam) && !/sans/i.test(fam)).face : "";
    // 大きさ：Word などの 0.5pt 刻みに近ければそろえる（10.56 → 10.5）
    const half = Math.round(a.size * 2) / 2, pt = Math.abs(a.size - half) < 0.1 ? half : Math.round(a.size * 10) / 10;
    return { ff: FF[face] || null, face, raw, pt, tc: colorOf(p, a), line: { top: a.top, bot: a.bot, base: a.base } };
  }
  P.fontNear = fontNear;

  /* 書体の上下の高さ（px）。画面の文字の枠と同じ書体で測る。測れないブラウザでは null */
  const mcv = document.createElement("canvas").getContext("2d");
  function metrics(ff, px) {
    const base = getComputedStyle(F.layer || document.body).getPropertyValue("--nb-font").trim() || "sans-serif";
    mcv.font = `${px}px ${F.FONTS[ff] ? `${F.FONTS[ff][1]},${base}` : base}`;
    const t = mcv.measureText("あA");
    return t.fontBoundingBoxAscent != null ? { a: t.fontBoundingBoxAscent, d: t.fontBoundingBoxDescent } : null;
  }

  /* テキストを置いたとき（notes_free.js の createHooks） */
  F.createHooks.push((o, at) => {
    if (!on || o.kind !== "text" || !String(o.anchor).startsWith("pdf:")) return;
    const n = +o.anchor.split(":")[2], p = S.pages[n - 1]; if (!p) return;
    const x = at.fx * p.w, y = at.fy * p.w;                 // 押した所（pt）
    const m = fontNear(n, x, y); if (!m) return;
    if (m.ff) o.ff = m.ff;
    o.fsr = Math.round(m.pt / p.w * 100000) / 100000;
    if (m.tc) o.tc = m.tc;
    // クリックで置いたとき：押した所から書き始める。近くの文字と同じ行なら、その行の高さにそろえる
    if (at.small) {
      const s = at.frame.s / p.w;                            // 1pt あたりの画面の px
      const fsPx = m.pt * s, lh = fsPx * 1.5;                // 文字の枠の1行の高さ（行の間は 1.5）
      const sameLine = y >= m.line.top - m.pt * 0.3 && y <= m.line.bot + m.pt * 0.3;
      // 1行目の上端（ページの上端からの px）。同じ行なら、文字の基準線（字が乗る線）を PDF の文字にそろえる。
      // 画面の1行の中の基準線の位置＝（行の高さ − 書体の高さ）÷2 ＋ 書体の上の高さ（書体ごとに測る）
      let top = y * s - lh / 2;
      if (sameLine) {
        const fm = metrics(o.ff, fsPx);
        top = fm ? m.line.base * s - ((lh - fm.a - fm.d) / 2 + fm.a) : (m.line.top + m.line.bot) / 2 * s - lh / 2;
      }
      const r4 = v => Math.round(v * 10000) / 10000;
      o.x = r4((x * s - 4) / at.frame.s);                    // 文字の枠の内側の余白（左 4px・上 2px）の分だけずらす
      o.dy = r4((top - 2) / at.frame.s);
      o.h = r4((lh + 4) / at.frame.s);
    }
  });

  /* 道具バー（テキストの道具を選んだとき）：近くの文字に合わせるか */
  F.optionBars.textbox = box => {
    const lb = document.createElement("label");
    lb.className = "pt-fmatch";
    lb.title = "テキストを置いたとき、近くの PDF の文字と同じ書体・大きさ・色にする";
    lb.innerHTML = `<input type="checkbox"${on ? " checked" : ""}> 近くの文字に合わせる`;
    lb.querySelector("input").onchange = e => { on = e.target.checked; try { localStorage.setItem(KEY, on ? "on" : "off"); } catch (er) { /* 覚えられなくても使える */ } };
    box.appendChild(lb);
  };
  P.hooks.close.push(() => { for (const p of S.pages || []) p._fi = null; });
})();
