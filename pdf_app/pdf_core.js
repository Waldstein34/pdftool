/* =====================================================================
   pdf_core.js ― PDFツール（PDF ファイルそのものが主役の道具）
   ・開く：📂（パソコンのファイル選択の窓）／PDF を落とす／最近開いた一覧
   ・読む：全ページを縦に並べて表示。見えているページだけ描き、離れたページは片づける
   ・左：ページの縮小一覧／目次（PDF に目次があれば）
   ・上：ページ移動・拡大縮小（「幅」で窓の幅に合わせる）・PDF の中の検索
   ・文字の層：PDF の文字を選んでコピーできる。検索で見つかった所を光らせる
   表示の部品 pdf.js はノートの vendor/ にあるもの（3.11.174）を使う。
   ファイルの出し入れ（開く・最近の一覧・記録・保存）は PdfTool.io に頼む。
     サーバー版＝pdf_io_server.js（単体起動・Studio）／ブラウザだけで動く公開版＝pdf_io_browser.js
   窓口：PdfTool.mount(入れ物, {base, standalone}) / PdfTool.open({buf, name, ref}, ページ)
   ===================================================================== */
(() => {
  "use strict";
  const P = window.PdfTool = window.PdfTool || {};
  const S = P._S = {
    base: "", standalone: false, root: null, ui: {},
    doc: null, gen: 0, ref: null, name: "", pages: [],
    scale: 1, fit: true, cur: 1,
    q: "", hits: [], hitIdx: -1, texts: null, wantScroll: false,
  };
  // 機能を足す窓口（pdf_write.js が書き込みを付ける）。open({buf, key, name, ref, url}) / close() / layout() / save()
  const hooks = P.hooks = { open: [], close: [], layout: [], save: [], page: [], theme: [], mount: [], print: [], convert: [], pages: [], thumbs: [], select: [] };
  const fire = (k, ...a) => hooks[k].forEach(f => { try { f(...a); } catch (e) { console.error(e); } });
  const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];

  /* ---------------- 線のアイコン（Lucide と同じ形。ISC License） ---------------- */
  const ICONS = {
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    open: '<path d="M6 14l1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>', prev: '<path d="m15 18-6-6 6-6"/>', next: '<path d="m9 18 6-6-6-6"/>',
    up: '<path d="m18 15-6-6-6 6"/>', down: '<path d="m6 9 6 6 6-6"/>',
    minus: '<path d="M5 12h14"/>', plus: '<path d="M5 12h14M12 5v14"/>',
    fit: '<path d="M21 12H3M7 8l-4 4 4 4M17 8l4 4-4 4"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    save: '<path d="M12 15V3M7 10l5 5 5-5M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>',
    palette: '<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.65-.75 1.65-1.69 0-.44-.18-.84-.44-1.13-.29-.29-.44-.65-.44-1.13a1.64 1.64 0 0 1 1.67-1.67h2c3.05 0 5.55-2.5 5.55-5.55C21.96 6.01 17.46 2 12 2z"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4M10 13H8M16 17H8M16 13h-2"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    pages: '<rect x="8" y="2" width="13" height="16" rx="2"/><path d="M4 6v14a2 2 0 0 0 2 2h10"/>',
    convert: '<path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M4 7V4a2 2 0 0 1 2-2h8l6 6v12a2 2 0 0 1-2 2h-4"/><path d="m5 11-3 3 3 3M9 17l3-3-3-3M2 14h10"/>',
    print: '<path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8" rx="1"/>',
  };
  P.ICONS = ICONS;
  P.icon = (k, cls) => `<svg class="pt-svg${cls ? " " + cls : ""}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[k] || ""}</svg>`;

  /* ---------------- 小道具 ---------------- */
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  const io = () => P.io;
  // 検索用に文字をそろえる（大文字小文字・全角英数を同じに。文字数は変えない）
  const norm = s => s.replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/　/g, " ").toLowerCase();
  function when(t) {
    const d = new Date(t * 1000), now = new Date();
    const day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((day(now) - day(d)) / 864e5);
    if (diff === 0) return `今日 ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
    if (diff === 1) return "昨日";
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  }

  let pdfjs = null;
  P.loadPdfJs = () => loadPdfJs();
  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (pdfjs) return pdfjs;
    pdfjs = new Promise((ok, ng) => {
      const sc = document.createElement("script");
      sc.src = `${S.base}/notes_app/vendor/pdf.min.js`;
      sc.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = `${S.base}/notes_app/vendor/pdf.worker.min.js`; ok(window.pdfjsLib); };
      sc.onerror = () => { pdfjs = null; ng(new Error("pdf.js を読み込めませんでした")); };
      document.head.appendChild(sc);
    });
    return pdfjs;
  }

  /* ---------------- 画面を組み立てる ---------------- */
  P.mount = function (root, opt = {}) {
    S.base = opt.base || "";
    S.standalone = !!opt.standalone;
    const app = el("div", "pt-app");
    const I = P.icon;
    app.innerHTML = `
      <div class="pt-top pt-panel">
        <button class="pt-ic pt-doc" data-a="side" title="ページ一覧の表示／非表示">${I("menu")}</button>
        <button class="pt-btn" data-a="open" title="PDF を開く">${I("open")}<span class="pt-lbl">開く</span></button>
        <span class="pt-sep pt-doc"></span>
        <span class="pt-name pt-doc"></span>
        <button class="pt-ic pt-doc" data-a="close" title="閉じて最初の画面へ">${I("x")}</button>
        <span class="pt-dirty pt-doc" hidden></span>
        <span class="pt-grow"></span>
        <span class="pt-grp pt-doc"><button class="pt-ic" data-a="prev" title="前のページ（←）">${I("prev")}</button><input class="pt-pgin" inputmode="numeric" aria-label="ページ"><span class="pt-of">/ <span class="pt-total"></span></span><button class="pt-ic" data-a="next" title="次のページ（→）">${I("next")}</button></span>
        <span class="pt-sep pt-doc"></span>
        <span class="pt-grp pt-doc"><button class="pt-ic" data-a="zout" title="縮小（Ctrl＋ホイールでも）">${I("minus")}</button><span class="pt-zoom"></span><button class="pt-ic" data-a="zin" title="拡大">${I("plus")}</button><button class="pt-ic" data-a="fit" title="窓の幅に合わせる">${I("fit")}</button></span>
        <span class="pt-grow pt-grow2"></span>
        <span class="pt-slot pt-slot-top pt-doc"></span>
        <span class="pt-search pt-doc">${I("search")}<input placeholder="PDFの中を検索" title="Enter で次、Shift＋Enter で前（Ctrl＋F）"><span class="pt-hits"></span><button data-a="sprev" title="前">${I("up")}</button><button data-a="snext" title="次">${I("down")}</button></span>
        <button class="pt-ic pt-doc" data-a="pages" title="ページの操作（回転・削除・挿入・結合・分割）">${I("pages")}</button>
        <button class="pt-btn pt-doc" data-a="save" title="書き込みを重ねた PDF を保存（元の PDF はそのまま）">${I("save")}<span class="pt-lbl">書き込みごと保存</span></button>
        <button class="pt-ic pt-doc" data-a="convert" title="ほかの形に変換して保存（PowerPoint など）">${I("convert")}</button>
        <button class="pt-ic pt-doc" data-a="print" title="印刷（Ctrl＋P）。書き込みがあれば書き込みごと">${I("print")}</button>
        <span class="pt-slot pt-slot-extra"></span>
        <button class="pt-ic" data-a="theme" title="見た目（テーマ）を変える">${I("palette")}</button>
      </div>
      <div class="pt-slot pt-slot-strip pt-doc"></div>
      <div class="pt-body">
        <div class="pt-side pt-panel">
          <div class="pt-tabs"><button class="on" data-a="tab-th">ページ</button><button data-a="tab-ol">目次</button></div>
          <div class="pt-thumbs"></div>
          <div class="pt-outline" hidden></div>
        </div>
        <div class="pt-main">
          <div class="pt-view pt-panel"><div class="pt-blocks"><div class="pt-pages nb-b" data-id="doc"></div></div></div>
          <div class="pt-slot pt-slot-float"></div>
          <div class="pt-slot pt-slot-left"></div>
          <div class="pt-prog"><i></i></div>
        </div>
        <div class="pt-rpanel pt-panel"><div class="pt-rtitle">書き込み</div><div class="pt-slot pt-slot-right"></div></div>
      </div>
      <div class="pt-home pt-panel">
        <div class="pt-drop">${I("file", "pt-bigic")}<b>PDFをここに落とす</b>または <button data-a="open" class="pt-btn pt-openbig"></button></div>
        <div class="pt-recent"></div>
      </div>
      <div class="pt-tools nb-tools nb-app" data-nb-theme="host-glass"></div>`;
    root.appendChild(app);
    S.root = app;
    const q = s => app.querySelector(s);
    S.ui = { name: q(".pt-name"), pgin: q(".pt-pgin"), total: q(".pt-total"), zoom: q(".pt-zoom"), fit: q('[data-a="fit"]'),
      sin: q(".pt-search input"), hits: q(".pt-hits"), thumbs: q(".pt-thumbs"), outline: q(".pt-outline"),
      view: q(".pt-view"), blocks: q(".pt-blocks"), pages: q(".pt-pages"), recent: q(".pt-recent"), tools: q(".pt-tools"), save: q('[data-a="save"]') };
    q(".pt-openbig").innerHTML = `${I("open")}<span>${esc(io().openLabel || "開く")}</span>`;
    bind(app);
    loadRecent();
    // 起動のときに渡された PDF（ダブルクリックで開いたときなど）
    fire("mount", app);
    if (io().startup) io().startup((f, page) => openData(f, page));
  };

  function bind(app) {
    const U = S.ui;
    app.addEventListener("click", e => {
      const b = e.target.closest("[data-a]");
      if (!b || b.disabled) return;
      const a = b.dataset.a;
      if (a === "open") pick();
      else if (a === "close") { if (!P.confirmLeave || P.confirmLeave()) closeDoc(); }
      else if (a === "side") { app.classList.toggle("pt-side-off"); relayout(); }
      else if (a === "prev") goTo(S.cur - 1);
      else if (a === "next") goTo(S.cur + 1);
      else if (a === "zin" || a === "zout") zoomStep(a === "zin" ? 1 : -1);
      else if (a === "fit") { S.fit = true; relayout(); }
      else if (a === "save") fire("save");
      else if (a === "print") fire("print");
      else if (a === "convert") fire("convert", b);
      else if (a === "pages") fire("pages", b);
      else if (a === "theme") fire("theme", b);
      else if (a === "snext") search(1);
      else if (a === "sprev") search(-1);
      else if (a === "tab-th" || a === "tab-ol") {
        app.querySelectorAll(".pt-tabs button").forEach(x => x.classList.toggle("on", x === b));
        U.thumbs.hidden = a !== "tab-th"; U.outline.hidden = a !== "tab-ol";
      }
    });
    U.pgin.addEventListener("change", () => goTo(parseInt(U.pgin.value, 10) || S.cur));
    U.pgin.addEventListener("keydown", e => { if (e.key === "Enter") U.pgin.blur(); });
    U.sin.addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); search(e.shiftKey ? -1 : 1); }
      else if (e.key === "Escape") { U.sin.value = ""; setQuery(""); }
    });
    U.sin.addEventListener("input", () => { if (!U.sin.value) setQuery(""); });
    // 文字を選んだ範囲を、1行ずつ1本の帯で描く（ブラウザの塗りは、かたまりの間が切れたり高さがガタガタになるため使わない）
    let selRaf = 0;
    document.addEventListener("selectionchange", () => { if (!selRaf) selRaf = requestAnimationFrame(() => { selRaf = 0; paintSel(); }); });

    // スクロール：今のページを追う
    let raf = 0;
    U.view.addEventListener("scroll", () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; track(); }); });
    // Ctrl＋ホイールで拡大縮小
    U.view.addEventListener("wheel", e => { if (e.ctrlKey) { e.preventDefault(); zoomStep(e.deltaY < 0 ? 1 : -1); } }, { passive: false });
    // 窓の大きさが変わったら、「幅に合わせる」のときは合わせ直す
    let rt = 0;
    new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(() => { if (S.fit && S.doc) relayout(); }, 120); }).observe(U.view);

    // PDF を落とす
    app.addEventListener("dragover", e => { if ([...(e.dataTransfer?.types || [])].includes("Files")) { e.preventDefault(); app.classList.add("pt-over"); } });
    app.addEventListener("dragleave", e => { if (!app.contains(e.relatedTarget)) app.classList.remove("pt-over"); });
    app.addEventListener("drop", e => {
      app.classList.remove("pt-over");
      if (!e.dataTransfer || ![...e.dataTransfer.types].includes("Files")) return;
      e.preventDefault();
      // 落とした瞬間にしか中身を取り出せないので、ここで頼む
      const got = io().fromDrop(e.dataTransfer);
      if (got) Promise.resolve(got).then(f => { if (f) openData(f, 1); });
    });

    // キー：Ctrl＋F で検索、← → でページ（文字を入力中は除く）
    const keyTarget = S.standalone ? document : app;
    keyTarget.addEventListener("keydown", e => {
      if (!S.doc) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") { e.preventDefault(); U.sin.focus(); U.sin.select(); return; }
      if (e.target.closest && e.target.closest("input,textarea,[contenteditable]")) return;
      if (window.Notes && Notes.Free && Notes.Free.selection.length) return;   // 書き込みを選んでいるときは、矢印は書き込みを動かす
      if (e.key === "ArrowRight") { e.preventDefault(); goTo(S.cur + 1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); goTo(S.cur - 1); }
    });
  }

  /* ---------------- 開く・閉じる ---------------- */
  async function pick() {
    let f = null;
    try { f = await io().pick(); } catch (e) { alert(e.message || "開けませんでした"); }
    if (f) openData(f, 1);
  }

  // f＝{buf（中身）, name（名前）, ref（居場所。わからなければ null）}
  // opts.reload＝ページの操作のあとに開き直す（目印 key と居場所は元のまま、書き込みは opts.free を使う）
  async function openData(f, page, opts = {}) {
    if (!opts.reload && P.confirmLeave && !P.confirmLeave()) return false;
    const { buf, name, ref } = f;
    closeDoc(true);
    const my = ++S.gen;
    const U = S.ui;
    // PDF の中身から目印（SHA-256）を作る。書き込みはこの目印で PDF に結びつける（名前・場所が変わっても戻る）
    // ※ pdf.js に渡すと中身が移されて空になるので、その前に作る
    const key = opts.key || [...new Uint8Array(await crypto.subtle.digest("SHA-256", buf))].map(b => b.toString(16).padStart(2, "0")).join("");
    const url = URL.createObjectURL(new Blob([buf], { type: "application/pdf" }));   // 書き込みごと保存で読み直すとき用
    const copy = buf.slice(0);
    S.root.classList.add("pt-has-doc");
    U.name.textContent = name; U.name.title = io().label(ref) || name;
    U.pages.innerHTML = `<div class="pt-msg">PDF を読み込み中…</div>`;
    let doc;
    try {
      const lib = await loadPdfJs();
      // cMap：文字の形を持たない日本語の PDF でも文字を出すための対応表（ノートの vendor/cmaps/）
      const task = lib.getDocument({ data: new Uint8Array(buf), cMapUrl: `${S.base}/notes_app/vendor/cmaps/`, cMapPacked: true });
      task.onPassword = (cb, reason) => {
        const pw = prompt(reason === lib.PasswordResponses.INCORRECT_PASSWORD ? "パスワードが違います。もう一度入れてください" : "この PDF にはパスワードが必要です");
        if (pw === null) task.destroy(); else cb(pw);
      };
      doc = await task.promise;
    } catch (e) {
      if (my !== S.gen) return false;
      U.pages.innerHTML = `<div class="pt-msg">PDF を表示できませんでした（${esc(e.message || e)}）</div>`;
      return false;
    }
    if (my !== S.gen) { doc.destroy(); return false; }
    S.doc = doc; S.ref = ref; S.name = name; S.key = key; S.url = url;
    if (S.standalone) document.title = `${name} - PDF`;
    // 各ページの大きさ（拡大率1のとき）を先に調べて、場所だけ作っておく
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const pg = await doc.getPage(n);
      if (my !== S.gen) return false;
      const vp = pg.getViewport({ scale: 1 });
      pages.push({ n, page: pg, w: vp.width, h: vp.height, el: null, rs: 0, task: null, divs: null, strs: null, occ: [] });
    }
    S.pages = pages;
    U.pages.innerHTML = "";
    S.io = new IntersectionObserver(onSee, { root: U.view, rootMargin: "800px 0px" });
    for (const p of pages) {
      p.el = el("div", "pt-page nb-pdf-page"); p.el.dataset.n = p.n; p.el.dataset.pw = p.w;   // pw＝ページの幅（pt）。書き込みの文字の大きさを pt で選ぶときに使う
      U.pages.appendChild(p.el);
      S.io.observe(p.el);
    }
    U.total.textContent = doc.numPages;
    buildThumbs(my);
    buildOutline(my);
    relayout();
    goTo(Math.min(Math.max(1, page || 1), doc.numPages), true);
    fire("open", { buf: copy, key, name, ref, url, reload: !!opts.reload, free: opts.free });
    if (!opts.reload) io().opened(ref, { key });
    return true;
  }
  P.open = openData;

  function closeDoc(keepHome) {
    if (S.doc) fire("close");
    if (S.url && S.url.startsWith("blob:")) URL.revokeObjectURL(S.url);
    S.url = null; S.key = null;
    S.gen++;
    if (S.io) { S.io.disconnect(); S.io = null; }
    if (S.tio) { S.tio.disconnect(); S.tio = null; }
    for (const p of S.pages) if (p.task) try { p.task.cancel(); } catch (e) { /* 描きかけを止めるだけ */ }
    if (S.doc) S.doc.destroy();
    S.doc = null; S.ref = null; S.pages = []; S.texts = null; S.hits = []; S.hitIdx = -1; S.q = "";
    const U = S.ui;
    U.pages.innerHTML = ""; U.thumbs.innerHTML = ""; U.outline.innerHTML = ""; U.sin.value = ""; U.hits.textContent = "";
    if (!keepHome) {
      S.root.classList.remove("pt-has-doc");
      if (S.standalone) document.title = "PDF";
      loadRecent();
    }
  }

  async function loadRecent() {
    const box = S.ui.recent;
    let items;
    try { items = await io().recent(); } catch (e) { return; }
    box.innerHTML = items.length ? `<h3>最近開いたPDF</h3>` : "";
    for (const it of items) {
      const row = el("div", "pt-row", `${P.icon("file")}<span class="pt-n">${esc(it.name)}</span>${it.ink ? `<span class="pt-ink">書き込みあり</span>` : ""}<span class="pt-m">${it.page > 1 ? `p.${it.page}　` : ""}${when(it.opened)}</span><button class="pt-x" title="一覧から外す（ファイルは消えません）">${P.icon("x")}</button>`);
      row.title = io().label(it.ref) || it.name;
      row.addEventListener("click", async e => {
        if (e.target.closest(".pt-x")) { await io().forget(it); loadRecent(); return; }
        let f = null;
        try { f = await io().openRecent(it); } catch (err) { alert(err.message || "開けませんでした"); }
        if (f) openData(f, it.page); else loadRecent();
      });
      box.appendChild(row);
    }
  }

  /* ---------------- 並べる・拡大縮小 ---------------- */
  function relayout() {
    if (!S.doc) return;
    const U = S.ui;
    // 今見ている所（ページとその中の位置）を覚えておき、大きさを変えたあとで戻す
    const p0 = S.pages[S.cur - 1];
    const frac = p0 && p0.el.offsetHeight ? (U.view.scrollTop - p0.el.offsetTop) / p0.el.offsetHeight : 0;
    if (S.fit) {
      const maxW = Math.max(...S.pages.map(p => p.w));
      S.scale = Math.min(5, Math.max(0.25, (U.view.clientWidth - 48 - 20) / maxW));
    }
    for (const p of S.pages) {
      p.el.style.width = `${Math.floor(p.w * S.scale)}px`;
      p.el.style.height = `${Math.floor(p.h * S.scale)}px`;
    }
    U.zoom.textContent = `${Math.round(S.scale * 100)}%`;
    U.fit.classList.toggle("on", S.fit);
    // 幅に合わせているときは横に動かす必要がない（画素の端数で横のスクロールバーが出るのを防ぐ）
    U.view.style.overflowX = S.fit ? "hidden" : "auto";
    if (p0) U.view.scrollTop = p0.el.offsetTop + frac * p0.el.offsetHeight;
    fire("layout");
    // 見えているページを描き直す
    for (const p of S.pages) if (p.seen) draw(p);
  }

  function zoomStep(dir) {
    if (!S.doc) return;
    const s = S.scale;
    const next = dir > 0 ? ZOOMS.find(z => z > s + 0.001) : [...ZOOMS].reverse().find(z => z < s - 0.001);
    if (!next) return;
    S.fit = false; S.scale = next;
    relayout();
  }

  /* ---------------- ページを描く ---------------- */
  function onSee(entries) {
    for (const en of entries) {
      const p = S.pages[+en.target.dataset.n - 1];
      if (!p) continue;
      p.seen = en.isIntersecting;
      if (p.seen) draw(p); else drop(p);
    }
  }

  function drop(p) {   // 遠く離れたページは片づけて、メモリを空ける
    if (p.task) try { p.task.cancel(); } catch (e) { /* 止めるだけ */ }
    p.task = null; p.rs = 0; p.divs = null; p.strs = null; p.cv = null; p.occ = [];
    p.el.innerHTML = "";
  }

  async function draw(p) {
    if (p.rs === S.scale) return;
    const my = S.gen, scale = S.scale;
    p.rs = scale;
    if (p.task) try { p.task.cancel(); } catch (e) { /* 前の描きかけを止める */ }
    const lib = await loadPdfJs();
    // 細かい画面でもくっきり見えるよう画素を増やす。ただし大きすぎる絵は作らない
    let dpr = window.devicePixelRatio || 1;
    const px = p.w * p.h * scale * scale;
    if (px * dpr * dpr > 16e6) dpr = Math.max(1, Math.sqrt(16e6 / px));
    const vpCss = p.page.getViewport({ scale });
    const vpPx = p.page.getViewport({ scale: scale * dpr });
    const cv = document.createElement("canvas");
    cv.width = Math.floor(vpPx.width); cv.height = Math.floor(vpPx.height);
    const task = p.page.render({ canvasContext: cv.getContext("2d"), viewport: vpPx });
    p.task = task;
    try { await task.promise; } catch (e) { return; }
    if (my !== S.gen || p.rs !== scale) return;
    p.task = null;
    // 文字の層
    const tl = el("div", "textLayer");
    tl.style.setProperty("--scale-factor", scale);
    const divs = [], strs = [];
    try {
      const tc = await p.page.getTextContent();
      p.tc = tc;                 // 文字の書体・大きさを調べるとき用（pdf_font.js）
      if (my !== S.gen || p.rs !== scale) return;
      await lib.renderTextLayer({ textContentSource: tc, container: tl, viewport: vpCss, textDivs: divs, textContentItemsStr: strs }).promise;
    } catch (e) { /* 文字の層がなくても絵は見せる */ }
    if (my !== S.gen || p.rs !== scale) return;
    p.el.innerHTML = "";
    p.el.append(cv, tl);
    p.divs = divs; p.strs = strs; p.cv = cv;
    markHits(p);
    paintSel();
  }

  /* ---------------- ページ移動 ---------------- */
  P.goTo = (n, instant) => goTo(n, instant);
  function goTo(n, instant) {
    if (!S.doc) return;
    n = Math.min(Math.max(1, n), S.pages.length);
    const p = S.pages[n - 1];
    S.ui.view.scrollTo({ top: p.el.offsetTop - 12, behavior: instant ? "auto" : "auto" });
    setCur(n);
  }

  function track() {
    if (!S.doc) return;
    const v = S.ui.view, mid = v.scrollTop + v.clientHeight * 0.3;
    let n = 1;
    for (const p of S.pages) { if (p.el.offsetTop <= mid) n = p.n; else break; }
    if (n !== S.cur) setCur(n);
  }

  let saveT = 0;
  function setCur(n) {
    S.cur = n;
    fire("page", n, S.pages.length);
    if (document.activeElement !== S.ui.pgin) S.ui.pgin.value = n;
    S.ui.thumbs.querySelectorAll(".pt-th.on").forEach(x => x.classList.remove("on"));
    const th = S.ui.thumbs.children[n - 1];
    if (th) { th.classList.add("on"); if (!S.ui.thumbs.hidden) th.scrollIntoView({ block: "nearest" }); }
    // 読んでいるページを覚える（次に開いたとき、そこから）
    if (S.ref) { clearTimeout(saveT); const ref = S.ref, key = S.key; saveT = setTimeout(() => io().opened(ref, { key, page: n }), 1500); }
  }

  /* ---------------- 左：縮小一覧・目次 ---------------- */
  function buildThumbs(my) {
    const box = S.ui.thumbs;
    box.innerHTML = "";
    S.tio = new IntersectionObserver(ens => {
      for (const en of ens) {
        if (!en.isIntersecting) continue;
        S.tio.unobserve(en.target);
        const p = S.pages[+en.target.dataset.n - 1];
        if (!p || my !== S.gen) continue;
        // ブラウザ標準のビュワーと同じやり方：大きめ（2.5倍）に描いてから、なめらかに縮めて画面の画素ぴったりに置く
        // （小さいまま描くと、細い文字の線が欠けたりつぶれたりしてぼやける）
        const cv = en.target.querySelector("canvas");
        const cssW = cv.parentElement.clientWidth || 116, dpr = window.devicePixelRatio || 1;
        const outW = Math.round(cssW * dpr), outH = Math.round(outW * p.h / p.w);
        const over = S.pages.length > 100 ? 1.5 : 2.5;     // ページが多い PDF はメモリを控えめに
        const vp = p.page.getViewport({ scale: outW * over / p.w });
        const big = document.createElement("canvas");
        big.width = Math.floor(vp.width); big.height = Math.floor(vp.height);
        p.page.render({ canvasContext: big.getContext("2d"), viewport: vp }).promise.then(() => {
          if (my !== S.gen) return;
          cv.width = outW; cv.height = outH;
          const ctx = cv.getContext("2d");
          ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
          ctx.drawImage(big, 0, 0, outW, outH);
          big.width = big.height = 0;                        // 大きい絵はすぐ片づける
        }).catch(() => {});
      }
    }, { root: box, rootMargin: "400px 0px" });
    for (const p of S.pages) {
      const th = el("div", "pt-th", `<div class="pt-thp"><canvas style="aspect-ratio:${p.w}/${p.h}"></canvas></div>${p.n}`);
      th.dataset.n = p.n;
      th.addEventListener("click", e => { if (P.thumbClick) P.thumbClick(e, p.n); else goTo(p.n); });
      box.appendChild(th);
      S.tio.observe(th);
    }
    fire("thumbs", box);
  }

  async function buildOutline(my) {
    const box = S.ui.outline;
    let ol = null;
    try { ol = await S.doc.getOutline(); } catch (e) { /* 目次なし */ }
    if (my !== S.gen) return;
    if (!ol || !ol.length) { box.innerHTML = `<div class="pt-empty">この PDF には目次がありません</div>`; return; }
    const doc = S.doc;
    const put = (items, depth) => {
      for (const it of items) {
        const row = el("div", "pt-oi");
        row.textContent = it.title || "（題なし）";
        row.title = it.title || "";
        row.style.paddingLeft = `${6 + depth * 14}px`;
        if (it.bold) row.style.fontWeight = "600";
        row.addEventListener("click", async () => {
          try {
            let d = it.dest;
            if (typeof d === "string") d = await doc.getDestination(d);
            if (!Array.isArray(d)) return;
            const n = typeof d[0] === "number" ? d[0] + 1 : (await doc.getPageIndex(d[0])) + 1;
            goTo(n);
          } catch (e) { /* 行き先が壊れている目次は飛ばない */ }
        });
        box.appendChild(row);
        if (it.items && it.items.length) put(it.items, depth + 1);
      }
    };
    box.innerHTML = "";
    put(ol, 0);
  }

  /* ---------------- 検索 ---------------- */
  function setQuery(q) {
    S.q = q; S.hits = []; S.hitIdx = -1;
    S.ui.hits.textContent = "";
    for (const p of S.pages) markHits(p);
  }

  async function search(dir) {
    if (!S.doc) return;
    const raw = S.ui.sin.value.trim();
    if (!raw) return setQuery("");
    const q = norm(raw);
    if (q !== S.q) {
      // 全ページの文字を（1回だけ）集めて、どのページに何個あるか数える
      const my = S.gen;
      S.ui.hits.textContent = "検索中…";
      if (!S.texts) {
        const t = [];
        for (const p of S.pages) {
          const tc = await p.page.getTextContent();
          if (my !== S.gen) return;
          t.push(norm(tc.items.filter(i => "str" in i).map(i => i.str).join("")));
        }
        S.texts = t;
      }
      setQuery(q);
      S.texts.forEach((t, i) => { let k = 0, at = t.indexOf(q); while (at >= 0) { S.hits.push({ n: i + 1, k: k++ }); at = t.indexOf(q, at + q.length); } });
      S.hitIdx = -1;
      // 今のページ以降の最初の一つから
      if (dir > 0) { const i = S.hits.findIndex(h => h.n >= S.cur); S.hitIdx = (i < 0 ? 0 : i) - 1; }
      else S.hitIdx = 0;   // 前へ：いちばん最後の一つから
    }
    if (!S.hits.length) { S.ui.hits.textContent = "0件"; return; }
    S.hitIdx = (S.hitIdx + dir + S.hits.length) % S.hits.length;
    S.ui.hits.textContent = `${S.hitIdx + 1}/${S.hits.length}`;
    const h = S.hits[S.hitIdx];
    S.wantScroll = true;
    for (const p of S.pages) markHits(p);
    const p = S.pages[h.n - 1];
    if (!p.divs) goTo(h.n);   // まだ描いていないページなら、まずそこへ（描き終わると光る）
  }

  /* ---------------- 選んだ文字の帯 ---------------- */
  // かたまり（span）ごとに、選ばれている部分の四角を集め、同じ行のものを1本にまとめて描く
  // 選んでいる文字の範囲を、ページごとの「行の四角」（ページの左上からの px）にまとめて返す
  function selLines() {
    const out = [];
    const sel = getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed || !S.doc) return out;
    const range = sel.getRangeAt(0);
    for (const p of S.pages) {
      if (!p.divs || !p.el.isConnected || !range.intersectsNode(p.el)) continue;
      const pr = p.el.getBoundingClientRect();
      const boxes = [];
      for (const d of p.divs) {
        const tn = d.firstChild;
        if (!tn || tn.nodeType !== 3 || !range.intersectsNode(d)) continue;
        const sub = document.createRange();
        sub.selectNodeContents(tn);
        if (range.startContainer === tn) sub.setStart(tn, range.startOffset);
        if (range.endContainer === tn) sub.setEnd(tn, range.endOffset);
        if (sub.collapsed || !sub.toString().trim()) continue;
        const r = sub.getBoundingClientRect();
        if (r.width < 0.5 || r.height < 0.5) continue;
        boxes.push({ l: r.left - pr.left, t: r.top - pr.top, r: r.right - pr.left, b: r.bottom - pr.top });
      }
      // 行ごとにまとめる：縦に半分以上重なっていれば同じ行
      boxes.sort((a, b) => a.t - b.t || a.l - b.l);
      const lines = [];
      for (const x of boxes) {
        const h = x.b - x.t;
        const ln = lines.find(L => Math.min(L.b, x.b) - Math.max(L.t, x.t) >= Math.min(h, L.b - L.t) * 0.5);
        if (ln) { ln.l = Math.min(ln.l, x.l); ln.r = Math.max(ln.r, x.r); ln.t = Math.min(ln.t, x.t); ln.b = Math.max(ln.b, x.b); }
        else lines.push({ ...x });
      }
      if (lines.length) out.push({ n: p.n, width: pr.width, height: pr.height, lines });
    }
    return out;
  }
  P.selLines = selLines;
  // 選んだ文字の帯を、1行ずつ1本で描く
  function paintSel() {
    if (!S.root) return;
    S.root.querySelectorAll(".pt-selbar").forEach(b => b.remove());
    for (const pg of selLines()) {
      const p = S.pages[pg.n - 1];
      for (const L of pg.lines) {
        const bar = el("div", "pt-selbar");
        Object.assign(bar.style, { left: L.l + "px", top: L.t + "px", width: L.r - L.l + "px", height: L.b - L.t + "px" });
        p.el.appendChild(bar);
      }
    }
    fire("select");
  }

  // 1ページの文字の層に、見つかった所の印を付ける
  function markHits(p) {
    if (!p.divs) return;
    p.divs.forEach(d => d.classList.remove("pt-hit", "pt-cur"));
    p.occ = [];
    if (!S.q) return;
    // 文字の層の文字をつなげ、どの文字がどの部品にあるかの対応を作る
    const owner = [];
    let text = "";
    p.strs.forEach((s, i) => { text += norm(s); for (let j = 0; j < s.length; j++) owner.push(i); });
    let at = text.indexOf(S.q);
    while (at >= 0) {
      const set = new Set();
      for (let j = at; j < at + S.q.length; j++) set.add(owner[j]);
      const ds = [...set].map(i => p.divs[i]).filter(Boolean);
      ds.forEach(d => d.classList.add("pt-hit"));
      p.occ.push(ds);
      at = text.indexOf(S.q, at + S.q.length);
    }
    const h = S.hits[S.hitIdx];
    if (h && h.n === p.n && p.occ[h.k]) {
      p.occ[h.k].forEach(d => d.classList.add("pt-cur"));
      if (S.wantScroll) {
        S.wantScroll = false;
        const d = p.occ[h.k][0], v = S.ui.view;
        v.scrollTop = p.el.offsetTop + d.offsetTop - v.clientHeight / 3;
      }
    }
  }
})();
