// ==UserScript==
// @name         网页二维码识别器
// @name:zh-CN   网页二维码识别器
// @name:zh-TW   網頁二維碼辨識器
// @namespace    http://tampermonkey.net/
// @version      1.3.1
// @description  自动扫描网页二维码，右键图片识别，结果持久化展示，支持打开链接复制定位
// @author       HH2XX
// @match        *://*/*
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_getValue
// @homepage     https://github.com/HH2XX/qrcode-scanner
// @support_url    https://github.com/HH2XX/qrcode-scanner/issues
// @run-at       document-end
// @require      https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js
// ==/UserScript==

(function() {
    'use strict';

    const SCANNED_URLS = new Set();
    let results = [];
    let scanTimer = null;
    let activeToasts = [];

    /* ==================== 样式 ==================== */
    GM_addStyle(`
        #qrscanner-panel {
            position: fixed; right: 0; top: 0; width: 400px; height: 100vh;
            background: rgba(255,255,255,0.98); backdrop-filter: blur(12px) saturate(180%);
            box-shadow: -4px 0 30px rgba(0,0,0,0.12), -1px 0 0 rgba(0,0,0,0.05);
            z-index: 2147483646; transform: translateX(100%);
            transition: transform 0.3s cubic-bezier(0.4,0,0.2,1);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
            display: flex; flex-direction: column; border-left: 1px solid rgba(0,0,0,0.08);
        }
        #qrscanner-panel.open { transform: translateX(0); }
        .qr-header {
            padding: 18px 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white; display: flex; align-items: center; justify-content: space-between;
            position: relative; overflow: hidden;
        }
        .qr-header::before {
            content: ""; position: absolute; top: -50%; right: -20%; width: 200px; height: 200px;
            background: rgba(255,255,255,0.1); border-radius: 50%; pointer-events: none;
        }
        .qr-header h1 { font-size: 18px; font-weight: 700; margin: 0; position: relative; z-index: 1; }
        .qr-close {
            background: rgba(255,255,255,0.2); border: none; color: white; width: 32px; height: 32px;
            border-radius: 8px; cursor: pointer; font-size: 16px; display: flex; align-items: center;
            justify-content: center; transition: all 0.2s; position: relative; z-index: 2;
        }
        .qr-close:hover { background: rgba(255,255,255,0.3); transform: scale(1.05); }
        .qr-body { flex: 1; overflow-y: auto; padding: 16px; background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%); }
        .qr-body::-webkit-scrollbar { width: 6px; }
        .qr-body::-webkit-scrollbar-track { background: transparent; }
        .qr-body::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; }
        .qr-empty { text-align: center; padding: 60px 20px; color: #94a3b8; }
        .qr-empty-icon { font-size: 64px; margin-bottom: 16px; opacity: 0.6; }
        .qr-empty-title { font-size: 16px; font-weight: 600; color: #64748b; margin-bottom: 8px; }
        .qr-empty-desc { font-size: 13px; color: #94a3b8; line-height: 1.5; }
        .qr-item {
            background: white; border-radius: 14px; padding: 16px; margin-bottom: 12px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.06); border: 1px solid rgba(0,0,0,0.06);
            transition: all 0.2s; position: relative; overflow: hidden;
        }
        .qr-item::before {
            content: ""; position: absolute; top: 0; left: 0; right: 0; height: 3px;
            background: linear-gradient(90deg, #667eea, #764ba2); opacity: 0; transition: opacity 0.2s;
        }
        .qr-item:hover { transform: translateY(-2px); box-shadow: 0 8px 25px rgba(0,0,0,0.1); }
        .qr-item:hover::before { opacity: 1; }
        .qr-meta { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
        .qr-badge {
            display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px;
            border-radius: 20px; font-size: 11px; font-weight: 600; text-transform: uppercase;
        }
        .qr-badge-url { background: linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%); color: #1e40af; }
        .qr-badge-text { background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); color: #92400e; }
        .qr-time { font-size: 11px; color: #94a3b8; font-weight: 500; }
        .qr-text {
            word-break: break-all; font-size: 13px; color: #1e293b; line-height: 1.5;
            padding: 10px 12px; background: #f8fafc; border-radius: 8px;
            border-left: 3px solid #667eea; font-family: "SF Mono", Monaco, monospace;
            font-size: 12px; margin-bottom: 12px;
        }
        .qr-actions { display: flex; gap: 8px; flex-wrap: wrap; }
        .qr-btn {
            border: none; padding: 7px 14px; border-radius: 8px; cursor: pointer;
            font-size: 12px; font-weight: 500; transition: all 0.2s;
            display: inline-flex; align-items: center; gap: 4px; font-family: inherit;
        }
        .qr-btn:hover { transform: translateY(-1px); }
        .qr-btn:active { transform: translateY(0); }
        .qr-btn-primary {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white;
            box-shadow: 0 2px 8px rgba(102,126,234,0.3);
        }
        .qr-btn-primary:hover { box-shadow: 0 4px 12px rgba(102,126,234,0.4); }
        .qr-btn-secondary { background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0; }
        .qr-btn-secondary:hover { background: #e2e8f0; }
        .qr-btn-danger { background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; }
        .qr-btn-danger:hover { background: #fee2e2; }
        #qrscanner-toggle {
            position: fixed; right: 20px; bottom: 20px; width: 56px; height: 56px;
            border-radius: 50%; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white; border: none; box-shadow: 0 6px 20px rgba(102,126,234,0.4);
            font-size: 20px; cursor: pointer; z-index: 2147483645;
            display: flex; align-items: center; justify-content: center; transition: all 0.3s;
        }
        #qrscanner-toggle:hover { transform: scale(1.1) rotate(5deg);
            box-shadow: 0 8px 25px rgba(102,126,234,0.5); }
        #qrscanner-context-menu {
            position: absolute; z-index: 2147483647; background: rgba(255,255,255,0.98);
            backdrop-filter: blur(12px); border: 1px solid rgba(0,0,0,0.08); border-radius: 12px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.15); display: none; overflow: hidden;
            min-width: 180px; padding: 6px;
        }
        .qr-cm-item {
            padding: 10px 14px; font-size: 13px; cursor: pointer; color: #1e293b;
            border-radius: 8px; transition: all 0.15s; display: flex; align-items: center; gap: 8px;
        }
        .qr-cm-item:hover { background: #f1f5f9; color: #667eea; }
        .qr-cm-item::before { content: "🔍"; }
        .qr-toast {
            position: fixed; left: 50%; top: 20px; transform: translateX(-50%);
            z-index: 2147483647; min-width: 300px; max-width: 500px; padding: 16px;
            border-radius: 14px; background: rgba(255,255,255,0.98);
            backdrop-filter: blur(12px) saturate(180%);
            box-shadow: 0 10px 40px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.05);
            display: none; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            border: 1px solid rgba(0,0,0,0.06);
        }
        .qr-toast-header { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
        .qr-toast-icon {
            width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center;
            justify-content: center; font-size: 14px; font-weight: bold; flex-shrink: 0;
        }
        .qr-toast-loading .qr-toast-icon {
            background: linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%); color: #667eea;
            animation: qrspin 1s linear infinite;
        }
        .qr-toast-success .qr-toast-icon { background: linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%); color: #059669; }
        .qr-toast-error .qr-toast-icon { background: linear-gradient(135deg, #fee2e2 0%, #fecaca 100%); color: #dc2626; }
        .qr-toast-hint .qr-toast-icon { background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); color: #d97706; }
        @keyframes qrspin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .qr-toast-title { font-weight: 600; font-size: 14px; color: #1e293b; }
        .qr-toast-message { color: #475569; margin-left: 34px; word-break: break-all; line-height: 1.5; }
        .qr-toast-actions { margin-top: 12px; display: flex; gap: 8px; flex-wrap: wrap; margin-left: 34px; }
        .qr-toast-btn {
            border: none; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white;
            padding: 8px 16px; border-radius: 8px; cursor: pointer; font-size: 12px;
            font-weight: 500; transition: all 0.2s; font-family: inherit;
        }
        .qr-toast-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(102,126,234,0.4); }
        .qr-toast-btn-secondary { background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0; }
        .qr-toast-btn-secondary:hover { background: #e2e8f0; box-shadow: none; }
        .qr-toast-close {
            position: absolute; top: 12px; right: 12px; background: none; border: none;
            font-size: 20px; cursor: pointer; color: #94a3b8; width: 28px; height: 28px;
            display: flex; align-items: center; justify-content: center; border-radius: 6px;
            transition: all 0.2s;
        }
        .qr-toast-close:hover { background: #f1f5f9; color: #475569; }
        .qr-toast-progress {
            position: absolute; bottom: 0; left: 0; height: 3px;
            background: #667eea; border-radius: 0 0 14px 14px; transition: width 0.3s ease;
        }
        .clear-all-btn {
            margin: 0 16px 16px; padding: 12px;
            background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%);
            color: #dc2626; border: 1px solid #fecaca; border-radius: 10px;
            cursor: pointer; font-size: 12px; font-weight: 600; transition: all 0.2s;
            display: flex; align-items: center; justify-content: center; gap: 6px; font-family: inherit;
        }
        .clear-all-btn:hover {
            background: linear-gradient(135deg, #fee2e2 0%, #fecaca 100%);
            transform: translateY(-1px); box-shadow: 0 4px 12px rgba(220,38,38,0.15);
        }
    `);

    /* ==================== 工具 ==================== */
    function escapeHtml(text) {
        const d = document.createElement('div');
        d.textContent = text;
        return d.innerHTML;
    }

    function copyText(text) {
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
        } else fallbackCopy(text);
    }
    function fallbackCopy(text) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none;';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch (e) {}
        document.body.removeChild(ta);
    }

    /* ==================== Toast（修复交互） ==================== */
    function showToast(message, type = 'info', duration = 0, actions = [], title = '') {
        const existing = activeToasts.find(t => t.type === type && !t.persistent);
        if (existing) removeToast(existing);

        const toast = document.createElement('div');
        toast.className = `qr-toast qr-toast-${type}`;
        toast.setAttribute('role', 'alert');

        const iconMap = { loading: '⟳', success: '✓', error: '✕', hint: '💡', info: 'ℹ' };
        const titleMap = { loading: '识别中', success: '识别成功', error: '识别失败', hint: '提示', info: '提示' };
        const iconText = iconMap[type] || 'ℹ';
        const titleText = title || titleMap[type] || '提示';

        // actions 支持两种形态：字符串数组 或 {text, cls, handler} 对象数组
        let btnHtml = '';
        if (actions.length) {
            btnHtml = '<div class="qr-toast-actions">';
            actions.forEach((a, i) => {
                if (typeof a === 'string') {
                    btnHtml += a;
                } else {
                    btnHtml += `<button class="${a.cls || 'qr-toast-btn'}" data-idx="${i}">${a.text</button>`;
                }
            });
            btnHtml +=</div>';
        }

        toast.innerHTML = `
            <button class="qr-toast-close" data-close="1">✕</button>
            <div class="qr-toast-header">
                <div class="qr-toast-icon">${iconText</div>
                <div class="qr-toast-title">${escapeHtml(titleText)}</div>
           </div>
            <div class="qr-toast-message">${typeof message === 'string' ? escapeHtml(message) : message</div>
            ${btnHtml}
            ${duration > 0 ? '<div class="qr-toast-progress" style="width:100%</div>' : ''}
        `;

        document.body.appendChild(toast);
        toast.style.display = 'block';

        // 立即绑定关闭按钮
        toast.querySelector('[data-close]').onclick = () => removeToast(toastData);

        // 立即绑定对象型 actions 的 handler
        actions.forEach((a, i) => {
            if (typeof a === 'object' && typeof a.handler === 'function') {
                const btn = toast.querySelector(`button[data-idx="${i}"]`);
                if (btn) btn.onclick = a.handler;
            }
        });

        const toastData = {
            element: toast,
            type,
            persistent: duration === 0,
            createdAt: Date.now()
        };
        activeToasts.push(toastData);

        if (duration > 0) {
            const progress = toast.querySelector('.qr-toast-progress');
            if (progress) setTimeout(() => { progress.style.width = '0%'; }, 50);
            setTimeout(() => removeToast(toastData), duration);
        }

        return toastData;
    }

    function removeToast(toastData) {
        if (!toastData) return;
        if (toastData.element && toastData.element.parentNode) toastData.element.remove();
        activeToasts = activeToasts.filter(t => t !== toastData);
    }

    /* ==================== 解码核心（识别率优化） ==================== */
    async function decodeCanvas(imageBitmapOrElement) {
        try {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d', { willReadFrequently: true });

            let width = 0, height = 0;
            if (imageBitmapOrElement instanceof ImageBitmap) {
                width = imageBitmapOrElement.width;
                height = imageBitmapOrElement.height;
            } else {
                width = imageBitmapOrElement.naturalWidth || imageBitmapOrElement.width;
                height = imageBitmapOrElement.naturalHeight || imageBitmapOrElement.height;
            }
            if (!width || !height || width < 21 || height < 21) return null;

            const maxDim = 1000;
            const minDim = 200;
            const maxSide = Math.max(width, height);
            let scale = Math.min(1, maxDim / maxSide);
            if (maxSide < minDim) scale = Math.max(scale, minDim / maxSide);

            const w = Math.max(1, Math.floor(width * scale));
            const h = Math.max(1, Math.floor(height * scale));
            canvas.width = w; canvas.height = h;
            ctx.drawImage(imageBitmapOrElement, 0, 0, w, h);

            const imageData = ctx.getImageData(0, 0, w, h);
            const data = imageData.data;
            // 对比度增强
            for (let i = 0; i < data.length; i += 4) {
                const gray = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
                const enhanced = gray > 128 ? Math.min(255, gray + 35) : Math.max(0, gray - 35);
                data[i] = data[i+1] = data[i+2] = enhanced;
            }
            ctx.putImageData(imageData, 0, 0);

            // 多模式解码
            const modes = [
                { inversionAttempts: 'dontInvert' },
                { inversionAttempts: 'invert' },
                { inversionAttempts: 'both' }
            ];
            for (const mode of modes) {
                try {
                    const code = jsQR(imageData.data, w, h, mode);
                    if (code && code.data && code.data.trim().length > 0) {
                        return code.data.trim();
                    }
                } catch (e) {}
            }
            return null;
        } catch (err) {
            return null;
        }
    }

    /* ==================== 扫描 ==================== */
    async function scanImage(img) {
        const src = img.src || img.getAttribute('src');
        if (!src || SCANNED_URLS.has(src)) return null;

        const nw = img.naturalWidth || 0, nh = img.naturalHeight || 0;
        if (nw < 20 || nh < 20 || nw * nh < 400) {
            SCANNED_URLS.add(src);
            return null;
        }

        try {
            const data = await decodeCanvas(img);
            if (data) {
                SCANNED_URLS.add(src);
                return {
                    id: btoa(src).replace(/[^a-z0-9]/gi, '').slice(-8),
                    src,
                    data,
                    kind: /^https?:\/\//i.test(data) ? 'url' : 'text',
                    time: new Date().toLocaleTimeString()
                };
            }
        } catch (e) {}
        SCANNED_URLS.add(src);
        return null;
    }

    async function scanPage() {
        const found = [];
        const imgs = Array.from(document.querySelectorAll('img'))
            .filter(i => {
                const w = i.naturalWidth || 0, h = i.naturalHeight || 0;
                return w >= 20 && h >= 20 && w * h >= 400;
            })
            .slice(0, 50);

        const batchSize = 6;
        for (let i = 0; i < imgs.length; i += batchSize) {
            const batch = imgs.slice(i, i + batchSize);
            const batchItems = await Promise.all(batch.map(img => scanImage(img)));
            batchItems.forEach(it => { if (it) found.push(it); });
        }
        return found;
    }

    function sendResults(items) {
        if (!items || !items.length) return;
        results = [...items, ...results];
        try { GM_setValue('qrResults', JSON.stringify(results)); } catch (e) {}
        renderResults();
    }

    function scheduleScan() {
        clearTimeout(scanTimer);
        scanTimer = setTimeout(() => scanPage().then(sendResults), 600);
    }

    function highlightResultId(targetId) {
        document.querySelectorAll('.qrscanner-highlight').forEach(el => {
            el.classList.remove('qrscanner-highlight');
            el.style.outline = ''; el.style.outlineOffset = '';
            el.style.backgroundColor = ''; el.style.boxShadow = '';
        });
        const img = document.querySelector(`img[data-qr-id="${targetId}"]`);
        if (!img) return;
        img.classList.add('qrscanner-highlight');
        img.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => {
            img.style.outline = '3px solid #667eea';
            img.style.outlineOffset = '4px';
            img.style.backgroundColor = 'rgba(102,126,234,0.1)';
            img.style.boxShadow = '0 0 0 8px rgba(102,126,234,0.2), 0 0 25px rgba(102,126,234,0.4)';
            img.style.zIndex = '2147483646';
        }, 50);
        setTimeout(() => {
            img.classList.remove('qrscanner-highlight');
            img.style.outline = ''; img.style.outlineOffset = '';
            img.style.backgroundColor = ''; img.style.boxShadow = '';
            img.style.zIndex = '';
        }, 3000);
    }

    /* ==================== 右键扫描 ==================== */
    async function handleContextScan(imageUrl) {
        const loadingToast = showToast('正在识别二维码...', 'loading', 0, [], '识别中');
        try {
            let data = null;
            const byImg = document.querySelector(`img[src="${CSS.escape(imageUrl)}"]`);

            if (byImg && (byImg.naturalWidth||0) >= 21 && (byImg.naturalHeight||0) >= 21) {
                data = await decodeCanvas(byImg);
            }

            if (!data) {
                try {
                    const image = new Image();
                    await new Promise((resolve, reject) => {
                        image.onload = async () => { data = await decodeCanvas(image); resolve(); };
                        image.onerror = () => reject(new Error('图片加载失败'));
                        image.src = imageUrl;
                    });
                } catch (e) {}
            }

            removeToast(loadingToast);

            if (data) {
                const isUrl = /^https?:\/\//i.test(data);
                const actions = [];
                if (isUrl) {
                    actions.push({
                        cls: 'qr-toast-btn',
                        text: '🌐 打开链接',
                        handler: () => window.open(data, '_blank')
                    });
                }
                actions.push({
                    cls: 'qr-toast-btn',
                    text: '📋 复制内容',
                    handler: () => {
                        copyText(data);
                        showToast('已复制到剪贴板', 'success', 2000, [], '复制成功');
                    }
                });
                actions.push({
                    cls: 'qr-toast-btn qr-toast-btn-secondary',
                    text: '关闭',
                    handler: () => {
                        const el = document.querySelector('.qr-toast-success');
                        if (el) el.remove();
                        activeToasts = activeToasts.filter(t => !(t.type === 'success' && !t.persistent));
                    }
                });

                showToast(`识别成功：${data}`, 'success', 0, actions, '识别成功');

                // 同步到结果列表
                const item = {
                    id: btoa(imageUrl).replace(/[^a-z0-9]/gi, '').slice(-8),
                    src: imageUrl,
                    data,
                    kind: isUrl ? 'url' : 'text',
                    time: new Date().toLocaleTimeString()
                };
                sendResults([item]);
            } else {
                const actions = [
                    {
                        cls: 'qr-toast-btn',
                        text: '🔍 打开原图试试',
                        handler: () => window.open(imageUrl, '_blank')
                    },
                    {
                        cls: 'qr-toast-btn qr-toast-btn-secondary',
                        text: '关闭',
                        handler: () => {
                            const el = document.querySelector('.qr-toast-hint');
                            if (el) el.remove();
                            activeToasts = activeToasts.filter(t => !(t.type === 'hint' && !t.persistent));
                        }
                    }
                ];
                showToast('未检测到二维码，建议双击打开大图后再识别', 'hint', 0, actions, '识别失败');
            }
        } catch (e) {
            removeToast(loadingToast);
            showToast('识别失败：读取图片异常', 'error', 0, [
                {
                    cls: 'qr-toast-btn qr-toast-btn-secondary',
                    text: '关闭',
                    handler: () => {
                        const el = document.querySelector('.qr-toast-error');
                        if (el) el.remove();
                        activeToasts = activeToasts.filter(t => !(t.type === 'error' && !t.persistent));
                    }
                }
            ], '识别失败');
        }
    }

    function initContextMenu() {
        const menu = document.createElement('div');
        menu.id = 'qrscanner-context-menu';
        menu.innerHTML = '<div class="qr-cm-item" data-act="scan">识别此二维码</div>';
        document.body.appendChild(menu);

        document.addEventListener('contextmenu', e => {
            const img = e.target.closest('img');
            if (!img) { menu.style.display = 'none'; return; }
            e.preventDefault();
            const src = img.src || img.getAttribute('src');
            if (!src) return;
            menu.style.display = 'block';
            menu.style.left = `${e.pageX}px`;
            menu.style.top = `${e.pageY}px`;
            menu.dataset.src = src;
        });

        document.addEventListener('click', e => { if (!menu.contains(e.target)) menu.style.display = 'none'; });

        menu.addEventListener('click', async e => {
            if (e.target.dataset.act !== 'scan') return;
            const src = menu.dataset.src;
            menu.style.display = 'none';
            if (src) handleContextScan(src);
        });
    }

    /* ==================== UI ==================== */
    function renderResults() {
        const list = document.getElementById('qrscanner-list');
        const empty = document.getElementById('qrscanner-empty');
        const clearBtn = document.getElementById('qrscanner-clear-all');

        if (!results.length) {
            list.innerHTML = '';
            empty.style.display = 'block';
            if (clearBtn) clearBtn.style.display = 'none';
            return;
        }

        empty.style.display = 'none';
        if (clearBtn) clearBtn.style.display = 'flex';

        list.innerHTML = results.map(item => {
            const isUrl = item.kind === 'url';
            return `<div class="qr-item">
                <div class="qr-meta">
                    <span class="qr-badge ${isUrl ? 'qr-badge-url' : 'qr-badge-text'}">
                        ${isUrl ? '🔗' : '📝'} ${isUrl ? '链接' : '文本'}
                   </span>
                    <span class="qr-time">${escapeHtml(item.time)}</span>
               </div>
                <div class="qr-text" title="${escapeHtml(item.data)}">${escapeHtml(item.data)}</div>
                <div class="qr-actions">
                    ${isUrl ? `<button class="qr-btn qr-btn-primary" data-id="${item.id}" data-act="open">🌐 打开</button>` : ''}
                    <button class="qr-btn qr-btn-secondary" data-id="${item.id}" data-act="copy">📋 复制</button>
                    <button class="qr-btn qr-btn-secondary" data-id="${item.id}" data-act="locate">🎯 定位</button>
                    <button class="qr-btn qr-btn-danger" data-id="${item.id}" data-act="remove">🗑️ 删除</button>
               </div>
           </div>`;
        }).join('');

        // 立即绑定列表按钮事件
        list.querySelectorAll('button[data-act]').forEach(btn => {
            const id = btn.dataset.id, act = btn.dataset.act;
            const item = results.find(r => r.id === id);
            if (!item) return;

            btn.onclick = () => {
                if (act === 'open' && item.kind === 'url') {
                    window.open(item.data, '_blank');
                } else if (act === 'copy') {
                    copyText(item.data);
                    const original = btn.innerHTML;
                    btn.innerHTML = '✓ 已复制';
                    btn.style.background = '#d1fae5';
                    btn.style.color = '#065f46';
                    setTimeout(() => { btn.innerHTML = original; btn.style.cssText = ''; }, 1800);
                } else if (act === 'locate') {
                    highlightResultId(item.id);
                } else if (act === 'remove') {
                    results = results.filter(r => r.id !== id);
                    try { GM_setValue('qrResults', JSON.stringify(results)); } catch (e) {}
                    renderResults();
                }
            };
        });
    }

    function buildUI() {
        const panel = document.createElement('div');
        panel.id = 'qrscanner-panel';
        panel.innerHTML = `
            <div class="qr-header">
                <h1>🔍 二维码识别器</h1>
                <button class="qr-close" id="qrscanner-close">✕</button>
           </div>
            <div class="qr-body">
                <div id="qrscanner-list</div>
                <div id="qrscanner-empty" class="qr-empty">
                    <div class="qr-empty-icon">🔎</div>
                    <div class="qr-empty-title">暂无识别结果</div>
                    <div class="qr-empty-desc">页面中可能不包含二维码，或二维码太小无法识别</div>
               </div>
           </div>
            <button id="qrscanner-clear-all" class="clear-all-btn" style="display:none;">🗑️ 清除所有结果</button>
        `;
        document.body.appendChild(panel);

        document.getElementById('qrscanner-close').onclick = () => panel.classList.remove('open');

        const clearBtn = document.getElementById('qrscanner-clear-all');
        clearBtn.onclick = () => {
            results = [];
            try { GM_setValue('qrResults', JSON.stringify([])); } catch (e) {}
            renderResults();
        };

        const toggle = document.createElement('button');
        toggle.id = 'qrscanner-toggle';
        toggle.title = '打开二维码识别器';
        document.body.appendChild(toggle);

        toggle.onclick = () => {
            if (panel.classList.contains('open')) {
                panel.classList.remove('open');
            } else {
                if (!results.length) {
                    showToast('正在扫描页面二维码...', 'loading', 2000, [], '扫描中');
                    scanPage().then(items => {
                        if (items.length) sendResults(items);
                    });
                }
                panel.classList.add('open');
            }
        };
    }

    /* ==================== 初始化 ==================== */
    function init() {
        buildUI();
        initContextMenu();

        // 延迟首次扫描
        setTimeout(() => {
            scanPage().then(items => {
                if (items.length) sendResults(items);
            });
        }, 1200);

        // 监听 DOM 变化
        const observer = new MutationObserver(() => {
            clearTimeout(scanTimer);
            scheduleScan();
        });
        observer.observe(document.body || document.documentElement, {
            childList: true, subtree: true, attributes: true,
            attributeFilter: ['src', 'style']
        });

        // 油猴菜单命令
        if (typeof GM_registerMenuCommand === 'function') {
            GM_registerMenuCommand('🔄 重新扫描当前页', async () => {
                results = [];
                try { GM_setValue('qrResults', JSON.stringify([])); } catch (e) {}
                showToast('正在重新扫描...', 'loading', 2000, [], '扫描中');
                const items = await scanPage();
                sendResults(items);
            });
        }

        // 加载缓存
        try {
            const cached = GM_getValue('qrResults');
            if (cached) {
                const arr = JSON.parse(cached);
                if (Array.isArray(arr)) {
                    results = arr;
                    renderResults();
                }
            }
        } catch (e) {}
    }

    init();
})();