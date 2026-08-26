// ==UserScript==
// @name         网页二维码识别器
// @name:zh-CN   网页二维码识别器
// @name:zh-TW   網頁 QR Code 識別器
// @namespace    http://tampermonkey.net/
// @version      1.4.0
// @description  自动扫描网页图片中的二维码，支持右键识别、本地上传识别、结果持久化与快速复制/打开。
// @author       HH2XX
// @match        *://*/*
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_getValue
// @homepage     https://github.com/HH2XX/qrcode-scanner
// @supportURL   https://github.com/HH2XX/qrcode-scanner/issues
// @run-at       document-end
// @require      https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js
// ==/UserScript==

(function() {
    'use strict';

    const STORAGE_KEY = 'qrResults';
    const PANEL_ID = 'qrscanner-panel';
    const TOGGLE_ID = 'qrscanner-toggle';
    const MENU_ID = 'qrscanner-context-menu';
    const TOAST_HOST_ID = 'qrscanner-toast-host';
    const FILE_INPUT_ID = 'qrscanner-file-input';
    const scannedSources = new Set();
    const locatedImages = new Map();

    let results = loadResults();
    let scanTimer = null;
    let currentContextImage = null;
    let toastSeed = 0;

    const ui = {
        panel: null,
        list: null,
        empty: null,
        toggle: null,
        status: null,
        uploadInput: null,
        dropzone: null,
        menu: null,
        toastHost: null
    };

    GM_addStyle(`
        :root {
            --qr-bg: linear-gradient(180deg, #eef4f1 0%, #f7f7f2 100%);
            --qr-panel: rgba(252, 253, 251, 0.96);
            --qr-card: rgba(255, 255, 255, 0.9);
            --qr-border: rgba(15, 23, 42, 0.08);
            --qr-shadow: 0 24px 80px rgba(15, 23, 42, 0.16);
            --qr-text: #172033;
            --qr-muted: #667085;
            --qr-accent: #0f766e;
            --qr-accent-2: #f59e0b;
            --qr-accent-soft: rgba(15, 118, 110, 0.12);
            --qr-danger: #c2410c;
            --qr-danger-soft: rgba(194, 65, 12, 0.12);
        }

        #${PANEL_ID} {
            position: fixed;
            top: 0;
            right: 0;
            width: min(420px, 100vw);
            height: 100vh;
            z-index: 2147483645;
            transform: translateX(100%);
            transition: transform 0.28s ease;
            background: var(--qr-panel);
            backdrop-filter: blur(16px) saturate(150%);
            box-shadow: var(--qr-shadow);
            border-left: 1px solid var(--qr-border);
            display: flex;
            flex-direction: column;
            color: var(--qr-text);
            font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
        }

        #${PANEL_ID}.open {
            transform: translateX(0);
        }

        .qrscanner-header {
            padding: 20px 18px 14px;
            background:
                radial-gradient(circle at top right, rgba(245, 158, 11, 0.2), transparent 36%),
                linear-gradient(135deg, #12372f 0%, #1e5a4f 54%, #0f766e 100%);
            color: #f8fafc;
        }

        .qrscanner-header-top {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 12px;
        }

        .qrscanner-title {
            margin: 0;
            font-size: 20px;
            font-weight: 700;
            letter-spacing: 0.02em;
        }

        .qrscanner-subtitle {
            margin-top: 6px;
            font-size: 12px;
            line-height: 1.5;
            color: rgba(248, 250, 252, 0.82);
        }

        .qrscanner-close {
            border: 0;
            width: 34px;
            height: 34px;
            border-radius: 12px;
            cursor: pointer;
            font-size: 18px;
            color: #f8fafc;
            background: rgba(255, 255, 255, 0.14);
            transition: transform 0.18s ease, background 0.18s ease;
        }

        .qrscanner-close:hover {
            transform: translateY(-1px);
            background: rgba(255, 255, 255, 0.22);
        }

        .qrscanner-body {
            flex: 1;
            overflow-y: auto;
            padding: 14px;
            background: var(--qr-bg);
        }

        .qrscanner-body::-webkit-scrollbar {
            width: 8px;
        }

        .qrscanner-body::-webkit-scrollbar-thumb {
            background: rgba(15, 118, 110, 0.26);
            border-radius: 999px;
        }

        .qrscanner-status {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px;
            margin-bottom: 12px;
        }

        .qrscanner-stat {
            padding: 12px 14px;
            border-radius: 16px;
            background: var(--qr-card);
            border: 1px solid var(--qr-border);
            box-shadow: 0 6px 20px rgba(15, 23, 42, 0.04);
        }

        .qrscanner-stat-label {
            font-size: 11px;
            color: var(--qr-muted);
            text-transform: uppercase;
            letter-spacing: 0.08em;
        }

        .qrscanner-stat-value {
            margin-top: 6px;
            font-size: 22px;
            font-weight: 700;
            color: var(--qr-text);
        }

        .qrscanner-toolbar {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 10px;
            margin-bottom: 12px;
        }

        .qrscanner-btn {
            border: 0;
            border-radius: 14px;
            padding: 11px 12px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 600;
            transition: transform 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
            font-family: inherit;
        }

        .qrscanner-btn:hover {
            transform: translateY(-1px);
        }

        .qrscanner-btn-primary {
            color: #f8fafc;
            background: linear-gradient(135deg, #0f766e 0%, #14532d 100%);
            box-shadow: 0 10px 24px rgba(15, 118, 110, 0.26);
        }

        .qrscanner-btn-secondary {
            color: var(--qr-text);
            background: rgba(255, 255, 255, 0.82);
            border: 1px solid var(--qr-border);
        }

        .qrscanner-btn-danger {
            color: var(--qr-danger);
            background: rgba(255, 247, 237, 0.92);
            border: 1px solid rgba(194, 65, 12, 0.16);
        }

        .qrscanner-dropzone {
            position: relative;
            margin-bottom: 14px;
            padding: 18px 16px;
            border-radius: 18px;
            border: 1.5px dashed rgba(15, 118, 110, 0.28);
            background:
                radial-gradient(circle at top right, rgba(245, 158, 11, 0.12), transparent 34%),
                linear-gradient(180deg, rgba(255, 255, 255, 0.94) 0%, rgba(242, 250, 248, 0.98) 100%);
            color: var(--qr-text);
            text-align: center;
            transition: border-color 0.18s ease, transform 0.18s ease, box-shadow 0.18s ease;
        }

        .qrscanner-dropzone.dragover {
            transform: translateY(-1px);
            border-color: var(--qr-accent);
            box-shadow: 0 12px 24px rgba(15, 118, 110, 0.14);
        }

        .qrscanner-dropzone-title {
            font-size: 15px;
            font-weight: 700;
        }

        .qrscanner-dropzone-desc {
            margin-top: 6px;
            font-size: 12px;
            line-height: 1.6;
            color: var(--qr-muted);
        }

        .qrscanner-hint {
            margin-bottom: 12px;
            padding: 10px 12px;
            border-radius: 14px;
            font-size: 12px;
            line-height: 1.6;
            background: rgba(15, 118, 110, 0.08);
            color: #0f4f4a;
            border: 1px solid rgba(15, 118, 110, 0.12);
        }

        .qrscanner-empty {
            padding: 48px 18px;
            border-radius: 22px;
            text-align: center;
            background: rgba(255, 255, 255, 0.78);
            border: 1px solid var(--qr-border);
            color: var(--qr-muted);
        }

        .qrscanner-empty-icon {
            font-size: 42px;
            line-height: 1;
        }

        .qrscanner-empty-title {
            margin-top: 12px;
            font-size: 15px;
            font-weight: 700;
            color: var(--qr-text);
        }

        .qrscanner-empty-desc {
            margin-top: 8px;
            font-size: 12px;
            line-height: 1.6;
        }

        .qrscanner-list {
            display: grid;
            gap: 12px;
        }

        .qrscanner-item {
            padding: 14px;
            border-radius: 18px;
            background: rgba(255, 255, 255, 0.9);
            border: 1px solid var(--qr-border);
            box-shadow: 0 10px 24px rgba(15, 23, 42, 0.05);
        }

        .qrscanner-item-top {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            margin-bottom: 10px;
        }

        .qrscanner-badges {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
        }

        .qrscanner-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 4px 9px;
            border-radius: 999px;
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.02em;
        }

        .qrscanner-badge-url {
            color: #115e59;
            background: rgba(20, 184, 166, 0.14);
        }

        .qrscanner-badge-text {
            color: #92400e;
            background: rgba(245, 158, 11, 0.16);
        }

        .qrscanner-badge-origin {
            color: #475467;
            background: rgba(148, 163, 184, 0.15);
        }

        .qrscanner-time {
            flex-shrink: 0;
            font-size: 11px;
            color: var(--qr-muted);
        }

        .qrscanner-data {
            padding: 12px;
            border-radius: 14px;
            background: rgba(243, 247, 245, 0.94);
            border: 1px solid rgba(15, 118, 110, 0.1);
            font-size: 12px;
            line-height: 1.6;
            color: var(--qr-text);
            word-break: break-all;
            white-space: pre-wrap;
        }

        .qrscanner-source {
            margin-top: 8px;
            font-size: 11px;
            color: var(--qr-muted);
            word-break: break-all;
        }

        .qrscanner-actions {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-top: 12px;
        }

        .qrscanner-action {
            border: 0;
            border-radius: 12px;
            padding: 8px 12px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 600;
            font-family: inherit;
            transition: transform 0.16s ease, background 0.16s ease;
        }

        .qrscanner-action:hover {
            transform: translateY(-1px);
        }

        .qrscanner-action-main {
            background: rgba(15, 118, 110, 0.12);
            color: #0f4f4a;
        }

        .qrscanner-action-soft {
            background: rgba(148, 163, 184, 0.14);
            color: #334155;
        }

        .qrscanner-action-danger {
            background: rgba(194, 65, 12, 0.12);
            color: var(--qr-danger);
        }

        #${TOGGLE_ID} {
            position: fixed;
            right: 22px;
            bottom: 22px;
            z-index: 2147483644;
            width: 62px;
            height: 62px;
            border: 0;
            border-radius: 22px;
            cursor: pointer;
            color: #f8fafc;
            font-size: 24px;
            background:
                radial-gradient(circle at top right, rgba(245, 158, 11, 0.5), transparent 34%),
                linear-gradient(135deg, #0f766e 0%, #14532d 100%);
            box-shadow: 0 18px 40px rgba(15, 118, 110, 0.32);
            transition: transform 0.22s ease, box-shadow 0.22s ease;
        }

        #${TOGGLE_ID}:hover {
            transform: translateY(-2px) rotate(-4deg);
            box-shadow: 0 20px 44px rgba(15, 118, 110, 0.38);
        }

        .qrscanner-toggle-badge {
            position: absolute;
            top: -6px;
            right: -4px;
            min-width: 22px;
            height: 22px;
            padding: 0 6px;
            border-radius: 999px;
            background: #f97316;
            color: #fff7ed;
            font-size: 11px;
            font-weight: 700;
            display: flex;
            align-items: center;
            justify-content: center;
            border: 2px solid rgba(255, 255, 255, 0.85);
        }

        #${MENU_ID} {
            position: fixed;
            z-index: 2147483647;
            min-width: 188px;
            padding: 6px;
            border-radius: 16px;
            display: none;
            background: rgba(255, 255, 255, 0.98);
            border: 1px solid var(--qr-border);
            box-shadow: 0 20px 48px rgba(15, 23, 42, 0.18);
            backdrop-filter: blur(14px);
        }

        .qrscanner-menu-item {
            display: block;
            width: 100%;
            border: 0;
            background: transparent;
            text-align: left;
            padding: 10px 12px;
            border-radius: 12px;
            cursor: pointer;
            font-size: 13px;
            color: var(--qr-text);
            font-family: inherit;
        }

        .qrscanner-menu-item:hover {
            background: rgba(15, 118, 110, 0.1);
        }

        #${TOAST_HOST_ID} {
            position: fixed;
            top: 18px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 2147483647;
            display: grid;
            gap: 10px;
            width: min(520px, calc(100vw - 24px));
        }

        .qrscanner-toast {
            padding: 14px 16px;
            border-radius: 18px;
            border: 1px solid var(--qr-border);
            background: rgba(255, 255, 255, 0.97);
            box-shadow: 0 16px 34px rgba(15, 23, 42, 0.14);
            color: var(--qr-text);
        }

        .qrscanner-toast-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
        }

        .qrscanner-toast-title {
            font-size: 14px;
            font-weight: 700;
        }

        .qrscanner-toast-close {
            border: 0;
            background: transparent;
            cursor: pointer;
            font-size: 16px;
            color: var(--qr-muted);
        }

        .qrscanner-toast-message {
            margin-top: 6px;
            font-size: 12px;
            line-height: 1.6;
            color: #344054;
            word-break: break-all;
        }

        .qrscanner-toast-actions {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-top: 10px;
        }

        .qrscanner-toast.loading {
            border-color: rgba(15, 118, 110, 0.18);
        }

        .qrscanner-toast.success {
            border-color: rgba(20, 184, 166, 0.24);
        }

        .qrscanner-toast.error {
            border-color: rgba(194, 65, 12, 0.2);
        }

        .qrscanner-highlight {
            outline: 3px solid rgba(245, 158, 11, 0.95) !important;
            outline-offset: 4px !important;
            box-shadow: 0 0 0 8px rgba(245, 158, 11, 0.2), 0 0 24px rgba(15, 118, 110, 0.26) !important;
            transition: box-shadow 0.18s ease;
        }

        @media (max-width: 560px) {
            #${PANEL_ID} {
                width: 100vw;
            }

            .qrscanner-toolbar {
                grid-template-columns: 1fr;
            }

            .qrscanner-status {
                grid-template-columns: 1fr 1fr;
            }
        }
    `);

    function loadResults() {
        try {
            const raw = GM_getValue(STORAGE_KEY, '[]');
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
        } catch (error) {
            return [];
        }
    }

    function saveResults() {
        try {
            GM_setValue(STORAGE_KEY, JSON.stringify(results));
        } catch (error) {}
    }

    function makeHash(input) {
        let hash = 0;
        const text = String(input || '');
        for (let i = 0; i < text.length; i += 1) {
            hash = ((hash << 5) - hash) + text.charCodeAt(i);
            hash |= 0;
        }
        return `qr_${Math.abs(hash)}`;
    }

    function isUrl(text) {
        return /^https?:\/\//i.test(String(text || '').trim());
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = String(text ?? '');
        return div.innerHTML;
    }

    function shortText(text, max = 140) {
        const value = String(text || '');
        return value.length <= max ? value : `${value.slice(0, max)}...`;
    }

    async function copyText(text) {
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(text);
            } else {
                const textarea = document.createElement('textarea');
                textarea.value = text;
                textarea.style.position = 'fixed';
                textarea.style.opacity = '0';
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                textarea.remove();
            }
            return true;
        } catch (error) {
            return false;
        }
    }

    function ensureToastHost() {
        if (ui.toastHost) {
            return ui.toastHost;
        }
        const host = document.createElement('div');
        host.id = TOAST_HOST_ID;
        document.body.appendChild(host);
        ui.toastHost = host;
        return host;
    }

    function showToast(options) {
        const {
            type = 'info',
            title = '提示',
            message = '',
            actions = [],
            duration = 2200
        } = options || {};

        const host = ensureToastHost();
        const toast = document.createElement('div');
        const toastId = `qrscanner-toast-${++toastSeed}`;
        toast.className = `qrscanner-toast ${type}`;
        toast.dataset.toastId = toastId;

        toast.innerHTML = `
            <div class="qrscanner-toast-head">
                <div class="qrscanner-toast-title">${escapeHtml(title)}</div>
                <button class="qrscanner-toast-close" type="button" data-close="${toastId}">×</button>
            </div>
            <div class="qrscanner-toast-message">${escapeHtml(message)}</div>
            <div class="qrscanner-toast-actions"></div>
        `;

        const actionsWrap = toast.querySelector('.qrscanner-toast-actions');
        actions.forEach((action) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = action.className || 'qrscanner-action qrscanner-action-main';
            button.textContent = action.text;
            button.addEventListener('click', () => {
                try {
                    action.onClick && action.onClick();
                } finally {
                    if (action.closeOnClick !== false) {
                        toast.remove();
                    }
                }
            });
            actionsWrap.appendChild(button);
        });

        if (!actions.length) {
            actionsWrap.remove();
        }

        toast.querySelector('[data-close]').addEventListener('click', () => {
            toast.remove();
        });

        host.appendChild(toast);
        if (duration > 0) {
            window.setTimeout(() => toast.remove(), duration);
        }
        return toast;
    }

    function normalizeResult(item) {
        const data = String(item.data || '').trim();
        const source = String(item.source || '').trim();
        const origin = item.origin || 'page';
        return {
            id: item.id || makeHash(`${origin}|${source}|${data}`),
            data,
            source,
            origin,
            kind: item.kind || (isUrl(data) ? 'url' : 'text'),
            time: item.time || new Date().toLocaleTimeString(),
            createdAt: Number(item.createdAt) || Date.now(),
            pageUrl: item.pageUrl || location.href
        };
    }

    function upsertResults(items) {
        const normalized = (items || [])
            .map(normalizeResult)
            .filter((item) => item.data);

        if (!normalized.length) {
            return;
        }

        const existing = new Map(results.map((item) => [`${item.origin}|${item.source}|${item.data}`, item]));
        normalized.forEach((item) => {
            existing.set(`${item.origin}|${item.source}|${item.data}`, item);
        });

        results = Array.from(existing.values())
            .sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
        saveResults();
        renderResults();
    }

    function removeResult(id) {
        results = results.filter((item) => item.id !== id);
        saveResults();
        renderResults();
    }

    function clearResults() {
        results = [];
        saveResults();
        renderResults();
    }

    function updateStatus() {
        if (!ui.status || !ui.toggle) {
            return;
        }
        const pageCount = results.filter((item) => item.pageUrl === location.href).length;
        ui.status.innerHTML = `
            <div class="qrscanner-stat">
                <div class="qrscanner-stat-label">当前页结果</div>
                <div class="qrscanner-stat-value">${pageCount}</div>
            </div>
            <div class="qrscanner-stat">
                <div class="qrscanner-stat-label">总结果数</div>
                <div class="qrscanner-stat-value">${results.length}</div>
            </div>
        `;

        const badge = ui.toggle.querySelector('.qrscanner-toggle-badge');
        badge.textContent = String(Math.min(results.length, 99));
        badge.style.display = results.length ? 'flex' : 'none';
    }

    function renderResults() {
        if (!ui.list || !ui.empty) {
            return;
        }

        updateStatus();
        if (!results.length) {
            ui.empty.style.display = 'block';
            ui.list.innerHTML = '';
            return;
        }

        ui.empty.style.display = 'none';
        ui.list.innerHTML = results.map((item) => {
            const openButton = item.kind === 'url'
                ? `<button class="qrscanner-action qrscanner-action-main" data-action="open" data-id="${item.id}">打开链接</button>`
                : '';

            const locateButton = item.origin === 'page' || item.origin === 'context'
                ? `<button class="qrscanner-action qrscanner-action-soft" data-action="locate" data-id="${item.id}">定位图片</button>`
                : '';

            const sourceLabelMap = {
                page: '页面扫描',
                context: '右键识别',
                upload: '本地上传'
            };

            return `
                <div class="qrscanner-item" data-result-id="${item.id}">
                    <div class="qrscanner-item-top">
                        <div class="qrscanner-badges">
                            <span class="qrscanner-badge ${item.kind === 'url' ? 'qrscanner-badge-url' : 'qrscanner-badge-text'}">
                                ${item.kind === 'url' ? '链接' : '文本'}
                            </span>
                            <span class="qrscanner-badge qrscanner-badge-origin">
                                ${sourceLabelMap[item.origin] || '来源未知'}
                            </span>
                        </div>
                        <div class="qrscanner-time">${escapeHtml(item.time)}</div>
                    </div>
                    <div class="qrscanner-data" title="${escapeHtml(item.data)}">${escapeHtml(item.data)}</div>
                    <div class="qrscanner-source">${escapeHtml(shortText(item.source || item.pageUrl || '无来源信息', 120))}</div>
                    <div class="qrscanner-actions">
                        ${openButton}
                        <button class="qrscanner-action qrscanner-action-soft" data-action="copy" data-id="${item.id}">复制内容</button>
                        ${locateButton}
                        <button class="qrscanner-action qrscanner-action-danger" data-action="remove" data-id="${item.id}">删除</button>
                    </div>
                </div>
            `;
        }).join('');
    }

    function openPanel() {
        ui.panel.classList.add('open');
    }

    function closePanel() {
        ui.panel.classList.remove('open');
    }

    function togglePanel() {
        ui.panel.classList.toggle('open');
    }

    function markImageForResult(resultId, image) {
        if (!image || !resultId) {
            return;
        }
        image.dataset.qrscannerResultId = resultId;
        locatedImages.set(resultId, image);
    }

    function highlightImage(resultId) {
        const image = locatedImages.get(resultId) || document.querySelector(`img[data-qrscanner-result-id="${resultId}"]`);
        if (!image) {
            showToast({
                type: 'error',
                title: '定位失败',
                message: '当前页面找不到对应图片，可能是结果来自旧页面或本地上传。'
            });
            return;
        }

        document.querySelectorAll('.qrscanner-highlight').forEach((node) => {
            node.classList.remove('qrscanner-highlight');
        });

        image.classList.add('qrscanner-highlight');
        image.scrollIntoView({ behavior: 'smooth', block: 'center' });
        window.setTimeout(() => image.classList.remove('qrscanner-highlight'), 2600);
    }

    function tryDecodeImageData(imageData, width, height) {
        const modes = [
            { inversionAttempts: 'attemptBoth' },
            { inversionAttempts: 'dontInvert' },
            { inversionAttempts: 'onlyInvert' }
        ];

        for (const mode of modes) {
            try {
                const code = jsQR(imageData.data, width, height, mode);
                if (code && code.data && code.data.trim()) {
                    return code.data.trim();
                }
            } catch (error) {}
        }
        return null;
    }

    function createBinaryImageData(imageData) {
        const cloned = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
        const data = cloned.data;
        for (let i = 0; i < data.length; i += 4) {
            const gray = (0.299 * data[i]) + (0.587 * data[i + 1]) + (0.114 * data[i + 2]);
            const value = gray > 140 ? 255 : 0;
            data[i] = value;
            data[i + 1] = value;
            data[i + 2] = value;
        }
        return cloned;
    }

    function decodeCanvas(canvas) {
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) {
            return null;
        }

        const original = context.getImageData(0, 0, canvas.width, canvas.height);
        return tryDecodeImageData(original, canvas.width, canvas.height)
            || tryDecodeImageData(createBinaryImageData(original), canvas.width, canvas.height);
    }

    function buildTargetSides(width, height) {
        const maxSide = Math.max(width, height);
        const candidates = [
            Math.min(1440, Math.max(maxSide, 360)),
            Math.min(1080, Math.max(maxSide, 280)),
            Math.min(800, Math.max(maxSide, 220))
        ];

        return Array.from(new Set(candidates.map((value) => Math.round(value))))
            .filter((value) => value >= 128)
            .sort((a, b) => b - a);
    }

    function decodeDrawable(drawable, width, height) {
        if (!width || !height || width < 20 || height < 20) {
            return null;
        }

        const maxSide = Math.max(width, height);
        const targetSides = buildTargetSides(width, height);

        for (const targetSide of targetSides) {
            const scale = targetSide / maxSide;
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(width * scale));
            canvas.height = Math.max(1, Math.round(height * scale));

            try {
                const context = canvas.getContext('2d', { willReadFrequently: true });
                if (!context) {
                    continue;
                }
                context.drawImage(drawable, 0, 0, canvas.width, canvas.height);
                const decoded = decodeCanvas(canvas);
                if (decoded) {
                    return decoded;
                }
            } catch (error) {}
        }

        return null;
    }

    async function decodeImageElement(image) {
        if (!image || !image.complete) {
            return null;
        }

        const width = image.naturalWidth || image.width;
        const height = image.naturalHeight || image.height;
        return decodeDrawable(image, width, height);
    }

    async function loadImageFromUrl(url) {
        const image = new Image();
        image.decoding = 'async';
        image.referrerPolicy = 'no-referrer';
        const promise = new Promise((resolve, reject) => {
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error('图片加载失败'));
        });
        image.src = url;
        return promise;
    }

    async function decodeFile(file) {
        const objectUrl = URL.createObjectURL(file);
        try {
            const image = await loadImageFromUrl(objectUrl);
            return decodeDrawable(image, image.naturalWidth, image.naturalHeight);
        } finally {
            URL.revokeObjectURL(objectUrl);
        }
    }

    function createResultFromDecoded(decoded, meta) {
        if (!decoded) {
            return null;
        }

        return normalizeResult({
            id: makeHash(`${meta.origin}|${meta.source}|${decoded}`),
            data: decoded,
            source: meta.source,
            origin: meta.origin,
            kind: isUrl(decoded) ? 'url' : 'text',
            time: new Date().toLocaleTimeString(),
            createdAt: Date.now(),
            pageUrl: location.href
        });
    }

    async function scanImageElement(image) {
        if (!image || !image.complete) {
            return null;
        }

        const source = image.currentSrc || image.src || image.getAttribute('src') || '';
        if (!source || scannedSources.has(source)) {
            return null;
        }

        const width = image.naturalWidth || image.width || 0;
        const height = image.naturalHeight || image.height || 0;
        if (width < 24 || height < 24 || (width * height) < 900) {
            scannedSources.add(source);
            return null;
        }

        let decoded = null;
        try {
            decoded = await decodeImageElement(image);
        } catch (error) {}

        scannedSources.add(source);
        if (!decoded) {
            return null;
        }

        const result = createResultFromDecoded(decoded, {
            origin: 'page',
            source
        });

        if (result) {
            markImageForResult(result.id, image);
        }
        return result;
    }

    async function scanPage() {
        const images = Array.from(document.images)
            .filter((image) => image.complete)
            .slice(0, 120);

        const found = [];
        for (let i = 0; i < images.length; i += 4) {
            const batch = images.slice(i, i + 4);
            const batchResults = await Promise.all(batch.map((image) => scanImageElement(image)));
            batchResults.forEach((item) => {
                if (item) {
                    found.push(item);
                }
            });
        }
        return found;
    }

    async function runPageScan(options = {}) {
        const { notify = false } = options;
        let loadingToast = null;

        if (notify) {
            loadingToast = showToast({
                type: 'loading',
                title: '正在扫描',
                message: '正在识别当前页面里的二维码图片... ',
                duration: 0
            });
        }

        try {
            const found = await scanPage();
            if (found.length) {
                upsertResults(found);
                if (notify) {
                    showToast({
                        type: 'success',
                        title: '扫描完成',
                        message: `本次共识别到 ${found.length} 条结果。`
                    });
                }
            } else if (notify) {
                showToast({
                    type: 'error',
                    title: '没有识别到二维码',
                    message: '可以试试右键单张图片识别，或者直接上传本地图片。'
                });
            }
            return found;
        } finally {
            if (loadingToast) {
                loadingToast.remove();
            }
        }
    }

    function scheduleScan() {
        window.clearTimeout(scanTimer);
        scanTimer = window.setTimeout(() => {
            runPageScan();
        }, 800);
    }

    async function handleUpload(files) {
        const imageFiles = Array.from(files || []).filter((file) => /^image\//i.test(file.type));
        if (!imageFiles.length) {
            showToast({
                type: 'error',
                title: '上传失败',
                message: '请选择图片文件后再试。'
            });
            return;
        }

        openPanel();
        const loadingToast = showToast({
            type: 'loading',
            title: '正在识别',
            message: `正在处理 ${imageFiles.length} 张上传图片...`,
            duration: 0
        });

        const found = [];
        for (const file of imageFiles) {
            try {
                const decoded = await decodeFile(file);
                const result = createResultFromDecoded(decoded, {
                    origin: 'upload',
                    source: `本地文件: ${file.name}`
                });
                if (result) {
                    found.push(result);
                }
            } catch (error) {}
        }

        loadingToast.remove();
        if (found.length) {
            upsertResults(found);
            showToast({
                type: 'success',
                title: '上传识别成功',
                message: `成功识别 ${found.length} 张图片中的二维码。`
            });
        } else {
            showToast({
                type: 'error',
                title: '上传后未识别到内容',
                message: '如果图片很模糊、二维码太小，建议换原图或更高清截图再试。'
            });
        }
    }

    async function handleContextScan(image) {
        if (!image) {
            return;
        }

        const source = image.currentSrc || image.src || '';
        if (!source) {
            return;
        }

        openPanel();
        const loadingToast = showToast({
            type: 'loading',
            title: '正在识别这张图片',
            message: '正在尝试直接从当前页面图片中读取二维码...',
            duration: 0
        });

        try {
            let decoded = await decodeImageElement(image);
            if (!decoded) {
                const fallbackImage = await loadImageFromUrl(source);
                decoded = decodeDrawable(fallbackImage, fallbackImage.naturalWidth, fallbackImage.naturalHeight);
            }

            loadingToast.remove();
            if (!decoded) {
                showToast({
                    type: 'error',
                    title: '识别失败',
                    message: '这张图里没有识别到二维码，建议打开原图或上传本地原图再试。',
                    actions: [
                        {
                            text: '打开原图',
                            className: 'qrscanner-action qrscanner-action-main',
                            onClick: () => window.open(source, '_blank')
                        }
                    ]
                });
                return;
            }

            const result = createResultFromDecoded(decoded, {
                origin: 'context',
                source
            });

            if (result) {
                markImageForResult(result.id, image);
                upsertResults([result]);
            }

            const actions = [
                {
                    text: '复制内容',
                    className: 'qrscanner-action qrscanner-action-soft',
                    onClick: async () => {
                        const ok = await copyText(decoded);
                        showToast({
                            type: ok ? 'success' : 'error',
                            title: ok ? '复制成功' : '复制失败',
                            message: ok ? '二维码内容已复制到剪贴板。' : '浏览器拒绝了剪贴板访问。'
                        });
                    }
                }
            ];

            if (isUrl(decoded)) {
                actions.unshift({
                    text: '打开链接',
                    className: 'qrscanner-action qrscanner-action-main',
                    onClick: () => window.open(decoded, '_blank')
                });
            }

            showToast({
                type: 'success',
                title: '识别成功',
                message: decoded,
                actions,
                duration: 0
            });
        } catch (error) {
            loadingToast.remove();
            showToast({
                type: 'error',
                title: '识别失败',
                message: '读取图片时发生异常，可能是图片未加载完成或已被站点限制。'
            });
        }
    }

    function buildUI() {
        const panel = document.createElement('aside');
        panel.id = PANEL_ID;
        panel.innerHTML = `
            <div class="qrscanner-header">
                <div class="qrscanner-header-top">
                    <div>
                        <h1 class="qrscanner-title">二维码识别器</h1>
                        <div class="qrscanner-subtitle">自动扫描网页图片，也支持本地上传。按住 Shift 再右键可以继续使用网页原生菜单。</div>
                    </div>
                    <button class="qrscanner-close" type="button" id="qrscanner-close-btn">×</button>
                </div>
            </div>
            <div class="qrscanner-body">
                <div class="qrscanner-status" id="qrscanner-status"></div>
                <div class="qrscanner-toolbar">
                    <button type="button" class="qrscanner-btn qrscanner-btn-primary" id="qrscanner-upload-btn">上传识别</button>
                    <button type="button" class="qrscanner-btn qrscanner-btn-secondary" id="qrscanner-rescan-btn">重新扫描</button>
                    <button type="button" class="qrscanner-btn qrscanner-btn-danger" id="qrscanner-clear-btn">清空结果</button>
                </div>
                <div class="qrscanner-dropzone" id="qrscanner-dropzone">
                    <div class="qrscanner-dropzone-title">拖图片到这里，或点击“上传识别”</div>
                    <div class="qrscanner-dropzone-desc">适合直接识别聊天截图、二维码海报、下载后的原图。</div>
                </div>
                <div class="qrscanner-hint">
                    上传识别是本次补上的稳定入口，不依赖网页图片加载状态；如果你之前是“上传后没效果”，这里会比原来的流程可靠很多。
                </div>
                <div class="qrscanner-empty" id="qrscanner-empty">
                    <div class="qrscanner-empty-icon">⌁</div>
                    <div class="qrscanner-empty-title">还没有识别结果</div>
                    <div class="qrscanner-empty-desc">可以先点“重新扫描”，也可以直接上传本地二维码图片。</div>
                </div>
                <div class="qrscanner-list" id="qrscanner-list"></div>
            </div>
        `;
        document.body.appendChild(panel);

        const toggle = document.createElement('button');
        toggle.id = TOGGLE_ID;
        toggle.type = 'button';
        toggle.title = '打开二维码识别器';
        toggle.innerHTML = `⌗<span class="qrscanner-toggle-badge" style="display:none;">0</span>`;
        document.body.appendChild(toggle);

        const input = document.createElement('input');
        input.id = FILE_INPUT_ID;
        input.type = 'file';
        input.accept = 'image/*';
        input.multiple = true;
        input.style.display = 'none';
        document.body.appendChild(input);

        const menu = document.createElement('div');
        menu.id = MENU_ID;
        menu.innerHTML = `
            <button type="button" class="qrscanner-menu-item" data-menu-action="scan">识别这张图片</button>
            <button type="button" class="qrscanner-menu-item" data-menu-action="open">在新标签打开原图</button>
        `;
        document.body.appendChild(menu);

        ui.panel = panel;
        ui.list = panel.querySelector('#qrscanner-list');
        ui.empty = panel.querySelector('#qrscanner-empty');
        ui.status = panel.querySelector('#qrscanner-status');
        ui.toggle = toggle;
        ui.uploadInput = input;
        ui.dropzone = panel.querySelector('#qrscanner-dropzone');
        ui.menu = menu;

        panel.querySelector('#qrscanner-close-btn').addEventListener('click', closePanel);
        toggle.addEventListener('click', togglePanel);
        panel.querySelector('#qrscanner-upload-btn').addEventListener('click', () => input.click());
        panel.querySelector('#qrscanner-rescan-btn').addEventListener('click', () => runPageScan({ notify: true }));
        panel.querySelector('#qrscanner-clear-btn').addEventListener('click', clearResults);
        input.addEventListener('change', (event) => {
            handleUpload(event.target.files);
            event.target.value = '';
        });

        ui.dropzone.addEventListener('dragover', (event) => {
            event.preventDefault();
            ui.dropzone.classList.add('dragover');
        });
        ui.dropzone.addEventListener('dragleave', () => {
            ui.dropzone.classList.remove('dragover');
        });
        ui.dropzone.addEventListener('drop', (event) => {
            event.preventDefault();
            ui.dropzone.classList.remove('dragover');
            handleUpload(event.dataTransfer.files);
        });

        ui.list.addEventListener('click', async (event) => {
            const button = event.target.closest('button[data-action]');
            if (!button) {
                return;
            }

            const { action, id } = button.dataset;
            const item = results.find((result) => result.id === id);
            if (!item) {
                return;
            }

            if (action === 'open' && item.kind === 'url') {
                window.open(item.data, '_blank');
                return;
            }

            if (action === 'copy') {
                const ok = await copyText(item.data);
                showToast({
                    type: ok ? 'success' : 'error',
                    title: ok ? '复制成功' : '复制失败',
                    message: ok ? '二维码内容已复制。' : '浏览器拒绝了剪贴板访问。'
                });
                return;
            }

            if (action === 'locate') {
                highlightImage(id);
                return;
            }

            if (action === 'remove') {
                removeResult(id);
            }
        });
    }

    function hideContextMenu() {
        if (ui.menu) {
            ui.menu.style.display = 'none';
        }
        currentContextImage = null;
    }

    function initContextMenu() {
        document.addEventListener('contextmenu', (event) => {
            const image = event.target.closest('img');
            if (!image || event.shiftKey) {
                hideContextMenu();
                return;
            }

            const source = image.currentSrc || image.src || image.getAttribute('src');
            if (!source) {
                hideContextMenu();
                return;
            }

            event.preventDefault();
            currentContextImage = image;
            ui.menu.style.display = 'block';
            ui.menu.style.left = `${Math.min(event.clientX, window.innerWidth - 204)}px`;
            ui.menu.style.top = `${Math.min(event.clientY, window.innerHeight - 110)}px`;
        });

        document.addEventListener('click', (event) => {
            if (ui.menu && !ui.menu.contains(event.target)) {
                hideContextMenu();
            }
        });

        ui.menu.addEventListener('click', (event) => {
            const button = event.target.closest('[data-menu-action]');
            if (!button || !currentContextImage) {
                return;
            }

            const image = currentContextImage;
            const source = image.currentSrc || image.src;
            const action = button.dataset.menuAction;
            hideContextMenu();

            if (action === 'scan') {
                handleContextScan(image);
            } else if (action === 'open' && source) {
                window.open(source, '_blank');
            }
        });
    }

    function initMenus() {
        if (typeof GM_registerMenuCommand !== 'function') {
            return;
        }

        GM_registerMenuCommand('打开二维码识别器', () => openPanel());
        GM_registerMenuCommand('上传本地二维码图片', () => ui.uploadInput.click());
        GM_registerMenuCommand('重新扫描当前页面', () => runPageScan({ notify: true }));
    }

    function initObserver() {
        const observer = new MutationObserver((mutations) => {
            const changed = mutations.some((mutation) => {
                if (mutation.type === 'childList') {
                    return mutation.addedNodes.length > 0;
                }
                if (mutation.type === 'attributes') {
                    return mutation.attributeName === 'src';
                }
                return false;
            });

            if (changed) {
                scheduleScan();
            }
        });

        observer.observe(document.body || document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['src']
        });
    }

    function restoreLocatedImages() {
        results.forEach((item) => {
            if ((item.origin === 'page' || item.origin === 'context') && item.source) {
                const image = Array.from(document.images).find((img) => {
                    const src = img.currentSrc || img.src || img.getAttribute('src') || '';
                    return src === item.source;
                });
                if (image) {
                    markImageForResult(item.id, image);
                }
            }
        });
    }

    async function init() {
        results = loadResults().map(normalizeResult);
        saveResults();
        buildUI();
        initContextMenu();
        initMenus();
        renderResults();
        restoreLocatedImages();

        window.setTimeout(() => {
            runPageScan();
        }, 1200);

        initObserver();
    }

    init();
})();
