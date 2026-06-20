#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
全景图应用服务端（只读）：静态文件服务 + 演示目录扫描。
零第三方依赖（仅 Python 标准库）。

用户上传的全景图只存在用户浏览器（IndexedDB），不经过本服务器。

用法:
    python server.py [端口]

API:
    GET /api/scenes   扫描 panoramas/ 返回演示图清单（只读）
"""
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit

ROOT = os.path.dirname(os.path.abspath(__file__))
PANO_DIR = os.path.join(ROOT, 'panoramas')
IMG_EXTS = ('.jpg', '.jpeg', '.png', '.webp')

MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
}


def scan_scenes():
    """扫描 panoramas/ 目录，返回演示图清单（只读，无元数据）。"""
    scenes = []
    os.makedirs(PANO_DIR, exist_ok=True)
    if os.path.isdir(PANO_DIR):
        for name in sorted(os.listdir(PANO_DIR)):
            ext = os.path.splitext(name)[1].lower()
            if ext not in IMG_EXTS:
                continue
            sid = os.path.splitext(name)[0]
            scenes.append({
                'id': sid,
                'title': sid,
                'file': '/panoramas/' + name,
            })
    return scenes


def cache_for(path):
    """分级缓存策略：HTML/代码文件实时（改动即时生效），库长缓存，演示图中等缓存。"""
    if path.startswith('/api/') or path.endswith('.html') or path.startswith('/assets/'):
        return 'no-cache'              # API/HTML/JS/CSS：不缓存，保证改动即时生效
    if path.startswith('/vendor/'):
        return 'public, max-age=86400'  # 第三方库稳定：1 天
    return 'public, max-age=3600'       # 演示图/favicon：1 小时


def find_pano_file(sid):
    sid = os.path.basename(sid)
    for ext in IMG_EXTS:
        p = os.path.join(PANO_DIR, sid + ext)
        if os.path.isfile(p):
            return p
    return None


def ensure_thumb(sid):
    """生成并缓存演示图缩略图（仅用于列表预览，绝不改动原图）。"""
    sid = os.path.basename(sid)
    thumb_dir = os.path.join(PANO_DIR, '.thumbs')
    tp = os.path.join(thumb_dir, sid + '.jpg')
    if os.path.isfile(tp):
        return tp
    src = find_pano_file(sid)
    if not src:
        return None
    try:
        from PIL import Image
        os.makedirs(thumb_dir, exist_ok=True)
        im = Image.open(src).convert('RGB')
        w = 360
        h = max(1, round(w * im.height / im.width))
        im = im.resize((w, h))
        im.save(tp, 'JPEG', quality=72, optimize=True)
        print('  [缩略图] 已生成:', sid)
        return tp
    except Exception as e:
        print('  [缩略图] 生成失败:', sid, e)
        return None


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # 静默日志

    def _send(self, code, body=b'', ctype='application/json; charset=utf-8', cc='no-cache'):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', cc)
        self.end_headers()
        if body:
            self.wfile.write(body)

    def _json(self, code, obj):
        self._send(code, json.dumps(obj, ensure_ascii=False).encode('utf-8'))

    def do_GET(self):
        path = unquote(urlsplit(self.path).path)

        if path == '/api/scenes':
            self._json(200, {'scenes': scan_scenes()})
            return

        # 演示图缩略图（列表预览用，小图；原图不压缩）
        if path.startswith('/api/thumb/'):
            sid = path[len('/api/thumb/'):]
            tp = ensure_thumb(sid)
            if not tp:
                self._send(404, b'no thumbnail', 'text/plain; charset=utf-8')
                return
            with open(tp, 'rb') as f:
                body = f.read()
            self._send(200, body, 'image/jpeg', 'public, max-age=86400')
            return

        # 静态文件服务
        if path == '/':
            path = '/index.html'
        rel = path.lstrip('/')
        full = os.path.normpath(os.path.join(ROOT, rel))
        if not full.startswith(ROOT) or not os.path.isfile(full):
            self._send(404, b'Not Found', 'text/plain; charset=utf-8')
            return
        ext = os.path.splitext(full)[1].lower()
        ctype = MIME.get(ext, 'application/octet-stream')
        with open(full, 'rb') as f:
            body = f.read()
        self._send(200, body, ctype, cache_for(path))

    # 仅接受错误日志上报（诊断用），其余 POST 拒绝
    def do_POST(self):
        path = unquote(urlsplit(self.path).path)
        length = int(self.headers.get('Content-Length', 0) or 0)
        if path == '/api/errorlog':
            body = self.rfile.read(length).decode('utf-8', 'replace')[:4000]
            try:
                with open(os.path.join(ROOT, 'error.log'), 'a', encoding='utf-8') as f:
                    f.write(body + '\n')
            except Exception:
                pass
            self._json(200, {'ok': True})
            return
        if length:
            self.rfile.read(length)
        self._json(405, {'error': 'server is read-only; user data stays in your browser'})


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    host = sys.argv[2] if len(sys.argv) > 2 else '0.0.0.0'
    srv = ThreadingHTTPServer((host, port), Handler)
    print('════════════════════════════════════════')
    print(' 全景图应用服务已启动（只读）')
    print(f' 监听: {host}:{port}')
    print(f' 首页: http://localhost:{port}/')
    print(f' 查看器: http://localhost:{port}/viewer.html')
    print(f' 演示图目录: {PANO_DIR}')
    print(' 用户上传的图只存在浏览器，不进服务器')
    print(' 生产环境建议: python server.py 8000 127.0.0.1（配合 Nginx 反代）')
    print(' 按 Ctrl+C 停止')
    print('════════════════════════════════════════')
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print('\n已停止')
        srv.shutdown()


if __name__ == '__main__':
    main()
