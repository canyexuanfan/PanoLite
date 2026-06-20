/* ============================================================
 * home.js — 首页：拉取演示全景、渲染网格、跳转查看器
 * ============================================================ */
(function () {
    'use strict';

    async function init() {
        const grid = document.getElementById('demo-grid');
        const countEl = document.getElementById('demo-count');
        let demos = [];
        try {
            const res = await fetch('/api/scenes', { cache: 'no-store' });
            const data = await res.json();
            demos = data.scenes || [];
        } catch (e) {
            if (grid) grid.innerHTML = '<p class="empty">无法连接服务端，请确认 server.py 已启动</p>';
            return;
        }
        if (countEl) countEl.textContent = demos.length;
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
            card.querySelector('.demo-thumb').style.backgroundImage =
                'url(/api/thumb/' + encodeURIComponent(s.id) + ')';
            grid.appendChild(card);
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
