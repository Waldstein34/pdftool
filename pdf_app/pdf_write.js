/* =====================================================================
   pdf_write.js ― PDF への書き込み（ノートと同じ部品を使う）

   ・道具（ペン・マーカー・消しゴム・投げ縄・図形・線・矢印・付箋・テキスト・アイコン）は
     ノートの notes_free.js / notes_ink.js / notes_icons.js がそのまま受け持つ。ここはつなぐだけ
   ・書き込みは PDF ごとに1つの記録に自動で保存する（置き場所は PdfTool.io 次第：サーバー版は data/ann/<目印>.json、
     公開版はブラウザの中）。
     目印＝PDF の中身から作った SHA-256。名前を変えても、別のフォルダに移しても書き込みが戻る。
     中身が変わった PDF（別のソフトで編集したなど）は、同じ PDF らしい記録があれば使うか聞く
   ・書き込みの位置は「pdf:doc:ページ番号」に結びつけ、ページの幅を1とした割合で覚える（拡大縮小しても追従）
   ・元に戻す Ctrl+Z ／ やり直し Ctrl+Y（Ctrl+Shift+Z）
   ・💾 書き込みごと保存：notes_pdfout.js で書き込みを焼き付けた PDF を作り、「元の名前（書き込み済み）.pdf」として保存する。
     サーバー版は元の PDF と同じフォルダへ（同じ名前があれば上書きしてよいか聞く）、公開版は保存先を選ぶ窓（元のフォルダから始まる）。
     居場所がわからない PDF は、ダウンロードに保存する
   書き込みの色は白い紙に合う明るいテーマ（notion）で描く（暗い画面でも「標準」の線は黒）。
   ===================================================================== */
(() => {
  "use strict";
  const P = window.PdfTool, N = window.Notes;
  if (!P || !P.hooks || !N || !N.Editor || !N.Free) return;
  const S = P._S, E = N.Editor;
  const io = () => P.io;
  let cur = null;          // 今開いている PDF { key, name, ref, url }
  let saveT = 0, dirty = false;

  function toast(msg, ms = 4000) {
    let t = S.root.querySelector(".pt-toast");
    if (!t) { t = document.createElement("div"); t.className = "pt-toast pt-glass"; S.root.appendChild(t); }
    t.textContent = msg; t.hidden = false;
    clearTimeout(t._h); t._h = setTimeout(() => { t.hidden = true; }, ms);
  }
  P.toast = toast;

  /* ---------------- 保存 ---------------- */
  function soon() { dirty = true; clearTimeout(saveT); saveT = setTimeout(flush, 700); }
  async function flush(keep) {
    clearTimeout(saveT);
    if (!dirty || !cur) return;
    dirty = false;
    const c = cur;
    try {
      const r = await io().annSave(c.key, c.name, c.ref, E.getFree(), keep);
      if (!r.ok) throw new Error(r.error || "保存できませんでした");
    } catch (e) {
      dirty = true;
      // つながらない間は、3秒ごとに保存を試し続ける（画面を閉じていなければ、つながり次第保存される）
      toast(await io().alive() ? `⚠ 書き込みを保存できませんでした（${e.message || e}）。もう一度試します`
        : `⚠ ${io().downMessage}今の書き込みは、起動し直すと自動で保存されます（この画面は閉じないでください）`, 6000);
      saveT = setTimeout(flush, 3000);
    }
  }
  addEventListener("beforeunload", () => { E.settle(); if (dirty) flush(true); });

  /* ---------------- 開く・閉じる ---------------- */
  P.hooks.open.push(async ctx => {
    cur = { key: ctx.key, name: ctx.name, ref: ctx.ref, url: ctx.url };
    let items = [];
    try {
      const r = await io().annGet(ctx.key, ctx.ref, ctx.name);
      if (cur !== null && cur.key === ctx.key && r.free && r.free.length) {
        if (r.matched === "key") items = r.free;
        else if (r.matched === "other" && confirm("この PDF は、前に書き込んだときから中身が変わっています（別のソフトで編集したなど）。\n前の書き込みを表示しますか？（位置がずれることがあります）")) {
          items = r.free; dirty = true;      // 新しい目印のほうに写して保存する
        }
      }
    } catch (e) { toast("⚠ 書き込みを読み込めませんでした"); }
    if (!cur || cur.key !== ctx.key) return;
    E.load(items);
    E.onChange = soon;
    const U = S.ui;
    N.Free.mount({ scroll: U.view, page: U.blocks, title: U.blocks, blocks: U.blocks, tools: U.tools });
    const layer = N.Free._.layer;
    layer.classList.add("nb-app");
    layer.dataset.nbTheme = "notion";      // 紙（白）に合う色で描く
    fitLayer();
    if (dirty) soon();
  });

  P.hooks.close.push(() => {
    E.settle();
    if (dirty) flush();
    cur = null;
    E.onChange = null;
    E.load([]);
    S.ui.view.querySelectorAll(".nb-free").forEach(n => n.remove());
  });

  // 拡大縮小・窓の大きさが変わったら、書き込みの層の幅を合わせて置き直す
  function fitLayer() {
    const layer = N.Free._.layer;
    if (!layer || !layer.isConnected) return;
    layer.style.width = S.ui.pages.offsetWidth + "px";
    N.Free.render();
  }
  P.hooks.layout.push(fitLayer);

  /* ---------------- 元に戻す・やり直し ---------------- */
  document.addEventListener("keydown", e => {
    if (!cur || !(e.ctrlKey || e.metaKey)) return;
    const a = document.activeElement;
    if (a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return;
    const k = e.key.toLowerCase();
    if (k === "z" && !e.shiftKey) { e.preventDefault(); if (!E.undo()) toast("これ以上は戻せません", 1500); }
    else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); if (!E.redo()) toast("これ以上はやり直せません", 1500); }
  });

  /* ---------------- 書き込みごと保存 ---------------- */
  P.hooks.save.push(async () => {
    if (!cur) return;
    E.settle();
    await flush();
    if (!await io().alive()) { alert(io().downMessage); return; }
    const c = cur, btn = S.ui.save, label = btn.innerHTML;
    if (!c.ref) { N.PdfOut.save("doc", c.url, c.name, btn); return; }   // 居場所がわからない PDF：ダウンロードへ
    try {
      btn.disabled = true; btn.textContent = "作成中…";
      const r = await N.PdfOut.build("doc", c.url);
      if (r.empty) { alert("この PDF には、まだ書き込みがありません。PDF のページの上に書き込んでから押してください。"); return; }
      let w = await io().saveAs(c.ref, c.name, r.bytes, false);
      if (w.exists) {
        if (!confirm(`「${w.name}」はもうあります。上書きしますか？`)) return;
        w = await io().saveAs(c.ref, c.name, r.bytes, true);
      }
      if (w.cancelled) return;
      if (!w.ok) throw new Error(w.error || "保存できませんでした");
      toast(`${w.message || `「${w.name}」を保存しました`}（${r.pages}ページに書き込み）${r.textNote || ""}`, 6000);
    } catch (e) {
      alert(e.message || "PDF を作れませんでした");
    } finally {
      btn.disabled = false; btn.innerHTML = label;
    }
  });

  P.Write = { flush, _: { get cur() { return cur; } } };
})();
