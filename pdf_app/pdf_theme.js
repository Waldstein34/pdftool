/* =====================================================================
   pdf_theme.js ― 見た目（テーマ）を切り替える

   テーマ＝色の組（pdf.css の html[data-pt-theme=…] の変数）＋道具バーの置き場所
     glass   ガラス（Studio）  … すりガラスの板。道具は上の帯の下（strip）
     chrome  ブラウザ標準風    … Chrome・Edge の PDF ビュワーと同じ暗い灰色。道具は上の帯の中（top）
     acrobat Acrobat 風        … 明るい画面。道具は右の欄に名前付きで（right）
     notion  ノート風ミニマル  … 白と生成り色。道具は下に浮かぶ板（float）
     mac     macOS プレビュー風… 明るい灰色。道具は2段目の帯（strip）
     night   夜の読書          … 黒い背景にセピアの紙。道具は左に縦（left）。🌙 で白い紙に戻せる
   ・選んだテーマはブラウザに覚える（localStorage。使う人ごとの好み）
   ・道具バーの中身は notes_free.js が作る。ここでは置き場所を移し、道具の絵を線のアイコン（Lucide）に替える
   ・浮かぶメニュー（右クリック・アイコン選び）の色も、テーマに合わせる（pdf_bridge.js が PdfTool.themeNb を見る）
   ===================================================================== */
(() => {
  "use strict";
  const P = window.PdfTool;
  if (!P || !P.hooks) return;
  const S = P._S;
  const KEY = "pdftool.theme", PAPER = "pdftool.paper";
  const THEMES = [
    { id: "glass", name: "ガラス（Studio）", tools: "strip", nb: "host-glass", sw: ["#1d2a5a", "#5a1d2a", "#7fb0ff"] },
    { id: "chrome", name: "ブラウザ標準風", tools: "top", nb: "host-glass", sw: ["#323639", "#525659", "#8ab4f8"] },
    { id: "acrobat", name: "Acrobat 風", tools: "right", nb: "notion", sw: ["#ffffff", "#e9e9e9", "#1473e6"], labels: true },
    { id: "notion", name: "ノート風ミニマル", tools: "float", nb: "notion", sw: ["#ffffff", "#f7f6f3", "#2383e2"] },
    { id: "mac", name: "macOS プレビュー風", tools: "strip", nb: "notion", sw: ["#ececec", "#c8c8cc", "#007aff"] },
    { id: "night", name: "夜の読書", tools: "left", nb: "host-glass", sw: ["#141417", "#f3ead6", "#f5a524"], paper: true },
  ];
  P.THEMES = THEMES;
  const LS = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 覚えられなくても切り替えはできる */ } },
  };

  /* ---------------- 道具の絵を線のアイコンに（notes_free.js の道具の名前ごと） ---------------- */
  const TOOL_ICONS = {
    text: '<path d="M17 22h-1a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4h1M7 22h1a4 4 0 0 0 4-4v-1M7 2h1a4 4 0 0 1 4 4v1"/>',
    select: '<path d="M4.04 4.86 10.48 20.7a.5.5 0 0 0 .94-.03l2.25-6.53a2 2 0 0 1 1.24-1.24l6.53-2.25a.5.5 0 0 0 .03-.94L5.03 3.25a.6.6 0 0 0-.99.61z"/>',
    pen: '<path d="M21.17 6.81a1 1 0 0 0-3.98-3.98L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5zM15 5l4 4"/>',
    eraser: '<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21M22 21H7M5 11l9 9"/>',
    lasso: '<path d="M7 22a5 5 0 0 1-2-4M3.3 14A6.8 6.8 0 0 1 2 10c0-4.4 4.5-8 10-8s10 3.6 10 8-4.5 8-10 8a12 12 0 0 1-5-1"/><path d="M5 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/>',
    rect: '<rect width="18" height="18" x="3" y="3" rx="2"/>',
    ellipse: '<circle cx="12" cy="12" r="10"/>',
    triangle: '<path d="M13.73 4a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>',
    line: '<path d="M5 19 19 5"/>',
    arrow: '<path d="M7 17 17 7M7 7h10v10"/>',
    note: '<path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8Z"/><path d="M15 3v4a2 2 0 0 0 2 2h4"/>',
    textbox: '<path d="M4 7V4h16v3M9 20h6M12 4v16"/>',
    icon: '<path d="M11.53 2.3a.53.53 0 0 1 .95 0l2.31 4.68a2.12 2.12 0 0 0 1.6 1.16l5.16.76a.53.53 0 0 1 .3.9l-3.74 3.64a2.12 2.12 0 0 0-.61 1.88l.88 5.14a.53.53 0 0 1-.77.56l-4.62-2.43a2.12 2.12 0 0 0-1.97 0L6.4 21.01a.53.53 0 0 1-.77-.56l.88-5.14a2.12 2.12 0 0 0-.61-1.88L2.16 9.8a.53.53 0 0 1 .29-.9l5.17-.76a2.12 2.12 0 0 0 1.6-1.16z"/>',
  };
  function toolCss() {
    const svg = d => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>${d}</svg>`)}")`;
    return Object.entries(TOOL_ICONS).map(([m, d]) => `.pt-tools .nb-tool[data-mode="${m}"] .i{--pt-m:${svg(d)}}`).join("\n");
  }

  /* ---------------- 当てはめる ---------------- */
  function current() { return THEMES.find(t => t.id === S.theme) || THEMES[0]; }
  function apply(id) {
    const t = THEMES.find(x => x.id === id) || THEMES[0];
    S.theme = t.id;
    const app = S.root;
    app.dataset.ptTheme = t.id;
    app.dataset.ptTools = t.tools;
    app.toggleAttribute("data-pt-labels", !!t.labels);
    document.documentElement.dataset.ptTheme = t.id;
    // 道具バーを、このテーマの置き場所へ移す（notes_free.js は同じ要素を持ち続けるので、移しても動く）
    const slot = app.querySelector(`.pt-slot-${t.tools}`);
    if (slot && S.ui.tools.parentElement !== slot) slot.appendChild(S.ui.tools);
    S.ui.tools.dataset.nbTheme = t.nb;
    P.themeNb = t.nb;
    // 夜の読書：紙の色（セピア／白）の切り替え
    const extra = app.querySelector(".pt-slot-extra");
    extra.innerHTML = "";
    if (t.paper) {
      const b = document.createElement("button");
      b.className = "pt-ic pt-doc" + (LS.get(PAPER) === "white" ? "" : " on");
      b.title = "紙の色（セピア／白）";
      b.innerHTML = P.icon("moon");
      b.onclick = () => { const w = LS.get(PAPER) !== "white"; LS.set(PAPER, w ? "white" : "sepia"); app.dataset.ptPaper = w ? "white" : "sepia"; b.classList.toggle("on", !w); };
      extra.appendChild(b);
      app.dataset.ptPaper = LS.get(PAPER) === "white" ? "white" : "sepia";
    } else delete app.dataset.ptPaper;
    LS.set(KEY, t.id);
  }
  P.setTheme = apply;

  /* ---------------- テーマを選ぶメニュー ---------------- */
  function menu(btn) {
    const N = window.Notes;
    const build = p => {
      p.classList.add("pt-thmenu");
      p.insertAdjacentHTML("beforeend", `<div class="cat">見た目（テーマ）</div>`);
      THEMES.forEach(t => {
        const it = document.createElement("button");
        it.className = "it" + (t.id === S.theme ? " cur" : "");
        it.innerHTML = `<span class="pt-thsw">${t.sw.map(c => `<i style="background:${c}"></i>`).join("")}</span><div>${t.name}</div>${t.id === S.theme ? P.icon("check") : ""}`;
        it.onclick = () => { apply(t.id); if (N && N._closePop) N._closePop(); };
        p.appendChild(it);
      });
    };
    if (N && N._openPop) N._openPop(btn, build);
  }

  P.hooks.theme.push(menu);
  P.hooks.mount.push(() => {
    const st = document.createElement("style");
    st.textContent = toolCss();
    document.head.appendChild(st);
    apply(LS.get(KEY) || S.defaultTheme || (P.io && P.io.kind === "browser" ? "chrome" : "glass"));
  });
  // 夜の読書：どこまで読んだかの細い線
  P.hooks.page.push((n, total) => {
    const bar = S.root && S.root.querySelector(".pt-prog i");
    if (bar) bar.style.width = total ? `${Math.round(n / total * 100)}%` : "0";
  });
})();
