/* ============================================================
 * app.js — 全景图应用核心控制器
 * 负责：取数 / 查看器初始化 / 画廊 / 场景切换 / 视角分享 /
 *       书签 / 截图 / 陀螺仪 / 缩放·旋转·全屏
 * 暴露 window.PanoApp 供 editor/tour/vr 模块挂载
 * ============================================================ */
(function () {
    'use strict';

    // ===== 全局错误捕获（显示真实异常，便于诊断）=====
    window.addEventListener('error', function (e) {
        const err = e.error || e;
        const msg = (err && err.stack) ? err.stack : ((err && err.message) || String(err));
        console.error('[PanoApp 致命错误]', err);
        let box = document.getElementById('fatal-err');
        if (!box) {
            box = document.createElement('div');
            box.id = 'fatal-err';
            box.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;background:#1a0d0d;color:#ff8080;padding:20px 24px;border-radius:12px;border:1px solid #ff6b6b;max-width:86vw;max-height:78vh;overflow:auto;font:12px/1.5 monospace;white-space:pre-wrap;box-shadow:0 8px 40px rgba(0,0,0,.6)';
            document.body.appendChild(box);
        }
        box.textContent = '【渲染异常 · 请截图】\n\n' + msg;
        // 上报到服务器日志（便于诊断手机端问题）
        try {
            fetch('/api/errorlog', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ua: navigator.userAgent, msg: msg }),
            });
        } catch (_) {}
    });

    const PanoApp = window.PanoApp = {
        viewer: null,
        scenes: [],          // 所有场景（演示 + 用户）
        sceneMap: {},        // id -> scene
        currentScene: null,
        galleryFilter: 'user',  // 'user' | 'demo' 画廊当前显示哪组
        tour: { loop: true, steps: [] },
        autoRotate: false,
        gyroOn: false,
    };

    const LS_BM = 'pano_bookmarks_v1';
    const LS_META = 'pano_meta_v2';   // { [sceneId]: {initialView, hotspots, northOffset} }
    const LS_TOUR = 'pano_tour_v2';   // { loop, steps }
    const $ = (id) => document.getElementById(id);

    // -------------------- 本地标注读写（全部存用户浏览器）--------------------
    function readMeta() { try { return JSON.parse(localStorage.getItem(LS_META) || '{}'); } catch (e) { return {}; } }
    function writeMeta(m) { localStorage.setItem(LS_META, JSON.stringify(m)); }
    function readTour() {
        try { const t = JSON.parse(localStorage.getItem(LS_TOUR) || 'null'); return t || { loop: true, steps: [] }; }
        catch (e) { return { loop: true, steps: [] }; }
    }
    function writeTour(t) { localStorage.setItem(LS_TOUR, JSON.stringify({ loop: !!t.loop, steps: t.steps || [] })); }
    PanoApp.writeTour = writeTour; // 供 tour.js 调用

    // -------------------- 工具 --------------------
    let toastTimer;
    PanoApp.toast = function (msg, ms) {
        const el = $('toast');
        el.textContent = msg;
        el.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => el.classList.remove('show'), ms || 2000);
    };

    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

    // Pannellum 用 startAutoRotate(speed) / stopAutoRotate()，统一封装避免误用
    PanoApp.applyAutoRotate = function (speed) {
        if (!PanoApp.viewer) return;
        if (speed && speed !== 0) {
            try { PanoApp.viewer.startAutoRotate(speed); } catch (e) {}
        } else {
            try { PanoApp.viewer.stopAutoRotate(); } catch (e) {}
        }
    };

    // -------------------- 取数（演示图来自服务器 + 用户图来自 IndexedDB）--------------------
    async function fetchScenes() {
        // 1. 演示图（服务器只读目录）
        let demos = [];
        try {
            const res = await fetch('/api/scenes', { cache: 'no-store' });
            if (res.ok) {
                const data = await res.json();
                demos = (data.scenes || []).map(s => ({
                    id: s.id, title: s.title, panorama: s.file, isUser: false,
                }));
            }
        } catch (e) { /* 服务器不可达时仅用本地 */ }

        // 2. 用户图（IndexedDB，只在本浏览器）
        let userPanos = [];
        try {
            const list = await DB.list();
            userPanos = list.map(r => ({
                id: r.id, title: r.title, panorama: r.url, isUser: true,
            }));
        } catch (e) { console.warn('IndexedDB 读取失败', e); }

        // 3. 合并 + 叠加本地标注（演示/用户图通用）
        const meta = readMeta();
        const attach = (s) => {
            const m = meta[s.id] || {};
            s.initialView = m.initialView || { yaw: 0, pitch: 0, hfov: 105 };
            s.hotspots = m.hotspots || [];
            s.northOffset = m.northOffset || 0;
            return s;
        };
        PanoApp.scenes = demos.map(attach).concat(userPanos.map(attach));
        PanoApp.sceneMap = {};
        PanoApp.scenes.forEach(s => { PanoApp.sceneMap[s.id] = s; });

        // tour 从本地读（合并，不替换对象，保留 tour.init）
        const t = readTour();
        if (t.loop !== undefined) PanoApp.tour.loop = t.loop;
        PanoApp.tour.steps = Array.isArray(t.steps) ? t.steps : (PanoApp.tour.steps || []);
    }

    // -------------------- 上传全景图（存入本浏览器 IndexedDB，不进服务器）--------------------
    async function uploadPanorama(file) {
        try {
            const title = file.name.replace(/\.[^.]+$/, '');
            const rec = await DB.add(title, file);
            return rec.id;
        } catch (e) {
            const quota = e && (e.name === 'QuotaExceededError' || e.name === 'QuotaExceeded');
            PanoApp.toast('添加失败：' + file.name + (quota ? '（浏览器存储空间不足）' : ''));
            return null;
        }
    }

    async function addFilesThenRefresh(files) {
        if (!files.length) return;
        PanoApp.toast('正在添加 ' + files.length + ' 张...');
        let lastId = null;
        for (const f of files) {
            const id = await uploadPanorama(f);
            if (id) lastId = id;
        }
        if (lastId) {
            PanoApp.galleryFilter = 'user';   // 上传后切到"我的"，确保新图可见
            await refreshScenes(lastId);
            PanoApp.toast('已添加全景图并切换');
        }
    }

    // -------------------- 刷新场景（取数 + 同步 viewer + 画廊）--------------------
    async function refreshScenes(showId) {
        await fetchScenes();
        if (!PanoApp.viewer && PanoApp.scenes.length > 0) {
            // 启动时为空未初始化查看器，现在补上
            renderGallery();
            initViewer();
            return;
        }
        // addScene 覆盖式：把所有场景（含新增）同步进 viewer 内部配置
        if (PanoApp.viewer) {
            PanoApp.scenes.forEach(s => {
                try {
                    PanoApp.viewer.addScene(s.id, {
                        panorama: s.panorama,
                        yaw: s.initialView.yaw,
                        pitch: s.initialView.pitch,
                        hfov: s.initialView.hfov,
                        northOffset: s.northOffset,
                        hotSpots: (s.hotspots || []).map(PanoApp.hotspotToView),
                    });
                } catch (e) {}
            });
        }
        renderGallery();
        if (showId && PanoApp.viewer && PanoApp.sceneMap[showId]) {
            PanoApp.viewer.loadScene(showId);
        }
    }

    // -------------------- 保存场景标注到本浏览器（localStorage）--------------------
    PanoApp.saveSceneMeta = function (id) {
        const s = PanoApp.sceneMap[id];
        if (!s) return;
        const meta = readMeta();
        meta[id] = {
            initialView: s.initialView,
            northOffset: s.northOffset,
            hotspots: s.hotspots,
        };
        writeMeta(meta);
        PanoApp.toast('已保存到本浏览器');
    };

    // -------------------- 热点 → Pannellum 格式 --------------------
    function sceneTitle(id) {
        return PanoApp.sceneMap[id] ? PanoApp.sceneMap[id].title : id;
    }
    PanoApp.hotspotToView = function (h) {
        const out = { id: h.id, yaw: h.yaw, pitch: h.pitch, type: h.type };
        if (h.type === 'scene') {
            out.sceneId = h.sceneId;
            if (h.targetYaw != null) out.targetYaw = h.targetYaw;
            if (h.targetPitch != null) out.targetPitch = h.targetPitch;
            out.text = h.title || ('前往「' + sceneTitle(h.sceneId) + '」');
        } else {
            let html = '';
            if (h.title) html += '<b>' + escapeHtml(h.title) + '</b>';
            if (h.text) html += (html ? '<br>' : '') + escapeHtml(h.text).replace(/\n/g, '<br>');
            if (!html) html = '信息点';
            out.text = html;
            if (h.image) out.image = h.image;
        }
        return out;
    };
    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    // -------------------- 构建 Pannellum 配置 --------------------
    function buildConfig() {
        const first = parseHash().scene || (PanoApp.scenes[0] && PanoApp.scenes[0].id);
        return {
            default: {
                firstScene: first,
                sceneFadeDuration: 800,
                autoLoad: true,
                showZoomCtrl: false,
                showFullscreenCtrl: false,
                showControls: false,
                compass: false,
                mouseZoom: true,
                keyboardZoom: true,
                hfov: 105, minHfov: 40, maxHfov: 150,
                hotSpotDebug: false,
                haov: 360, vaov: 180, vOffset: 0,
            },
            scenes: buildScenes(),
        };
    }
    function buildScenes() {
        const obj = {};
        PanoApp.scenes.forEach(s => {
            obj[s.id] = {
                title: s.title,
                panorama: s.panorama,
                yaw: s.initialView.yaw,
                pitch: s.initialView.pitch,
                hfov: s.initialView.hfov,
                northOffset: s.northOffset,
                hotSpots: (s.hotspots || []).map(PanoApp.hotspotToView),
            };
        });
        return obj;
    }

    // -------------------- 初始化查看器 --------------------
    function initViewer() {
        if (PanoApp.scenes.length === 0) {
            $('scene-title').textContent = '还没有全景图';
            PanoApp.toast('把全景图拖进窗口，或点画廊 ＋ 添加');
            return;
        }
        PanoApp.viewer = pannellum.viewer('panorama', buildConfig());

        PanoApp.viewer.on('scenechange', (id) => {
            PanoApp.currentScene = id;
            onSceneChanged(id);
        });
        PanoApp.viewer.on('load', () => {
            const id = PanoApp.viewer.getScene ? PanoApp.viewer.getScene() : PanoApp.currentScene;
            PanoApp.currentScene = id;
            onSceneChanged(id);
            applyHashView();
            setTimeout(() => $('hint').classList.add('fade'), 3500);
            // 通知子模块场景已就绪
            ['editor', 'tour', 'vr'].forEach(m => PanoApp[m] && PanoApp[m].onLoad && PanoApp[m].onLoad());
        });
    }

    function onSceneChanged(id) {
        const s = PanoApp.sceneMap[id];
        $('scene-title').textContent = s ? s.title : id;
        // 画廊高亮
        document.querySelectorAll('.scene-item').forEach(el => {
            el.classList.toggle('active', el.dataset.id === id);
        });
        // 自动旋转状态保持
        PanoApp.applyAutoRotate(PanoApp.autoRotate ? -3 : 0);
        // 更新书签面板标题
        $('bm-scene-name').textContent = s ? '· ' + s.title : '';
        renderBookmarks();
        updateHash();
    }

    // -------------------- 画廊（按 我的/演示 筛选）--------------------
    function updateFilterButton() {
        const b = $('btn-filter');
        if (b) b.textContent = PanoApp.galleryFilter === 'user' ? '🖼 我的' : '🎬 演示';
    }
    function renderGallery() {
        const list = $('gallery-list');
        list.innerHTML = '';
        updateFilterButton();
        const items = PanoApp.scenes.filter(s => PanoApp.galleryFilter === 'user' ? s.isUser : !s.isUser);
        if (items.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'popup-empty';
            empty.style.padding = '20px 14px';
            empty.style.lineHeight = '1.7';
            empty.innerHTML = PanoApp.galleryFilter === 'user'
                ? '还没有你的全景图<br>把图片拖进窗口<br>或点上方 ＋ 上传'
                : '暂无演示全景';
            list.appendChild(empty);
            return;
        }
        items.forEach(s => {
            const item = document.createElement('div');
            item.className = 'scene-item' + (s.isUser ? ' is-user' : '');
            item.dataset.id = s.id;
            item.innerHTML =
                '<div class="scene-thumb">' +
                  (s.isUser ? '<button class="scene-del" title="删除">✕</button>' : '') +
                '</div>' +
                '<div class="scene-name"></div>';
            item.querySelector('.scene-name').textContent = s.title;
            item.addEventListener('click', () => switchScene(s.id));
            if (s.isUser) {
                item.querySelector('.scene-del').addEventListener('click', (e) => {
                    e.stopPropagation();
                    deleteUserScene(s.id);
                });
            }
            list.appendChild(item);
            // 缩略图：演示图用服务端小图（不下载全图），用户图用本地 blob
            const thumbUrl = s.isUser ? s.panorama : ('/api/thumb/' + encodeURIComponent(s.id));
            item.querySelector('.scene-thumb').style.backgroundImage = 'url(' + thumbUrl + ')';
        });
    }

    // 删除用户全景图（IndexedDB + 清本地标注）
    async function deleteUserScene(id) {
        if (!confirm('删除这张全景图及其标注？')) return;
        try { await DB.remove(id); } catch (e) {}
        const meta = readMeta();
        delete meta[id];
        writeMeta(meta);
        PanoApp.scenes = PanoApp.scenes.filter(s => s.id !== id);
        delete PanoApp.sceneMap[id];
        PanoApp.tour.steps = (PanoApp.tour.steps || []).filter(st => st.scene !== id);
        writeTour(PanoApp.tour);
        renderGallery();
        // 若删的是当前场景，切到第一张
        if (PanoApp.currentScene === id) {
            const next = PanoApp.scenes[0];
            if (next && PanoApp.viewer) PanoApp.viewer.loadScene(next.id);
            else location.reload();
        }
        PanoApp.toast('已删除');
    }

    function switchScene(id) {
        if (!PanoApp.viewer || id === PanoApp.currentScene) return;
        PanoApp.viewer.loadScene(id);
    }

    // 画廊开关（手机端联动遮罩抽屉）
    function setGallery(open) {
        const g = $('gallery'), go = $('gallery-open'), bk = $('gallery-backdrop');
        if (open) {
            g.classList.remove('collapsed');
            if (go) go.style.display = 'none';
            if (bk && window.innerWidth <= 720) bk.classList.add('show');
        } else {
            g.classList.add('collapsed');
            if (go) go.style.display = 'flex';
            if (bk) bk.classList.remove('show');
        }
    }

    // -------------------- 视角分享 (URL hash) --------------------
    function parseHash() {
        const out = {};
        location.hash.replace(/^#/, '').split('&').forEach(p => {
            const [k, v] = p.split('=');
            if (k) out[k] = decodeURIComponent(v);
        });
        return out;
    }
    function applyHashView() {
        const h = parseHash();
        if (h.scene && PanoApp.sceneMap[h.scene] && h.scene !== PanoApp.currentScene) {
            PanoApp.viewer.loadScene(h.scene);
            return; // loadScene 完成后会再次 apply
        }
        if (h.yaw != null) PanoApp.viewer.setYaw(parseFloat(h.yaw));
        if (h.pitch != null) PanoApp.viewer.setPitch(parseFloat(h.pitch));
        if (h.hfov != null) PanoApp.viewer.setHfov(parseFloat(h.hfov));
    }
    let lastHash = '';
    function updateHash() {
        if (!PanoApp.viewer) return;
        const y = PanoApp.viewer.getYaw().toFixed(1);
        const p = PanoApp.viewer.getPitch().toFixed(1);
        const f = PanoApp.viewer.getHfov().toFixed(1);
        const id = PanoApp.currentScene || '';
        const h = `scene=${encodeURIComponent(id)}&yaw=${y}&pitch=${p}&hfov=${f}`;
        if (h !== lastHash) {
            lastHash = h;
            history.replaceState(null, '', '#' + h);
        }
    }
    window.addEventListener('hashchange', applyHashView);

    // -------------------- 书签 (localStorage) --------------------
    function getBookmarks() {
        try { return JSON.parse(localStorage.getItem(LS_BM) || '{}'); }
        catch (e) { return {}; }
    }
    function setBookmarks(obj) {
        localStorage.setItem(LS_BM, JSON.stringify(obj));
    }
    function renderBookmarks() {
        const list = $('bookmark-list');
        const empty = $('bm-empty');
        list.innerHTML = '';
        const all = getBookmarks();
        const items = all[PanoApp.currentScene] || [];
        if (items.length === 0) { empty.classList.remove('hidden'); return; }
        empty.classList.add('hidden');
        items.forEach((bm, i) => {
            const row = document.createElement('div');
            row.className = 'bm-item';
            row.innerHTML = `<span class="bm-name"></span><span class="bm-meta"></span><button class="bm-del" title="删除">✕</button>`;
            row.querySelector('.bm-name').textContent = bm.name;
            row.querySelector('.bm-meta').textContent = `${bm.yaw}°,${bm.pitch}°`;
            row.querySelector('.bm-name').onclick = () => gotoBookmark(bm);
            row.querySelector('.bm-del').onclick = () => {
                items.splice(i, 1);
                all[PanoApp.currentScene] = items;
                setBookmarks(all);
                renderBookmarks();
            };
            list.appendChild(row);
        });
    }
    function gotoBookmark(bm) {
        PanoApp.viewer.setYaw(bm.yaw);
        PanoApp.viewer.setPitch(bm.pitch);
        PanoApp.viewer.setHfov(bm.hfov);
        $('bookmark-menu').classList.add('hidden');
    }
    function saveCurrentBookmark() {
        if (!PanoApp.viewer) return;
        const name = prompt('为该视角命名', '视角 ' + new Date().toLocaleTimeString().slice(0, 5));
        if (!name) return;
        const all = getBookmarks();
        const arr = all[PanoApp.currentScene] || [];
        arr.push({
            name,
            yaw: +PanoApp.viewer.getYaw().toFixed(1),
            pitch: +PanoApp.viewer.getPitch().toFixed(1),
            hfov: +PanoApp.viewer.getHfov().toFixed(1),
        });
        all[PanoApp.currentScene] = arr;
        setBookmarks(all);
        PanoApp.toast('已收藏当前视角');
        renderBookmarks();
    }

    // -------------------- 截图 --------------------
    function screenshot() {
        if (!PanoApp.viewer) return;
        try {
            // getCanvas 是渲染器(renderer)的方法，经 viewer.getRenderer() 获取
            const r = PanoApp.viewer.getRenderer();
            const canvas = r && r.getCanvas ? r.getCanvas() : document.querySelector('#panorama canvas');
            if (!canvas) { PanoApp.toast('找不到渲染画布'); return; }
            const url = canvas.toDataURL('image/png');
            const a = document.createElement('a');
            a.href = url;
            a.download = (PanoApp.currentScene || 'panorama') + '_' + Date.now() + '.png';
            a.click();
            PanoApp.toast('截图已下载');
        } catch (e) {
            PanoApp.toast('截图失败：' + e.message);
        }
    }

    // -------------------- 陀螺仪 --------------------
    function onDeviceOrient(e) {
        if (!PanoApp.viewer || !PanoApp.gyroOn) return;
        let heading = null;
        if (e.webkitCompassHeading !== undefined && e.webkitCompassHeading !== null) {
            heading = e.webkitCompassHeading;
        } else if (e.alpha != null && e.absolute) {
            heading = 360 - e.alpha;
        }
        if (heading == null) return;
        const yaw = heading;
        const pitch = e.beta != null ? clamp(e.beta - 90, -85, 85) : PanoApp.viewer.getPitch();
        try {
            PanoApp.viewer.setYaw(yaw, false);
            PanoApp.viewer.setPitch(pitch, false);
        } catch (_) {}
    }
    async function toggleGyro() {
        if (PanoApp.gyroOn) {
            PanoApp.gyroOn = false;
            window.removeEventListener('deviceorientation', onDeviceOrient);
            $('btn-gyro').classList.remove('active');
            PanoApp.toast('陀螺仪已关闭');
            return;
        }
        // iOS 13+ 需请求权限
        if (typeof DeviceOrientationEvent !== 'undefined' &&
            typeof DeviceOrientationEvent.requestPermission === 'function') {
            try {
                const p = await DeviceOrientationEvent.requestPermission();
                if (p !== 'granted') { PanoApp.toast('未授予陀螺仪权限'); return; }
            } catch (e) { PanoApp.toast('无法启用陀螺仪'); return; }
        }
        if (!('DeviceOrientationEvent' in window)) { PanoApp.toast('设备不支持陀螺仪'); return; }
        PanoApp.gyroOn = true;
        PanoApp.autoRotate = false;
        PanoApp.applyAutoRotate(0);
        $('btn-rotate').classList.remove('active');
        window.addEventListener('deviceorientation', onDeviceOrient);
        $('btn-gyro').classList.add('active');
        PanoApp.toast('陀螺仪已开启 · 转动设备查看');
    }

    // -------------------- 其他控制 --------------------
    function toggleAutoRotate() {
        PanoApp.autoRotate = !PanoApp.autoRotate;
        PanoApp.applyAutoRotate(PanoApp.autoRotate ? -3 : 0);
        $('btn-rotate').classList.toggle('active', PanoApp.autoRotate);
    }
    function resetView() {
        if (!PanoApp.viewer) return;
        const s = PanoApp.sceneMap[PanoApp.currentScene];
        const iv = (s && s.initialView) || { yaw: 0, pitch: 0, hfov: 105 };
        PanoApp.viewer.setYaw(iv.yaw);
        PanoApp.viewer.setPitch(iv.pitch);
        PanoApp.viewer.setHfov(iv.hfov);
    }
    // 将当前视角存为该场景的初始视角（持久化 + 同步 viewer 内部配置）
    function setInitialView() {
        if (!PanoApp.viewer) return;
        const s = PanoApp.sceneMap[PanoApp.currentScene];
        if (!s) return;
        s.initialView = {
            yaw: +PanoApp.viewer.getYaw().toFixed(1),
            pitch: +PanoApp.viewer.getPitch().toFixed(1),
            hfov: +PanoApp.viewer.getHfov().toFixed(1),
        };
        // 同步 viewer 内部场景配置，使切场景再回来时也用新初始视角
        try {
            PanoApp.viewer.addScene(PanoApp.currentScene, {
                panorama: s.file,
                yaw: s.initialView.yaw,
                pitch: s.initialView.pitch,
                hfov: s.initialView.hfov,
                northOffset: s.northOffset,
                hotSpots: (s.hotspots || []).map(PanoApp.hotspotToView),
            });
        } catch (e) {}
        PanoApp.saveSceneMeta(PanoApp.currentScene);
        PanoApp.toast('已设为「' + s.title + '」的初始视角（⌂ 可随时跳回）');
    }
    function toggleFullscreen() {
        if (!document.fullscreenElement) document.documentElement.requestFullscreen();
        else document.exitFullscreen();
    }

    // -------------------- 顶部弹出层显隐 --------------------
    function closeAllPopups() {
        ['bookmark-menu', 'tour-panel'].forEach(p => { const e = $(p); if (e) e.classList.add('hidden'); });
        const bk = $('popup-backdrop'); if (bk) bk.classList.remove('show');
    }
    function togglePopup(id) {
        const el = $(id);
        const willOpen = el.classList.contains('hidden');
        closeAllPopups();
        if (willOpen) {
            el.classList.remove('hidden');
            const bk = $('popup-backdrop'); if (bk) bk.classList.add('show');
            if (id === 'bookmark-menu') renderBookmarks();
        }
    }

    // -------------------- 事件绑定 --------------------
    function bindEvents() {
        $('btn-zoom-in').onclick = () => PanoApp.viewer && PanoApp.viewer.setHfov(PanoApp.viewer.getHfov() - 12);
        $('btn-zoom-out').onclick = () => PanoApp.viewer && PanoApp.viewer.setHfov(PanoApp.viewer.getHfov() + 12);
        $('btn-rotate').onclick = toggleAutoRotate;
        $('btn-reset').onclick = resetView;
        $('btn-initial').onclick = setInitialView;
        $('btn-shot').onclick = screenshot;
        $('btn-bmsave').onclick = saveCurrentBookmark;
        $('btn-gyro').onclick = toggleGyro;
        $('btn-vr').onclick = () => PanoApp.vr && PanoApp.vr.toggle();
        $('btn-fs').onclick = toggleFullscreen;
        $('btn-filter').onclick = () => {
            PanoApp.galleryFilter = (PanoApp.galleryFilter === 'user') ? 'demo' : 'user';
            renderGallery();
            PanoApp.toast(PanoApp.galleryFilter === 'user' ? '我的全景' : '演示全景');
        };

        $('btn-share').onclick = () => {
            updateHash();
            const url = location.href;
            if (navigator.clipboard) {
                navigator.clipboard.writeText(url).then(() => PanoApp.toast('视角链接已复制'));
            } else {
                prompt('复制此链接分享当前视角：', url);
            }
        };
        $('btn-bookmark').onclick = () => togglePopup('bookmark-menu');
        $('btn-tour').onclick = () => togglePopup('tour-panel');
        // 面板关闭：✕ 按钮 + 遮罩点击
        const popBk = $('popup-backdrop');
        if (popBk) popBk.onclick = closeAllPopups;
        document.querySelectorAll('.popup-close').forEach(b => { b.onclick = closeAllPopups; });

        $('gallery-toggle').onclick = () => setGallery(false);
        $('gallery-open').onclick = () => setGallery(true);
        const gbk = $('gallery-backdrop');
        if (gbk) gbk.onclick = () => setGallery(false);

        // ---- 手机端：顶栏菜单合并（常驻，仅 ⋮ 按钮切换开关）----
        const menuToggle = $('menu-toggle');
        const topActions = document.querySelector('.top-actions');
        if (menuToggle && topActions) {
            menuToggle.addEventListener('click', (e) => {
                e.stopPropagation();
                topActions.classList.toggle('open');
            });
            // 菜单保持常驻：点内部操作不自动收起，也不因点外部收起，只能再点 ⋮ 切换
        }

        // ---- 添加全景图：拖放 + "+"按钮 ----
        const dz = $('drop-zone');
        let dragN = 0;
        const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
        window.addEventListener('dragenter', (e) => {
            if (!hasFiles(e)) return;
            e.preventDefault();
            dragN++;
            dz.classList.add('active');
        });
        window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
        window.addEventListener('dragleave', (e) => {
            if (!hasFiles(e)) return;
            dragN--;
            if (dragN <= 0) { dragN = 0; dz.classList.remove('active'); }
        });
        window.addEventListener('drop', (e) => {
            if (!hasFiles(e)) return;
            e.preventDefault();
            dragN = 0;
            dz.classList.remove('active');
            const files = [...(e.dataTransfer.files || [])].filter(f => f.type.startsWith('image/'));
            if (files.length === 0) { PanoApp.toast('请拖入图片文件（jpg/png/webp）'); return; }
            addFilesThenRefresh(files);
        });
        $('gallery-add').onclick = () => $('pano-file-input').click();
        $('pano-file-input').onchange = (e) => {
            const files = [...e.target.files];
            e.target.value = '';
            addFilesThenRefresh(files);
        };

        // 点击空白仅关闭书签菜单（导览面板只受「导览」按钮控制，保持常驻）
        document.addEventListener('click', (e) => {
            const bm = $('bookmark-menu');
            if (bm && !bm.classList.contains('hidden') &&
                !bm.contains(e.target) && !e.target.closest('#btn-bookmark')) {
                bm.classList.add('hidden');
            }
        });

        // 键盘
        window.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            switch (e.key) {
                case ' ': e.preventDefault(); toggleAutoRotate(); break;
                case 'f': case 'F': toggleFullscreen(); break;
                case 'r': case 'R': resetView(); break;
                case '+': case '=': $('btn-zoom-in').onclick(); break;
                case '-': case '_': $('btn-zoom-out').onclick(); break;
            }
        });

        // 周期性同步 URL hash（覆盖拖拽/缩放/陀螺仪/导览）
        setInterval(updateHash, 700);
    }

    // -------------------- 启动 --------------------
    async function start() {
        try {
            await fetchScenes();
        } catch (e) {
            PanoApp.toast('无法连接服务端，请确认 server.py 已启动');
            $('scene-title').textContent = '连接失败';
            return;
        }
        // 默认筛选：有用户上传则看"我的"，否则看"演示"
        PanoApp.galleryFilter = PanoApp.scenes.some(s => s.isUser) ? 'user' : 'demo';
        renderGallery();
        bindEvents();
        initViewer();
        // 手机端默认收起画廊侧栏
        if (window.innerWidth <= 720) setGallery(false);
        // 初始化子模块
        PanoApp.editor && PanoApp.editor.init && PanoApp.editor.init();
        PanoApp.tour && PanoApp.tour.init && PanoApp.tour.init();
        PanoApp.vr && PanoApp.vr.init && PanoApp.vr.init();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();
