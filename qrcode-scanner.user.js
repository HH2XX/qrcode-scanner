// ==UserScript==
// @name         网页二维码识别器
// @name:zh-CN   网页二维码识别器
// @name:zh-TW   網頁 QR Code 識別器
// @namespace    http://tampermonkey.net/
// @version      1.5.0
// @description  自动扫描网页图片中的二维码，支持右键识别、本地上传识别、结果持久化与快速复制/打开。
// @author       HH2XX
// @homepage     https://github.com/HH2XX/qrcode-scanner
// @supportURL   https://github.com/HH2XX/qrcode-scanner/issues
// @match        *://*/*
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      *
// @noframes
// @run-at       document-end
// @require      https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js
// ==/UserScript==

(function () {
    'use strict';

    const STORAGE_KEY = 'qrResults';
    const PANEL_ID = 'qrscanner-panel';
    const TOGGLE_ID = 'qrscanner-toggle';
    const MENU_ID = 'qrscanner-context-menu';
    const TOAST_HOST_ID = 'qrscanner-toast-host';
    const FILE_INPUT_ID = 'qrscanner-file-input';

    const ROOT_CLASS = 'qrscanner-root';
    const MAX_RESULTS = 300;           // 结果条数上限，避免 GM 存储无限膨胀
    const MAX_SCANNED_SOURCES = 4000;  // 已扫描地址集合上限
    const MAX_PAGES_IMAGES = 120;      // 单次扫描最多处理的图片数
    const SCAN_DEBOUNCE = 900;
    const MIN_IMAGE_SIDE = 24;

    // 与本目录下的「网页图片格式转换下载器」共用，避免两个脚本同时抢占右键。
    // 用 <html> 上的时间戳而不是 Event 属性：Tampermonkey 沙箱之间只有 DOM 一定共享。
    const MENU_CLAIM_ATTR = 'hh2xxMenuClaim';
    const MENU_CLAIM_WINDOW = 60;

    const QR_ICON =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<rect x="3" y="3" width="7" height="7" rx="1.6"/>' +
        '<rect x="14" y="3" width="7" height="7" rx="1.6"/>' +
        '<rect x="3" y="14" width="7" height="7" rx="1.6"/>' +
        '<path d="M14 14h3.2v3.2H14zM20.2 14H21M14 20.2h3.2M20.2 17.2V21"/></svg>';

    const scannedSources = new Set();
    const locatedImages = new Map();

    let results = [];
    let scanTimer = null;
    let currentContextImage = null;
    let toastSeed = 0;
    let filterText = '';
    let detectorPromise = null;
    let scanning = false;

    const ui = {
        panel: null,
        list: null,
        empty: null,
        toggle: null,
        status: null,
        uploadInput: null,
        dropzone: null,
        menu: null,
        toastHost: null,
        progress: null,
        filter: null
    };

    /* ---------------------------------------------------------------- 样式 */

    GM_addStyle(`
        .${ROOT_CLASS} {
            box-sizing: border-box;
            --qr-bg: #f5f7f5;
            --qr-panel-bg: #ffffff;
            --qr-card: #ffffff;
            --qr-card-soft: #f3f7f5;
            --qr-border: rgba(16, 40, 34, 0.10);
            --qr-border-strong: rgba(16, 40, 34, 0.18);
            --qr-text: #14211e;
            --qr-muted: #6c7d78;
            --qr-accent: #0d7a6b;
            --qr-accent-strong: #0a5b50;
            --qr-accent-soft: rgba(13, 122, 107, 0.10);
            --qr-amber: #d98324;
            --qr-danger: #b4341f;
            --qr-danger-soft: rgba(180, 52, 31, 0.09);
            --qr-shadow: 0 20px 60px rgba(10, 30, 25, 0.16);
            --qr-radius: 14px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
                "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
            font-size: 13px;
            line-height: 1.5;
            -webkit-font-smoothing: antialiased;
        }

        .${ROOT_CLASS} *,
        .${ROOT_CLASS} *::before,
        .${ROOT_CLASS} *::after {
            box-sizing: border-box;
        }

        /* 用 :where 降低重置规则的特异性，避免压掉各按钮自己的背景色 */
        .${ROOT_CLASS} :where(button) {
            font: inherit;
            color: inherit;
            border: 0;
            background: none;
            cursor: pointer;
        }

        @media (prefers-color-scheme: dark) {
            .${ROOT_CLASS} {
                --qr-bg: #111614;
                --qr-panel-bg: #171d1b;
                --qr-card: #1d2624;
                --qr-card-soft: #212b28;
                --qr-border: rgba(255, 255, 255, 0.08);
                --qr-border-strong: rgba(255, 255, 255, 0.16);
                --qr-text: #e8f0ed;
                --qr-muted: #93a49f;
                --qr-accent: #34b8a3;
                --qr-accent-strong: #2a9a88;
                --qr-accent-soft: rgba(52, 184, 163, 0.14);
                --qr-amber: #e6a55c;
                --qr-danger: #ff9c8a;
                --qr-danger-soft: rgba(255, 108, 88, 0.12);
                --qr-shadow: 0 24px 70px rgba(0, 0, 0, 0.55);
            }
        }

        /* ---------------------------------------------------------- 侧边面板 */

        #${PANEL_ID} {
            position: fixed;
            top: 0;
            right: 0;
            z-index: 2147483640;
            display: flex;
            flex-direction: column;
            width: min(392px, 100vw);
            height: 100vh;
            height: 100dvh;
            transform: translateX(102%);
            transition: transform 0.26s cubic-bezier(0.22, 0.61, 0.36, 1);
            background: var(--qr-panel-bg);
            border-left: 1px solid var(--qr-border);
            box-shadow: var(--qr-shadow);
            color: var(--qr-text);
            overflow: hidden;
        }

        #${PANEL_ID}.open {
            transform: translateX(0);
        }

        @media (prefers-reduced-motion: reduce) {
            #${PANEL_ID} {
                transition: none;
            }
        }

        .qrscanner-progress {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 2px;
            overflow: hidden;
            opacity: 0;
            transition: opacity 0.2s ease;
            background: transparent;
        }

        .qrscanner-progress.active {
            opacity: 1;
        }

        .qrscanner-progress::after {
            content: "";
            position: absolute;
            inset: 0;
            width: 40%;
            background: linear-gradient(90deg, transparent, var(--qr-amber), transparent);
            animation: qrscanner-sweep 1.1s ease-in-out infinite;
        }

        @keyframes qrscanner-sweep {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(350%); }
        }

        .qrscanner-header {
            position: relative;
            flex: 0 0 auto;
            padding: 15px 14px 13px;
            color: #f4fbf8;
            background:
                radial-gradient(120% 140% at 100% 0%, rgba(217, 131, 36, 0.34), transparent 52%),
                linear-gradient(135deg, #0b5b51 0%, #0d7a6b 58%, #0a4c43 100%);
        }

        .qrscanner-header-row {
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .qrscanner-logo {
            display: grid;
            place-items: center;
            flex: 0 0 32px;
            width: 32px;
            height: 32px;
            border-radius: 10px;
            background: rgba(255, 255, 255, 0.16);
            border: 1px solid rgba(255, 255, 255, 0.18);
        }

        .qrscanner-logo svg {
            width: 18px;
            height: 18px;
        }

        .qrscanner-heading {
            flex: 1;
            min-width: 0;
        }

        .qrscanner-title {
            margin: 0;
            font-size: 15px;
            font-weight: 650;
            letter-spacing: 0.01em;
        }

        .qrscanner-subtitle {
            margin-top: 1px;
            font-size: 11px;
            color: rgba(244, 251, 248, 0.76);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .qrscanner-close {
            flex: 0 0 auto;
            display: grid;
            place-items: center;
            width: 30px;
            height: 30px;
            border-radius: 9px;
            color: #f4fbf8;
            background: rgba(255, 255, 255, 0.12);
            transition: background 0.16s ease;
        }

        .qrscanner-close:hover {
            background: rgba(255, 255, 255, 0.24);
        }

        .qrscanner-close svg {
            width: 15px;
            height: 15px;
        }

        .qrscanner-body {
            flex: 1;
            min-height: 0;
            overflow-y: auto;
            overscroll-behavior: contain;
            padding: 12px 12px 18px;
            background: var(--qr-bg);
            scrollbar-width: thin;
        }

        .qrscanner-body::-webkit-scrollbar {
            width: 8px;
        }

        .qrscanner-body::-webkit-scrollbar-thumb {
            background: var(--qr-border-strong);
            border-radius: 99px;
        }

        /* ---------------------------------------------------------- 概览数据 */

        .qrscanner-stats {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
            margin-bottom: 10px;
        }

        .qrscanner-stat {
            padding: 9px 11px;
            border-radius: 12px;
            background: var(--qr-card);
            border: 1px solid var(--qr-border);
        }

        .qrscanner-stat-label {
            font-size: 10px;
            font-weight: 600;
            letter-spacing: 0.06em;
            color: var(--qr-muted);
        }

        .qrscanner-stat-value {
            margin-top: 3px;
            font-size: 19px;
            font-weight: 650;
            font-variant-numeric: tabular-nums;
            line-height: 1.1;
        }

        /* ------------------------------------------------------------ 工具栏 */

        .qrscanner-toolbar {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 7px;
            margin-bottom: 10px;
        }

        .qrscanner-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            min-height: 36px;
            padding: 7px 10px;
            border-radius: 10px;
            border: 1px solid transparent;
            font-size: 12px;
            font-weight: 600;
            transition: transform 0.14s ease, background 0.14s ease, border-color 0.14s ease;
        }

        .qrscanner-btn svg {
            width: 13px;
            height: 13px;
        }

        .qrscanner-btn:hover:not(:disabled) {
            transform: translateY(-1px);
        }

        .qrscanner-btn:active:not(:disabled) {
            transform: translateY(0);
        }

        .qrscanner-btn:disabled {
            opacity: 0.55;
            cursor: not-allowed;
        }

        .qrscanner-btn-primary {
            color: #f6fffc;
            background: linear-gradient(135deg, var(--qr-accent) 0%, var(--qr-accent-strong) 100%);
            box-shadow: 0 6px 16px var(--qr-accent-soft);
        }

        .qrscanner-btn-secondary {
            color: var(--qr-text);
            background: var(--qr-card);
            border-color: var(--qr-border-strong);
        }

        .qrscanner-btn-secondary:hover:not(:disabled) {
            background: var(--qr-card-soft);
        }

        .qrscanner-btn-quiet {
            color: var(--qr-muted);
            background: transparent;
            border-color: var(--qr-border);
        }

        .qrscanner-btn-quiet:hover:not(:disabled) {
            color: var(--qr-text);
            background: var(--qr-card);
        }

        .qrscanner-btn-danger {
            color: var(--qr-danger);
            background: var(--qr-danger-soft);
            border-color: transparent;
        }

        /* -------------------------------------------------------- 上传拖放区 */

        .qrscanner-dropzone {
            position: relative;
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 11px 12px;
            margin-bottom: 10px;
            border-radius: 12px;
            border: 1px dashed var(--qr-border-strong);
            background: var(--qr-card);
            cursor: pointer;
            transition: border-color 0.16s ease, background 0.16s ease, transform 0.16s ease;
        }

        .qrscanner-dropzone:hover {
            border-color: var(--qr-accent);
        }

        .qrscanner-dropzone.dragover {
            border-color: var(--qr-accent);
            border-style: solid;
            background: var(--qr-accent-soft);
            transform: translateY(-1px);
        }

        .qrscanner-dropzone-icon {
            display: grid;
            place-items: center;
            flex: 0 0 30px;
            width: 30px;
            height: 30px;
            border-radius: 9px;
            color: var(--qr-accent);
            background: var(--qr-accent-soft);
        }

        .qrscanner-dropzone-icon svg {
            width: 15px;
            height: 15px;
        }

        .qrscanner-dropzone-text {
            min-width: 0;
        }

        .qrscanner-dropzone-title {
            font-size: 12px;
            font-weight: 600;
        }

        .qrscanner-dropzone-desc {
            font-size: 10.5px;
            color: var(--qr-muted);
            line-height: 1.4;
        }

        /* ---------------------------------------------------------- 筛选框 */

        .qrscanner-filter-wrap {
            position: relative;
            margin-bottom: 10px;
        }

        .qrscanner-filter-wrap svg {
            position: absolute;
            left: 9px;
            top: 50%;
            width: 13px;
            height: 13px;
            transform: translateY(-50%);
            color: var(--qr-muted);
            pointer-events: none;
        }

        .qrscanner-filter {
            width: 100%;
            height: 32px;
            padding: 0 10px 0 28px;
            border-radius: 9px;
            border: 1px solid var(--qr-border);
            background: var(--qr-card);
            color: var(--qr-text);
            font: inherit;
            font-size: 12px;
            outline: none;
            transition: border-color 0.16s ease, box-shadow 0.16s ease;
        }

        .qrscanner-filter::placeholder {
            color: var(--qr-muted);
        }

        .qrscanner-filter:focus {
            border-color: var(--qr-accent);
            box-shadow: 0 0 0 3px var(--qr-accent-soft);
        }

        /* ---------------------------------------------------------- 空状态 */

        .qrscanner-empty {
            padding: 34px 20px;
            border-radius: var(--qr-radius);
            text-align: center;
            background: var(--qr-card);
            border: 1px solid var(--qr-border);
            color: var(--qr-muted);
        }

        .qrscanner-empty-icon {
            display: inline-grid;
            place-items: center;
            width: 46px;
            height: 46px;
            border-radius: 14px;
            color: var(--qr-muted);
            background: var(--qr-card-soft);
        }

        .qrscanner-empty-icon svg {
            width: 22px;
            height: 22px;
            opacity: 0.7;
        }

        .qrscanner-empty-title {
            margin-top: 12px;
            font-size: 13px;
            font-weight: 650;
            color: var(--qr-text);
        }

        .qrscanner-empty-desc {
            margin-top: 5px;
            font-size: 11px;
            line-height: 1.6;
        }

        /* ---------------------------------------------------------- 结果卡片 */

        .qrscanner-list {
            display: grid;
            gap: 9px;
        }

        .qrscanner-item {
            padding: 11px 12px;
            border-radius: var(--qr-radius);
            background: var(--qr-card);
            border: 1px solid var(--qr-border);
            transition: border-color 0.16s ease, box-shadow 0.16s ease;
        }

        .qrscanner-item:hover {
            border-color: var(--qr-border-strong);
            box-shadow: 0 6px 18px rgba(10, 30, 25, 0.06);
        }

        .qrscanner-item-top {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            margin-bottom: 8px;
        }

        .qrscanner-badges {
            display: flex;
            flex-wrap: wrap;
            gap: 5px;
            min-width: 0;
        }

        .qrscanner-badge {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 2px 7px;
            border-radius: 6px;
            font-size: 10px;
            font-weight: 650;
            letter-spacing: 0.02em;
            white-space: nowrap;
        }

        .qrscanner-badge-url {
            color: var(--qr-accent-strong);
            background: var(--qr-accent-soft);
        }

        .qrscanner-badge-text {
            color: var(--qr-amber);
            background: rgba(217, 131, 36, 0.12);
        }

        .qrscanner-badge-origin {
            color: var(--qr-muted);
            background: var(--qr-card-soft);
            border: 1px solid var(--qr-border);
        }

        .qrscanner-time {
            flex: 0 0 auto;
            font-size: 10px;
            color: var(--qr-muted);
            font-variant-numeric: tabular-nums;
        }

        .qrscanner-data {
            position: relative;
            padding: 8px 9px;
            border-radius: 9px;
            background: var(--qr-card-soft);
            font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
            font-size: 11.5px;
            line-height: 1.55;
            color: var(--qr-text);
            word-break: break-all;
            white-space: pre-wrap;
            max-height: 4.7em;
            overflow: hidden;
            cursor: zoom-in;
        }

        .qrscanner-data.expanded {
            max-height: none;
            cursor: zoom-out;
        }

        .qrscanner-data.clamped::after {
            content: "";
            position: absolute;
            left: 0;
            right: 0;
            bottom: 0;
            height: 1.6em;
            background: linear-gradient(180deg, transparent, var(--qr-card-soft));
            pointer-events: none;
        }

        .qrscanner-source {
            margin-top: 6px;
            font-size: 10px;
            color: var(--qr-muted);
            word-break: break-all;
            overflow: hidden;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
        }

        .qrscanner-actions {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            margin-top: 9px;
        }

        .qrscanner-action {
            padding: 5px 10px;
            border-radius: 8px;
            font-size: 11px;
            font-weight: 600;
            background: var(--qr-card-soft);
            color: var(--qr-text);
            transition: background 0.14s ease, color 0.14s ease;
        }

        .qrscanner-action:hover {
            background: var(--qr-border);
        }

        .qrscanner-action-main {
            background: var(--qr-accent-soft);
            color: var(--qr-accent-strong);
        }

        .qrscanner-action-main:hover {
            background: var(--qr-accent);
            color: #f6fffc;
        }

        .qrscanner-action-soft {
            background: transparent;
            color: var(--qr-muted);
            border: 1px solid var(--qr-border);
        }

        .qrscanner-action-soft:hover {
            color: var(--qr-text);
            background: var(--qr-card-soft);
        }

        .qrscanner-action-danger {
            background: transparent;
            color: var(--qr-muted);
            border: 1px solid transparent;
            margin-left: auto;
        }

        .qrscanner-action-danger:hover {
            color: var(--qr-danger);
            background: var(--qr-danger-soft);
        }

        /* ---------------------------------------------------------- 悬浮按钮 */

        #${TOGGLE_ID} {
            position: fixed;
            right: 20px;
            bottom: 20px;
            z-index: 2147483641;
            display: grid;
            place-items: center;
            width: 52px;
            height: 52px;
            border-radius: 16px;
            color: #f6fffc;
            background:
                radial-gradient(120% 120% at 100% 0%, rgba(217, 131, 36, 0.45), transparent 55%),
                linear-gradient(135deg, #0d7a6b 0%, #0a4c43 100%);
            box-shadow: 0 12px 28px rgba(10, 60, 50, 0.34);
            transition: transform 0.2s ease, box-shadow 0.2s ease;
        }

        #${TOGGLE_ID}:hover {
            transform: translateY(-2px);
            box-shadow: 0 16px 34px rgba(10, 60, 50, 0.42);
        }

        #${TOGGLE_ID} svg {
            width: 24px;
            height: 24px;
        }

        .qrscanner-toggle-badge {
            position: absolute;
            top: -5px;
            right: -5px;
            display: none;
            align-items: center;
            justify-content: center;
            min-width: 20px;
            height: 20px;
            padding: 0 5px;
            border-radius: 99px;
            background: var(--qr-amber);
            color: #fff;
            font-size: 10px;
            font-weight: 700;
            border: 2px solid var(--qr-panel-bg);
            font-variant-numeric: tabular-nums;
        }

        /* ------------------------------------------------------------ 右键菜单 */

        #${MENU_ID} {
            position: fixed;
            z-index: 2147483642;
            display: none;
            min-width: 176px;
            padding: 5px;
            border-radius: 12px;
            background: var(--qr-panel-bg);
            border: 1px solid var(--qr-border);
            box-shadow: 0 16px 40px rgba(10, 30, 25, 0.24);
        }

        #${MENU_ID}.open {
            display: block;
            animation: qrscanner-pop 0.12s ease-out;
        }

        @keyframes qrscanner-pop {
            from { opacity: 0; transform: translateY(-3px) scale(0.98); }
            to { opacity: 1; transform: none; }
        }

        .qrscanner-menu-item {
            display: flex;
            align-items: center;
            gap: 8px;
            width: 100%;
            padding: 8px 9px;
            border-radius: 8px;
            text-align: left;
            font-size: 12px;
            color: var(--qr-text);
            transition: background 0.13s ease;
        }

        .qrscanner-menu-item:hover {
            background: var(--qr-accent-soft);
        }

        .qrscanner-menu-item svg {
            width: 13px;
            height: 13px;
            color: var(--qr-muted);
            flex: 0 0 auto;
        }

        .qrscanner-menu-hint {
            margin-top: 3px;
            padding: 5px 9px 3px;
            border-top: 1px solid var(--qr-border);
            font-size: 10px;
            color: var(--qr-muted);
        }

        /* ------------------------------------------------------------ 提示条 */

        #${TOAST_HOST_ID} {
            position: fixed;
            top: 16px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 2147483643;
            display: grid;
            gap: 8px;
            width: min(440px, calc(100vw - 24px));
            pointer-events: none;
        }

        .qrscanner-toast {
            pointer-events: auto;
            padding: 11px 13px;
            border-radius: 12px;
            background: var(--qr-panel-bg);
            border: 1px solid var(--qr-border);
            box-shadow: 0 16px 40px rgba(10, 30, 25, 0.20);
            color: var(--qr-text);
            animation: qrscanner-drop 0.16s ease-out;
        }

        @keyframes qrscanner-drop {
            from { opacity: 0; transform: translateY(-8px); }
            to { opacity: 1; transform: none; }
        }

        .qrscanner-toast.loading {
            border-left: 3px solid var(--qr-accent);
        }

        .qrscanner-toast.success {
            border-left: 3px solid #1a9c62;
        }

        .qrscanner-toast.error {
            border-left: 3px solid var(--qr-danger);
        }

        .qrscanner-toast-head {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 10px;
        }

        .qrscanner-toast-title {
            font-size: 12.5px;
            font-weight: 650;
        }

        .qrscanner-toast-close {
            flex: 0 0 auto;
            display: grid;
            place-items: center;
            width: 20px;
            height: 20px;
            border-radius: 6px;
            color: var(--qr-muted);
            transition: background 0.14s ease;
        }

        .qrscanner-toast-close:hover {
            background: var(--qr-card-soft);
        }

        .qrscanner-toast-close svg {
            width: 11px;
            height: 11px;
        }

        .qrscanner-toast-message {
            margin-top: 4px;
            font-size: 11.5px;
            line-height: 1.55;
            color: var(--qr-muted);
            word-break: break-all;
            max-height: 7em;
            overflow: auto;
        }

        .qrscanner-toast-actions {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            margin-top: 9px;
        }

        .qrscanner-toast-actions .qrscanner-action {
            padding: 5px 10px;
        }

        /* ------------------------------------------------------------ 高亮 */

        .qrscanner-highlight {
            outline: 3px solid var(--qr-amber, #d98324) !important;
            outline-offset: 3px !important;
            box-shadow: 0 0 0 7px rgba(217, 131, 36, 0.22) !important;
        }

        @media (max-width: 520px) {
            #${PANEL_ID} {
                width: 100vw;
            }
        }
    `);

    /* ------------------------------------------------------------ 数据层 */

    function loadResults() {
        try {
            const raw = GM_getValue(STORAGE_KEY, '[]');
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            if (!Array.isArray(parsed)) return [];

            const cleaned = parsed
                .filter((item) => item && item.data)
                .map(normalizeResult)
                .sort((a, b) => b.createdAt - a.createdAt);

            // 超出上限的旧记录在读取时直接裁掉。
            return cleaned.slice(0, MAX_RESULTS);
        } catch (error) {
            console.warn('[QR] 读取历史结果失败:', error);
            return [];
        }
    }

    function saveResults() {
        try {
            if (results.length > MAX_RESULTS) {
                results = results.slice(0, MAX_RESULTS);
            }
            GM_setValue(STORAGE_KEY, JSON.stringify(results));
        } catch (error) {
            console.warn('[QR] 保存结果失败:', error);
        }
    }

    function makeHash(input) {
        const text = String(input || '');
        let hash = 0;
        for (let i = 0; i < text.length; i += 1) {
            hash = ((hash << 5) - hash) + text.charCodeAt(i);
            hash |= 0;
        }
        return `qr_${Math.abs(hash)}_${text.length}`;
    }

    function isUrl(text) {
        return /^https?:\/\//i.test(String(text || '').trim());
    }

    // 同时用于文本内容和属性值，因此必须转义引号。
    function esc(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, (character) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[character]));
    }

    function shortText(text, max = 120) {
        const value = String(text || '');
        return value.length <= max ? value : `${value.slice(0, max)}…`;
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
        const normalized = (items || []).map(normalizeResult).filter((item) => item.data);
        if (!normalized.length) return;

        // 按「来源 + 内容」去重，而不是按 id，避免哈希碰撞误删。
        const merged = new Map(
            results.map((item) => [`${item.origin}|${item.source}|${item.data}`, item])
        );
        normalized.forEach((item) => {
            merged.set(`${item.origin}|${item.source}|${item.data}`, item);
        });

        results = Array.from(merged.values())
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, MAX_RESULTS);

        saveResults();
        renderResults();
    }

    function removeResult(id) {
        results = results.filter((item) => item.id !== id);
        saveResults();
        renderResults();
    }

    function clearResults() {
        if (!results.length) return;
        results = [];
        locatedImages.clear();
        document.querySelectorAll('img[data-qrscanner-result-id]').forEach((image) => {
            delete image.dataset.qrscannerResultId;
        });
        saveResults();
        renderResults();
    }

    /* ------------------------------------------------------------ 渲染层 */

    function visibleResults() {
        if (!filterText) return results;
        const query = filterText.toLowerCase();
        return results.filter((item) =>
            item.data.toLowerCase().includes(query) ||
            (item.source || '').toLowerCase().includes(query)
        );
    }

    function updateStatus() {
        if (!ui.status || !ui.toggle) return;

        const pageCount = results.filter((item) => item.pageUrl === location.href).length;
        ui.status.innerHTML =
            '<div class="qrscanner-stat">' +
            '<div class="qrscanner-stat-label">当前页</div>' +
            `<div class="qrscanner-stat-value">${pageCount}</div>` +
            '</div>' +
            '<div class="qrscanner-stat">' +
            '<div class="qrscanner-stat-label">累计结果</div>' +
            `<div class="qrscanner-stat-value">${results.length}</div>` +
            '</div>';

        const badge = ui.toggle.querySelector('.qrscanner-toggle-badge');
        badge.textContent = results.length > 99 ? '99+' : String(results.length);
        badge.style.display = results.length ? 'flex' : 'none';
    }

    const SOURCE_LABELS = {
        page: '页面扫描',
        context: '右键识别',
        upload: '本地上传'
    };

    function renderResults() {
        if (!ui.list || !ui.empty) return;

        updateStatus();

        const items = visibleResults();
        if (!items.length) {
            ui.empty.style.display = 'block';
            if (filterText && results.length) {
                ui.empty.innerHTML =
                    '<div class="qrscanner-empty-icon">' + QR_ICON + '</div>' +
                    '<div class="qrscanner-empty-title">没有匹配的结果</div>' +
                    `<div class="qrscanner-empty-desc">共 ${results.length} 条结果，换个关键词试试。</div>`;
            } else {
                ui.empty.innerHTML =
                    '<div class="qrscanner-empty-icon">' + QR_ICON + '</div>' +
                    '<div class="qrscanner-empty-title">还没有识别结果</div>' +
                    '<div class="qrscanner-empty-desc">可以点「重新扫描」，也可以直接上传本地二维码图片。</div>';
            }
            ui.list.innerHTML = '';
            return;
        }

        ui.empty.style.display = 'none';
        ui.list.innerHTML = items.map(buildItemHtml).join('');
    }

    function buildItemHtml(item) {
        const id = esc(item.id);
        const openButton = item.kind === 'url'
            ? `<button class="qrscanner-action qrscanner-action-main" data-action="open" data-id="${id}">打开链接</button>`
            : '';

        const locateButton = (item.origin === 'page' || item.origin === 'context')
            ? `<button class="qrscanner-action qrscanner-action-soft" data-action="locate" data-id="${id}">定位图片</button>`
            : '';

        const longData = item.data.length > 150;

        return '' +
            `<article class="qrscanner-item" data-result-id="${id}">` +
            '<div class="qrscanner-item-top">' +
            '<div class="qrscanner-badges">' +
            `<span class="qrscanner-badge ${item.kind === 'url' ? 'qrscanner-badge-url' : 'qrscanner-badge-text'}">` +
            `${item.kind === 'url' ? '链接' : '文本'}</span>` +
            `<span class="qrscanner-badge qrscanner-badge-origin">${esc(SOURCE_LABELS[item.origin] || '未知来源')}</span>` +
            '</div>' +
            `<span class="qrscanner-time">${esc(item.time)}</span>` +
            '</div>' +
            `<div class="qrscanner-data${longData ? ' clamped' : ''}" data-role="data" title="点击展开或收起">${esc(item.data)}</div>` +
            `<div class="qrscanner-source" title="${esc(item.source || item.pageUrl)}">` +
            `${esc(shortText(item.source || item.pageUrl || '无来源信息'))}</div>` +
            '<div class="qrscanner-actions">' +
            openButton +
            `<button class="qrscanner-action qrscanner-action-soft" data-action="copy" data-id="${id}">复制</button>` +
            locateButton +
            `<button class="qrscanner-action qrscanner-action-danger" data-action="remove" data-id="${id}">删除</button>` +
            '</div>' +
            '</article>';
    }

    /* ------------------------------------------------------------ 面板控制 */

    function openPanel() {
        if (!ui.panel) return;
        ui.panel.classList.add('open');
        ui.panel.setAttribute('aria-hidden', 'false');
    }

    function closePanel() {
        if (!ui.panel) return;
        ui.panel.classList.remove('open');
        ui.panel.setAttribute('aria-hidden', 'true');
        hideContextMenu();
    }

    function togglePanel() {
        if (!ui.panel) return;
        if (ui.panel.classList.contains('open')) closePanel();
        else openPanel();
    }

    function handleGlobalKeydown(event) {
        if (event.key !== 'Escape') return;
        if (ui.menu && ui.menu.classList.contains('open')) {
            hideContextMenu();
            return;
        }
        if (ui.panel && ui.panel.classList.contains('open')) {
            closePanel();
        }
    }

    function setScanningState(value) {
        scanning = value;
        if (ui.progress) ui.progress.classList.toggle('active', value);
        const button = ui.panel && ui.panel.querySelector('#qrscanner-rescan-btn');
        if (button) {
            button.disabled = value;
            button.querySelector('.qrscanner-btn-label').textContent = value ? '扫描中…' : '重新扫描';
        }
    }

    function markImageForResult(resultId, image) {
        if (!image || !resultId) return;
        image.dataset.qrscannerResultId = resultId;
        locatedImages.set(resultId, image);
    }

    function highlightImage(resultId) {
        const image = locatedImages.get(resultId) ||
            document.querySelector(`img[data-qrscanner-result-id="${resultId}"]`);

        if (!image || !image.isConnected) {
            showToast({
                type: 'error',
                title: '定位失败',
                message: '当前页面找不到对应图片，它可能来自已关闭的页面或本地上传。'
            });
            return;
        }

        document.querySelectorAll('.qrscanner-highlight')
            .forEach((node) => node.classList.remove('qrscanner-highlight'));

        image.classList.add('qrscanner-highlight');
        image.scrollIntoView({ behavior: 'smooth', block: 'center' });
        window.setTimeout(() => image.classList.remove('qrscanner-highlight'), 2600);
    }

    /* ------------------------------------------------------------ 提示条 */

    function ensureToastHost() {
        if (ui.toastHost && ui.toastHost.isConnected) return ui.toastHost;

        const host = document.createElement('div');
        host.id = TOAST_HOST_ID;
        host.className = ROOT_CLASS;
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
            duration = 2400
        } = options || {};

        const host = ensureToastHost();
        const toast = document.createElement('div');
        const toastId = `qrscanner-toast-${++toastSeed}`;
        toast.className = `qrscanner-toast ${type}`;
        toast.dataset.toastId = toastId;
        toast.innerHTML =
            '<div class="qrscanner-toast-head">' +
            `<div class="qrscanner-toast-title">${esc(title)}</div>` +
            `<button class="qrscanner-toast-close" type="button" data-close="${toastId}" aria-label="关闭">` +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" ' +
            'stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
            '</button>' +
            '</div>' +
            `<div class="qrscanner-toast-message">${esc(message)}</div>` +
            '<div class="qrscanner-toast-actions"></div>';

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
                    if (action.closeOnClick !== false) toast.remove();
                }
            });
            actionsWrap.appendChild(button);
        });

        if (!actions.length) {
            actionsWrap.remove();
        }

        toast.querySelector('[data-close]').addEventListener('click', () => toast.remove());
        host.appendChild(toast);

        // 带操作按钮的提示必须常驻，否则用户来不及点击。
        const effectiveDuration = actions.length ? 0 : duration;
        if (effectiveDuration > 0) {
            window.setTimeout(() => toast.remove(), effectiveDuration);
        }
        return toast;
    }

    /* ------------------------------------------------------------ 解码核心 */

    function getDetector() {
        if (detectorPromise) return detectorPromise;

        detectorPromise = (async () => {
            if (typeof window.BarcodeDetector !== 'function') return null;
            try {
                if (typeof window.BarcodeDetector.getSupportedFormats === 'function') {
                    const formats = await window.BarcodeDetector.getSupportedFormats();
                    if (Array.isArray(formats) && !formats.includes('qr_code')) return null;
                }
                return new window.BarcodeDetector({ formats: ['qr_code'] });
            } catch (error) {
                return null;
            }
        })();

        return detectorPromise;
    }

    // Chrome/Edge 自带识别器：比 jsQR 快一个量级，且能处理旋转与透视。
    async function decodeWithDetector(source) {
        const detector = await getDetector();
        if (!detector) return null;

        try {
            const codes = await detector.detect(source);
            for (const code of codes) {
                const value = String(code.rawValue || '').trim();
                if (value) return value;
            }
        } catch (error) {
            // 跨域污染、未加载完成等情况会在这里抛出，静默降级。
        }
        return null;
    }

    function tryJsQR(imageData) {
        if (typeof jsQR !== 'function') return null;
        try {
            const code = jsQR(imageData.data, imageData.width, imageData.height, {
                inversionAttempts: 'attemptBoth'
            });
            if (code && code.data && code.data.trim()) {
                return code.data.trim();
            }
        } catch (error) {
            // 忽略单次解码异常。
        }
        return null;
    }

    function createBinaryImageData(imageData) {
        const cloned = new ImageData(
            new Uint8ClampedArray(imageData.data),
            imageData.width,
            imageData.height
        );
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

    // 每个尺寸只跑两轮：原图一次、二值化一次；attemptBoth 已覆盖正片与反色。
    function decodeCanvas(canvas) {
        if (typeof jsQR !== 'function') return null;

        let context;
        try {
            context = canvas.getContext('2d', { willReadFrequently: true });
        } catch (error) {
            return null;
        }
        if (!context) return null;

        let original;
        try {
            original = context.getImageData(0, 0, canvas.width, canvas.height);
        } catch (error) {
            // 跨域污染的画布无法读取像素。
            return null;
        }

        return tryJsQR(original) ||
            tryJsQR(createBinaryImageData(original));
    }

    function buildTargetSides(maxSide) {
        const candidates = [
            Math.min(1080, Math.max(maxSide, 360)),
            Math.min(1440, Math.max(maxSide, 360)),
            Math.min(560, Math.max(maxSide, 240))
        ];

        return Array.from(new Set(candidates.map((value) => Math.round(value))))
            .filter((value) => value >= 128)
            .sort((a, b) => b - a);
    }

    async function decodeDrawable(drawable, width, height) {
        if (!width || !height || width < 20 || height < 20) return null;
        if (width * height > 60e6) return null; // 超大图直接跳过，避免卡死标签页

        const nativeDecoded = await decodeWithDetector(drawable);
        if (nativeDecoded) return nativeDecoded;

        if (typeof jsQR !== 'function') return null;

        const maxSide = Math.max(width, height);
        for (const targetSide of buildTargetSides(maxSide)) {
            const scale = targetSide / maxSide;
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(width * scale));
            canvas.height = Math.max(1, Math.round(height * scale));

            const context = canvas.getContext('2d', { willReadFrequently: true });
            if (!context) continue;

            try {
                context.drawImage(drawable, 0, 0, canvas.width, canvas.height);
            } catch (error) {
                continue;
            }

            const canvasDecoded = await decodeWithDetector(canvas);
            if (canvasDecoded) return canvasDecoded;

            const decoded = decodeCanvas(canvas);
            if (decoded) return decoded;
        }

        return null;
    }

    async function decodeImageElement(image) {
        if (!image || !image.complete) return null;
        const width = image.naturalWidth || image.width || 0;
        const height = image.naturalHeight || image.height || 0;
        return decodeDrawable(image, width, height);
    }

    function loadImageFromUrl(url, useCors = false) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.decoding = 'async';
            if (useCors) image.crossOrigin = 'anonymous';

            const timer = window.setTimeout(() => {
                image.src = '';
                reject(new Error('图片加载超时'));
            }, 15000);

            image.onload = () => {
                window.clearTimeout(timer);
                if (!image.naturalWidth && !image.naturalHeight) {
                    reject(new Error('图片尺寸为 0'));
                    return;
                }
                resolve(image);
            };
            image.onerror = () => {
                window.clearTimeout(timer);
                reject(new Error('图片加载失败'));
            };
            image.src = url;
        });
    }

    function fetchBlobViaGM(url) {
        return new Promise((resolve, reject) => {
            if (typeof GM_xmlhttpRequest !== 'function') {
                reject(new Error('缺少 GM_xmlhttpRequest 权限'));
                return;
            }

            GM_xmlhttpRequest({
                method: 'GET',
                url,
                responseType: 'blob',
                timeout: 20000,
                onload: (response) => {
                    if (response.status >= 200 && response.status < 400 &&
                        response.response instanceof Blob) {
                        resolve(response.response);
                    } else {
                        reject(new Error(`读图失败 (HTTP ${response.status})`));
                    }
                },
                onerror: () => reject(new Error('网络错误')),
                ontimeout: () => reject(new Error('读图超时'))
            });
        });
    }

    // 跨域/防盗链图片：用特权请求拿到字节，绕开画布污染限制。
    async function decodeViaNetwork(url) {
        const blob = await fetchBlobViaGM(url);
        const objectUrl = URL.createObjectURL(blob);
        try {
            const image = await loadImageFromUrl(objectUrl);
            return await decodeDrawable(image, image.naturalWidth, image.naturalHeight);
        } finally {
            URL.revokeObjectURL(objectUrl);
        }
    }

    async function decodeFile(file) {
        const objectUrl = URL.createObjectURL(file);
        try {
            const image = await loadImageFromUrl(objectUrl);
            return await decodeDrawable(image, image.naturalWidth, image.naturalHeight);
        } finally {
            URL.revokeObjectURL(objectUrl);
        }
    }

    function createResultFromDecoded(decoded, meta) {
        if (!decoded) return null;
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

    /* ------------------------------------------------------------ 扫描流程 */

    function rememberSource(source) {
        scannedSources.add(source);
        if (scannedSources.size > MAX_SCANNED_SOURCES) {
            // 超出上限时清空重来，避免长驻页面无限增长。
            scannedSources.clear();
            scannedSources.add(source);
        }
    }

    async function scanImageElement(image) {
        if (!image || !image.complete) return null;

        const source = image.currentSrc || image.src || image.getAttribute('src') || '';
        if (!source || scannedSources.has(source)) return null;

        const width = image.naturalWidth || image.width || 0;
        const height = image.naturalHeight || image.height || 0;
        if (width < MIN_IMAGE_SIDE || height < MIN_IMAGE_SIDE || width * height < 900) {
            rememberSource(source);
            return null;
        }

        let decoded = null;
        try {
            decoded = await decodeImageElement(image);
        } catch (error) {
            decoded = null;
        }

        rememberSource(source);
        if (!decoded) return null;

        const result = createResultFromDecoded(decoded, { origin: 'page', source });
        if (result) markImageForResult(result.id, image);
        return result;
    }

    async function scanPage() {
        // 同一张图在页面上常出现多次，先按 src 去重，把配额留给真正不同的图。
        const seenSources = new Set();
        const images = Array.from(document.images)
            .filter((image) => {
                if (!image.complete) return false;
                if ((image.naturalWidth || 0) < MIN_IMAGE_SIDE) return false;
                const src = image.currentSrc || image.src || image.getAttribute('src') || '';
                if (!src || seenSources.has(src)) return false;
                seenSources.add(src);
                return true;
            })
            // 先扫面积大的图，二维码更容易藏在主图里。
            .map((image) => ({
                image,
                weight: (image.naturalWidth || 0) * (image.naturalHeight || 0)
            }))
            .sort((a, b) => b.weight - a.weight)
            .slice(0, MAX_PAGES_IMAGES)
            .map((entry) => entry.image);

        const found = [];
        for (let i = 0; i < images.length; i += 4) {
            const batch = images.slice(i, i + 4);
            const batchResults = await Promise.all(batch.map((image) => scanImageElement(image)));
            batchResults.forEach((item) => {
                if (item) found.push(item);
            });
        }
        return found;
    }

    async function runPageScan(options = {}) {
        const { notify = false } = options;
        if (scanning) return [];

        let loadingToast = null;
        setScanningState(true);

        if (notify) {
            loadingToast = showToast({
                type: 'loading',
                title: '正在扫描',
                message: '正在识别当前页面里的二维码图片…',
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
                        message: `本次识别到 ${found.length} 条结果。`
                    });
                }
            } else if (notify) {
                showToast({
                    type: 'info',
                    title: '没有识别到二维码',
                    message: '可以右键单张图片识别，或上传本地图片。跨域图片建议用右键或上传方式。'
                });
            }
            return found;
        } finally {
            setScanningState(false);
            if (loadingToast) loadingToast.remove();
        }
    }

    function scheduleScan() {
        window.clearTimeout(scanTimer);
        scanTimer = window.setTimeout(() => {
            runPageScan();
        }, SCAN_DEBOUNCE);
    }

    /* ------------------------------------------------------------ 交互入口 */

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
            message: `正在处理 ${imageFiles.length} 张图片…`,
            duration: 0
        });

        const found = [];
        for (const file of imageFiles) {
            const decoded = await decodeFile(file).catch(() => null);
            const result = createResultFromDecoded(decoded, {
                origin: 'upload',
                source: `本地文件：${file.name}`
            });
            if (result) found.push(result);
        }

        loadingToast.remove();
        if (found.length) {
            upsertResults(found);
            showToast({
                type: 'success',
                title: '识别成功',
                message: `已从 ${found.length} 张图片中识别出二维码。`
            });
        } else {
            showToast({
                type: 'error',
                title: '没有识别到内容',
                message: '图片模糊或二维码太小时容易失败，试试用更清晰的原图。'
            });
        }
    }

    async function handleContextScan(image, source) {
        if (!image || !source) return;

        openPanel();
        const loadingToast = showToast({
            type: 'loading',
            title: '正在识别这张图片',
            message: '先读取页面像素，失败时会自动重新下载原图。',
            duration: 0
        });

        let decoded = null;
        let networkError = null;

        try {
            decoded = await decodeImageElement(image);
        } catch (error) {
            decoded = null;
        }

        // 页面像素读不到（跨域污染）时，用特权请求重新取图。
        if (!decoded && !/^data:/i.test(source)) {
            try {
                decoded = await decodeViaNetwork(source);
            } catch (error) {
                networkError = error;
            }
        }

        loadingToast.remove();

        if (!decoded) {
            showToast({
                type: 'error',
                title: '识别失败',
                message: networkError
                    ? `这张图读取失败：${networkError.message}。可以打开原图或下载后上传。`
                    : '这张图里没有检测到二维码，可能是二维码太小、被裁切或压缩过度。',
                actions: [
                    {
                        text: '打开原图',
                        className: 'qrscanner-action qrscanner-action-main',
                        onClick: () => window.open(source, '_blank', 'noopener,noreferrer')
                    },
                    {
                        text: '上传本地图片',
                        className: 'qrscanner-action qrscanner-action-soft',
                        onClick: () => ui.uploadInput.click()
                    }
                ]
            });
            return;
        }

        const result = createResultFromDecoded(decoded, { origin: 'context', source });
        if (result) {
            markImageForResult(result.id, image);
            upsertResults([result]);
        }

        const actions = [{
            text: '复制内容',
            className: 'qrscanner-action qrscanner-action-soft',
            onClick: async () => {
                const ok = await copyText(decoded);
                showToast({
                    type: ok ? 'success' : 'error',
                    title: ok ? '已复制' : '复制失败',
                    message: ok ? '二维码内容已复制到剪贴板。' : '浏览器拒绝了剪贴板访问。'
                });
            }
        }];

        if (isUrl(decoded)) {
            actions.unshift({
                text: '打开链接',
                className: 'qrscanner-action qrscanner-action-main',
                onClick: () => window.open(decoded, '_blank', 'noopener,noreferrer')
            });
        }

        showToast({
            type: 'success',
            title: '识别成功',
            message: decoded,
            actions
        });
    }

    async function copyText(text) {
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(text);
                return true;
            }
        } catch (error) {
            // 继续走兜底方案。
        }

        try {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.setAttribute('readonly', '');
            textarea.style.cssText = 'position:fixed;top:-1000px;opacity:0;';
            document.body.appendChild(textarea);
            textarea.select();
            const ok = document.execCommand('copy');
            textarea.remove();
            return ok;
        } catch (error) {
            return false;
        }
    }

    function exportResults() {
        if (!results.length) {
            showToast({ type: 'info', title: '没有可导出的内容', message: '先扫描或上传一张二维码图片。' });
            return;
        }

        try {
            const payload = JSON.stringify({
                exportedAt: new Date().toISOString(),
                page: location.href,
                count: results.length,
                results
            }, null, 2);

            const blob = new Blob([payload], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `qrcode-results-${Date.now()}.json`;
            link.rel = 'noopener';
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 4000);

            showToast({
                type: 'success',
                title: '已导出',
                message: `共导出 ${results.length} 条结果。`
            });
        } catch (error) {
            showToast({ type: 'error', title: '导出失败', message: '浏览器阻止了文件生成。' });
        }
    }

    /* -------------------------------------------------------------- 界面 */

    function buildUI() {
        const panel = document.createElement('aside');
        panel.id = PANEL_ID;
        panel.className = ROOT_CLASS;
        panel.setAttribute('role', 'complementary');
        panel.setAttribute('aria-label', '二维码识别器');
        panel.setAttribute('aria-hidden', 'true');
        panel.innerHTML = `
            <div class="qrscanner-progress"></div>
            <div class="qrscanner-header">
                <div class="qrscanner-header-row">
                    <div class="qrscanner-logo">${QR_ICON}</div>
                    <div class="qrscanner-heading">
                        <h1 class="qrscanner-title">二维码识别器</h1>
                        <div class="qrscanner-subtitle">Esc 关闭 · Shift + 右键使用原菜单</div>
                    </div>
                    <button class="qrscanner-close" type="button" id="qrscanner-close-btn" aria-label="关闭面板">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
                            stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
                    </button>
                </div>
            </div>
            <div class="qrscanner-body">
                <div class="qrscanner-stats" id="qrscanner-status"></div>

                <div class="qrscanner-toolbar">
                    <button type="button" class="qrscanner-btn qrscanner-btn-primary" id="qrscanner-upload-btn">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                            stroke-linecap="round" stroke-linejoin="round">
                            <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5"/><path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"/>
                        </svg>
                        <span>上传识别</span>
                    </button>
                    <button type="button" class="qrscanner-btn qrscanner-btn-secondary" id="qrscanner-rescan-btn">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                            stroke-linecap="round" stroke-linejoin="round">
                            <path d="M20 11a8 8 0 10-2.3 5.7"/><path d="M20 5v6h-6"/>
                        </svg>
                        <span class="qrscanner-btn-label">重新扫描</span>
                    </button>
                    <button type="button" class="qrscanner-btn qrscanner-btn-quiet" id="qrscanner-export-btn">导出 JSON</button>
                    <button type="button" class="qrscanner-btn qrscanner-btn-danger" id="qrscanner-clear-btn">清空结果</button>
                </div>

                <div class="qrscanner-dropzone" id="qrscanner-dropzone">
                    <div class="qrscanner-dropzone-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                            stroke-linecap="round" stroke-linejoin="round">
                            <rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 15l4.5-4.5 4 4L15 11l6 6"/>
                        </svg>
                    </div>
                    <div class="qrscanner-dropzone-text">
                        <div class="qrscanner-dropzone-title">拖入图片，或点击上传</div>
                        <div class="qrscanner-dropzone-desc">截图、海报、下载好的原图都能直接识别</div>
                    </div>
                </div>

                <div class="qrscanner-filter-wrap">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                        stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/></svg>
                    <input class="qrscanner-filter" id="qrscanner-filter" type="search"
                        placeholder="筛选结果：链接、关键词或文件名" autocomplete="off">
                </div>

                <div class="qrscanner-empty" id="qrscanner-empty">
                    <div class="qrscanner-empty-icon">${QR_ICON}</div>
                    <div class="qrscanner-empty-title">还没有识别结果</div>
                    <div class="qrscanner-empty-desc">可以点「重新扫描」，也可以直接上传本地二维码图片。</div>
                </div>

                <div class="qrscanner-list" id="qrscanner-list"></div>
            </div>
        `;
        document.body.appendChild(panel);

        const toggle = document.createElement('button');
        toggle.id = TOGGLE_ID;
        toggle.className = ROOT_CLASS;
        toggle.type = 'button';
        toggle.title = '打开二维码识别器';
        toggle.innerHTML = QR_ICON + '<span class="qrscanner-toggle-badge">0</span>';
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
        menu.className = ROOT_CLASS;
        menu.setAttribute('role', 'menu');
        menu.innerHTML = `
            <button type="button" class="qrscanner-menu-item" data-menu-action="scan">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                    stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="3" width="7" height="7" rx="1.6"/><rect x="14" y="3" width="7" height="7" rx="1.6"/>
                    <rect x="3" y="14" width="7" height="7" rx="1.6"/><path d="M14 14h3v3h-3z"/>
                </svg>
                <span>识别这张图片</span>
            </button>
            <button type="button" class="qrscanner-menu-item" data-menu-action="open">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                    stroke-linecap="round" stroke-linejoin="round">
                    <path d="M14 4h6v6"/><path d="M20 4l-8 8"/>
                    <path d="M18 14v4a2 2 0 01-2 2H6a2 2 0 01-2-2V8a2 2 0 012-2h4"/>
                </svg>
                <span>在新标签打开原图</span>
            </button>
            <div class="qrscanner-menu-hint">Shift + 右键 保留原菜单</div>
        `;
        document.body.appendChild(menu);

        ui.panel = panel;
        ui.list = panel.querySelector('#qrscanner-list');
        ui.empty = panel.querySelector('#qrscanner-empty');
        ui.status = panel.querySelector('#qrscanner-status');
        ui.progress = panel.querySelector('.qrscanner-progress');
        ui.toggle = toggle;
        ui.uploadInput = input;
        ui.dropzone = panel.querySelector('#qrscanner-dropzone');
        ui.menu = menu;
        ui.filter = panel.querySelector('#qrscanner-filter');

        bindPanelEvents(panel, toggle, input);
    }

    function bindPanelEvents(panel, toggle, input) {
        panel.querySelector('#qrscanner-close-btn').addEventListener('click', closePanel);
        toggle.addEventListener('click', togglePanel);

        panel.querySelector('#qrscanner-upload-btn').addEventListener('click', () => input.click());
        panel.querySelector('#qrscanner-rescan-btn').addEventListener('click', () => {
            runPageScan({ notify: true });
        });
        panel.querySelector('#qrscanner-export-btn').addEventListener('click', exportResults);
        panel.querySelector('#qrscanner-clear-btn').addEventListener('click', clearResults);

        input.addEventListener('change', (event) => {
            handleUpload(event.target.files);
            event.target.value = '';
        });

        ui.filter.addEventListener('input', (event) => {
            filterText = event.target.value.trim();
            renderResults();
        });

        ui.dropzone.addEventListener('click', () => input.click());
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
            if (event.dataTransfer && event.dataTransfer.files.length) {
                handleUpload(event.dataTransfer.files);
            }
        });

        ui.list.addEventListener('click', async (event) => {
            const dataNode = event.target.closest('[data-role="data"]');
            if (dataNode) {
                dataNode.classList.toggle('expanded');
                dataNode.classList.remove('clamped');
                return;
            }

            const button = event.target.closest('button[data-action]');
            if (!button) return;

            const { action, id } = button.dataset;
            const item = results.find((result) => result.id === id);
            if (!item) return;

            if (action === 'open' && item.kind === 'url') {
                window.open(item.data, '_blank', 'noopener,noreferrer');
                return;
            }

            if (action === 'copy') {
                const ok = await copyText(item.data);
                if (ok) {
                    const label = button.textContent;
                    button.textContent = '已复制';
                    window.setTimeout(() => { button.textContent = label; }, 1400);
                } else {
                    showToast({
                        type: 'error',
                        title: '复制失败',
                        message: '浏览器拒绝了剪贴板访问，可以手动选中内容复制。'
                    });
                }
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

    /* ------------------------------------------------------------ 右键菜单 */

    // 同一次右键在 60ms 内只允许一个脚本抢占，另一个直接让位。
    function claimContextMenu() {
        const root = document.documentElement;
        if (!root || !root.dataset) return true;

        const last = Number(root.dataset[MENU_CLAIM_ATTR] || 0);
        if (last && Date.now() - last < MENU_CLAIM_WINDOW) return false;

        const stamp = String(Date.now());
        root.dataset[MENU_CLAIM_ATTR] = stamp;
        window.setTimeout(() => {
            if (root.dataset[MENU_CLAIM_ATTR] === stamp) {
                delete root.dataset[MENU_CLAIM_ATTR];
            }
        }, 150);
        return true;
    }

    function hideContextMenu() {
        if (ui.menu) ui.menu.classList.remove('open');
        currentContextImage = null;
    }

    function initContextMenu() {
        document.addEventListener('contextmenu', (event) => {
            const image = event.target && event.target.closest ? event.target.closest('img') : null;

            if (!image || event.shiftKey) {
                hideContextMenu();
                return;
            }

            if (ui.menu && ui.menu.contains(event.target)) return;

            const source = image.currentSrc || image.src || image.getAttribute('src');
            if (!source) {
                hideContextMenu();
                return;
            }

            // 两个脚本共存时只让一个接管右键。
            if (!claimContextMenu()) {
                hideContextMenu();
                return;
            }

            event.preventDefault();
            currentContextImage = image;

            ui.menu.classList.add('open');
            const rect = ui.menu.getBoundingClientRect();
            const left = Math.min(event.clientX, window.innerWidth - rect.width - 8);
            const top = Math.min(event.clientY, window.innerHeight - rect.height - 8);
            ui.menu.style.left = `${Math.max(8, left)}px`;
            ui.menu.style.top = `${Math.max(8, top)}px`;
        }, true);

        document.addEventListener('mousedown', (event) => {
            if (ui.menu && !ui.menu.contains(event.target)) hideContextMenu();
        }, true);

        ui.menu.addEventListener('click', (event) => {
            const button = event.target.closest('[data-menu-action]');
            if (!button || !currentContextImage) return;

            const image = currentContextImage;
            const source = image.currentSrc || image.src || image.getAttribute('src');
            const action = button.dataset.menuAction;
            hideContextMenu();

            if (action === 'scan') {
                handleContextScan(image, source);
            } else if (action === 'open' && source) {
                window.open(source, '_blank', 'noopener,noreferrer');
            }
        });
    }

    function initMenus() {
        if (typeof GM_registerMenuCommand !== 'function') return;

        GM_registerMenuCommand('打开二维码识别器', () => openPanel());
        GM_registerMenuCommand('上传本地二维码图片', () => ui.uploadInput.click());
        GM_registerMenuCommand('重新扫描当前页面', () => runPageScan({ notify: true }));
    }

    function initObserver() {
        if (typeof MutationObserver !== 'function') return;

        const observer = new MutationObserver((mutations) => {
            const changed = mutations.some((mutation) => {
                if (mutation.type === 'childList') return mutation.addedNodes.length > 0;
                if (mutation.type === 'attributes') return mutation.attributeName === 'src';
                return false;
            });
            if (changed) scheduleScan();
        });

        const root = document.body || document.documentElement;
        if (!root) return;

        observer.observe(root, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['src']
        });
    }

    function restoreLocatedImages() {
        if (!results.length) return;

        const bySource = new Map();
        Array.from(document.images).forEach((image) => {
            const src = image.currentSrc || image.src || image.getAttribute('src') || '';
            if (src && !bySource.has(src)) bySource.set(src, image);
        });

        results.forEach((item) => {
            if (item.origin !== 'page' && item.origin !== 'context') return;
            const image = bySource.get(item.source);
            if (image) markImageForResult(item.id, image);
        });
    }

    function init() {
        if (!document.body) {
            document.addEventListener('DOMContentLoaded', init, { once: true });
            return;
        }

        results = loadResults();
        buildUI();
        initContextMenu();
        initMenus();
        renderResults();
        restoreLocatedImages();

        document.addEventListener('keydown', handleGlobalKeydown, true);

        if (typeof jsQR !== 'function') {
            console.warn('[QR] jsQR 未加载（可能被 CDN 拦截），将仅使用浏览器原生识别能力。');
        }

        window.setTimeout(() => {
            runPageScan();
        }, 1200);

        initObserver();
    }

    init();
})();
