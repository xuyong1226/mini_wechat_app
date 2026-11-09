/**
 * 原生工程结构校验：JSON 严格性、页面文件完整性、tabBar、组件引用、隐私接口扫描。
 * 运行：node scripts/validate.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const problems = [];
const notes = [];

function fail(msg) { problems.push(msg); }
function note(msg) { notes.push(msg); }

function readJson(rel) {
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) {
        fail('缺少文件：' + rel);
        return null;
    }
    const raw = fs.readFileSync(file, 'utf8');
    // 严格 JSON：不允许注释与尾逗号
    if (/^\s*\/\//m.test(raw) || /,\s*[}\]]/.test(raw)) {
        fail('JSON 含注释或尾逗号：' + rel);
    }
    try {
        return JSON.parse(raw);
    } catch (error) {
        fail('JSON 解析失败：' + rel + ' -> ' + error.message);
        return null;
    }
}

// --- 遍历所有 json ---
function walk(dir, out) {
    const files = fs.readdirSync(dir);
    for (const f of files) {
        if (f === 'node_modules' || f === 'miniprogram_npm' || f === '.git') continue;
        const full = path.join(dir, f);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) walk(full, out);
        else if (f.endsWith('.json')) out.push(path.relative(ROOT, full).split(path.sep).join('/'));
    }
    return out;
}

const jsonFiles = walk(ROOT, []);
note('JSON 文件数：' + jsonFiles.length);
for (const rel of jsonFiles) readJson(rel);

// --- app.json ---
const appJson = readJson('app.json');
if (appJson) {
    if (!Array.isArray(appJson.pages) || appJson.pages.length === 0) {
        fail('app.json.pages 不能为空');
    }
    if (appJson.lazyCodeLoading !== 'requiredComponents') {
        fail('app.json 缺少 lazyCodeLoading: requiredComponents');
    }
    if (appJson.tabBar) {
        for (const item of appJson.tabBar.list || []) {
            if (!appJson.pages.includes(item.pagePath)) {
                fail('tabBar.pagePath 未在 pages 中声明：' + item.pagePath);
            }
            if (item.iconPath && !fs.existsSync(path.join(ROOT, item.iconPath))) {
                fail('tabBar 图标不存在：' + item.iconPath);
            }
        }
    }

    // 页面文件完整性 + 组件引用
    for (const page of appJson.pages || []) {
        for (const ext of ['.js', '.wxml', '.json']) {
            const p = path.join(ROOT, page + ext);
            if (!fs.existsSync(p)) fail('页面文件缺失：' + page + ext);
        }
        const pageJson = readJson(page + '.json');
        if (!pageJson) continue;
        for (const key in pageJson.usingComponents || {}) {
            const rel = pageJson.usingComponents[key];
            if (!rel) continue;
            const base = path.resolve(path.dirname(path.join(ROOT, page + '.json')), rel);
            const candidates = [base, base + '.js', base + '.json', base + '.wxml'];
            if (!candidates.some(function (p) { return fs.existsSync(p); })) {
                fail('组件引用不存在：' + page + ' -> ' + rel);
            }
        }
    }
}

// --- project.config.json ---
const pc = readJson('project.config.json');
if (pc) {
    if (!pc.miniprogramRoot) fail('project.config.json 缺少 miniprogramRoot');
    else if (!fs.existsSync(path.join(ROOT, pc.miniprogramRoot, 'app.json'))) {
        fail('miniprogramRoot 下找不到 app.json');
    }
    if (!pc.compileType || pc.compileType !== 'miniprogram') {
        fail('compileType 应为 miniprogram');
    }
}

// --- 页面里不能出现浏览器 API ---
const banned = [
    ['document.', '浏览器 DOM API'],
    ['window.', '浏览器全局对象'],
    ['localStorage', '浏览器存储'],
    ['fetch(', '浏览器 fetch'],
];
const jsFiles = [];
function walkJs(dir) {
    for (const f of fs.readdirSync(dir)) {
        if (f === 'node_modules' || f === 'miniprogram_npm' || f === '.git' || f === 'scripts') continue;
        const full = path.join(dir, f);
        if (fs.statSync(full).isDirectory()) walkJs(full);
        else if (f.endsWith('.js')) jsFiles.push(full);
    }
}
walkJs(ROOT);
for (const file of jsFiles) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    const src = fs.readFileSync(file, 'utf8');
    for (const [token, label] of banned) {
        if (src.indexOf(token) !== -1) fail(rel + ' 使用了' + label + '：' + token);
    }
    // 严格模式下对象字面量多余逗号等由小程序编译器负责，这里只查明显语法错误
    try {
        new Function(src);
    } catch (error) {
        fail(rel + ' 语法错误：' + error.message);
    }
}

// --- 隐私接口扫描 ---
const PRIVACY_APIS = [
    ['wx.getLocation', 'Location'], ['wx.getFuzzyLocation', 'Location'],
    ['wx.startLocationUpdate', 'Location'], ['wx.chooseLocation', 'ChooseLocation'],
    ['wx.choosePoi', 'ChooseLocation'], ['wx.chooseAddress', 'Address'],
    ['wx.chooseInvoice', 'Invoice'], ['open-type="chooseAvatar"', 'UserInfo'],
    ['type="nickname"', 'UserInfo'], ['open-type="getPhoneNumber"', 'PhoneNumber'],
    ['wx.chooseLicensePlate', 'LicensePlate'], ['wx.getWeRunData', 'RunData'],
    ['wx.chooseImage', 'Album'], ['wx.chooseVideo', 'Album'], ['wx.chooseMedia', 'Album'],
    ['wx.saveImageToPhotosAlbum', 'AlbumWriteOnly'], ['wx.startRecord', 'Record'],
    ['wx.chooseMessageFile', 'MessageFile'], ['wx.setClipboardData', 'Clipboard'],
    ['wx.getClipboardData', 'Clipboard'], ['wx.addPhoneContact', 'Contact'],
    ['wx.addPhoneCalendar', 'CalendarWriteOnly'], ['wx.openBluetoothAdapter', 'BlueTooth'],
    ['wx.startAccelerometer', 'Accelerometer'], ['wx.startCompass', 'Compass'],
    ['wx.startDeviceMotionListening', 'DeviceMotion'], ['wx.startGyroscope', 'Gyroscope'],
];
const privacyHits = new Set();
const allSrc = [];
function collect(dir) {
    for (const f of fs.readdirSync(dir)) {
        if (f === 'node_modules' || f === 'miniprogram_npm' || f === '.git' || f === 'scripts') continue;
        const full = path.join(dir, f);
        if (fs.statSync(full).isDirectory()) collect(full);
        else if (/\.(js|wxml)$/.test(f)) allSrc.push(fs.readFileSync(full, 'utf8'));
    }
}
collect(ROOT);
const joined = allSrc.join('\n');
for (const [token, key] of PRIVACY_APIS) {
    if (joined.indexOf(token) !== -1) privacyHits.add(key);
}

// 邮箱输入 → Email
if (/type="text"[^>]*placeholder="邮箱"/.test(joined) || /邮箱/.test(joined)) {
    privacyHits.add('Email');
}

// 手机号输入 → PhoneNumber（账号标识与备用联系方式都会用到）
if (/手机号|手机/.test(joined)) {
    privacyHits.add('PhoneNumber');
}

const privacyFile = path.join(ROOT, '.wbapp_va5fLh2P6q1EkjTz693VC8.privacy.json');
if (fs.existsSync(privacyFile)) {
    const list = readJson('.wbapp_va5fLh2P6q1EkjTz693VC8.privacy.json');
    if (Array.isArray(list)) {
        const declared = list.map(function (item) { return Object.keys(item)[0]; });
        for (const key of privacyHits) {
            if (declared.indexOf(key) === -1) fail('隐私清单缺少：' + key);
        }
        for (const key of declared) {
            if (privacyHits.size && !privacyHits.has(key)) {
                fail('隐私清单多声明：' + key);
            }
        }
        note('隐私清单已声明：' + (declared.join(', ') || '(空)'));
    } else {
        fail('隐私清单必须是数组');
    }
} else {
    fail('缺少隐私清单 .wbapp_va5fLh2P6q1EkjTz693VC8.privacy.json');
}

// --- 源码内不得出现密钥形态字符串 ---
for (const file of jsFiles) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    const src = fs.readFileSync(file, 'utf8');
    if (/sk-[A-Za-z0-9]{20,}/.test(src)) fail(rel + ' 疑似包含密钥');
}

// --- 权限与健壮性静态基线：防住「归属写进前端」「数据页漏门禁」等低级错误 ---
const DATA_PAGES = [
    'pages/index/index', 'pages/search/search', 'pages/todo/todo',
    'pages/report/report', 'pages/detail/detail', 'pages/profile/profile',
    'pages/account/account', 'pages/bind/bind',
];
const ALLOWED_TABLES = [
    'entries', 'todos', 'user_profile',
    // 统一用户主体三张表：只做归属解析，不存业务数据
    'user_link', 'user_credential', 'user_bind_ticket',
];
const AUTH_METHODS = new Set([
    'getSession', 'getUser', 'signOut', 'onAuthStateChange',
    'handleWorkBuddyMiniProgramCallback', 'signInWithPassword', 'signInWithWechat',
    'sendOtp', 'verifyOtp', 'resetPasswordForEmail', 'resetPasswordForOld',
]);

for (const page of DATA_PAGES) {
    const rel = page + '.js';
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) continue;
    const src = fs.readFileSync(file, 'utf8');
    if (src.indexOf('ensureSession(') === -1) fail('数据页缺少会话门禁：' + rel);
}

for (const file of jsFiles) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    const src = fs.readFileSync(file, 'utf8');
    if (/owner_id\s*:/.test(src)) {
        fail(rel + ' 前端写入 owner_id（归属必须由服务端 auth.uid() 决定）');
    }
    if (/\.eq\(\s*['"]owner_id['"]/.test(src)) {
        fail(rel + ' 前端按 owner_id 过滤（应交给 RLS）');
    }
    if (/service_role|serviceRole/.test(src)) {
        fail(rel + ' 出现 service_role 凭据形态');
    }
    let m;
    const tables = /table:\s*['"]([^'"]+)['"]/g;
    while ((m = tables.exec(src))) {
        if (ALLOWED_TABLES.indexOf(m[1]) === -1) fail(rel + ' 访问了未登记的数据表：' + m[1]);
    }
    // identity.js 走的是 table('x') 形式，单独扫一遍
    const tableCalls = /\btable\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((m = tableCalls.exec(src))) {
        if (ALLOWED_TABLES.indexOf(m[1]) === -1) fail(rel + ' 访问了未登记的数据表：' + m[1]);
    }
    // 主体归属只能由服务端函数决定，前端不许自己算 subject_id 的「默认值」
    const authCalls = /\bcloud\.auth\.([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
    while ((m = authCalls.exec(src))) {
        if (!AUTH_METHODS.has(m[1])) fail(rel + ' 调用了未登记的 auth 方法：' + m[1]);
    }
}
note('权限静态基线：' + DATA_PAGES.length + ' 个数据页会话门禁、owner_id 不落前端、表名与 auth 方法白名单');
note('云端 RLS 属服务端配置，本地脚本不覆盖；发布前需按 README 清单核对策略');

// --- 待办完成状态交互：只有左侧方框能切换完成状态 ---
const todoWxmlPath = path.join(ROOT, 'pages', 'todo', 'todo.wxml');
if (fs.existsSync(todoWxmlPath)) {
    const todoWxml = fs.readFileSync(todoWxmlPath, 'utf8');
    const mainTags = todoWxml.match(/<view[^>]*class="todo-main"[^>]*>/g) || [];
    if (mainTags.length !== 2) fail('待办行结构异常：期望 2 个 todo-main，实际 ' + mainTags.length);
    for (const tag of mainTags) {
        if (/\b(?:bind|catch)(?::)?tap\s*=/.test(tag)) {
            fail('待办整行仍绑定 tap（会导致点文字即标记完成）：' + tag.slice(0, 90));
        }
    }
    const hitTags = todoWxml.match(/<view[^>]*class="todo-check-hit"[^>]*>/g) || [];
    if (hitTags.length !== 2) fail('待办方框热区数量异常：期望 2，实际 ' + hitTags.length);
    for (const tag of hitTags) {
        if (!/catchtap="onToggle"/.test(tag)) fail('待办方框缺少 catchtap="onToggle"：' + tag.slice(0, 90));
    }
    if (!/todo-source[^>]*catchtap="onSourceTap"/.test(todoWxml)) fail('待办「来自记录」入口丢失');
    if (!/todo-del[^>]*catchtap="onDelete"/.test(todoWxml)) fail('待办删除入口丢失');
    note('待办交互：整行无 tap、仅方框 catchtap、删除/来源入口保留');
} else {
    fail('缺少 pages/todo/todo.wxml');
}

// --- setData 里不能出现 WXML 未绑定的变量（IDE 会报「存在将未绑定在 WXML 的变量传入 setData」） ---
const BINDING_PAIRS = [
    ['pages/login/login.js', 'pages/login/login.wxml'],
    ['components/login-panel/login-panel.js', 'components/login-panel/login-panel.wxml'],
    ['pages/messages/messages.js', 'pages/messages/messages.wxml'],
    ['pages/settings/settings.js', 'pages/settings/settings.wxml'],
];
for (const [jsRel, wxmlRel] of BINDING_PAIRS) {
    const jsFile = path.join(ROOT, jsRel);
    const wxmlFile = path.join(ROOT, wxmlRel);
    if (!fs.existsSync(jsFile) || !fs.existsSync(wxmlFile)) {
        fail('页面文件缺失：' + jsRel + ' / ' + wxmlRel);
        continue;
    }
    const jsSrc = fs.readFileSync(jsFile, 'utf8');
    const wxmlSrc = fs.readFileSync(wxmlFile, 'utf8');
    const keys = new Set();
    const re = /setData\(\s*\{/g;
    let m;
    while ((m = re.exec(jsSrc))) {
        let i = m.index + m[0].length;
        let depth = 1;
        let body = '';
        while (i < jsSrc.length && depth > 0) {
            const ch = jsSrc[i];
            if (ch === '{') depth += 1;
            else if (ch === '}') depth -= 1;
            if (depth > 0) body += ch;
            i += 1;
        }
        const keyRe = /(?:^|[,{])\s*([A-Za-z_$][\w$]*)\s*:/g;
        let k;
        while ((k = keyRe.exec(body))) keys.add(k[1]);
    }
    for (const key of keys) {
        const bound = wxmlSrc.indexOf('{{' + key) !== -1 ||
            wxmlSrc.indexOf('{{ ' + key) !== -1 ||
            wxmlSrc.indexOf(key + '="{{') !== -1;
        if (!bound) fail(jsRel + ' 把未在 WXML 绑定的变量传进 setData：' + key);
    }
    note('setData 变量绑定：' + jsRel + ' 共 ' + keys.size + ' 个，全部有绑定');
}

console.log('\n校验结果');
for (const n of notes) console.log('  · ' + n);
if (problems.length) {
    console.log('\n问题 ' + problems.length + ' 项：');
    for (const p of problems) console.log('  ✗ ' + p);
    console.log('');
    process.exit(1);
}
console.log('\n✓ 全部通过\n');
