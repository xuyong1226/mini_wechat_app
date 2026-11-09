/**
 * 编译级校验（不依赖微信开发者工具窗口 / CLI 服务端口）。
 *
 * 直接调用开发者工具自带的官方编译器：
 *   wcc.exe  —— WXML 编译器
 *   wcsc.exe —— WXSS 编译器
 * 再加 JS 语法检查、SDK 产物导出检查、require 链路检查。
 *
 * 用法：node scripts/compile-check.js
 * 可通过环境变量 WECHAT_DEVTOOLS_ROOT 指定开发者工具安装目录。
 *
 * 注意：这是「编译通过」验证，不能替代真机运行验证
 * （登录、数据库读写、大模型调用仍需在微信里实测）。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-compile-check-'));

let pass = 0;
let fail = 0;

function ok(label, extra) {
    pass += 1;
    console.log('  OK   ' + label + (extra ? '  ' + extra : ''));
}
function bad(label, detail) {
    fail += 1;
    console.log('  FAIL ' + label + (detail ? '  ' + detail : ''));
}

function walk(dir, ext, out) {
    for (const name of fs.readdirSync(dir)) {
        if (name === 'node_modules' || name === 'miniprogram_npm' || name === '.git' || name === '.buildcheck') continue;
        const full = path.join(dir, name);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) walk(full, ext, out);
        else if (name.endsWith(ext)) out.push(full);
    }
    return out;
}

function findDevtoolsRoot() {
    if (process.env.WECHAT_DEVTOOLS_ROOT) return process.env.WECHAT_DEVTOOLS_ROOT;
    const candidates = [
        'C:\\Program Files (x86)\\Tencent\\微信web开发者工具',
        'C:\\Program Files\\Tencent\\微信web开发者工具',
        '/Applications/wechatwebdevtools.app/Contents/MacOS',
    ];
    for (const c of candidates) {
        if (fs.existsSync(path.join(c, 'resources', 'app.asar.unpacked', 'node_modules', 'wcc-exec'))) return c;
    }
    return '';
}

function main() {
    const devtools = findDevtoolsRoot();
    const wccDir = devtools
        ? path.join(devtools, 'resources', 'app.asar.unpacked', 'node_modules', 'wcc-exec')
        : '';
    const wcc = path.join(wccDir, process.platform === 'win32' ? 'wcc.exe' : 'wcc');
    const wcsc = path.join(wccDir, process.platform === 'win32' ? 'wcsc.exe' : 'wcsc');

    console.log('编译级校验  ' + ROOT);
    console.log('编译器目录  ' + (wccDir || '(未找到)'));
    console.log('');

    // 1. WXML 全量编译
    console.log('[1/5] WXML 官方编译器');
    const wxmls = walk(ROOT, '.wxml', []);
    if (!fs.existsSync(wcc)) {
        bad('wcc 编译器不可用', wcc);
    } else {
        const outFile = path.join(OUT, 'all-wxml.js');
        const r = spawnSync(wcc, ['-d', '-o', outFile].concat(wxmls.map((f) => path.relative(ROOT, f))), {
            cwd: ROOT, encoding: 'utf8',
        });
        const size = fs.existsSync(outFile) ? fs.statSync(outFile).size : 0;
        if (r.status === 0 && size > 0) ok(wxmls.length + ' 个 WXML 全量编译', size + 'B 产物');
        else bad('WXML 编译', 'rc=' + r.status + ' ' + (r.stderr || '').slice(0, 300));
    }

    // 2. WXSS 逐个编译（wcsc 多文件只取第一个，必须逐个跑）
    console.log('[2/5] WXSS 官方编译器（逐个）');
    const wxsses = walk(ROOT, '.wxss', []);
    if (!fs.existsSync(wcsc)) {
        bad('wcsc 编译器不可用', wcsc);
    } else {
        for (const f of wxsses) {
            const outFile = path.join(OUT, path.basename(f) + '-' + Math.random().toString(36).slice(2, 8) + '.css');
            const r = spawnSync(wcsc, ['-lc', '-o', outFile, path.relative(ROOT, f)], {
                cwd: ROOT, encoding: 'utf8',
            });
            const size = fs.existsSync(outFile) ? fs.statSync(outFile).size : 0;
            const rel = path.relative(ROOT, f);
            if (r.status === 0 && size > 0) ok(rel, size + 'B');
            else bad(rel, 'rc=' + r.status + ' ' + (r.stderr || '').slice(0, 200));
        }
    }

    // 3. JS 语法检查
    console.log('[3/5] JS 语法检查');
    const jses = walk(ROOT, '.js', []);
    for (const f of jses) {
        const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
        if (r.status === 0) ok(path.relative(ROOT, f));
        else bad(path.relative(ROOT, f), (r.stderr || '').split('\n').slice(0, 3).join(' '));
    }

    // 4. SDK 小程序 npm 产物导出检查
    console.log('[4/5] SDK 小程序产物');
    const sdkFile = path.join(ROOT, 'miniprogram_npm', '@tencent-ai', 'workbuddy-cloud-sdk', 'miniprogram.js');
    if (!fs.existsSync(sdkFile)) {
        bad('miniprogram_npm 产物缺失', sdkFile);
    } else {
        try {
            const sdk = require(sdkFile);
            const needed = [
                'createMiniProgramWorkBuddyCloud',
                'ensureMiniProgramPolyfills',
                'createMiniProgramFetch',
                'createMiniProgramStorage',
            ];
            const missing = needed.filter((k) => typeof sdk[k] !== 'function');
            if (missing.length) bad('SDK 导出缺失', missing.join(', '));
            else ok('SDK 导出 ' + Object.keys(sdk).length + ' 项，关键方法齐全', fs.statSync(sdkFile).size + 'B');
        } catch (error) {
            bad('SDK 产物无法加载', error.message);
        }
        const sdkPkg = path.join(path.dirname(sdkFile), 'package.json');
        if (fs.existsSync(sdkPkg)) {
            const pkg = JSON.parse(fs.readFileSync(sdkPkg, 'utf8'));
            if (pkg.type === 'module') bad('SDK 产物 package.json 带 type:module，会导致 require 拿到空对象');
            else ok('SDK 产物 package.json 为 CommonJS 兼容格式');
        }
    }

    // 5. 本地 require 链路（惰性代理不应在加载时崩）
    console.log('[5/5] 云客户端 require 链路');
    try {
        const cloudModule = require(path.join(ROOT, 'utils', 'cloud.js'));
        const keys = Object.keys(cloudModule);
        if (keys.indexOf('cloud') === -1 || keys.indexOf('getCloud') === -1) {
            bad('cloud.js 导出不完整', keys.join(','));
        } else {
            ok('cloud.js 加载成功（惰性初始化）', cloudModule.PUBLIC_CONFIG.endpoint);
        }
    } catch (error) {
        bad('cloud.js 加载失败', error.message);
    }

    try {
        fs.rmSync(OUT, { recursive: true, force: true });
    } catch (_) { /* 临时目录清理失败不影响结论 */ }

    console.log('');
    console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
    if (!devtools) {
        console.log('提示：未找到微信开发者工具，WXML/WXSS 官方编译被跳过。');
        console.log('      可设置 WECHAT_DEVTOOLS_ROOT 指向安装目录后重跑。');
    }
    if (fail) process.exit(1);
}

main();
