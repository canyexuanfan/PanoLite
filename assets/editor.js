/* ============================================================
 * editor.js — 热点编辑器（点击放置 / 编辑 / 删除 / 持久化）
 * 挂载到 PanoApp.editor
 * ============================================================ */
(function () {
    'use strict';
    const PanoApp = window.PanoApp;
    if (!PanoApp) return;
    const $ = (id) => document.getElementById(id);

    const Editor = PanoApp.editor = {
        editMode: false,
        editingId: null,
        managerEl: null,
    };

    // -------------------- 创建热点管理面板 --------------------
    function ensureManager() {
        if (Editor.managerEl) return;
        const el = document.createElement('div');
        el.id = 'hotspot-manager';
        el.className = 'popup hidden';
        el.style.top = '92px';
        el.style.right = '16px';
        el.style.left = 'auto';
        el.style.width = '240px';
        el.innerHTML = '<div class="popup-head">热点管理 <span class="popup-sub">点击画面添加</span></div>' +
            '<div id="hs-list" class="popup-list"></div>' +
            '<div class="popup-empty hidden" id="hs-empty">本场景暂无热点 · 点击画面添加</div>';
        document.body.appendChild(el);
        Editor.managerEl = el;
    }

    function showManager(show) {
        ensureManager();
        Editor.managerEl.classList.toggle('hidden', !show);
        if (show) renderList();
    }

    // -------------------- 渲染热点列表 --------------------
    function renderList() {
        const list = $('hs-list');
        const empty = $('hs-empty');
        if (!list) return;
        const s = PanoApp.sceneMap[PanoApp.currentScene];
        const hs = (s && s.hotspots) || [];
        list.innerHTML = '';
        if (hs.length === 0) { empty.classList.remove('hidden'); return; }
        empty.classList.add('hidden');
        hs.forEach(h => {
            const row = document.createElement('div');
            row.className = 'bm-item';
            const tag = h.type === 'scene' ? '🔗 ' : '📍 ';
            row.innerHTML = `<span class="bm-name"></span><span class="bm-meta"></span>` +
                `<button class="bm-del" title="编辑">🖉</button><button class="bm-del" title="删除">✕</button>`;
            const nm = row.querySelector('.bm-name');
            nm.textContent = tag + (h.title || (h.type === 'scene' ? '跳转' : '信息点'));
            row.querySelector('.bm-meta').textContent = `${h.yaw}°,${h.pitch}°`;
            const btns = row.querySelectorAll('.bm-del');
            btns[0].onclick = (e) => { e.stopPropagation(); openForm(h); };
            btns[1].onclick = (e) => { e.stopPropagation(); removeHotspot(h.id); };
            nm.onclick = () => { PanoApp.viewer && PanoApp.viewer.setYaw(h.yaw); };
            list.appendChild(row);
        });
    }

    // -------------------- 打开表单 --------------------
    function openForm(existing, yaw, pitch) {
        const panel = $('editor-panel');
        panel.classList.remove('hidden');
        populateTargets();
        if (existing) {
            Editor.editingId = existing.id;
            $('ed-type').value = existing.type;
            $('ed-title').value = existing.title || '';
            $('ed-text').value = existing.text || '';
            $('ed-img').value = existing.image || '';
            $('ed-target').value = existing.sceneId || '';
            $('ed-yaw').textContent = (+existing.yaw).toFixed(1);
            $('ed-pitch').textContent = (+existing.pitch).toFixed(1);
            $('ed-coords').textContent = '编辑';
            $('ed-delete').classList.remove('hidden');
        } else {
            Editor.editingId = null;
            $('ed-type').value = 'info';
            $('ed-title').value = '';
            $('ed-text').value = '';
            $('ed-img').value = '';
            $('ed-yaw').textContent = yaw.toFixed(1);
            $('ed-pitch').textContent = pitch.toFixed(1);
            $('ed-coords').textContent = '新建';
            $('ed-delete').classList.add('hidden');
        }
        syncTypeFields();
    }
    function closeForm() {
        $('editor-panel').classList.add('hidden');
        Editor.editingId = null;
    }

    function populateTargets() {
        const sel = $('ed-target');
        sel.innerHTML = '';
        PanoApp.scenes.forEach(s => {
            if (s.id === PanoApp.currentScene) return;
            const o = document.createElement('option');
            o.value = s.id; o.textContent = s.title;
            sel.appendChild(o);
        });
    }

    function syncTypeFields() {
        const isScene = $('ed-type').value === 'scene';
        $('ed-text-wrap').classList.toggle('hidden', isScene);
        $('ed-img-wrap').classList.toggle('hidden', isScene);
        $('ed-target-wrap').classList.toggle('hidden', !isScene);
    }

    // -------------------- 保存 --------------------
    function buildFromForm() {
        const type = $('ed-type').value;
        const h = {
            id: Editor.editingId || ('h' + Date.now()),
            yaw: +$('ed-yaw').textContent,
            pitch: +$('ed-pitch').textContent,
            type,
            title: $('ed-title').value.trim(),
        };
        if (type === 'scene') {
            h.sceneId = $('ed-target').value;
        } else {
            h.text = $('ed-text').value.trim();
            if ($('ed-img').value.trim()) h.image = $('ed-img').value.trim();
        }
        return h;
    }
    function saveHotspot() {
        const sid = PanoApp.currentScene;
        const s = PanoApp.sceneMap[sid];
        if (!s || !PanoApp.viewer) return;
        s.hotspots = s.hotspots || [];
        const h = buildFromForm();
        if (h.type === 'scene' && !h.sceneId) { PanoApp.toast('请选择目标场景'); return; }
        try {
            if (Editor.editingId) {
                PanoApp.viewer.removeHotSpot(Editor.editingId, sid);
                const idx = s.hotspots.findIndex(x => x.id === Editor.editingId);
                if (idx >= 0) s.hotspots[idx] = h; else s.hotspots.push(h);
            } else {
                s.hotspots.push(h);
            }
            PanoApp.viewer.addHotSpot(PanoApp.hotspotToView(h), sid);
        } catch (e) {
            PanoApp.toast('操作失败：' + e.message);
            return;
        }
        closeForm();
        renderList();
        PanoApp.saveSceneMeta(sid);
    }
    function removeHotspot(id) {
        const sid = PanoApp.currentScene;
        const s = PanoApp.sceneMap[sid];
        if (!s || !PanoApp.viewer) return;
        try { PanoApp.viewer.removeHotSpot(id, sid); } catch (e) {}
        s.hotspots = (s.hotspots || []).filter(x => x.id !== id);
        renderList();
        PanoApp.saveSceneMeta(sid);
        PanoApp.toast('热点已删除');
    }

    // -------------------- 编辑模式 --------------------
    let downX = 0, downY = 0;
    function onViewerClick(e) {
        if (!Editor.editMode) return;
        if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return;     // 拖拽，忽略
        if (e.target.closest('.pnlm-hotspot')) return;                          // 点中已有热点
        if (e.target.closest('#editor-panel') || e.target.closest('#hotspot-manager')) return;
        const c = PanoApp.viewer.mouseEventToCoords(e);
        openForm(null, c[0], c[1]);
    }
    function onViewerDown(e) { downX = e.clientX; downY = e.clientY; }

    function setEditMode(on) {
        Editor.editMode = on;
        $('btn-edit').classList.toggle('active', on);
        const wrap = document.getElementById('panorama');
        if (on) {
            showManager(true);
            wrap.addEventListener('mousedown', onViewerDown);
            wrap.addEventListener('click', onViewerClick);
            wrap.style.cursor = 'crosshair';
            PanoApp.toast('编辑模式 · 点击画面放置热点');
        } else {
            showManager(false);
            closeForm();
            wrap.removeEventListener('mousedown', onViewerDown);
            wrap.removeEventListener('click', onViewerClick);
            wrap.style.cursor = '';
        }
    }
    function toggleEditMode() { setEditMode(!Editor.editMode); }

    // -------------------- 初始化 --------------------
    Editor.init = function () {
        $('btn-edit').onclick = toggleEditMode;
        $('ed-type').onchange = syncTypeFields;
        $('ed-save').onclick = saveHotspot;
        $('ed-cancel').onclick = closeForm;
        $('ed-delete').onclick = () => { if (Editor.editingId) removeHotspot(Editor.editingId); };
        // 点击表单/管理面板外部不关闭（编辑中保持），但切场景时刷新
    };
    // 场景就绪回调：刷新列表
    Editor.onLoad = function () { if (Editor.editMode) renderList(); };

    // 暴露给外部（导览/VR 等可能需要退出编辑）
    Editor.setEditMode = setEditMode;
})();
