/* =====================================================================
   pdf_io_browser.js ― 「開く・最近の一覧・記録・保存」の部品（公開版：ブラウザだけで動く）

   裏のプログラム（サーバー）なしで、pdf_io_server.js と同じ窓口（PdfTool.io）を用意する。
   PDF はパソコンの中だけで読み書きし、どこにも送らない。
     ・開く：ファイルを選ぶ窓（Chrome・Edge は File System Access API。ほかのブラウザはふつうのファイル選択）
       ／PDF を落とす／最近開いた一覧／アプリとして入れたときは、PDF をダブルクリックして開く（launchQueue）
     ・最近の一覧と書き込みは、ブラウザの中の保存場所（IndexedDB）に置く
       Chrome・Edge は「ファイルの手がかり（handle）」も覚えるので、一覧から開き直せる（初回は許可を聞かれる）
     ・書き込みごと保存：保存先を選ぶ窓（元の PDF のフォルダから始まる）。窓が出せないブラウザはダウンロード
     ref（PDF の居場所）＝{ id, name, handle（なければ null） }
   ノートのアイコン部品が使う窓口（追加パック・設定）も、ここでブラウザの中だけで用意する（notesApi）。
   ===================================================================== */
(() => {
  "use strict";
  const P = window.PdfTool = window.PdfTool || {};
  const RECENT_MAX = 30;
  const PDF_TYPES = [{ description: "PDF", accept: { "application/pdf": [".pdf"] } }];
  const isPdf = f => f && (f.type === "application/pdf" || /\.pdf$/i.test(f.name || ""));
  const rid = () => "r" + Math.random().toString(36).slice(2, 12);

  /* ---------------- ブラウザの中の保存場所（IndexedDB） ---------------- */
  let dbP = null;
  function db() {
    return dbP || (dbP = new Promise((ok, ng) => {
      const q = indexedDB.open("pdftool", 1);
      q.onupgradeneeded = () => {
        const d = q.result;
        d.createObjectStore("recent", { keyPath: "id" });
        d.createObjectStore("ann", { keyPath: "key" });
      };
      q.onsuccess = () => ok(q.result);
      q.onerror = () => { dbP = null; ng(q.error || new Error("ブラウザの保存場所を開けませんでした")); };
    }));
  }
  async function tx(store, mode, fn) {
    const d = await db();
    return new Promise((ok, ng) => {
      const t = d.transaction(store, mode), s = t.objectStore(store);
      let out;
      Promise.resolve(fn(s, v => { out = v; })).catch(ng);
      t.oncomplete = () => ok(out);
      t.onerror = t.onabort = () => ng(t.error || new Error("保存できませんでした"));
    });
  }
  const req = r => new Promise((ok, ng) => { r.onsuccess = () => ok(r.result); r.onerror = () => ng(r.error); });
  const getAll = store => tx(store, "readonly", async (s, out) => out(await req(s.getAll())));
  const get = (store, k) => tx(store, "readonly", async (s, out) => out(await req(s.get(k))));
  const put = (store, v) => tx(store, "readwrite", s => { s.put(v); });
  const del = (store, k) => tx(store, "readwrite", s => { s.delete(k); });

  /* ---------------- 居場所（ref）を作る ---------------- */
  // 同じファイルなら、最近の一覧の同じ項目を使う（handle があれば isSameEntry、なければ名前と大きさで）
  async function refFor(file, handle) {
    const list = await getAll("recent").catch(() => []);
    for (const r of list) {
      if (handle && r.handle) { try { if (await r.handle.isSameEntry(handle)) return { id: r.id, name: file.name, handle }; } catch (e) { /* 比べられない */ } }
      else if (!handle && !r.handle && r.name === file.name && r.size === file.size) return { id: r.id, name: file.name, handle: null };
    }
    return { id: rid(), name: file.name, handle: handle || null, size: file.size };
  }
  async function fromFile(file, handle) {
    const ref = await refFor(file, handle);
    ref.size = file.size;
    return { buf: await file.arrayBuffer(), name: file.name, ref };
  }

  // ふつうのファイル選択（File System Access API がないブラウザ用）
  function inputPick() {
    return new Promise(ok => {
      const i = document.createElement("input");
      i.type = "file"; i.accept = "application/pdf,.pdf";
      i.style.display = "none";
      i.onchange = () => { ok(i.files && i.files[0] && isPdf(i.files[0]) ? i.files[0] : null); i.remove(); };
      i.addEventListener("cancel", () => { ok(null); i.remove(); });
      document.body.appendChild(i);
      i.click();
    });
  }

  async function ensurePerm(handle, mode) {
    const o = { mode };
    if ((await handle.queryPermission(o)) === "granted") return true;
    return (await handle.requestPermission(o)) === "granted";
  }

  /* ---------------- ノートのアイコン部品の窓口（ブラウザの中だけで） ---------------- */
  const LS = {
    get(k, fb) { try { const v = localStorage.getItem(k); return v === null ? fb : JSON.parse(v); } catch (e) { return fb; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 保存できなくても動く */ } },
  };

  P.io = {
    kind: "browser",
    async recent() {
      const [list, anns] = await Promise.all([getAll("recent"), getAll("ann")]);
      const ink = new Set(anns.filter(a => a.free && a.free.length).map(a => a.key));
      return list.sort((a, b) => b.opened - a.opened).map(r => ({
        id: r.id, name: r.name, opened: r.opened, page: r.page || 1, ink: !!(r.key && ink.has(r.key)),
        ref: { id: r.id, name: r.name, handle: r.handle || null, size: r.size },
      }));
    },
    async pick() {
      if (window.showOpenFilePicker) {
        let h;
        try { [h] = await showOpenFilePicker({ types: PDF_TYPES, id: "pdftool", excludeAcceptAllOption: false }); }
        catch (e) { if (e.name === "AbortError") return null; throw e; }
        const f = await h.getFile();
        if (!isPdf(f)) { alert("PDF ファイルを選んでください"); return null; }
        return fromFile(f, h);
      }
      const f = await inputPick();
      return f ? fromFile(f, null) : null;
    },
    async openRecent(it) {
      const h = it.ref.handle;
      if (!h) {
        // このブラウザは前に開いたファイルの場所を覚えられない → もう一度選んでもらう
        alert(`「${it.name}」をもう一度選んでください（このブラウザでは、前に開いたファイルを直接開けません）`);
        return this.pick();
      }
      if (!await ensurePerm(h, "read")) return null;
      let f;
      try { f = await h.getFile(); }
      catch (e) { alert(`「${it.name}」が見つかりません。移動したか、消された可能性があります。`); return null; }
      return { buf: await f.arrayBuffer(), name: f.name, ref: { id: it.id, name: f.name, handle: h, size: f.size } };
    },
    // 落とした瞬間にしか取り出せないので、ここで同時に頼む（Chrome・Edge は handle も取れる）
    fromDrop(dt) {
      const item = [...(dt.items || [])].find(i => i.kind === "file" && isPdf(i.getAsFile()));
      if (!item) return null;
      const file = item.getAsFile();
      const hp = item.getAsFileSystemHandle ? item.getAsFileSystemHandle().catch(() => null) : Promise.resolve(null);
      return hp.then(h => fromFile(file, h && h.kind === "file" ? h : null));
    },
    async opened(ref, o) {
      if (!ref) return;
      try {
        const old = (await get("recent", ref.id)) || {};
        await put("recent", {
          id: ref.id, name: ref.name || old.name, handle: ref.handle || old.handle || null, size: ref.size ?? old.size,
          key: o.key || old.key, page: o.page || old.page || 1, opened: Date.now() / 1000,
        });
        const list = (await getAll("recent")).sort((a, b) => b.opened - a.opened);
        for (const r of list.slice(RECENT_MAX)) await del("recent", r.id);
      } catch (e) { /* 一覧に残せなくても、開くことはできる */ }
    },
    forget: it => del("recent", it.id),
    async annGet(key, ref) {
      const a = await get("ann", key);
      if (a) return { matched: "key", free: a.free || [] };
      // 中身が変わった同じ PDF（同じ一覧の項目で書き込んだもの）
      if (ref) {
        const all = (await getAll("ann")).filter(x => x.refId === ref.id && x.free && x.free.length).sort((a, b) => b.updated - a.updated);
        if (all.length) return { matched: "other", free: all[0].free };
      }
      return { matched: null, free: [] };
    },
    async annSave(key, name, ref, free) {
      if (!free || !free.length) await del("ann", key);
      else await put("ann", { key, name, refId: ref ? ref.id : null, updated: Date.now() / 1000, free });
      return { ok: true };
    },
    async saveAs(ref, name, bytes) {
      const out = `${String(name || "PDF").replace(/\.pdf$/i, "")}（書き込み済み）.pdf`;
      if (window.showSaveFilePicker) {
        let h;
        try { h = await showSaveFilePicker({ suggestedName: out, startIn: (ref && ref.handle) || "documents", types: PDF_TYPES }); }
        catch (e) { if (e.name === "AbortError") return { cancelled: true }; throw e; }
        const w = await h.createWritable();
        await w.write(bytes); await w.close();
        return { ok: true, name: h.name, message: `「${h.name}」を保存しました` };
      }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      a.download = out;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      return { ok: true, name: out, message: `「${out}」をダウンロードに保存しました` };
    },
    // 変換したファイルなどを保存する（保存先を選ぶ窓。出せないブラウザはダウンロード）
    async saveFile(ref, name, bytes) {
      const ext = (name.match(/\.[a-z0-9]+$/i) || [".bin"])[0].toLowerCase();
      const mime = { ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".png": "image/png", ".jpg": "image/jpeg", ".txt": "text/plain", ".zip": "application/zip", ".pdf": "application/pdf" }[ext] || "application/octet-stream";
      if (window.showSaveFilePicker) {
        let h;
        try { h = await showSaveFilePicker({ suggestedName: name, startIn: (ref && ref.handle) || "documents", types: [{ description: ext.slice(1).toUpperCase(), accept: { [mime]: [ext] } }] }); }
        catch (e) { if (e.name === "AbortError") return { cancelled: true }; throw e; }
        const w = await h.createWritable();
        await w.write(bytes); await w.close();
        return { ok: true, name: h.name, message: `「${h.name}」を保存しました` };
      }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([bytes], { type: mime }));
      a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      return { ok: true, name, message: `「${name}」をダウンロードに保存しました` };
    },
    alive: async () => true,
    downMessage: "",
    // アプリとして入れたとき：PDF をダブルクリックしたら、そのファイルを受け取って開く
    startup(open) {
      if (!("launchQueue" in window)) return;
      launchQueue.setConsumer(async params => {
        const h = params.files && params.files[0];
        if (!h) return;
        try {
          const f = await h.getFile();
          if (!isPdf(f)) return;
          const file = await fromFile(f, h);
          const it = (await this.recent()).find(x => x.id === file.ref.id);
          open(file, it ? it.page : 1);
        } catch (e) { alert("PDF を開けませんでした"); }
      });
    },
    label: ref => (ref && ref.name) || "",
    openLabel: "PDF を選ぶ",
    // notes_icons.js の追加パック・設定（ここでは追加パックなし、表示しないパックだけ覚える）
    notesApi(path, body) {
      const act = body && body.act;
      if (act === "iconpacks") return { ok: true, packs: [] };
      if (act === "settings") {
        if ("iconHidden" in body) LS.set("pdftool.iconHidden", body.iconHidden || []);
        return { ok: true, tree: { pages: {}, settings: { iconHidden: LS.get("pdftool.iconHidden", []) } } };
      }
      return { ok: false, error: "この版では使えません" };
    },
    initialSettings: () => ({ iconHidden: LS.get("pdftool.iconHidden", []) }),
  };
})();
