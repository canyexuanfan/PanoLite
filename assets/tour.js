/* ============================================================
 * tour.js — 自动导览（多场景按序巡游 + 循环）
 * 挂载到 PanoApp.tour
 * ============================================================ */
(function () {
    'use strict';
    const PanoApp = window.PanoApp;
    if (!PanoApp) return;
    const $ = (id) => document.getElementById(id);

    const Tour = PanoApp.tour;  // 引用 app.js 已创建的对象，绝不重新赋值（否则 fetchScenes 替换后 init 会丢失）
    Tour.playing = false;
    Tour.stepIdx = 0;
    Tour.timer = null;

    function steps() { return PanoApp.tour.steps; }
    function sceneTitle(id) { return PanoApp.sceneMap[id] ? PanoApp.sceneMap[id].title : id; }

    // -------------------- 持久化（写本浏览器 localStorage）--------------------
    function persist() {
        try { PanoApp.writeTour(PanoApp.tour); } catch (e) {}
    }

    // -------------------- 渲染步骤列表 --------------------
    function render() {
        const box = $('tour-steps');
        box.innerHTML = '';
        const arr = steps();
        if (arr.length === 0) {
            box.innerHTML = '<div class="popup-empty" style="text-align:left;line-height:1.8;padding:16px">'
                + '导览 = 自动按顺序播放多个场景<br>'
                + '① 先切到要加入的全景图<br>'
                + '② 点「+ 加入当前场景」<br>'
                + '③ 再切到别的图，继续加入<br>'
                + '④ 点「▶ 播放导览」自动巡游<br>'
                + '<span style="color:rgba(255,255,255,.3)">至少加入 2 个场景才好玩</span>'
                + '</div>';
            return;
        }
        arr.forEach((st, i) => {
            const row = document.createElement('div');
            row.className = 'tour-step';
            row.innerHTML = `<span class="idx">${i + 1}</span>` +
                `<span class="nm"></span>` +
                `<span>停留</span><input type="number" min="1" max="120" value="${st.dwell || 5}">` +
                `<span class="dw">秒</span>` +
                `<button class="bm-del" title="移除">✕</button>`;
            row.querySelector('.nm').textContent = sceneTitle(st.scene);
            row.querySelector('input').onchange = (e) => {
                st.dwell = clamp(parseInt(e.target.value) || 5, 1, 120);
                e.target.value = st.dwell;
                persist();
            };
            row.querySelector('.bm-del').onclick = () => {
                arr.splice(i, 1);
                render();
                persist();
            };
            box.appendChild(row);
        });
    }

    function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

    // -------------------- 加入当前场景 --------------------
    function addCurrent() {
        const id = PanoApp.currentScene;
        if (!id) { PanoApp.toast('请先加载场景'); return; }
        const arr = steps();
        if (arr.some(s => s.scene === id)) { PanoApp.toast('该场景已在导览中'); return; }
        arr.push({ scene: id, dwell: 5 });
        render();
        persist();
        PanoApp.toast('已加入导览');
    }

    // -------------------- 播放 / 停止 --------------------
    function play() {
        const arr = steps();
        if (arr.length === 0) { PanoApp.toast('请先加入场景'); return; }
        if (!PanoApp.viewer) return;
        Tour.playing = true;
        Tour.stepIdx = 0;
        // 导览期间开启全局自动旋转（跨场景保持）
        PanoApp.autoRotate = true;
        PanoApp.applyAutoRotate(-3);  // 立即启动旋转（单场景也生效）
        $('btn-rotate').classList.add('active');
        $('tour-play').textContent = '⏹ 停止导览';
        $('btn-tour').classList.add('active');
        PanoApp.toast('开始自动导览');
        advance();
    }
    function advance() {
        if (!Tour.playing) return;
        const arr = steps();
        if (Tour.stepIdx >= arr.length) {
            if (PanoApp.tour.loop && arr.length > 0) {
                Tour.stepIdx = 0;
            } else {
                stop();
                return;
            }
        }
        const st = arr[Tour.stepIdx];
        if (PanoApp.currentScene !== st.scene) {
            PanoApp.viewer.loadScene(st.scene);
        }
        Tour.stepIdx++;
        const dwell = (st.dwell || 5) * 1000;
        Tour.timer = setTimeout(advance, dwell);
    }
    function stop() {
        Tour.playing = false;
        clearTimeout(Tour.timer);
        $('tour-play').textContent = '▶ 播放导览';
        $('btn-tour').classList.remove('active');
        PanoApp.autoRotate = false;
        PanoApp.applyAutoRotate(0);
        $('btn-rotate').classList.remove('active');
    }
    function togglePlay() { Tour.playing ? stop() : play(); }

    // -------------------- 初始化 --------------------
    Tour.init = function () {
        $('tour-add').onclick = addCurrent;
        $('tour-play').onclick = togglePlay;
        render();
    };
    Tour.onLoad = function () { /* 场景切换时无需操作 */ };
    Tour.stop = stop;
})();
