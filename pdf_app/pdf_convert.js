/* =====================================================================
   pdf_convert.js ― 別の形への変換（上の帯の「変換」）

   PowerPoint（.pptx）：見た目を元とほぼ同じにすることを最優先に、その上でできるだけ編集できるようにする
     ・スライドは2枚重ね
         下＝ページから「文字だけを抜いた」絵（罫線・表の線・図・写真・色の帯）。スライドの背景に敷く（動かない）
         上＝PDF の文字を、元と同じ位置・大きさ・色で1行ずつ文字枠に置く（直せる・検索できる・コピーできる）
     ・書体：元の書体の名前から、パソコンにある近い書体を選ぶ。行の長さが元と同じになるよう、文字の間隔を調整する
     ・文字の色：文字ありの絵と文字なしの絵をくらべて、文字の部分の色を読み取る
     ・書き込みがあれば、書き込みごと変換する（印刷と同じ PDF を使う）
     ・AI は使わない。すべてパソコンの中で処理する
   部品：vendor/pptxgen.bundle.js（PptxGenJS 3.12.0・MIT。中に JSZip を含む）
   ===================================================================== */
(() => {
  "use strict";
  const P = window.PdfTool, N = window.Notes;
  if (!P || !P.hooks) return;
  const S = P._S;
  const BG_DPI = 200;               // 背景の絵の細かさ
  // PowerPoint は、行の間隔を「文字の大きさちょうど」にした文字枠では、上端から 文字の大きさ×割合 の所に
  // 文字の並ぶ線（ベースライン）を置く。割合は書体ごとに違う（書体ごとに 40pt の行を PowerPoint で書き出して測った値）
  const BASELINE = { "MS Mincho": 0.819, "MS Gothic": 0.825, "Meiryo": 0.700, "Yu Gothic": 0.731, "Yu Mincho": 0.719,
    "BIZ UDGothic": 0.881, "BIZ UDMincho": 0.756, "Century": 0.794, "Times New Roman": 0.775, "Arial": 0.781,
    "Calibri": 0.762, "Segoe UI": 0.781, "Cambria": 0.78, "Courier New": 0.78 };
  const toast = (m, ms) => P.toast && P.toast(m, ms);
  let busy = false;

  function loadScript(src, glob) {
    if (window[glob]) return Promise.resolve(window[glob]);
    return new Promise((ok, ng) => {
      const sc = document.createElement("script");
      sc.src = src;
      sc.onload = () => ok(window[glob]);
      sc.onerror = () => ng(new Error(`${src} を読み込めませんでした`));
      document.head.appendChild(sc);
    });
  }

  /* ---------------- 書体 ---------------- */
  // PDF の中の書体の名前（例 "ABCDEF+MS-Mincho"）から、パソコン・PowerPoint で使う書体を選ぶ
  function pickFont(raw, fallbackSerif) {
    const n = String(raw || "").replace(/^[A-Z]{6}\+/, "").replace(/[-_,]/g, " ").toLowerCase();
    const bold = /bold|black|heavy|semibold|w[6-9]\b|demi/.test(n);
    let face;
    if (/biz\s*ud.*mincho|bizudmincho/.test(n)) face = "BIZ UDMincho";
    else if (/biz\s*ud.*gothic|bizudgothic|bizudpgothic/.test(n)) face = "BIZ UDGothic";
    else if (/yu\s*mincho|游明朝/.test(n)) face = "Yu Mincho";
    else if (/yu\s*gothic|游ゴシック/.test(n)) face = "Yu Gothic";
    else if (/meiryo|メイリオ/.test(n)) face = "Meiryo";
    else if (/mincho|明朝|ryumin|hiragino\s*mincho/.test(n)) face = "MS Mincho";
    else if (/gothic|ゴシック|kaku|hiragino|ud\s*shin/.test(n)) face = "MS Gothic";
    else if (/century/.test(n)) face = "Century";
    else if (/times/.test(n)) face = "Times New Roman";
    else if (/arial|helvetica|liberation\s*sans/.test(n)) face = "Arial";
    else if (/calibri/.test(n)) face = "Calibri";
    else if (/cambria/.test(n)) face = "Cambria";
    else if (/segoe/.test(n)) face = "Segoe UI";
    else if (/courier|mono/.test(n)) face = "Courier New";
    else face = fallbackSerif ? "Yu Mincho" : "Yu Gothic";
    return { face, bold };
  }
  // 文字の幅を測る。MS 明朝などは小さい大きさだと画面用に丸めた幅（数字1文字＝6px など）を返すので、
  // 大きな文字（100px）で測ってから元の大きさに縮める
  const measureCv = document.createElement("canvas").getContext("2d");
  function measure(text, face, size, bold) {
    measureCv.font = `${bold ? "bold " : ""}100px "${face}"`;
    return measureCv.measureText(text).width * size / 100;
  }
  // PowerPoint の日本語用の書体名（正式な名前）
  const JP_NAME = { "MS Mincho": "ＭＳ 明朝", "MS Gothic": "ＭＳ ゴシック", "Yu Mincho": "游明朝", "Yu Gothic": "游ゴシック",
    "Meiryo": "メイリオ", "BIZ UDMincho": "BIZ UD明朝", "BIZ UDGothic": "BIZ UDゴシック" };

  /* PptxGenJS が作ったスライドの XML を整える
     ・文字の種類を日本語に（lang="ja-JP"）、日本語用の書体を正式な名前と日本語の文字セット（-128）に
     ・段落の設定（a:pPr）が文字のかたまりごとに繰り返されるので、段落の先頭の1つだけにする（決まりに合わせる） */
  async function tidyPptx(bytes) {
    const zip = await window.JSZip.loadAsync(bytes);
    const names = Object.keys(zip.files).filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f));
    for (const f of names) {
      let x = await zip.file(f).async("string");
      x = x.replace(/lang="en-US"/g, 'lang="ja-JP"');
      x = x.replace(/<a:ea typeface="([^"]*)"[^>]*\/>/g, (m, face) => `<a:ea typeface="${JP_NAME[face] || face}" charset="-128"/>`);
      x = x.replace(/<a:cs typeface="([^"]*)"[^>]*\/>/g, (m, face) => `<a:cs typeface="${face}"/>`);
      x = x.replace(/<a:p>([\s\S]*?)<\/a:p>/g, (m, inner) => {
        let seen = false;
        return "<a:p>" + inner.replace(/<a:pPr\b[^>]*?(?:\/>|>[\s\S]*?<\/a:pPr>)/g, pp => seen ? "" : (seen = true, pp)) + "</a:p>";
      });
      zip.file(f, x);
    }
    return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  }

  /* ---------------- 1ページを調べる ---------------- */
  async function renderPair(page, scale) {
    const vp = page.getViewport({ scale });
    const mk = () => { const c = document.createElement("canvas"); c.width = Math.floor(vp.width); c.height = Math.floor(vp.height); const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); return [c, x]; };
    const [full, fx] = mk();
    await page.render({ canvasContext: fx, viewport: vp, intent: "print" }).promise;
    // 文字だけを抜いた絵：pdf.js は文字を fillText / strokeText で描くので、それを何もしないようにする
    const [bare, bx] = mk();
    bx.fillText = () => {}; bx.strokeText = () => {};
    await page.render({ canvasContext: bx, viewport: vp, intent: "print" }).promise;
    return { full, bare, fx, bx, vp };
  }

  // 文字のかたまりの色：文字ありと文字なしで違う画素の色を集める（違いが大きい画素ほど文字そのもの）
  function sampleColor(fx, bx, l, t, w, h) {
    l = Math.max(0, Math.floor(l)); t = Math.max(0, Math.floor(t));
    w = Math.max(1, Math.min(Math.ceil(w), fx.canvas.width - l)); h = Math.max(1, Math.min(Math.ceil(h), fx.canvas.height - t));
    if (w <= 0 || h <= 0) return "000000";
    const a = fx.getImageData(l, t, w, h).data, b = bx.getImageData(l, t, w, h).data;
    const px = [];
    for (let i = 0; i < a.length; i += 4) {
      const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      if (d > 90) px.push([d, a[i], a[i + 1], a[i + 2]]);
    }
    if (!px.length) return "000000";
    px.sort((p, q) => q[0] - p[0]);
    const top = px.slice(0, Math.max(1, Math.ceil(px.length * 0.3)));
    const avg = k => Math.round(top.reduce((s, p) => s + p[k], 0) / top.length);
    return [avg(1), avg(2), avg(3)].map(v => v.toString(16).padStart(2, "0")).join("");
  }

  // 文字のかたまりを、同じ行で近いもの同士の「行」にまとめる
  function buildLines(items) {
    items.sort((a, b) => a.base - b.base || a.x - b.x);
    const lines = [];
    for (const it of items) {
      const ln = lines.find(L => Math.abs(L.base - it.base) < Math.max(L.size, it.size) * 0.3
        && Math.abs(L.size - it.size) < Math.max(L.size, it.size) * 0.35
        && it.x >= L.end - it.size * 0.6 && it.x - L.end < it.size * 1.6);
      if (ln) { ln.items.push(it); ln.end = Math.max(ln.end, it.x + it.w); ln.size = Math.max(ln.size, it.size); }
      else lines.push({ base: it.base, size: it.size, x: it.x, end: it.x + it.w, items: [it] });
    }
    lines.forEach(L => L.items.sort((a, b) => a.x - b.x));
    return lines;
  }

  /* ---------------- PowerPoint ---------------- */
  async function toPptx() {
    const lib = await P.loadPdfJs();
    await loadScript(`${S.base}/pdf_app/vendor/pptxgen.bundle.js`, "PptxGenJS");
    const bytes = await P.sourceBytes();
    const doc = await lib.getDocument({ data: bytes, cMapUrl: `${S.base}/notes_app/vendor/cmaps/`, cMapPacked: true }).promise;
    const pptx = new window.PptxGenJS();
    const first = (await doc.getPage(1)).getViewport({ scale: 1 });
    const W = first.width / 72, H = first.height / 72;       // スライドの大きさ（インチ）＝1ページ目と同じ
    pptx.defineLayout({ name: "PDF", width: W, height: H });
    pptx.layout = "PDF";
    pptx.title = S.name.replace(/\.pdf$/i, "");
    const stats = { pages: doc.numPages, boxes: 0, runs: 0 };
    try {
      for (let n = 1; n <= doc.numPages; n++) {
        toast(`PowerPoint に変換中… ${n} / ${doc.numPages} ページ`, 60000);
        const page = await doc.getPage(n);
        const vp1 = page.getViewport({ scale: 1 });
        // ページの大きさが1ページ目と違うときは、スライドに収まるように縮めて中央に置く
        const k = Math.min(W * 72 / vp1.width, H * 72 / vp1.height);
        const ox = (W * 72 - vp1.width * k) / 2, oy = (H * 72 - vp1.height * k) / 2;
        const sc = BG_DPI / 72;
        const { full, bare, fx, bx } = await renderPair(page, sc);
        const tc = await page.getTextContent();
        // 斜め・縦の文字は文字枠にしないので、そのページは文字を抜かない絵を背景にする
        const skipped = tc.items.some(it => "str" in it && it.str.trim() && (Math.abs(Math.atan2(it.transform[1], it.transform[0])) > 0.02 || (tc.styles[it.fontName] || {}).vertical));
        const slide = pptx.addSlide();
        slide.background = { color: "FFFFFF" };
        slide.addImage({ data: (skipped ? full : bare).toDataURL("image/png"), x: ox / 72, y: oy / 72, w: vp1.width * k / 72, h: vp1.height * k / 72 });
        // 文字
        const items = [];
        for (const it of tc.items) {
          if (!("str" in it) || !it.str || !it.str.trim()) continue;     // 空白だけのかたまりは文字にせず、すき間として扱う
          const tx = lib.Util.transform(vp1.transform, it.transform);     // ページの左上を原点とする pt
          const size = Math.hypot(tx[2], tx[3]);
          if (size < 1) continue;
          const angle = Math.atan2(tx[1], tx[0]);
          if (Math.abs(angle) > 0.02) continue;                          // 斜め・縦の文字は背景の絵に残す
          const st = tc.styles[it.fontName] || {};
          if (st.vertical) continue;
          let rawName = "";
          try { const f = page.commonObjs.get(it.fontName); rawName = (f && (f.name || f.loadedName)) || ""; } catch (e) { /* 名前がなくても続ける */ }
          const font = pickFont(rawName, /serif/i.test(st.fontFamily || "") && !/sans/i.test(st.fontFamily || ""));
          const asc = st.ascent || 0.88;
          const w = it.width * vp1.scale;
          items.push({ str: it.str, x: tx[4], base: tx[5], size, w, asc, ...font,
            color: sampleColor(fx, bx, tx[4] * sc, (tx[5] - size * asc) * sc, w * sc, size * sc * 1.05) });
        }
        for (const L of buildLines(items)) {
          const runs = [];          // { text, options, chars, cs（pt・この版の縮尺前） }
          let cursor = L.x;
          L.items.forEach((it, i) => {
            const gap = it.x - cursor;
            if (i > 0 && gap > 0.3) {
              const sw = measure(" ", it.face, it.size, it.bold);
              if (gap >= sw * 0.8) {
                // 空白1つ分くらい以上のすき間：空白を置き、残りを空白の間隔で合わせる
                runs.push({ text: " ", font: it, chars: 1, cs: gap - sw });
              } else if (runs.length) {
                // 狭いすき間：手前のかたまりの文字の間隔に振り分ける（PowerPoint は大きく詰める指定が効かないことがある）
                const pr = runs[runs.length - 1];
                pr.cs += gap / pr.chars;
              }
            }
            // 行の長さが元と同じになるように、文字の間隔を調整する（PowerPoint の文字間隔は1文字ごとに足される pt）
            const m = measure(it.str, it.face, it.size, it.bold);
            const chars = Math.max(1, [...it.str].length);
            runs.push({ text: it.str, font: it, chars, cs: (it.w - m) / chars });
            cursor = it.x + it.w;
          });
          const pptRuns = runs.map(r => ({ text: r.text, options: { fontFace: r.font.face, fontSize: r.font.size * k, color: r.font.color, bold: r.font.bold,
            charSpacing: Math.max(-r.font.size * 0.3, Math.min(r.font.size * 2, r.cs)) * k } }));
          const size = L.size;
          // 行の中で一番多く使われている書体の割合を使う
          const share = {};
          L.items.forEach(i => { share[i.face] = (share[i.face] || 0) + [...i.str].length; });
          const mainFace = Object.keys(share).sort((a, b) => share[b] - share[a])[0];
          const baseRatio = BASELINE[mainFace] || 0.78;
          slide.addText(pptRuns, {
            x: (ox + L.x * k) / 72, y: (oy + (L.base - size * baseRatio) * k) / 72,
            w: Math.max(0.1, ((L.end - L.x) * k + size * k * 0.5) / 72), h: (size * 1.3 * k) / 72,
            margin: 0, valign: "top", wrap: false, fit: "none", lineSpacing: size * k, paraSpaceBefore: 0, paraSpaceAfter: 0,
          });
          stats.boxes++; stats.runs += pptRuns.length;
        }
        full.width = full.height = bare.width = bare.height = 0;
        page.cleanup();
      }
    } finally { doc.destroy(); }
    const out = await tidyPptx(await pptx.write({ outputType: "uint8array" }));
    P._lastConvert = stats;
    return out;
  }

  /* ---------------- メニューと保存 ---------------- */
  const KINDS = [
    { id: "pptx", name: "PowerPoint（.pptx）", note: "見た目そのまま・文字は直せる", ext: ".pptx", run: toPptx },
  ];
  async function convert(kind) {
    if (!S.doc || busy) return;
    busy = true;
    try {
      if (N && N.Editor) N.Editor.settle();
      const bytes = await kind.run();
      toast("", 1);
      await P.saveOut(S.name.replace(/\.pdf$/i, "") + kind.ext, bytes);
    } catch (e) {
      toast("", 1);
      alert(`変換できませんでした（${e.message || e}）`);
    } finally { busy = false; }
  }
  P.convert = id => convert(KINDS.find(k => k.id === id));
  P.convertKinds = KINDS;
  P.pickFont = pickFont;      // 書体の見分け方（pdf_font.js も使う）

  P.hooks.convert.push(btn => {
    if (!N || !N._openPop) return;
    N._openPop(btn, p => {
      p.classList.add("pt-thmenu");
      p.insertAdjacentHTML("beforeend", `<div class="cat">変換して保存</div>`);
      KINDS.forEach(k => {
        const it = document.createElement("button");
        it.className = "it";
        it.innerHTML = `<div>${k.name}<br><small style="opacity:.7">${k.note}</small></div>`;
        it.onclick = () => { N._closePop(); convert(k); };
        p.appendChild(it);
      });
    });
  });
})();
