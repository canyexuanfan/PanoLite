/* ============================================================
 * db.js — 用户全景图的 IndexedDB 封装
 * 用户上传的图只存在本浏览器，不进服务器。
 * 暴露 window.DB
 * ============================================================ */
(function () {
    'use strict';
    const DB_NAME = 'pano_user';
    const STORE = 'panoramas';
    const VERSION = 1;
    let _db = null;
    const _urls = {}; // id -> blobURL 缓存，避免重复创建

    function open() {
        if (_db) return Promise.resolve(_db);
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, VERSION);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE)) {
                    db.createObjectStore(STORE, { keyPath: 'id' });
                }
            };
            req.onsuccess = () => { _db = req.result; resolve(_db); };
            req.onerror = () => reject(req.error);
        });
    }

    function store(mode) {
        return open().then(db => db.transaction(STORE, mode).objectStore(STORE));
    }

    function urlFor(id, blob) {
        if (!_urls[id]) _urls[id] = URL.createObjectURL(blob);
        return _urls[id];
    }

    // 添加一张用户全景图，返回 { id, title, url }
    async function add(title, blob) {
        const id = 'u_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
        const rec = { id, title, blob, addedAt: Date.now(), size: blob.size };
        const s = await store('readwrite');
        return new Promise((resolve, reject) => {
            const r = s.add(rec);
            r.onsuccess = () => resolve({ id, title, url: urlFor(id, blob) });
            r.onerror = () => reject(r.error);
        });
    }

    // 列出全部用户图，每项附带 url（blobURL）
    async function list() {
        const s = await store('readonly');
        return new Promise((resolve, reject) => {
            const r = s.getAll();
            r.onsuccess = () => resolve(r.result.map(rec => ({
                id: rec.id,
                title: rec.title,
                blob: rec.blob,
                addedAt: rec.addedAt,
                url: urlFor(rec.id, rec.blob),
            })));
            r.onerror = () => reject(r.error);
        });
    }

    // 删除一张用户图，并回收 blobURL
    async function remove(id) {
        const s = await store('readwrite');
        return new Promise((resolve, reject) => {
            const r = s.delete(id);
            r.onsuccess = () => {
                if (_urls[id]) { URL.revokeObjectURL(_urls[id]); delete _urls[id]; }
                resolve();
            };
            r.onerror = () => reject(r.error);
        });
    }

    window.DB = { open, add, list, remove };
})();
