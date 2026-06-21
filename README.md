# PanoLite · 轻量级 360° 全景图查看器

> 基于 Pannellum 的轻量、本地优先的全景图查看应用。演示图共享只读，用户上传的图只存在自己的浏览器，天然多用户隔离、零后端数据库。

演示：把项目跑起来后访问首页即可体验。内置三张演示全景（埃菲尔铁塔、八达岭长城、圣索菲亚大教堂）。

---

## ✨ 特性

- **360° 沉浸浏览** - 拖拽漫游、滚轮缩放、自动旋转、全屏
- **热点标注** - 在画面任意位置放置信息点，或跳转到另一个全景场景（街景式漫游）
- **场景漫游** - 热点跳转 + 多场景巡游
- **自动导览** - 把多个场景排成路线，按顺序自动播放
- **视角分享** - 链接直达同一画面与角度（yaw / pitch / hfov 编进 URL）
- **截图导出** - 一键导出当前视角为 PNG
- **视角书签** - 收藏与跳回特定取景
- **陀螺仪 / VR 分屏** - 移动端转头看、Cardboard 式分屏（近似立体）
- **拖拽上传** - 把图片拖进窗口即加入你的私人图库
- **本地优先** - 用户上传的图、热点、书签全部存在自己的浏览器（IndexedDB / localStorage），不上传服务器，他人不可见
- **服务端缩略图** - 演示图自动生成小缩略图，列表加载快
- **响应式** - 桌面与手机端适配，手机端顶栏菜单合并、画廊抽屉

## 🧱 技术栈

- **前端**：原生 HTML / CSS / JavaScript（无框架、无构建步骤）
- **全景渲染**：[Pannellum](https://pannellum.org/)（本地化到 `vendor/`，离线可用，并补丁支持截图）
- **后端**：Python 标准库 `http.server`（零第三方依赖，仅作只读演示目录扫描 + 缩略图生成 + 错误日志）
- **存储**：IndexedDB（用户图片 Blob）+ localStorage（热点 / 导览 / 书签等标注）

## 🚀 快速开始

需要 Python 3.8+。

```bash
git clone https://github.com/<你的用户名>/PanoLite.git
cd PanoLite
python server.py
```

浏览器打开 http://localhost:8000/

> 注意：必须通过 HTTP 访问（不能用 `file://` 双击打开），因为 WebGL 纹理加载受同源策略限制。

## 🖼️ 添加演示全景

把等距矩形（equirectangular，2:1）的全景图放进 `panoramas/` 目录，刷新即自动出现。支持 `.jpg` / `.png` / `.webp`。

> 用户自己上传的图不会进这个目录，而是存在用户浏览器的 IndexedDB 里。

## 🌐 部署

`server.py` 是一个只读的静态 + API 服务，可部署到任何能跑 Python 的服务器。

示例（Nginx 反向代理）：

```bash
# 后端（只监听内网）
python server.py 8000 127.0.0.1

# Nginx 把域名反代到 127.0.0.1:8000
# location / { proxy_pass http://127.0.0.1:8000; }
```

建议配置 HTTPS（陀螺仪、剪贴板、IndexedDB 等功能需要安全上下文）。

用 systemd 常驻：

```ini
[Unit]
Description=PanoLite
After=network.target
[Service]
Type=simple
User=www
WorkingDirectory=/path/to/PanoLite
ExecStart=/usr/bin/python3 -u /path/to/PanoLite/server.py 8000 127.0.0.1
Restart=always
[Install]
WantedBy=multi-user.target
```

## 🏗️ 架构

```
演示图 ── 服务器 panoramas/ ── 共享、只读
用户图 ── 浏览器 IndexedDB ── 私密、仅本人
标注  ── 浏览器 localStorage ── 私密、跨会话
```

- 服务器只保留**演示图目录**（只读），不存任何用户数据
- 每个用户的上传与标注存在各自浏览器，天然多用户隔离，服务器零存储压力
- 画廊合并显示「演示」与「我的」两组，可一键切换

## 📁 目录结构

```
PanoLite/
├── index.html          首页（落地页 + 演示网格）
├── viewer.html         全景查看器
├── favicon.svg
├── server.py           只读后端（演示目录扫描 + 缩略图 + 错误日志）
├── assets/
│   ├── style.css       全部样式
│   ├── app.js          查看器核心（取数 / 画廊 / 分享 / 书签 / 截图 / 陀螺仪）
│   ├── home.js         首页演示网格
│   ├── db.js           IndexedDB 封装
│   ├── editor.js       热点编辑器
│   ├── tour.js         自动导览
│   └── vr.js           VR 分屏
├── vendor/             Pannellum（本地化 + 截图补丁）
└── panoramas/          演示全景图
```

## 🌍 浏览器支持

支持现代浏览器（Chrome / Edge / Firefox / Safari 最新版）。需要 WebGL。移动端陀螺仪与 VR 在支持相关传感器的设备上可用。

## 📄 开源协议

[MIT License](./LICENSE)
