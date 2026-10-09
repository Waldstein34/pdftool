/* =====================================================================
   notes_pdfout.js ― PDF の「書き込みごと保存」（書き込みを焼き付けた写しを作る）

   ・PDF ブロックの「⤓ 書き込みごと保存」を押すと、「元の名前（書き込み済み）.pdf」をダウンロードする
   ・元の PDF とノートの中の書き込みは変えない（写しを作るだけ）
   ・しくみ：書き込みのあるページごとに、ページと同じ大きさの透明なシート（画像）を作り、
     書き込みを描いて、元の PDF のページの上に重ねる（部品は vendor/pdf-lib.min.js）。
     元の PDF の文字はそのまま残るので、選択・検索できる
   ・入るのは、PDF のページに結びついた書き込み（anchor が "pdf:行id:頁"）だけ。余白の付箋などは入らない
   ・色は紙（白）に合う明るいテーマ（notion）の色で描く。暗いテーマでも「標準」の線が白くならない
   ・線の太さなどは、今の画面の PDF の幅に対する割合で描く（画面で見たとおりの太さ）
   ・付箋・テキストの文字は、PDF の本物の文字として入れる（選択・検索・コピーできる）。書体は画面と同じもの
     （Windows の Segoe UI＝英数字、Yu Gothic UI＝日本語。ノートのサーバーの /api/notes/sysfont から受け取る）を
     vendor/fontkit.umd.min.js で読み、使った文字だけを PDF に入れる。見つからないときは同梱の BIZ UDゴシック（SIL OFL）。
     行の切れ目と1文字ずつの位置は画面と同じ。書体にない文字（絵文字など）だけは、シートに絵で描く。付箋の黄色い地もシートに描く
   窓口：Notes.PdfOut.button(ブロック, ファイルのURL) → ボタン、Notes.PdfOut.build(行id, ファイルのURL) → PDF の中身（テスト用）
   ===================================================================== */
window.Notes = window.Notes || {};
(function () {
  "use strict";
  const N = window.Notes;
  const F = () => N.Free._;
  const DPP = 3;            // 1pt あたりの画素（3 ≒ 216dpi。印刷しても粗くならない）
  const MAXPX = 6000;       // シートの一辺の上限（大きすぎる PDF でも止まらないように）
  const status = t => { const s = document.getElementById("nbStatus"); if (s) s.textContent = t; };

  /* ---------------- 部品（pdf-lib・fontkit・日本語の書体）を読む ---------------- */
  const vendor = f => `${N._S.base || ""}/notes_app/vendor/${f}`;
  const scripts = {};
  function loadScript(file, glob) {
    if (window[glob]) return Promise.resolve(window[glob]);
    if (scripts[file]) return scripts[file];
    return (scripts[file] = new Promise((ok, ng) => {
      const sc = document.createElement("script");
      sc.src = vendor(file);
      sc.onload = () => ok(window[glob]);
      sc.onerror = () => { delete scripts[file]; ng(new Error(`${file} を読み込めませんでした`)); };
      document.head.appendChild(sc);
    }));
  }
  const loadLib = () => loadScript("pdf-lib.min.js", "PDFLib");
  /* fontkit は、読み込むときに1か所だけ直してから使う（vendor のファイルそのものは変えない）。
     使った文字だけの書体を作るとき、文字の位置の表（loca）を「短い形式」で書くことがあるが、短い形式は
     各文字のデータが偶数の長さでないとずれる。この書体（BIZ UDゴシック）では奇数の長さがあり、約4割の文字の形が壊れて
     PDF で白く抜けた（文字の取り出しはできるのに見えない）→ いつも「長い形式」で書くようにする */
  const FK_BUG = "this.version=this.offsets[this.offsets.length-1]>65535?1:0";
  let fkP = null;
  function loadFontkit() {
    if (window.fontkit && window.fontkit.__nbFixed) return Promise.resolve(window.fontkit);
    if (fkP) return fkP;
    return (fkP = (async () => {
      const src = await fetch(vendor("fontkit.umd.min.js")).then(r => { if (!r.ok) throw new Error("fontkit を読み込めませんでした"); return r.text(); });
      if (src.split(FK_BUG).length !== 2) throw new Error("fontkit の直し所が見つかりません（版が違う）");
      const url = URL.createObjectURL(new Blob([src.replace(FK_BUG, "this.version=1")], { type: "text/javascript" }));
      try {
        await new Promise((ok, ng) => { const sc = document.createElement("script"); sc.src = url; sc.onload = ok; sc.onerror = () => ng(new Error("fontkit を読み込めませんでした")); document.head.appendChild(sc); });
      } finally { URL.revokeObjectURL(url); }
      window.fontkit.__nbFixed = true;
      return window.fontkit;
    })().catch(e => { fkP = null; throw e; }));
  }
  /* 書体の用意。画面と同じ書体（Windows の Segoe UI＝英数字、Yu Gothic UI＝日本語・全角の記号）を、
     ノートのサーバーから受け取って PDF に入れる（使った文字だけ）。見つからない（Windows 以外など）ときは、
     同梱の BIZ UDゴシック（vendor/BIZUDGothic-Regular.ttf、SIL OFL）にする。
     返り値 { list: [{ font, chars }]（1文字ずつ、前から順に「その字がある書体」を使う）, note } */
  const bytesCache = {};
  async function getBytes(key, url) {
    if (bytesCache[key]) return bytesCache[key];
    const r = await fetch(url);
    const b = r.ok ? await r.arrayBuffer() : null;
    if (!b || b.byteLength < 1000) throw new Error("書体がありません");
    return (bytesCache[key] = b);
  }
  async function prepareFonts(doc) {
    const fk = await loadFontkit();
    const mk = font => ({ font, chars: new Set(font.getCharacterSet()) });
    try {
      const api = n => `${N._S.base || ""}/api/notes/sysfont?name=${n}`;
      const [se, yu] = await Promise.all([getBytes("segoe", api("segoe-ui")), getBytes("yugothic", api("yugothic-ui"))]);
      doc.registerFontkit(fk);
      const fSe = await doc.embedFont(se, { subset: true });
      doc.registerFontkit({ create: b => fk.create(b, "YuGothicUI-Regular") });   // 書体のまとめファイル（.ttc）から Yu Gothic UI を選ぶ
      const fYu = await doc.embedFont(yu, { subset: true });
      doc.registerFontkit(fk);
      return { list: [mk(fSe), mk(fYu)], note: "" };
    } catch (e) {
      doc.registerFontkit(fk);
      const fb = await doc.embedFont(await getBytes("biz", vendor("BIZUDGothic-Regular.ttf")), { subset: true });
      return { list: [mk(fb)], note: "（画面の書体が見つからなかったため、文字は BIZ UDゴシックで入れました）" };
    }
  }

  /* ---------------- 色：紙に合う明るいテーマの色に直す ---------------- */
  function makeProbe() {
    const p = document.createElement("div");
    p.className = "nb-app"; p.dataset.nbTheme = "notion";
    p.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;pointer-events:none";
    document.body.appendChild(p);
    const cs = getComputedStyle(p);
    const col = v => String(v || "").replace(/var\((--[\w-]+)\)/g, (_, n) => cs.getPropertyValue(n).trim() || "#000");
    return { col, font: () => cs.getPropertyValue("--nb-font").trim() || "sans-serif", remove: () => p.remove() };
  }

  /* ---------------- 描く道具 ---------------- */
  function loadImg(src) {
    return new Promise((ok, ng) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => ng(new Error("画像を作れませんでした")); im.src = src; });
  }
  // SVG を、シートの細かさ（s 倍）で絵にして置く。x, y, w, h は画面の px、rot は中心まわりの角度
  async function drawSvg(ctx, inner, x, y, w, h, rot, s, P) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.max(1, w * s)}" height="${Math.max(1, h * s)}" viewBox="0 0 ${w} ${h}">${P.col(inner)}</svg>`;
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    try {
      const im = await loadImg(url);
      withRot(ctx, x, y, w, h, rot, () => ctx.drawImage(im, x, y, w, h));
    } finally { URL.revokeObjectURL(url); }
  }
  function withRot(ctx, x, y, w, h, rot, fn) {
    ctx.save();
    if (rot) { const cx = x + w / 2, cy = y + h / 2; ctx.translate(cx, cy); ctx.rotate(rot * Math.PI / 180); ctx.translate(-cx, -cy); }
    fn(); ctx.restore();
  }
  // 文字を枠の幅で折り返す（改行はそのまま。空白があればそこで、なければ1文字ずつ）
  function wrap(ctx, text, maxW) {
    const out = [];
    String(text || "").split("\n").forEach(par => {
      let line = "";
      for (const ch of par) {
        const t = line + ch;
        if (line && ctx.measureText(t).width > maxW) {
          const sp = line.lastIndexOf(" ");
          if (sp > 0 && ch !== " ") { out.push(line.slice(0, sp)); line = line.slice(sp + 1) + ch; }
          else { out.push(line); line = ch === " " ? "" : ch; }
        } else line = t;
      }
      out.push(line);
    });
    return out;
  }
  // 文字の書体は、画面に出ている付箋・テキストと同じものを使う（違うと折り返す位置がずれる）
  function fontOf(o, P) {
    const d = F().elOf(o.id), tx = d && (d.querySelector(".nb-fotx") || d);
    return (tx && getComputedStyle(tx).fontFamily) || P.font();
  }
  /* 画面で折り返された行を、そのまま取り出す。1文字ずつ画面上の位置を調べ、同じ高さの文字を1行にまとめる。
     返り値 [{ cy: 文字の枠の上端から行の真ん中まで, ch: [{ c: 文字, x: 文字の枠の左端からの位置 }] }]
     （空行も高さごとそのまま。1文字ずつの横の位置も画面と同じ）。画面に出ていない・回転しているときは null */
  function screenLines(o, maxW) {
    if (o.rot) return null;
    const d = F().elOf(o.id), tx = d && d.querySelector(".nb-fotx");
    if (!tx || !tx.offsetParent || !tx.textContent) return null;
    const cs = getComputedStyle(tx), rr = tx.getBoundingClientRect();
    // 画面の文字の枠の幅が、書き出しで使う幅と違う（画面が隠れていて幅がつぶれている等）なら、画面の折り返しは使わない
    const inner = rr.width - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
    if (Math.abs(inner - maxW) > 2) return null;
    const top = rr.top + (parseFloat(cs.paddingTop) || 0), left = rr.left + (parseFloat(cs.paddingLeft) || 0);
    const lines = []; let cur = null;
    const walk = document.createTreeWalker(tx, NodeFilter.SHOW_TEXT), r = document.createRange();
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const s = n.textContent;
      for (let i = 0; i < s.length; i++) {
        const cp = s.codePointAt(i), len = cp > 0xffff ? 2 : 1;      // 絵文字など2つ分の文字は1文字として扱う
        r.setStart(n, i); r.setEnd(n, i + len);
        const rc = r.getClientRects()[0];
        if (rc && rc.height) {
          const cy = rc.top + rc.height / 2 - top;
          if (!cur || Math.abs(cy - cur.cy) > rc.height / 2) { cur = { cy, ch: [] }; lines.push(cur); }
          cur.ch.push({ c: s.slice(i, i + len), x: rc.left - left });
        }
        i += len - 1;
      }
    }
    return lines.length ? lines : null;
  }
  /* 自分で折り返す（画面に出ていない・回転しているとき）。形は screenLines と同じ */
  function wrapLines(ctx, text, maxW, fs) {
    const lh = fs * 1.5;
    return wrap(ctx, text, maxW).map((t, i) => {
      const ch = []; let x = 0;
      for (const c of t) { ch.push({ c, x }); x += ctx.measureText(c).width; }
      return { cy: lh * i + lh / 2, ch };
    });
  }
  /* 付箋・テキストの文字。書体にある文字は T.runs に「PDF の本物の文字」としてためておき、
     書体にない文字（絵文字など）だけシートに描く。x, y＝文字の枠の左上（画面の px）、clipH＝これより下の行は描かない */
  function layoutText(ctx, o, x, y, maxW, fs, color, P, clipH, T, box) {
    const family = fontOf(o, P);
    ctx.save();
    ctx.font = `${fs}px ${family}`; ctx.fillStyle = color; ctx.textBaseline = "middle";
    const lh = fs * 1.5;
    const lines = screenLines(o, maxW) || wrapLines(ctx, o.text, maxW, fs);
    lines.forEach(ln => {
      const cy = y + ln.cy;
      if (clipH != null && cy - lh / 2 > clipH) return;
      let run = null;
      ln.ch.forEach(({ c, x: cx }) => {
        const f = T.pick(c);                                           // この字を入れる書体（なければ null）
        if (f) {
          if (!run || run.font !== f) { run = { text: "", font: f, x: x + cx, cy, fs, color, rot: o.rot || 0, box, n: 0 }; T.runs.push(run); }
          run.text += c; run.n++; run.lastX = x + cx; run.lastC = c;     // 最後の文字の位置（画面と同じ幅にそろえるため）
        } else {
          run = null;
          if (c.trim()) ctx.fillText(c, x + cx, cy);           // 書体にない文字は絵で
        }
      });
    });
    ctx.restore();
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  /* 書き込み1つを描く。Wd＝今の画面の PDF の幅（px）。位置は「ページの幅を1とした割合」×Wd */
  async function drawItem(ctx, o, Wd, s, P, T) {
    const fr = F();
    if (o.kind === "line" || o.kind === "arrow") {
      const x1 = o.p1.x * Wd, y1 = o.p1.dy * Wd, x2 = o.p2.x * Wd, y2 = o.p2.dy * Wd;
      const b = { x1, y1, x2, y2, l: Math.min(x1, x2), t: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
      const { P: pad, svg } = fr.lineSvg(o, b);
      return drawSvg(ctx, svg, b.l - pad, b.t - pad, b.w + pad * 2, b.h + pad * 2, 0, s, P);
    }
    const x = o.x * Wd, y = o.dy * Wd, w = o.w * Wd, h = o.h * Wd, rot = o.rot || 0;
    if (o.kind === "ink") return drawSvg(ctx, fr.kindRender.ink(o, { w, h }), x, y, w, h, rot, s, P);
    if (o.kind === "rect" || o.kind === "ellipse" || o.kind === "triangle") {
      // 画面の図形と同じ形（縦横 102 の目盛りの 0〜100 に描く）
      const U = v => v / 102, X = u => x + U(u + 1) * w, Y = u => y + U(u + 1) * h;
      withRot(ctx, x, y, w, h, rot, () => {
        ctx.beginPath();
        if (o.kind === "rect") { const rx = Math.min(U(3) * w, U(3) * h); roundRect(ctx, X(0), Y(0), X(100) - X(0), Y(100) - Y(0), rx); }
        else if (o.kind === "ellipse") ctx.ellipse(X(50), Y(50), X(100) - X(50), Y(100) - Y(50), 0, 0, Math.PI * 2);
        else { ctx.moveTo(X(50), Y(0)); ctx.lineTo(X(100), Y(100)); ctx.lineTo(X(0), Y(100)); ctx.closePath(); }
        const fill = P.col(fr.fillCss(o.fill));
        if (fill && fill !== "transparent") { ctx.fillStyle = fill; ctx.fill(); }
        const st = P.col(fr.strokeCss(o.stroke || "ink"));
        if (st !== "transparent") { ctx.strokeStyle = st; ctx.lineWidth = o.sw || 2; ctx.lineJoin = "round"; ctx.stroke(); }
      });
      return;
    }
    const box = { x, y, w, h };      // 回転の中心を出すための枠
    if (o.kind === "note") {
      withRot(ctx, x, y, w, h, rot, () => {
        ctx.save();
        roundRect(ctx, x, y, w, h, 3); ctx.fillStyle = P.col(fr.noteCss(o.fill)); ctx.fill();
        ctx.clip();
        layoutText(ctx, o, x + 12, y + 10, w - 24, o.fs || 14, o.tc && o.tc !== "ink" ? P.col(fr.strokeCss(o.tc)) : "#3a3200", P, y + h, T, box);
        ctx.restore();
      });
      return;
    }
    if (o.kind === "text") {
      withRot(ctx, x, y, w, h, rot, () => layoutText(ctx, o, x + 4, y + 2, w - 8, o.fs || 16, P.col(fr.strokeCss(o.tc || "ink")), P, null, T, box));
      return;
    }
    if (o.kind === "icon") return drawIcon(ctx, o, x, y, w, h, rot, s, P);
  }
  /* アイコン：画面に出ている形（SVG・画像・文字の部品・絵文字）をそのまま使う */
  async function drawIcon(ctx, o, x, y, w, h, rot, s, P) {
    const size = Math.max(8, Math.min(w, h) * 0.86), color = P.col(F().strokeCss(o.stroke || "ink"));
    const d = F().elOf(o.id);
    const holder = document.createElement("div");
    holder.innerHTML = d && d.querySelector(".nb-foic") && !d.querySelector(".nb-pending") ? d.querySelector(".nb-foic").innerHTML : (N.Icons ? N.Icons.html(o.icon, "□") : String(o.icon || ""));
    const sv = holder.querySelector("svg"), im = holder.querySelector("img"), wic = holder.querySelector(".nb-wic");
    const ix = x + (w - size) / 2, iy = y + (h - size) / 2;
    if (sv) {
      sv.setAttribute("width", size); sv.setAttribute("height", size);
      const inner = sv.outerHTML.replace(/currentColor/g, color);
      return drawSvg(ctx, inner, ix, iy, size, size, rot, s, P);
    }
    if (im) {
      const pic = await loadImg(im.getAttribute("src"));
      withRot(ctx, x, y, w, h, rot, () => ctx.drawImage(pic, ix, iy, size, size));
      return;
    }
    const txt = holder.textContent || "□";
    withRot(ctx, x, y, w, h, rot, () => {
      ctx.save();
      ctx.font = `${size}px ${wic ? wic.style.fontFamily : `"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",${P.font()}`}`;
      ctx.fillStyle = color; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(txt, x + w / 2, y + h / 2);
      ctx.restore();
    });
  }

  /* ---------------- 写しを作る ---------------- */
  // 透明なシートを、PDF のページの向き（/Rotate）に合わせて置く
  function placeSheet(page, img, lib) {
    const cb = page.getCropBox(), rot = (((page.getRotation().angle || 0) % 360) + 360) % 360;
    const W = cb.width, H = cb.height, deg = lib.degrees;
    if (rot === 90) page.drawImage(img, { x: cb.x + W, y: cb.y, width: H, height: W, rotate: deg(90) });
    else if (rot === 180) page.drawImage(img, { x: cb.x + W, y: cb.y + H, width: W, height: H, rotate: deg(180) });
    else if (rot === 270) page.drawImage(img, { x: cb.x, y: cb.y + H, width: H, height: W, rotate: deg(270) });
    else page.drawImage(img, { x: cb.x, y: cb.y, width: W, height: H });
  }
  // 色の文字（#rgb・#rrggbb・rgb()）→ pdf-lib の色
  function toRgb(lib, c) {
    let r = 0, g = 0, b = 0; c = String(c || "").trim();
    let m = /^#([0-9a-f]{3})$/i.exec(c);
    if (m) [r, g, b] = m[1].split("").map(h => parseInt(h + h, 16));
    else if ((m = /^#([0-9a-f]{6})/i.exec(c))) [r, g, b] = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
    else if ((m = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/i.exec(c))) [r, g, b] = [m[1], m[2], m[3]].map(Number);
    return lib.rgb(r / 255, g / 255, b / 255);
  }
  /* ためておいた文字を、PDF のページに本物の文字として書く。
     画面の px → 見える向きの pt（×u）→ PDF の座標（/Rotate に合わせる）。行の真ん中に合わせて、文字の基準線を決める */
  function drawRuns(page, runs, lib, u) {
    const cb = page.getCropBox(), rot = (((page.getRotation().angle || 0) % 360) + 360) % 360;
    const W = cb.width, H = cb.height;
    const toPdf = (dx, dy) => rot === 90 ? [cb.x + dy, cb.y + dx] : rot === 180 ? [cb.x + W - dx, cb.y + dy]
      : rot === 270 ? [cb.x + W - dy, cb.y + H - dx] : [cb.x + dx, cb.y + H - dy];
    runs.forEach(r => {
      const font = r.font, size = r.fs * u;
      const asc = font.heightAtSize(size, { descender: false }), desc = font.heightAtSize(size) - asc;
      let bx = r.x, by = r.cy + (asc - desc) / 2 / u;            // 基準線（画面の px）
      if (r.rot) {                                                 // 図形の回転（画面では右回り）を、中心のまわりに
        const cx = r.box.x + r.box.w / 2, cy = r.box.y + r.box.h / 2, a = r.rot * Math.PI / 180;
        const dx = bx - cx, dy = by - cy;
        bx = cx + dx * Math.cos(a) - dy * Math.sin(a); by = cy + dx * Math.sin(a) + dy * Math.cos(a);
      }
      const [x, y] = toPdf(bx * u, by * u);
      // 画面と同じ書体なら幅はほぼ同じ。わずかな差（文字の詰め具合など）だけ、文字の間隔で画面の幅にそろえる。
      // 大きく詰めると文字が重なって二重に見えるので、間隔の変更は文字の大きさの 8% まで
      const pdfW = font.widthOfTextAtSize(r.text, size), screenW = (r.lastX - r.x) * u + font.widthOfTextAtSize(r.lastC, size);
      const tc = r.n > 1 ? Math.max(-size * 0.08, Math.min(size * 0.08, (screenW - pdfW) / (r.n - 1))) : 0;
      if (tc) page.pushOperators(lib.setCharacterSpacing(tc));
      page.drawText(r.text, { x, y, size, font, color: toRgb(lib, r.color), rotate: lib.degrees(rot - r.rot) });
      if (tc) page.pushOperators(lib.setCharacterSpacing(0));
    });
  }
  async function build(bid, url) {
    const items = F().list().filter(o => typeof o.anchor === "string" && o.anchor.startsWith(`pdf:${bid}:`));
    if (!items.length) return { empty: true };
    const lib = await loadLib();
    const src = await fetch(url).then(r => { if (!r.ok) throw new Error("元の PDF を読めませんでした"); return r.arrayBuffer(); });
    let doc;
    try { doc = await lib.PDFDocument.load(src); }
    catch (e) { throw new Error(/encrypt/i.test(String(e && e.message)) ? "この PDF は保護（暗号化）されているため、書き込みを焼き付けられません" : "この PDF を開けませんでした"); }
    const byPage = new Map();
    items.forEach(o => { const n = +o.anchor.split(":")[2]; if (!byPage.has(n)) byPage.set(n, []); byPage.get(n).push(o); });
    // 付箋・テキストの文字があれば、書体を PDF に入れる（使った文字だけ）。どれも読めなければ、文字も絵で描く
    let fonts = [], textNote = "";
    if (items.some(o => (o.kind === "note" || o.kind === "text") && o.text)) {
      try { const r = await prepareFonts(doc); fonts = r.list; textNote = r.note; }
      catch (e) { fonts = []; textNote = "（書体を読めなかったため、文字は絵として入れました）"; }
    }
    const pick = c => { const cp = c.codePointAt(0); const f = fonts.find(x => x.chars.has(cp)); return f ? f.font : null; };
    const P = makeProbe();
    let pages = 0, texts = 0;
    try {
      for (const [n, list] of byPage) {
        if (!(n >= 1 && n <= doc.getPageCount())) continue;
        const page = doc.getPage(n - 1);
        const cb = page.getCropBox(), rot = (((page.getRotation().angle || 0) % 360) + 360) % 360;
        const Dw = rot % 180 ? cb.height : cb.width, Dh = rot % 180 ? cb.width : cb.height;   // 画面で見える向きの大きさ（pt）
        const k = Math.min(DPP, MAXPX / Math.max(Dw, Dh));
        const cv = document.createElement("canvas");
        cv.width = Math.max(1, Math.round(Dw * k)); cv.height = Math.max(1, Math.round(Dh * k));
        const pg = document.querySelector(`.nb-b[data-id="${bid}"] .nb-pdf-page[data-n="${n}"]`);
        // 今の画面の PDF の幅（px）。測れないとき（折りたたみの中・画面が隠れている）は、本文の列の幅か 700 を使う
        // （文字の大きさや線の太さは px なので、幅を小さく測ると、書き込みが PDF に対して大きく焼き付いてしまう）
        const colW = F().parts() && F().parts().blocks ? F().parts().blocks.clientWidth : 0;
        const Wd = pg && pg.clientWidth >= 200 ? pg.clientWidth : colW >= 200 ? colW : 700;
        const s = cv.width / Wd;
        const ctx = cv.getContext("2d");
        ctx.scale(s, s);
        const T = { runs: [], pick };
        for (const o of list.slice().sort((a, b) => (a.z || 0) - (b.z || 0))) await drawItem(ctx, o, Wd, s, P, T);
        const png = await new Promise(ok => cv.toBlob(b => ok(b), "image/png")).then(b => b.arrayBuffer());
        placeSheet(page, await doc.embedPng(png), lib);
        if (T.runs.length) { drawRuns(page, T.runs, lib, Dw / Wd); texts += T.runs.length; }
        pages++;
      }
    } finally { P.remove(); }
    return { bytes: await doc.save(), pages, items: items.length, texts, textNote };
  }
  function outName(name) {
    const base = String(name || "PDF").replace(/\.pdf$/i, "");
    return `${base}（書き込み済み）.pdf`;
  }
  async function save(bid, url, name, btn) {
    const label = btn ? btn.textContent : "";
    try {
      if (btn) { btn.disabled = true; btn.textContent = "作成中…"; }
      status("書き込みごと保存：PDF を作っています…");
      const r = await build(bid, url);
      if (r.empty) { alert("この PDF には、まだ書き込みがありません。PDF のページの上に書き込んでから押してください。"); status(""); return; }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([r.bytes], { type: "application/pdf" }));
      a.download = outName(name);
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      status(`「${a.download}」を保存しました（${r.pages}ページに書き込み）${r.textNote || ""}`);
    } catch (e) {
      alert(e.message || "PDF を作れませんでした"); status("");
    } finally { if (btn) { btn.disabled = false; btn.textContent = label; } }
  }

  /* PDF ブロックの上の帯に置くボタン（notes_media.js が呼ぶ） */
  function button(b, url) {
    const bt = document.createElement("button");
    bt.className = "nb-btn burn"; bt.textContent = "⤓ 書き込みごと保存";
    bt.title = "PDF の上の書き込みを焼き付けた写しを保存します（元の PDF はそのまま）";
    bt.onclick = () => {
      const blk = bt.closest(".nb-b");
      save(blk ? blk.dataset.id : b.id, url, b.name, bt);
    };
    return bt;
  }

  N.PdfOut = { button, build, save, _: { outName } };
})();
