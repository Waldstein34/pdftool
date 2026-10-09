/* =====================================================================
   notes_icons.js ― 絵文字とアイコン

   アイコンの値（ページ・コールアウト・文中・自由配置で共通）
     ・絵文字そのもの（例 "⭐"）
     ・"icon:パック:名前"（例 "icon:lucide:star"）
   パック
     std    … 標準（Alter から移植した52種。notes_icons_std.js）
     lucide … Lucide（約1700種。vendor/lucide-icons.js。使うときに読み込む）
     win    … Windows 標準（Segoe Fluent Icons。パソコンの文字の部品で表示。名前は vendor/segoe-fluent.json）
     k…     … ユーザーが外から追加したパック（サーバーの icons/）
   絵文字：vendor/emoji-ja.json（emojibase-data 日本語版。カテゴリと日本語の検索）
   雰囲気を変える：アイコンの「何を表すか」（MEAN の表、なければ名前を整えたもの）で、別のパックの同じものに置き換える
   ===================================================================== */
window.Notes = window.Notes || {};
(function () {
  "use strict";
  const N = window.Notes;
  const el = (...a) => N._el(...a);
  const esc = s => N._esc(s);
  const base = () => (N._S && N._S.base) || "";
  const LS = {
    get(k, fb) { try { const v = localStorage.getItem(k); return v === null ? fb : JSON.parse(v); } catch (e) { return fb; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };

  /* ---------------- パックの読み込み ---------------- */
  const STD = Object.fromEntries((N.STD_ICONS || []).map(i => [i.id, i]));
  let LUC = null, lucLoading = null, WIN = null, winLoading = null, USER = [], EMO = null, emoLoading = null;
  let winFont = null;            // Windows 標準アイコンの文字の部品があるか
  function loadScript(src) {
    return new Promise((ok, ng) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = ng; document.head.appendChild(s); });
  }
  function loadLucide() {
    if (LUC) return Promise.resolve(LUC);
    if (!lucLoading) lucLoading = loadScript(`${base()}/notes_app/vendor/lucide-icons.js`).then(() => { LUC = window.LUCIDE_ICONS || {}; refreshPending(); return LUC; });
    return lucLoading;
  }
  function loadWin() {
    if (WIN) return Promise.resolve(WIN);
    if (!winLoading) winLoading = fetch(`${base()}/notes_app/vendor/segoe-fluent.json`).then(r => r.json()).then(list => {
      WIN = {}; list.forEach(([code, name]) => { if (!WIN[name]) WIN[name] = code; }); refreshPending(); return WIN;
    });
    return winLoading;
  }
  function loadEmoji() {
    if (EMO) return Promise.resolve(EMO);
    if (!emoLoading) emoLoading = fetch(`${base()}/notes_app/vendor/emoji-ja.json`).then(r => r.json()).then(d => { EMO = d.filter(e => e.group != null && e.group !== 2); return EMO; });
    return emoLoading;
  }
  async function loadUser() {
    try { const r = await N.api("/api/notes", { act: "iconpacks" }); USER = (r.ok && r.packs) || []; } catch (e) { USER = []; }
    refreshPending();
    return USER;
  }
  // Windows 標準アイコンの文字の部品：Windows なら入っている（11 は Segoe Fluent Icons、10 は Segoe MDL2 Assets）。
  // 文字の幅で確かめる方法は、Windows が別の部品で代わりに描くため当てにならないので使わない
  function hasWinFont() {
    if (winFont == null) winFont = /Windows/i.test(navigator.userAgent) ? "'Segoe Fluent Icons','Segoe MDL2 Assets'" : "";
    return winFont;
  }
  /* ---------------- 「何を表すか」の対応表（雰囲気を変えるため） ----------------
     標準の id を「意味」とし、Lucide・Windows の候補名を並べる（最初に見つかったものを使う） */
  const MEAN = {
    "arrow-right": [["arrow-right"], ["Forward", "ChevronRight"]], "arrow-left": [["arrow-left"], ["Back", "ChevronLeft"]],
    "arrow-up": [["arrow-up"], ["Up", "ChevronUp"]], "arrow-down": [["arrow-down"], ["Down", "ChevronDown"]],
    "arrow-up-right": [["arrow-up-right"], ["OpenInNewWindow"]], "refresh": [["refresh-cw", "refresh-ccw"], ["Refresh", "Sync"]],
    "rotate-back": [["rotate-ccw", "undo-2", "undo"], ["Undo"]], "chevrons-right": [["chevrons-right"], ["DoubleChevronRight", "ChevronRight"]],
    "trending-up": [["trending-up"], ["Market"]], "corner-down-right": [["corner-down-right"], ["Reply"]],
    "check": [["check"], ["CheckMark", "Accept"]], "x": [["x"], ["Cancel", "ChromeClose"]], "plus": [["plus"], ["Add"]], "minus": [["minus"], ["Remove"]],
    "alert": [["triangle-alert", "alert-triangle"], ["Warning"]], "info": [["info"], ["Info"]], "star": [["star"], ["FavoriteStar", "FavoriteStarFill"]],
    "heart": [["heart"], ["Heart", "HeartFill"]], "flag": [["flag"], ["Flag"]], "bookmark": [["bookmark"], ["Bookmarks", "BookmarksMirrored"]],
    "thumbs-up": [["thumbs-up"], ["Like"]], "circle-check": [["circle-check", "check-circle"], ["Completed", "CompletedSolid"]],
    "book": [["book", "book-open"], ["Library", "ReadingMode"]], "pen": [["pen", "pencil"], ["Edit", "PenWorkspace"]],
    "bulb": [["lightbulb"], ["Lightbulb"]], "clock": [["clock"], ["Clock"]], "calendar": [["calendar"], ["Calendar"]],
    "bar-chart": [["chart-bar", "bar-chart-3", "bar-chart"], ["BarChart4", "BarChartVertical"]], "file-text": [["file-text"], ["Document", "Page"]],
    "graduation": [["graduation-cap"], ["Education"]], "check-square": [["square-check", "check-square"], ["CheckboxComposite"]],
    "award": [["award", "trophy"], ["Trophy", "Medal"]], "target": [["target"], ["Target", "Location"]],
    "circle": [["circle"], ["CircleRing"]], "circle-fill": [["circle"], ["CircleFill"]], "square": [["square"], ["Checkbox"]], "square-fill": [["square"], ["CheckboxFill"]],
    "triangle": [["triangle"], ["TriangleUp"]], "triangle-fill": [["triangle"], ["TriangleSolid"]], "diamond": [["diamond"], []], "hexagon": [["hexagon"], []], "octagon": [["octagon"], []],
    "home": [["house", "home"], ["Home"]], "mail": [["mail"], ["Mail"]], "bell": [["bell"], ["Ringer", "Alarm"]], "camera": [["camera"], ["Camera"]],
    "map-pin": [["map-pin"], ["MapPin", "Pin"]], "settings": [["settings"], ["Settings", "Setting"]], "search": [["search"], ["Search"]],
    "user": [["user"], ["Contact", "Person"]], "link": [["link"], ["Link"]], "folder": [["folder"], ["Folder"]],
  };
  const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const kana = s => String(s || "").normalize("NFKC").toLowerCase().replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
  function names(pack) {
    if (pack === "std") return Object.keys(STD);
    if (pack === "lucide") return LUC ? Object.keys(LUC) : [];
    if (pack === "win") return WIN ? Object.keys(WIN) : [];
    const u = USER.find(p => p.id === pack); return u ? u.icons.map(i => i.name) : [];
  }
  function meaningOf(pack, name) {
    if (pack === "std") return name;
    const col = pack === "lucide" ? 0 : pack === "win" ? 1 : -1;
    if (col >= 0) for (const m in MEAN) if (MEAN[m][col].includes(name)) return m;
    const n = norm(name);
    for (const m in MEAN) if (norm(m) === n || MEAN[m][0].some(x => norm(x) === n) || MEAN[m][1].some(x => norm(x) === n)) return m;
    return n;                               // 表にないものは、名前を整えたものを「意味」とする
  }
  function nameIn(pack, meaning) {
    const list = names(pack), set = new Set(list);
    if (pack === "std" && STD[meaning]) return meaning;
    const row = MEAN[meaning];
    if (row) { const c = pack === "lucide" ? row[0] : pack === "win" ? row[1] : null; if (c) for (const x of c) if (set.has(x)) return x; }
    const n = norm(meaning);
    return list.find(x => norm(x) === n) || (row ? list.find(x => [...row[0], ...row[1], meaning].some(y => norm(y) === norm(x))) : null) || null;
  }

  /* ---------------- 表示 ---------------- */
  const parse = ref => { const m = /^icon:([a-z0-9_-]+):(.+)$/.exec(ref || ""); return m ? { pack: m[1], name: m[2] } : null; };
  const svgWrap = body => `<svg class="nb-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  function html(ref, fallback) {
    if (!ref) return fallback != null ? esc(fallback) : "";
    const p = parse(ref);
    if (!p) return `<span class="nb-emo">${esc(ref)}</span>`;
    if (p.pack === "std") return STD[p.name] ? svgWrap(STD[p.name].body) : esc(fallback || "□");
    if (p.pack === "lucide") {
      if (LUC) return LUC[p.name] ? svgWrap(LUC[p.name]) : esc(fallback || "□");
      loadLucide(); return `<span class="nb-ic nb-pending" data-icon="${esc(ref)}"></span>`;
    }
    if (p.pack === "win") {
      if (!WIN) { loadWin(); return `<span class="nb-ic nb-pending" data-icon="${esc(ref)}"></span>`; }
      const code = WIN[p.name];
      if (code && hasWinFont()) return `<span class="nb-ic nb-wic" style="font-family:${hasWinFont()}">&#x${code};</span>`;
      // この環境に文字の部品がないときは、同じ意味の Lucide で代わりに表示
      const alt = nameIn("lucide", meaningOf("win", p.name));
      if (alt) return html(`icon:lucide:${alt}`, fallback);
      return esc(fallback || "□");
    }
    const u = USER.find(x => x.id === p.pack), it = u && u.icons.find(i => i.name === p.name);
    if (it) return `<img class="nb-ic nb-uic" src="${base()}/api/notes/icon?pack=${encodeURIComponent(u.id)}&file=${encodeURIComponent(it.file)}" alt="">`;
    if (!userLoaded) { loadUser(); return `<span class="nb-ic nb-pending" data-icon="${esc(ref)}"></span>`; }
    return esc(fallback || "□");
  }
  let userLoaded = false;
  function refreshPending() {
    document.querySelectorAll(".nb-pending[data-icon]").forEach(s => {
      const h = html(s.dataset.icon);
      if (!/nb-pending/.test(h)) { const t = document.createElement("span"); t.innerHTML = h; s.replaceWith(...t.childNodes); }
    });
  }

  /* ---------------- 選ぶ画面（絵文字／アイコン） ---------------- */
  const GROUPS = [[0, "😀", "顔・感情"], [1, "👋", "人・体"], [3, "🐶", "動物・自然"], [4, "🍎", "食べ物"], [5, "✈️", "旅行・場所"], [6, "⚽", "活動"], [7, "💡", "物"], [8, "❤️", "記号"], [9, "🏁", "旗"]];
  const RECENT_KEY = "notes.iconRecent";
  // よく使うのに、データでは漢字だけで書かれている言葉の読み
  const YOMI = { "ほし": ["星"], "はな": ["花"], "ひ": ["火"], "みず": ["水"], "き": ["木"], "やま": ["山"], "うみ": ["海"], "そら": ["空"],
    "あめ": ["雨"], "ゆき": ["雪"], "くも": ["雲"], "たいよう": ["太陽"], "つき": ["月"], "かお": ["顔"], "て": ["手"], "め": ["目"], "くち": ["口"],
    "あし": ["足"], "ほん": ["本"], "かね": ["金", "お金"], "おかね": ["お金"], "いえ": ["家"], "くるま": ["車"], "でんしゃ": ["電車"], "ひこうき": ["飛行機"],
    "とけい": ["時計"], "でんわ": ["電話"], "ちず": ["地図"], "にく": ["肉"], "さかな": ["魚"], "とり": ["鳥"], "うし": ["牛"], "うま": ["馬"], "ぶた": ["豚"],
    "さる": ["猿"], "かみなり": ["雷"], "あい": ["愛"], "わらう": ["笑"], "なく": ["泣"], "おこる": ["怒"], "がっこう": ["学校"], "べんきょう": ["勉強", "学"],
    "おんがく": ["音楽"], "しごと": ["仕事"], "かぎ": ["鍵"], "てがみ": ["手紙"], "しるし": ["印"], "はた": ["旗"], "やじるし": ["矢印"], "まる": ["丸"] };
  const recent = () => LS.get(RECENT_KEY, []);
  function remember(ref) { const r = [ref].concat(recent().filter(x => x !== ref)).slice(0, 24); LS.set(RECENT_KEY, r); }
  function hidden() { return ((N.tree && N.tree().settings) || {}).iconHidden || []; }
  function packList() {
    const all = [{ id: "std", name: "標準" }, { id: "lucide", name: "Lucide" }, { id: "win", name: "Windows" }].concat(USER.map(u => ({ id: u.id, name: u.name, user: true })));
    return all;
  }

  /* pick(anchor, cur, onPick, {remove:true}) … onPick(値) / 外すときは onPick(null) */
  function pick(anchor, cur, onPick, opt = {}) {
    let tab = LS.get("notes.iconTab", "emoji"), pack = LS.get("notes.iconPack", "std"), q = "", grp = GROUPS[0][0];
    if (parse(cur)) tab = "icon";
    N._openPop(anchor, p => {
      p.classList.add("nb-ipick");
      p.innerHTML = `<div class="nb-itabs"><button data-t="emoji">😀 絵文字</button><button data-t="icon">★ アイコン</button></div>
        <input class="nb-isearch" type="text" spellcheck="false"><div class="nb-ibar"></div><div class="nb-igrid"></div><div class="nb-ifoot"></div>`;
      const search = p.querySelector(".nb-isearch"), bar = p.querySelector(".nb-ibar"), grid = p.querySelector(".nb-igrid"), foot = p.querySelector(".nb-ifoot");
      const choose = ref => { remember(ref); N._closePop(); onPick(ref); };
      const cell = (ref, title) => { const b = el("button", "nb-icell" + (ref === cur ? " cur" : ""), html(ref)); b.title = title || ""; b.onclick = () => choose(ref); return b; };
      function paint() {
        p.querySelectorAll(".nb-itabs button").forEach(b => b.classList.toggle("on", b.dataset.t === tab));
        search.placeholder = tab === "emoji" ? "絵文字を探す（例：ねこ、にっこり、ほし）" : "アイコンを探す（英語の名前・日本語は標準のみ）";
        bar.innerHTML = ""; grid.innerHTML = ""; foot.innerHTML = "";
        if (tab === "emoji") paintEmoji(); else paintIcons();
        const f = el("div", "row");
        if (opt.remove && cur) { const rm = el("button", "nb-btn", "✕ 外す"); rm.onclick = () => { N._closePop(); onPick(null); }; f.appendChild(rm); }
        if (tab === "icon") {
          const mg = el("button", "nb-btn", "📦 パックの管理"); mg.onclick = () => { N._closePop(); manager(); }; f.appendChild(mg);
          if (N.curPage && N.curPage()) { const sw = el("button", "nb-btn", "🎨 このページの雰囲気を変える"); sw.onclick = e => swapMenu(e.currentTarget); f.appendChild(sw); }
        }
        foot.appendChild(f);
      }
      function paintEmoji() {
        const rc = recent().filter(r => !parse(r));
        if (!EMO) { grid.innerHTML = `<div class="nb-imsg">読み込み中…</div>`; loadEmoji().then(paint); return; }
        if (!q) {
          GROUPS.forEach(([g, ic, n]) => { const b = el("button", "nb-igrp" + (g === grp ? " on" : ""), ic); b.title = n; b.onclick = () => { grp = g; paint(); }; bar.appendChild(b); });
          if (rc.length) { grid.appendChild(el("div", "nb-icat", "最近使ったもの")); rc.forEach(r => grid.appendChild(cell(r))); grid.appendChild(el("div", "nb-icat", (GROUPS.find(x => x[0] === grp) || [])[2] || "")); }
          EMO.filter(e => e.group === grp).forEach(e => grid.appendChild(cell(e.unicode, e.label)));
        } else {
          const nq = kana(q);      // 「ねこ」で「ネコ」も見つかる
          const kj = YOMI[nq];      // 漢字でしか書かれていない言葉は、読みからも探す（「ほし」→「星」）
          const has = t => kana(t).includes(nq) || (kj && kj.some(k => t.includes(k)));
          const hits = EMO.filter(e => has(e.label) || (e.tags || []).some(has) || (e.emoticon && String(e.emoticon).includes(q))).slice(0, 400);
          if (!hits.length) grid.innerHTML = `<div class="nb-imsg">見つかりませんでした</div>`;
          hits.forEach(e => grid.appendChild(cell(e.unicode, e.label)));
        }
      }
      function paintIcons() {
        const hid = hidden();
        packList().forEach(pk => {
          if (hid.includes(pk.id)) return;
          const b = el("button", "nb-ipack" + (pk.id === pack ? " on" : ""), esc(pk.name)); b.onclick = () => { pack = pk.id; LS.set("notes.iconPack", pack); paint(); }; bar.appendChild(b);
        });
        const rc = recent().filter(r => parse(r));
        if (!q && rc.length) { grid.appendChild(el("div", "nb-icat", "最近使ったもの")); rc.forEach(r => grid.appendChild(cell(r))); grid.appendChild(el("div", "nb-icat", "")); }
        const need = pack === "lucide" ? loadLucide : pack === "win" ? loadWin : null;
        if ((pack === "lucide" && !LUC) || (pack === "win" && !WIN)) { grid.insertAdjacentHTML("beforeend", `<div class="nb-imsg">読み込み中…</div>`); need().then(paint); return; }
        if (pack === "win" && !hasWinFont()) grid.insertAdjacentHTML("beforeend", `<div class="nb-imsg">このパソコンには Windows 標準アイコンの文字の部品がないため、同じ意味の Lucide で代わりに表示します</div>`);
        const nq = q.toLowerCase();
        let list;
        if (pack === "std") list = Object.values(STD).filter(i => !nq || i.id.includes(nq) || kana(i.name).includes(kana(q)) || (i.kw || []).some(k => kana(k).includes(kana(q)))).map(i => [i.id, i.name]);
        else list = names(pack).filter(n => !nq || n.toLowerCase().includes(nq)).map(n => [n, n]);
        const LIMIT = 300, shown = list.slice(0, LIMIT);
        shown.forEach(([n, t]) => grid.appendChild(cell(`icon:${pack}:${n}`, t)));
        if (!list.length) grid.insertAdjacentHTML("beforeend", `<div class="nb-imsg">見つかりませんでした</div>`);
        if (list.length > LIMIT) {
          const more = el("button", "nb-imore", `ほかに ${list.length - LIMIT} 個（検索で絞り込めます）`);
          more.onclick = () => { more.remove(); list.slice(LIMIT, LIMIT + 600).forEach(([n, t]) => grid.appendChild(cell(`icon:${pack}:${n}`, t))); };
          grid.appendChild(more);
        }
      }
      p.querySelectorAll(".nb-itabs button").forEach(b => b.onclick = () => { tab = b.dataset.t; LS.set("notes.iconTab", tab); q = ""; search.value = ""; paint(); });
      let st = 0;
      search.addEventListener("input", () => { clearTimeout(st); st = setTimeout(() => { q = search.value.trim(); paint(); }, 120); });
      if (!userLoaded) { userLoaded = true; loadUser().then(() => { if (tab === "icon") paint(); }); }
      paint();
      setTimeout(() => search.focus(), 0);
    });
  }

  /* ---------------- 雰囲気を変える（このページのアイコンを、別のパックの同じものに） ---------------- */
  function swapMenu(anchor) {
    N._openPop(anchor, p => {
      p.appendChild(el("div", "cat", "このページのアイコンを、どのパックにそろえますか？"));
      packList().filter(pk => !hidden().includes(pk.id)).forEach(pk => {
        const it = el("button", "it", `<div>${esc(pk.name)}<small>同じものを表すアイコンがあれば入れ替え、なければそのまま</small></div>`);
        it.onclick = async () => { N._closePop(); await swapPage(pk.id); };
        p.appendChild(it);
      });
    });
  }
  async function swapPage(target) {
    if (target === "lucide") await loadLucide(); if (target === "win") await loadWin();
    await loadLucide(); await loadWin(); if (!userLoaded) { userLoaded = true; await loadUser(); }
    let changed = 0, kept = 0;
    const conv = ref => {
      const p = parse(ref); if (!p || p.pack === target) return ref;
      const n = nameIn(target, meaningOf(p.pack, p.name));
      if (n) { changed++; return `icon:${target}:${n}`; }
      kept++; return ref;
    };
    N.Editor.transform((blocks, free) => {
      blocks.forEach(b => {
        if (b.type === "callout" && b.icon) b.icon = conv(b.icon);
        if (b.html && b.html.includes('data-ref="icon:')) b.html = b.html.replace(/data-ref="(icon:[^"]+)"/g, (m, r) => `data-ref="${conv(r)}"`);
      });
      free.forEach(o => { if (o.kind === "icon" && o.icon) o.icon = conv(o.icon); });
    });
    const meta = N._S.meta;
    if (meta && parse(meta.icon)) { const nv = conv(meta.icon); if (nv !== meta.icon) await N.setPageIcon(nv); }
    const s = document.getElementById("nbStatus"); if (s) s.textContent = `アイコンを ${changed} 個入れ替えました${kept ? `（${kept} 個は同じものがないのでそのまま）` : ""}`;
  }

  /* ---------------- パックの管理 ---------------- */
  function manager() {
    const app = document.querySelector(".nb-main-root");
    const m = el("div", "nb-dbmodal nb-app nb-imgr"); m.dataset.nbTheme = app ? app.dataset.nbTheme : "";
    const panel = el("div", "nb-dbpanel");
    m.appendChild(panel); document.body.appendChild(m);
    const close = () => { m.remove(); document.removeEventListener("keydown", esc_); };
    const esc_ = e => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", esc_);
    m.addEventListener("mousedown", e => { if (e.target === m) close(); });
    async function paint() {
      await loadUser();
      const hid = hidden();
      panel.innerHTML = `<div class="nb-dbbar"><span class="crumb">📦 アイコンパックの管理</span><button class="nb-ibtn x" title="閉じる">✕</button></div>
        <div class="nb-imlist"></div>
        <div class="nb-imdrop"><b>＋ パックを追加</b><br>SVG・PNG のファイル、またはそれをまとめた ZIP を、ここにドラッグするか、押して選んでください。<br><small>ファイル名がアイコンの名前になります（例：star.svg →「star」）。同じ名前にすると「雰囲気を変える」で入れ替わります</small></div>`;
      panel.querySelector(".x").onclick = close;
      const ul = panel.querySelector(".nb-imlist");
      packList().forEach(pk => {
        const n = pk.user ? (USER.find(u => u.id === pk.id) || { icons: [] }).icons.length : pk.id === "std" ? Object.keys(STD).length : pk.id === "lucide" ? 1745 : 1533;
        const row = el("div", "nb-imrow", `<label><input type="checkbox" ${hid.includes(pk.id) ? "" : "checked"}> <b>${esc(pk.name)}</b> <small>${n}個${pk.user ? "・追加したパック" : "・最初から入っているパック"}</small></label><span class="acts"></span>`);
        row.querySelector("input").onchange = async e => {
          const h = new Set(hidden()); if (e.target.checked) h.delete(pk.id); else h.add(pk.id);
          const r = await N.api("/api/notes", { act: "settings", iconHidden: [...h] });
          if (r.ok) N._S.tree.settings = r.tree.settings;
        };
        if (pk.user) {
          const rn = el("button", "nb-btn", "名前を変える"), dl = el("button", "nb-btn danger", "削除");
          rn.onclick = async () => { const v = prompt("パックの名前", pk.name); if (v == null) return; await N.api("/api/notes", { act: "iconpack_rename", id: pk.id, name: v }); paint(); };
          dl.onclick = async () => { if (!confirm(`パック「${pk.name}」を削除します。\nこのパックのアイコンを使っている場所は「□」になります。`)) return; await N.api("/api/notes", { act: "iconpack_delete", id: pk.id }); paint(); };
          row.querySelector(".acts").append(rn, dl);
        }
        ul.appendChild(row);
      });
      const drop = panel.querySelector(".nb-imdrop");
      const add = async files => {
        files = [...files].filter(f => /\.(svg|png|zip)$/i.test(f.name)); if (!files.length) { alert("SVG・PNG・ZIP のファイルを選んでください"); return; }
        const name = prompt("パックの名前", files.length === 1 && /\.zip$/i.test(files[0].name) ? files[0].name.replace(/\.zip$/i, "") : "追加したアイコン"); if (name == null) return;
        drop.innerHTML = "取り込み中…";
        const enc = f => new Promise(ok => { const fr = new FileReader(); fr.onload = () => ok({ name: f.name, data: String(fr.result).split(",")[1] || "" }); fr.readAsDataURL(f); });
        const r = await N.api("/api/notes", { act: "iconpack_add", name, files: await Promise.all(files.map(enc)) });
        if (!r.ok) alert(r.error || "取り込めませんでした"); else LS.set("notes.iconPack", r.pack.id);
        paint();
      };
      drop.onclick = () => { const i = document.createElement("input"); i.type = "file"; i.multiple = true; i.accept = ".svg,.png,.zip"; i.onchange = () => add(i.files); i.click(); };
      drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("over"); });
      drop.addEventListener("dragleave", () => drop.classList.remove("over"));
      drop.addEventListener("drop", e => { e.preventDefault(); drop.classList.remove("over"); add(e.dataTransfer.files); });
    }
    paint();
  }

  /* ---------------- 自由配置の「★ アイコン」 ---------------- */
  if (N.Free && N.Free._) {
    const F = N.Free._;
    F.kindRender.icon = (o, b) => `<div class="nb-foic" style="font-size:${Math.max(8, Math.min(b.w, b.h) * 0.86).toFixed(1)}px;color:${F.strokeCss(o.stroke || "ink")}">${html(o.icon, "□")}</div>`;
    F.toolHandlers.icon = e => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      e.preventDefault();
      const LR = F.layerRect(), x = e.clientX - LR.left, y = e.clientY - LR.top;
      const pin = el("div"); Object.assign(pin.style, { position: "fixed", left: e.clientX + "px", top: e.clientY + "px", width: "1px", height: "1px" });
      document.body.appendChild(pin);
      pick(pin, null, ref => {
        if (!ref) return;
        N.Editor.settle();
        const o = F.add({ kind: "icon", icon: ref, stroke: "ink" }, { x: x - 32, y: y - 32, w: 64, h: 64 }, { x, y });
        N.Editor.changed();
        N.Free.setMode("select"); N.Free.select(o.id); N.Free.render();
      });
      setTimeout(() => pin.remove(), 0);
    };
    F.optionBars.icon = box => box.appendChild(el("span", "nb-tool-hint", "紙の上を押すと、絵文字・アイコンを選んで置けます"));
  }

  N.Icons = { html, pick, swapPage, manager, parse, loadLucide, loadWin, loadEmoji, loadUser, meaningOf, nameIn, hasWinFont, refreshPending };
  // 追加パックの一覧は早めに読んでおく（ページのアイコンに使われていても表示できるように）
  setTimeout(() => { if (!userLoaded) { userLoaded = true; loadUser(); } }, 0);
})();
