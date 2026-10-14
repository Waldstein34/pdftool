/* sw.js ― オフラインでも開けるようにする係（service worker）
   画面の部品は、まず手元の写しを出し、裏で新しいものに入れ替える（次に開いたときに新しくなる）。
   VERSION と CORE は build_public.py が書き込む。 */
const VERSION = "7271affd3809";
const CORE = ["./", "index.html", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "pdf_app/pdf.css", "pdf_app/pdf_core.js", "pdf_app/pdf_write.js", "pdf_app/pdf_bridge.js", "pdf_app/pdf_io_browser.js", "pdf_app/pdf_theme.js", "notes_app/notes.css", "notes_app/notes_free.js", "notes_app/notes_guide.js", "notes_app/notes_ink.js", "notes_app/notes_icons_std.js", "notes_app/notes_icons.js", "notes_app/notes_pdfout.js", "notes_app/vendor/pdf.min.js", "notes_app/vendor/pdf.worker.min.js"];
const CACHE = "pdftool-" + VERSION;

self.addEventListener("install", e => {
  // ブラウザ自身の一時保存（HTTP キャッシュ）は使わず、必ず最新を取りに行く
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE.map(u => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("pdftool-") && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(req, { ignoreSearch: true });
    const net = fetch(req, { cache: "no-cache" }).then(r => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
