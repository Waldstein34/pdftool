/* =====================================================================
   pdf_print.js ― 印刷（🖨 ボタン・Ctrl＋P）

   ・書き込みがあれば、書き込みごと印刷する（notes_pdfout.js の「書き込みごと保存」と同じ PDF を作ってから印刷）
     書き込みがなければ、元の PDF をそのまま印刷する
   ・各ページを印刷用の細かさ（PRINT_DPI）で絵にして、印刷のときだけ見える入れ物（.pt-print）に並べ、
     ブラウザの印刷画面を出す。Chrome・Edge・Firefox 系のどれでも同じように動く
   ・印刷画面を閉じたら、絵は片づける
   ===================================================================== */
(() => {
  "use strict";
  const P = window.PdfTool, N = window.Notes;
  if (!P || !P.hooks) return;
  const S = P._S;
  const PRINT_DPI = 150;            // 1インチあたりの点の数（150 で文字も線もくっきり。ページが多いと準備に時間がかかる）
  let busy = false;

  const toast = (m, ms) => P.toast && P.toast(m, ms);
  const hasInk = () => N && N.Editor && N.Editor.freeList().some(o => typeof o.anchor === "string" && o.anchor.startsWith("pdf:doc:"));

  // 印刷する PDF の中身（書き込みがあれば焼き付けたもの）
  async function sourceBytes() {
    if (hasInk() && N.PdfOut) {
      const r = await N.PdfOut.build("doc", S.url);
      if (!r.empty) return r.bytes;
    }
    return new Uint8Array(await (await fetch(S.url)).arrayBuffer());
  }
  P.sourceBytes = sourceBytes;      // 変換（pdf_convert.js）でも使う

  // ページを絵（PNG）にする。返すのは画像の URL の一覧
  async function renderPages(bytes, onProgress) {
    const lib = await P.loadPdfJs();
    const doc = await lib.getDocument({ data: bytes, cMapUrl: `${S.base}/notes_app/vendor/cmaps/`, cMapPacked: true }).promise;
    const urls = [];
    try {
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        const vp = page.getViewport({ scale: PRINT_DPI / 72 });
        const cv = document.createElement("canvas");
        cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
        const ctx = cv.getContext("2d");
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
        await page.render({ canvasContext: ctx, viewport: vp, intent: "print" }).promise;
        const blob = await new Promise(ok => cv.toBlob(ok, "image/png"));
        urls.push({ url: URL.createObjectURL(blob), w: vp.width, h: vp.height });
        cv.width = cv.height = 0;
        page.cleanup();
        onProgress(n, doc.numPages);
      }
    } finally { doc.destroy(); }
    return urls;
  }

  async function doPrint() {
    if (!S.doc || busy) return;
    busy = true;
    const btn = S.root.querySelector('[data-a="print"]');
    if (btn) btn.disabled = true;
    let box = null, urls = [];
    try {
      if (N && N.Editor) N.Editor.settle();
      toast("印刷の準備中…", 60000);
      const bytes = await sourceBytes();
      urls = await renderPages(bytes, (n, all) => toast(`印刷の準備中… ${n} / ${all} ページ`, 60000));
      box = document.createElement("div");
      box.className = "pt-print";
      for (const u of urls) {
        const img = new Image();
        img.src = u.url;
        img.className = u.w > u.h ? "pt-pland" : "";
        box.appendChild(img);
      }
      document.body.appendChild(box);
      await Promise.all([...box.images || box.querySelectorAll("img")].map(i => i.decode().catch(() => {})));
      toast("", 1);
      P._lastPrint = { pages: urls.length, ink: hasInk() };     // 確かめるとき用
      window.print();                                          // Chrome 系は印刷画面を閉じるまでここで止まる
    } catch (e) {
      alert(`印刷できませんでした（${e.message || e}）`);
    } finally {
      // Firefox 系は print() がすぐ戻るので、印刷画面が閉じてから片づける
      const clean = () => { if (box) box.remove(); urls.forEach(u => URL.revokeObjectURL(u.url)); busy = false; if (btn) btn.disabled = false; };
      if (box) { let done = false; const once = () => { if (!done) { done = true; clean(); } }; addEventListener("afterprint", once, { once: true }); setTimeout(once, 60000); }
      else clean();
    }
  }
  P.print = doPrint;

  P.hooks.print.push(doPrint);
  // Ctrl＋P はブラウザの印刷（画面がそのまま印刷される）ではなく、PDF の印刷にする
  document.addEventListener("keydown", e => {
    if (S.doc && (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "p") { e.preventDefault(); doPrint(); }
  }, true);
})();
