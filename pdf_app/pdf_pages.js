/* =====================================================================
   pdf_pages.js ― ページの操作と保存の選び方

   ・左の「ページ」一覧：押して選ぶ（Ctrl で足す・Shift で範囲）、ドラッグで並べ替え、右クリックでメニュー
   ・上の帯の「ページ」ボタン：選んだページ（なければ今のページ）に同じメニュー
     右に回転・左に回転・削除・前／後ろに白紙・後ろに PDF を挿入・最後に PDF をつなぐ（結合）・選んだページを別の PDF に（分割）
   ・操作した時点ではファイルを変えない。上の帯に「未保存の変更」を出し、
     保存（元の PDF に上書き）／別名で保存／取り消し／元に戻す（1つ前の操作）を選ぶ
   ・書き込み（ペン・付箋など）は、ページについていく（並べ替え・回転・削除に合わせて付け替える）
     未保存の間は書き込みを保存しない（ページの番号が元のファイルと食い違うため）。保存のときにまとめて残す
   ・PDF の作り替えは pdf-lib（ノートの vendor/）。ページの中身・目次はそのまま、並び・向きだけを変える
   ===================================================================== */
(() => {
  "use strict";
  const P = window.PdfTool, N = window.Notes;
  if (!P || !P.hooks) return;
  const S = P._S, E = N && N.Editor;
  const io = () => P.io;
  const toast = (m, ms) => P.toast && P.toast(m, ms);
  const st = { dirty: false, bytes: null, orig: null, hist: [], sel: new Set(), last: 0, busy: false };

  /* ---------------- 小道具 ---------------- */
  let libP = null;
  function loadPdfLib() {
    if (window.PDFLib) return Promise.resolve(window.PDFLib);
    return libP || (libP = new Promise((ok, ng) => {
      const sc = document.createElement("script");
      sc.src = `${S.base}/notes_app/vendor/pdf-lib.min.js`;
      sc.onload = () => ok(window.PDFLib);
      sc.onerror = () => { libP = null; ng(new Error("pdf-lib を読み込めませんでした")); };
      document.head.appendChild(sc);
    }));
  }
  const sha = async bytes => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(b => b.toString(16).padStart(2, "0")).join("");
  const ab = u8 => u8.slice().buffer;      // pdf.js に渡すと中身が移されるので、写しを渡す
  const baseName = () => S.name.replace(/\.pdf$/i, "");
  function selected() {
    const s = [...st.sel].filter(n => n >= 1 && n <= S.pages.length).sort((a, b) => a - b);
    return s.length ? s : [S.cur];
  }
  function rangeText(list) {        // [1,2,3,5] → "1-3,5"
    const out = [];
    for (let i = 0; i < list.length; i++) {
      let j = i; while (j + 1 < list.length && list[j + 1] === list[j] + 1) j++;
      out.push(i === j ? `${list[i]}` : `${list[i]}-${list[j]}`); i = j;
    }
    return out.join(",");
  }
  async function loadDoc(bytes) {
    const L = await loadPdfLib();
    try { return await L.PDFDocument.load(bytes); }
    catch (e) {
      if (/encrypt/i.test(String(e && e.message))) throw new Error("この PDF は保護（暗号化）されているため、ページを操作できません");
      throw new Error("この PDF を読み込めませんでした");
    }
  }
  // 見えている向きでのページの幅と高さ
  function shownSize(page) {
    const { width, height } = page.getSize(), a = ((page.getRotation().angle % 360) + 360) % 360;
    return a === 90 || a === 270 ? { w: height, h: width } : { w: width, h: height };
  }

  /* ---------------- 書き込みの付け替え ---------------- */
  // order[新しい位置] = 元の位置（0 から。新しく入れたページは null）。rot[元の位置] = +1（右に90°）/-1（左に90°）
  function remap(items, order, rot, ratio) {
    const newPos = new Map();
    order.forEach((old, i) => { if (old != null) newPos.set(old, i); });
    const keepUpright = new Set(["note", "text", "icon"]);
    const out = [];
    for (const o0 of items) {
      const m = typeof o0.anchor === "string" && /^pdf:doc:(\d+)$/.exec(o0.anchor);
      if (!m) { out.push(o0); continue; }
      const old = +m[1] - 1;
      if (!newPos.has(old)) continue;                       // 消したページの書き込みは一緒に消える
      const o = JSON.parse(JSON.stringify(o0));
      o.anchor = `pdf:doc:${newPos.get(old) + 1}`;
      const d = rot[old];
      if (d) {
        const r = ratio[old];                                // 回す前の 高さ÷幅
        // 点（ページの幅を1とした割合）を回す
        const turn = (u, v) => d > 0 ? [1 - v / r, u / r] : [v / r, (1 - u) / r];
        if (o.p1 && o.p2) {
          const [a, b] = turn(o.p1.x, o.p1.dy), [c, e] = turn(o.p2.x, o.p2.dy);
          o.p1 = { x: a, dy: b }; o.p2 = { x: c, dy: e };
        } else {
          const [cx, cy] = turn(o.x + o.w / 2, o.dy + o.h / 2);
          o.w = o.w / r; o.h = o.h / r;                      // 大きさは同じまま（新しいページの幅で割り直す）
          o.x = cx - o.w / 2; o.dy = cy - o.h / 2;
          if (!keepUpright.has(o.kind)) o.rot = (((o.rot || 0) + d * 90 + 540) % 360) - 180;   // 付箋・文字・アイコンは読める向きのまま
        }
      }
      out.push(o);
    }
    return out;
  }

  /* ---------------- 操作を当てる ---------------- */
  async function apply(label, fn, focusNew) {
    if (!S.doc || st.busy) return;
    st.busy = true;
    try {
      if (E) E.settle();
      const doc = await loadDoc(st.bytes);
      const n = doc.getPageCount();
      const ctx = { doc, order: [...Array(n).keys()], rot: {}, ratio: {} };
      doc.getPages().forEach((p, i) => { const s = shownSize(p); ctx.ratio[i] = s.h / s.w; });
      const go = await fn(ctx);
      if (go === false) return;
      const bytes = await doc.save();
      st.hist.push({ bytes: st.bytes, free: E ? E.getFree() : [], page: S.cur, label });
      if (st.hist.length > 30) st.hist.shift();
      st.bytes = bytes;
      st.dirty = true;
      const free = remap(E ? E.getFree() : [], ctx.order, ctx.rot, ctx.ratio);
      const page = focusNew || Math.min(S.cur, ctx.order.length);
      st.sel = new Set();
      await P.open({ buf: ab(bytes), name: S.name, ref: S.ref }, page, { reload: true, key: S.key, free });
      banner();
      toast(`${label}（まだ保存していません）`, 2500);
    } catch (e) {
      alert(e.message || "ページを操作できませんでした");
    } finally { st.busy = false; }
  }

  const ops = {
    rotate: d => apply(d > 0 ? "右に回転しました" : "左に回転しました", ({ doc, rot }) => {
      const L = window.PDFLib;
      for (const n of selected()) {
        const p = doc.getPage(n - 1);
        p.setRotation(L.degrees((((p.getRotation().angle + d * 90) % 360) + 360) % 360));
        rot[n - 1] = d;
      }
    }),
    remove: () => {
      const sel = selected();
      if (sel.length >= S.pages.length) { alert("すべてのページは削除できません。少なくとも1ページは残してください。"); return; }
      return apply(`${sel.length}ページを削除しました`, ({ doc, order }) => {
        for (const n of [...sel].reverse()) { doc.removePage(n - 1); order.splice(n - 1, 1); }
      });
    },
    // 並べ替え：選んだページを、元の並びの target 番目（0 から）の前へ
    move: (sel, target) => apply("ページを並べ替えました", ({ doc, order }) => {
      const pages = doc.getPages(), idx = sel.map(n => n - 1);
      const rest = order.filter(i => !idx.includes(i));
      const at = rest.filter(i => i < target).length;
      const next = rest.slice(0, at).concat(idx, rest.slice(at));
      if (next.every((v, i) => v === i)) return false;      // 動いていない
      for (let i = pages.length - 1; i >= 0; i--) doc.removePage(i);
      next.forEach((old, i) => doc.insertPage(i, pages[old]));
      order.splice(0, order.length, ...next);
    }, null),
    blank: after => {
      const sel = selected(), at = after ? sel[sel.length - 1] : sel[0] - 1;   // 0 から数えた入れる位置
      return apply("白紙のページを入れました", ({ doc, order }) => {
        const ref = doc.getPage(Math.min(Math.max(at - (after ? 1 : 0), 0), doc.getPageCount() - 1));
        const s = shownSize(ref);
        doc.insertPage(at, [s.w, s.h]);
        order.splice(at, 0, null);
      }, at + 1);
    },
    // ほかの PDF を入れる。at＝0 から数えた入れる位置（省くと最後＝結合）
    insertPdf: async after => {
      let f = null;
      try { f = await io().pick(); } catch (e) { alert(e.message || "開けませんでした"); }
      if (!f) return;
      const sel = selected(), at = after ? sel[sel.length - 1] : S.pages.length;
      return apply(`「${f.name}」を入れました`, async ({ doc, order }) => {
        const other = await loadDoc(new Uint8Array(f.buf));
        const copied = await doc.copyPages(other, other.getPageIndices());
        copied.forEach((p, k) => doc.insertPage(at + k, p));
        order.splice(at, 0, ...copied.map(() => null));
      }, at + 1);
    },
    // 分割：選んだページだけの PDF を、別のファイルとして保存（今の PDF はそのまま）
    extract: async () => {
      const sel = selected();
      try {
        const L = await loadPdfLib();
        const src = await loadDoc(st.bytes), out = await L.PDFDocument.create();
        (await out.copyPages(src, sel.map(n => n - 1))).forEach(p => out.addPage(p));
        await P.saveOut(`${baseName()}_p${rangeText(sel)}.pdf`, await out.save());
      } catch (e) { alert(e.message || "保存できませんでした"); }
    },
    selectAll: () => { st.sel = new Set(S.pages.map(p => p.n)); paintSel(); },
  };
  P.pageOps = ops;

  /* ---------------- 保存の選び方 ---------------- */
  async function save() {
    if (!st.dirty) return;
    if (!S.ref) return saveAs();
    try {
      if (E) E.settle();
      const w = await io().overwrite(S.ref, st.bytes);
      if (w.cancelled) return;
      if (!w.ok) throw new Error(w.error || "保存できませんでした");
      const newKey = await sha(st.bytes), free = E ? E.getFree() : [];
      await io().annSave(newKey, S.name, S.ref, free);
      // 古い中身の書き込みの記録は消さない（まったく同じ中身の PDF がほかにあると、そちらの書き込みまで消えてしまうため）
      st.dirty = false; st.hist = [];
      await P.open({ buf: ab(st.bytes), name: S.name, ref: S.ref }, S.cur);
      banner();
      toast(w.message, 5000);
    } catch (e) { alert(e.message || "保存できませんでした"); }
  }
  async function saveAs() {
    let name = prompt("別名で保存するファイルの名前", `${baseName()}（編集済み）.pdf`);
    if (name == null) return;
    name = name.trim().replace(/[\\/:*?"<>|]/g, "_");
    if (!name) return;
    if (!/\.pdf$/i.test(name)) name += ".pdf";
    try {
      if (E) E.settle();
      const free = E ? E.getFree() : [];
      const w = await P.saveOut(name, st.bytes);
      if (!w || w.cancelled) return;
      const ref = io().refOf ? io().refOf(w) : null;
      const newKey = await sha(st.bytes);
      await io().annSave(newKey, w.name || name, ref, free);     // 元の PDF の書き込みはそのまま残る
      st.dirty = false; st.hist = [];
      await P.open({ buf: ab(st.bytes), name: w.name || name, ref }, S.cur);   // 保存したファイルを開き直す
      banner();
    } catch (e) { alert(e.message || "保存できませんでした"); }
  }
  async function discard() {
    if (!confirm("ページの変更を取り消して、保存されている状態に戻しますか？")) return;
    st.dirty = false; st.hist = [];
    await P.open({ buf: ab(st.orig), name: S.name, ref: S.ref }, Math.min(S.cur, S.pages.length));
    banner();
  }
  async function undo() {
    const h = st.hist.pop();
    if (!h) return;
    st.bytes = h.bytes;
    st.dirty = st.hist.length > 0 || !(await sameBytes(h.bytes, st.orig));
    await P.open({ buf: ab(h.bytes), name: S.name, ref: S.ref }, h.page, { reload: true, key: S.key, free: h.free });
    banner();
    toast(`元に戻しました（${h.label}）`, 2000);
  }
  async function sameBytes(a, b) { return a.length === b.length && (await sha(a)) === (await sha(b)); }

  // 上の帯の「未保存の変更」
  function banner() {
    const box = S.root && S.root.querySelector(".pt-dirty");
    if (!box) return;
    box.hidden = !st.dirty;
    if (!st.dirty) { box.innerHTML = ""; return; }
    box.innerHTML = `<span class="pt-dot"></span><span class="pt-dtx">未保存の変更</span>
      <button class="pt-btn pt-sm" data-pg="undo" title="1つ前のページの操作を取り消す">元に戻す</button>
      <button class="pt-btn pt-sm pt-pri" data-pg="save" title="元の PDF に上書き保存">保存</button>
      <button class="pt-btn pt-sm" data-pg="saveas">別名で保存</button>
      <button class="pt-btn pt-sm" data-pg="discard" title="ページの変更を捨てて、保存されている状態に戻す">取り消し</button>`;
    box.querySelector('[data-pg="undo"]').disabled = !st.hist.length;
  }

  P.pagesDirty = () => st.dirty;
  P.confirmLeave = () => {
    if (!st.dirty) return true;
    if (!confirm("ページの変更が保存されていません。保存せずに閉じますか？")) return false;
    st.dirty = false; st.hist = []; banner();
    return true;
  };
  addEventListener("beforeunload", e => { if (st.dirty) { e.preventDefault(); e.returnValue = ""; } });

  /* ---------------- メニュー ---------------- */
  function menu(anchor) {
    if (!N || !N._openPop || !S.doc) return;
    const sel = selected(), what = sel.length > 1 ? `${sel.length}ページ（${rangeText(sel)}）` : `${sel[0]}ページ`;
    N._openPop(anchor, p => {
      p.classList.add("pt-thmenu", "pt-pgmenu");
      p.insertAdjacentHTML("beforeend", `<div class="cat">${what}</div>`);
      const item = (label, fn, cls) => {
        const b = document.createElement("button");
        b.className = "it" + (cls ? " " + cls : "");
        b.innerHTML = `<div>${label}</div>`;
        b.onclick = () => { N._closePop(); fn(); };
        p.appendChild(b);
      };
      item("右に回転", () => ops.rotate(1));
      item("左に回転", () => ops.rotate(-1));
      item("前に白紙を入れる", () => ops.blank(false));
      item("後ろに白紙を入れる", () => ops.blank(true));
      item("後ろに PDF を入れる…", () => ops.insertPdf(true));
      p.appendChild(document.createElement("hr"));
      item("最後に PDF をつなぐ（結合）…", () => ops.insertPdf(false));
      item("選んだページを別の PDF に（分割）…", () => ops.extract());
      item("すべてのページを選ぶ", () => ops.selectAll());
      p.appendChild(document.createElement("hr"));
      item("削除", () => ops.remove(), "danger");
    });
  }
  function menuAt(x, y) {
    const pin = document.createElement("div");
    Object.assign(pin.style, { position: "fixed", left: x + "px", top: y + "px", width: "1px", height: "1px" });
    document.body.appendChild(pin);
    menu(pin);
    setTimeout(() => pin.remove(), 0);
  }

  /* ---------------- 左のページ一覧：選ぶ・ドラッグ・右クリック ---------------- */
  function paintSel() {
    S.ui.thumbs.querySelectorAll(".pt-th").forEach(th => th.classList.toggle("sel", st.sel.has(+th.dataset.n)));
  }
  P.thumbClick = (e, n) => {
    if (e.ctrlKey || e.metaKey) { st.sel.has(n) ? st.sel.delete(n) : st.sel.add(n); }
    else if (e.shiftKey && st.last) { st.sel = new Set(); const [a, b] = [Math.min(st.last, n), Math.max(st.last, n)]; for (let i = a; i <= b; i++) st.sel.add(i); }
    else { st.sel = new Set([n]); P.goTo(n); }
    st.last = n;
    paintSel();
  };
  let line = null;
  function dropIndex(box, y) {        // 一覧の中の高さ y に落としたときの、入る位置（0 から）
    const ths = [...box.querySelectorAll(".pt-th")];
    for (let i = 0; i < ths.length; i++) { const r = ths[i].getBoundingClientRect(); if (y < r.top + r.height / 2) return i; }
    return ths.length;
  }
  P.hooks.thumbs.push(box => {
    paintSel();
    if (box._ptPages) return;
    box._ptPages = true;
    box.addEventListener("dragstart", e => {
      const th = e.target.closest(".pt-th"); if (!th) return;
      const n = +th.dataset.n;
      if (!st.sel.has(n)) { st.sel = new Set([n]); paintSel(); }
      e.dataTransfer.setData("text/x-pt-pages", rangeText(selected()));
      e.dataTransfer.effectAllowed = "move";
    });
    box.addEventListener("dragover", e => {
      if (![...e.dataTransfer.types].includes("text/x-pt-pages")) return;
      e.preventDefault();
      const i = dropIndex(box, e.clientY), ths = box.querySelectorAll(".pt-th");
      if (!line) { line = document.createElement("div"); line.className = "pt-dropline"; }
      const ref = ths[i];
      if (ref) box.insertBefore(line, ref); else box.appendChild(line);
    });
    box.addEventListener("dragleave", e => { if (!box.contains(e.relatedTarget) && line) line.remove(); });
    box.addEventListener("drop", e => {
      if (![...e.dataTransfer.types].includes("text/x-pt-pages")) return;
      e.preventDefault(); e.stopPropagation();
      if (line) line.remove();
      ops.move(selected(), dropIndex(box, e.clientY));
    });
    box.addEventListener("dragend", () => { if (line) line.remove(); });
    box.addEventListener("contextmenu", e => {
      const th = e.target.closest(".pt-th"); if (!th) return;
      e.preventDefault();
      const n = +th.dataset.n;
      if (!st.sel.has(n)) { st.sel = new Set([n]); st.last = n; paintSel(); }
      menuAt(e.clientX, e.clientY);
    });
  });
  // 一覧のページをドラッグできるようにする（作り直されるたびに）
  P.hooks.thumbs.push(box => box.querySelectorAll(".pt-th").forEach(th => { th.draggable = true; }));

  /* ---------------- 開く・閉じる・ボタン ---------------- */
  P.hooks.open.push(ctx => {
    if (ctx.reload) return;
    st.orig = new Uint8Array(ctx.buf.slice(0));
    st.bytes = st.orig;
    st.dirty = false; st.hist = []; st.sel = new Set(); st.last = 0;
    banner();
  });
  P.hooks.close.push(() => { if (!st.dirty) banner(); });
  P.hooks.pages.push(btn => menu(btn));
  document.addEventListener("click", e => {
    const b = e.target.closest && e.target.closest("[data-pg]");
    if (!b || b.disabled) return;
    ({ undo, save, saveas: saveAs, discard })[b.dataset.pg]();
  });
})();
