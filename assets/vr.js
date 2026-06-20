/* ============================================================
 * vr.js — VR 分屏（cardboard 式近似立体，双 viewer 同步 + 视差偏移）
 * 挂载到 PanoApp.vr
 * 局限：近似立体（非 WebXR 真景深）；双 viewer 双倍内存/带宽，按需开启
 * ============================================================ */
(function () {
    'use strict';
    const PanoApp = window.PanoApp;
    if (!PanoApp) return;
    const $ = (id) => document.getElementById(id);

    const VR = PanoApp.vr = {
        on: false,
        viewer2: null,
        raf: null,
        EYE_OFFSET: 3, // 双眼视差偏移(度)，可按设备调整
    };

    function buildConfig(sceneId) {
        const s = PanoApp.sceneMap[sceneId];
        return {
            type: 'equirectangular',
            panorama: s.file,
            autoLoad: true,
            showControls: false,
            showZoomCtrl: false,
            showFullscreenCtrl: false,
            showControls: false,
            compass: false,
            mouseZoom: false,
            keyboardZoom: false,
            draggable: false,   // 副画面跟随主画面，不接受交互
            disableKeyboardCtrl: true,
            hfov: PanoApp.viewer.getHfov(),
            yaw: PanoApp.viewer.getYaw() + VR.EYE_OFFSET,
            pitch: PanoApp.viewer.getPitch(),
            crossOrigin: 'anonymous',
        };
    }

    // -------------------- 同步循环 --------------------
    function sync() {
        if (!VR.on || !VR.viewer2) return;
        try {
            VR.viewer2.setYaw(PanoApp.viewer.getYaw() + VR.EYE_OFFSET, false);
            VR.viewer2.setPitch(PanoApp.viewer.getPitch(), false);
            VR.viewer2.setHfov(PanoApp.viewer.getHfov(), false);
        } catch (e) {}
        VR.raf = requestAnimationFrame(sync);
    }

    // -------------------- 开启 --------------------
    VR.on_ = function () {
        if (!PanoApp.viewer || !PanoApp.currentScene) { PanoApp.toast('请先加载场景'); return; }
        document.body.classList.add('vr-on');
        VR.on = true;
        $('btn-vr').classList.add('active');
        // 等布局更新后再创建副 viewer
        requestAnimationFrame(() => {
            try {
                VR.viewer2 = pannellum.viewer('vr-second', buildConfig(PanoApp.currentScene));
                VR.viewer2.on('load', () => { window.dispatchEvent(new Event('resize')); sync(); });
            } catch (e) {
                PanoApp.toast('VR 初始化失败：' + e.message);
                VR.off_();
                return;
            }
            window.dispatchEvent(new Event('resize'));
        });
        PanoApp.toast('VR 分屏已开启 · 横屏装入手机盒子观看');
    };

    // -------------------- 关闭 --------------------
    VR.off_ = function () {
        VR.on = false;
        if (VR.raf) cancelAnimationFrame(VR.raf);
        document.body.classList.remove('vr-on');
        if (VR.viewer2) {
            try { VR.viewer2.destroy(); } catch (e) {}
            VR.viewer2 = null;
        }
        $('btn-vr').classList.remove('active');
        window.dispatchEvent(new Event('resize'));
    };

    VR.toggle = function () { VR.on ? VR.off_() : VR.on_(); };

    // -------------------- 初始化 --------------------
    VR.init = function () {
        // 主画面切场景时，同步副画面（无 setPanorama API，销毁重建）
        PanoApp.viewer.on('scenechange', (id) => {
            if (VR.on && VR.viewer2) {
                try { VR.viewer2.destroy(); } catch (e) {}
                VR.viewer2 = null;
                try {
                    VR.viewer2 = pannellum.viewer('vr-second', buildConfig(id));
                    VR.viewer2.on('load', () => { window.dispatchEvent(new Event('resize')); sync(); });
                } catch (e) {}
            }
        });
    };
    VR.onLoad = function () {};
})();
