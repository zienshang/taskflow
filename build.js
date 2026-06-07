#!/usr/bin/env node
/**
 * TaskFlow — Build & Obfuscation Script
 *
 * Kết hợp tất cả JS thành 1 bundle, obfuscate, minify CSS/HTML.
 * Output: taskflow/static_prod/   (được serve bởi FastAPI khi tồn tại)
 *
 * Usage:
 *   node build.js          — build production
 *   node build.js --clean  — xóa static_prod
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT  = __dirname;
const SRC   = path.join(ROOT, 'taskflow', 'static');
const DIST  = path.join(ROOT, 'taskflow', 'static_prod');

// ── Helpers ────────────────────────────────────────────
function kb(str) { return (str.length / 1024).toFixed(1) + 'KB'; }
function log(msg) { console.log(msg); }

// ── Clean only ─────────────────────────────────────────
if (process.argv.includes('--clean')) {
  fs.rmSync(DIST, { recursive: true, force: true });
  log('✓ static_prod/ removed');
  process.exit(0);
}

// ── Auto-install deps ──────────────────────────────────
const DEPS = ['javascript-obfuscator', 'clean-css', 'html-minifier-terser'];
const missing = DEPS.filter(d => { try { require.resolve(d); return false; } catch { return true; } });
if (missing.length) {
  log(`Installing: ${missing.join(', ')} …`);
  execSync(`npm install --save-dev ${missing.join(' ')}`, { stdio: 'inherit', cwd: ROOT });
}

const JavaScriptObfuscator = require('javascript-obfuscator');
const CleanCSS             = require('clean-css');
const { minify: minifyHtml } = require('html-minifier-terser');

// ── Prepare output dirs ────────────────────────────────
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(path.join(DIST, 'js'), { recursive: true });

log('\n📦  TaskFlow Build\n' + '─'.repeat(40));

// ── Obfuscator options ─────────────────────────────────
// Bundle option: renameGlobals=false vì onclick="doLogin()" trong HTML cần tên gốc.
// Cân bằng giữa mức độ bảo vệ và kích thước file (mục tiêu < 400KB).
const BUNDLE_OPT = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.4,  // Giảm threshold để giảm size
  deadCodeInjection: false,             // Tắt: đây là nguồn bloat lớn nhất
  debugProtection: true,               // Loop debugger khi DevTools mở
  debugProtectionInterval: 3000,
  disableConsoleOutput: true,
  identifierNamesGenerator: 'hexadecimal',
  log: false,
  numbersToExpressions: true,
  renameGlobals: false,                // WAJIB false: onclick="..." harus tetap valid
  selfDefending: true,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 10,         // Chunk lớn hơn = ít tokens hơn
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayCallsTransformThreshold: 0.6,
  stringArrayEncoding: ['base64'],
  stringArrayIndexShift: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayWrappersCount: 1,         // Giảm từ 2 → 1
  stringArrayWrappersChainedCalls: true,
  stringArrayWrappersParametersMaxCount: 3,
  stringArrayWrappersType: 'function',
  stringArrayThreshold: 0.7,
  unicodeEscapeSequence: false,
  target: 'browser',
  seed: 2024,
};

// protect.js: bisa rename global (IIFE, tidak expose apa-apa)
const PROTECT_OPT = {
  ...BUNDLE_OPT,
  renameGlobals: true,
  debugProtection: false,  // protect.js sudah punya debugger trap sendiri
  deadCodeInjection: false,
  controlFlowFlattening: false,
  seed: 9999,
};

// ── 1. Obfuscate protect.js ────────────────────────────
const protectSrc  = fs.readFileSync(path.join(SRC, 'js', 'protect.js'), 'utf8');
const protectOut  = JavaScriptObfuscator.obfuscate(protectSrc, PROTECT_OPT).getObfuscatedCode();
fs.writeFileSync(path.join(DIST, 'js', 'protect.js'), protectOut, 'utf8');
log(`  ✓ protect.js       ${kb(protectSrc)} → ${kb(protectOut)}`);

// ── 2. Bundle + obfuscate main JS ──────────────────────
// Urutan load sesuai index.html (dependencies dulu, app.js terakhir)
const JS_ORDER = [
  'utils.js', 'api.js', 'auth.js', 'users.js', 'cvs.js',
  'history.js', 'settings.js', 'payments.js', 'tasks.js',
  'dashboard.js', 'tickets.js', 'app.js',
];
const jsDir   = path.join(SRC, 'js');
const bundled = JS_ORDER.map(f => fs.readFileSync(path.join(jsDir, f), 'utf8')).join('\n;\n');
const bundleOut = JavaScriptObfuscator.obfuscate(bundled, BUNDLE_OPT).getObfuscatedCode();
fs.writeFileSync(path.join(DIST, 'js', 'bundle.js'), bundleOut, 'utf8');
log(`  ✓ bundle.js        ${kb(bundled)} → ${kb(bundleOut)}  (${JS_ORDER.length} files)`);

// ── 3. Minify CSS ──────────────────────────────────────
const cssSrc = fs.readFileSync(path.join(SRC, 'style.css'), 'utf8');
const cssOut  = new CleanCSS({ level: 2 }).minify(cssSrc).styles;
fs.writeFileSync(path.join(DIST, 'style.css'), cssOut, 'utf8');
log(`  ✓ style.css        ${kb(cssSrc)} → ${kb(cssOut)}`);

// ── 4. Minify HTML (thay thế script tags → bundle) ────
const htmlSrc = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');

// Xóa tất cả <script src="/static/js/..."> trừ protect.js
// và thêm bundle.js vào cuối body
const htmlPatched = htmlSrc
  // Xóa các script tag cũ (các file JS riêng lẻ, trừ protect.js)
  .replace(
    /[ \t]*<script src="\/static\/js\/(?!protect\.js)[^"]+"><\/script>\n?/g,
    ''
  )
  // Thêm bundle.js trước </body>
  .replace(
    '</body>',
    '<script src="/static/js/bundle.js"></script>\n</body>'
  );

minifyHtml(htmlPatched, {
  collapseWhitespace: true,
  removeComments: true,
  removeRedundantAttributes: true,
  removeScriptTypeAttributes: true,
  removeStyleLinkTypeAttributes: true,
  minifyCSS: true,
  minifyJS: true,
  useShortDoctype: true,
}).then(function (htmlOut) {
  fs.writeFileSync(path.join(DIST, 'index.html'), htmlOut, 'utf8');
  log(`  ✓ index.html       ${kb(htmlSrc)} → ${kb(htmlOut)}`);

  // Copy extra static assets (favicon, …)
  const EXTRA = ['favicon.svg'];
  for (const f of EXTRA) {
    const src = path.join(SRC, f);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(DIST, f));
      log(`  ✓ ${f}              ${kb(fs.readFileSync(src))}`);
    }
  }

  log('\n✅  Build hoàn tất → taskflow/static_prod/');
  log('   Khởi động lại server để áp dụng.\n');
}).catch(function (err) {
  console.error('HTML minify error:', err);
  process.exit(1);
});
