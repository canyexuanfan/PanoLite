/* ============================================================
 * home.js - 首页：拉取演示全景、渲染网格、跳转查看器
 * ============================================================ */
(function () {
    'use strict';

    async function loadDemoScenes() {
        const res = await fetch('/assets/scenes.json', { cache: 'no-store' });
        if (!res.ok) throw new Error('Failed to load static scenes');
        const data = await res.json();
        return data.scenes || [];
    }

    function sceneThumb(scene) {
        return scene.thumb || scene.file || scene.panorama || '';
    }

    async function init() {
        const grid = document.getElementById('demo-grid');
        const countEl = document.getElementById('demo-count');
        let demos = [];
        try {
            demos = await loadDemoScenes();
        } catch (e) {
            if (grid) grid.innerHTML = '<p class="empty">无法连接服务端，请确认 server.py 已启动</p>';
            return;
        }
        if (countEl) countEl.textContent = demos.length;

        // Hero 预览窗：填充首张演示缩略图（真实全景画面，非渐变色块）
        const portal = document.getElementById('hero-portal');
        if (portal && demos.length > 0) {
            portal.style.backgroundImage = 'url(' + sceneThumb(demos[0]) + ')';
        }

        if (!grid) return;
        if (demos.length === 0) {
            grid.innerHTML = '<p class="empty">还没有演示全景图</p>';
            return;
        }
        grid.innerHTML = '';
        demos.forEach(s => {
            const card = document.createElement('a');
            card.className = 'demo-card';
            card.href = 'viewer.html#scene=' + encodeURIComponent(s.id);
            card.innerHTML = '<div class="demo-thumb"></div><div class="demo-name"></div><div class="demo-go">进入查看 →</div>';
            card.querySelector('.demo-name').textContent = s.title;
            // 演示图用服务端缩略图（小图，不下载全图）
            card.querySelector('.demo-thumb').style.backgroundImage = 'url(' + sceneThumb(s) + ')';
            grid.appendChild(card);
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
