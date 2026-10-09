/* =====================================================================
   pdf_bridge.js ― ノートの書き込み部品を、PDFツールの中で動かすための「つなぎ役」

   ノートの notes_free.js（図形・付箋・テキスト）・notes_ink.js（ペン・消しゴム・投げ縄）・
   notes_guide.js（整列ガイド）・notes_icons.js（アイコン）・notes_pdfout.js（書き込みごと保存）は、
   ノート本体（notes_core.js・notes_editor.js）が用意する小道具を使う。
   ここでは、その小道具の「PDFツール版」を用意する。ノートの部品そのものは1行も変えない。
     Notes._el / _esc / _openPop / _closePop / api / _S / tree … 小物
     Notes.Editor … 書き込みの一覧（freeList）と「元に戻す」の履歴。本文（ブロック）はないので、
                    行は PDF 全体を表す1つ（id "doc"）だけ
   このファイルは notes_*.js より先に読み込む。
   PDFツールは単体版でも Studio の中でも「自分だけの画面」で開くので、ノートの部品とぶつからない。
   ===================================================================== */
window.Notes = window.Notes || {};
(function () {
  "use strict";
  const N = window.Notes;
  const S = N._S = { base: "", tree: { pages: {}, settings: {} }, meta: null };

  /* ---------------- 小物（notes_core.js と同じ働き） ---------------- */
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  N._el = el; N._esc = esc;
  N.tree = () => S.tree;
  // 公開版（pdf_io_browser.js）は裏のプログラムがないので、ノートの窓口（アイコンの追加パック・設定）をブラウザの中で済ませる
  const io = () => window.PdfTool && window.PdfTool.io;
  N.api = async (path, body) => {
    if (io() && io().notesApi) return io().notesApi(path, body);
    const opt = body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {};
    return (await fetch(S.base + path, opt)).json();
  };

  // 浮かぶメニュー（右クリック・アイコン選び）。見た目は Studio のガラスに合わせる
  let popEl = null;
  function closePop() { if (popEl) { popEl.remove(); popEl = null; } }
  function openPop(anchor, build) {
    closePop();
    const p = el("div", "nb-pop nb-app pt-pop");
    p.dataset.nbTheme = (window.PdfTool && window.PdfTool.themeNb) || "host-glass";   // テーマに合わせる（pdf_theme.js）
    build(p);
    document.body.appendChild(p);
    const r = anchor.getBoundingClientRect();
    let x = r.left, y = r.bottom + 4;
    const w = p.offsetWidth, h = p.offsetHeight;
    if (x + w > innerWidth - 8) x = Math.max(8, innerWidth - w - 8);
    if (y + h > innerHeight - 8) y = Math.max(8, r.top - h - 4);
    p.style.left = x + "px"; p.style.top = y + "px";
    popEl = p;
    return p;
  }
  N._openPop = openPop; N._closePop = closePop;
  document.addEventListener("mousedown", e => { if (popEl && !popEl.contains(e.target)) closePop(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && popEl) closePop(); });

  /* ---------------- 書き込みの一覧と「元に戻す」 ---------------- */
  // 一覧の配列はずっと同じものを使う（notes_free.js がこの配列に直接足し引きするため）
  const free = [];
  let hist = [], idx = -1, pending = false, typingTimer = 0;
  let onChange = null;                 // 変わったら呼ぶ（pdf_write.js が保存に使う）
  const MAXHIST = 200;

  function snap() { return JSON.stringify(free); }
  function record() {
    const s = snap();
    if (hist[idx] === s) return;
    hist = hist.slice(0, idx + 1);
    hist.push(s);
    if (hist.length > MAXHIST) hist.shift();
    idx = hist.length - 1;
    if (onChange) onChange();
  }
  function settle() { if (pending) { clearTimeout(typingTimer); pending = false; record(); } }
  // 打っている途中（kind="type"）は、0.9 秒止まったら1回分として記録する
  function changed(kind) {
    if (kind === "type") {
      pending = true;
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => { pending = false; record(); }, 900);
      if (onChange) onChange();
      return;
    }
    settle();
    record();
  }
  function restore(s) {
    free.splice(0, free.length, ...JSON.parse(s));
    if (N.Free) { N.Free.select([]); N.Free.render(); }
    if (onChange) onChange();
  }
  function undo() { settle(); if (idx > 0) { idx--; restore(hist[idx]); return true; } return false; }
  function redo() { settle(); if (idx < hist.length - 1) { idx++; restore(hist[idx]); return true; } return false; }
  // 新しい PDF を開いたとき：一覧を入れ替えて、履歴を作り直す
  function load(items) {
    clearTimeout(typingTimer); pending = false;
    free.splice(0, free.length, ...(Array.isArray(items) ? items : []));
    hist = [snap()]; idx = 0;
  }

  N.Editor = {
    freeList: () => free,
    getFree: () => JSON.parse(snap()),
    getBlocks: () => [{ id: "doc" }],
    settle, changed, undo, redo, load,
    transform(fn) { settle(); fn([], free); record(); if (N.Free) N.Free.render(); },
    hooks: { keydown: [], input: [], paste: [], renderTx: [], afterRender: [] },
    set onChange(f) { onChange = f; },
  };
})();
