/**
 * 消息中心：从已有数据派生通知，不另建云端表。
 *
 * 通知来源：
 *   - 待办提醒：未完成待办且带截止日期 → 归类「待办」
 *   - 记录动态：最近写入的记录 → 归类「记录」
 *   - 系统通知：本地常量（引擎、隐私协议变更等）→ 归类「系统」
 *
 * 已读状态存在本地 storage（按用户隔离键），清空全部只是本地标记，不删业务数据。
 * 本模块不抛异常：任何一步失败都退化成空列表，不影响页面渲染。
 */

const STORE_KEY = 'keeper_notice_state_v1';

const CATEGORY_ALL = 'all';
const CATEGORY_SYSTEM = 'system';
const CATEGORY_ENTRY = 'entry';
const CATEGORY_TODO = 'todo';

const CATEGORY_LABEL = {
    system: '系统通知',
    entry: '记录动态',
    todo: '待办提醒',
};

const CATEGORY_ICON = {
    system: 'shield',
    entry: 'check-circle',
    todo: 'alert-circle',
};

const MAX_ITEMS = 30;

function pad(n) {
    return n < 10 ? '0' + n : String(n);
}

/** 时间戳 -> "11.06 15:02"；跨年则补年份 */
function formatTime(ms) {
    const d = new Date(ms);
    if (!Number.isFinite(d.getTime())) return '';
    const stamp = pad(d.getMonth() + 1) + '.' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    return d.getFullYear() === new Date().getFullYear()
        ? stamp
        : d.getFullYear() + '.' + stamp;
}

/** 只显示月日，作为列表右侧的紧凑时间 */
function formatShort(ms) {
    const d = new Date(ms);
    if (!Number.isFinite(d.getTime())) return '';
    if (d.getFullYear() === new Date().getFullYear()) return pad(d.getMonth() + 1) + '.' + pad(d.getDate());
    return String(d.getFullYear()).slice(2) + '.' + pad(d.getMonth() + 1) + '.' + pad(d.getDate());
}

/** 读本地已读状态；结构 { read: {id:true}, cleared: timestamp, enabled: bool } */
function readState() {
    try {
        const raw = wx.getStorageSync(STORE_KEY);
        if (!raw || typeof raw !== 'object') return { read: {}, cleared: 0, enabled: true };
        return {
            read: (raw.read && typeof raw.read === 'object') ? raw.read : {},
            cleared: Number(raw.cleared) || 0,
            enabled: raw.enabled === false ? false : true,
        };
    } catch (error) {
        return { read: {}, cleared: 0, enabled: true };
    }
}

function writeState(state) {
    try {
        wx.setStorageSync(STORE_KEY, state);
    } catch (error) {
        // 存储失败不影响功能，只是已读状态不保留
    }
}

/** 通知 id：同一来源同一对象固定同一个 id，重算后仍能对上已读标记 */
function idOf(kind, key) {
    return kind + ':' + key;
}

/** 系统通知：固定文案，跟随当前时间生成一次 */
function systemNotices(now) {
    return [
        {
            id: idOf('system', 'engine'),
            category: CATEGORY_SYSTEM,
            title: '智能引擎已就绪',
            body: '分类、摘要、问答与阶段总结优先走大模型，不可用时自动回落本地规则引擎。',
            time: now,
        },
        {
            id: idOf('system', 'privacy'),
            category: CATEGORY_SYSTEM,
            title: '隐私协议已更新',
            body: '用户协议与隐私政策全文可在「设置 → 隐私协议」查看。',
            time: now,
        },
    ];
}

/** 待办提醒：未完成且带截止日期的待办 */
function todoNotices(todos, now) {
    const list = (todos || []).filter(function (t) {
        return t && t.status !== 'done' && t.due;
    });
    list.sort(function (a, b) {
        return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
    });
    return list.slice(0, 10).map(function (t) {
        return {
            id: idOf('todo', t.id),
            category: CATEGORY_TODO,
            title: '「' + (t.title || '未命名待办') + '」已到截止时间',
            body: '待办 · ' + t.due + ' 到期，记得闭环。',
            time: t.updatedAt || t.createdAt || now,
            refId: t.id,
        };
    });
}

/** 记录动态：最近写入的记录 */
function entryNotices(entries, now) {
    const list = (entries || []).slice(0, 10).map(function (e) {
        const label = e.type === 'material' ? '资料' : (e.type === 'todo' ? '待办' : '想法');
        const name = e.title || (e.content || '').slice(0, 18) || '未命名记录';
        return {
            id: idOf('entry', e.id),
            category: CATEGORY_ENTRY,
            title: '「' + name + '」已归档',
            body: label + ' · ' + (e.category || 'general') + '，已自动归类并抽取重点。',
            time: e.createdAt || now,
            refId: e.id,
        };
    });
    list.sort(function (a, b) { return b.time - a.time; });
    return list;
}

/**
 * 组装完整通知列表。
 * @param {object} data { entries: [], todos: [] }
 * @param {object} state 本地已读状态
 * @returns {Array} 每项含 category/categoryLabel/icon/read
 */
function build(data, state) {
    const now = Date.now();
    const source = data || {};
    const merged = []
        .concat(systemNotices(now))
        .concat(todoNotices(source.todos, now))
        .concat(entryNotices(source.entries, now));

    const cleared = state.cleared || 0;
    const read = state.read || {};
    const rows = [];
    for (let i = 0; i < merged.length; i += 1) {
        const item = merged[i];
        if (cleared && item.time <= cleared) continue;
        rows.push(Object.assign({}, item, {
            categoryLabel: CATEGORY_LABEL[item.category] || '通知',
            icon: CATEGORY_ICON[item.category] || CATEGORY_ICON.system,
            read: !!read[item.id],
            timeText: formatTime(item.time),
            shortTime: formatShort(item.time),
        }));
    }
    rows.sort(function (a, b) { return b.time - a.time; });
    return rows.slice(0, MAX_ITEMS);
}

/** 按分类筛选；category=all 时不过滤 */
function filter(list, category) {
    if (!category || category === CATEGORY_ALL) return list || [];
    return (list || []).filter(function (item) { return item.category === category; });
}

/** 未读条数（未读红点用） */
function unreadCount(list) {
    let n = 0;
    for (let i = 0; i < (list || []).length; i += 1) {
        if (!(list || [])[i].read) n += 1;
    }
    return n;
}

/** 全部标记已读 */
function markAllRead(list) {
    const state = readState();
    const rows = list || [];
    for (let i = 0; i < rows.length; i += 1) {
        state.read[rows[i].id] = true;
    }
    writeState(state);
    return state;
}

/** 单条标记已读 */
function markRead(id) {
    if (!id) return readState();
    const state = readState();
    state.read[id] = true;
    writeState(state);
    return state;
}

/**
 * 清空全部：把当前列表时间点之前的通知标记为已清空。
 * 之后新产生的通知（时间更大）仍会显示。
 */
function clearAll(list) {
    const state = readState();
    const rows = list || [];
    let latest = state.cleared || 0;
    for (let i = 0; i < rows.length; i += 1) {
        if (rows[i].time > latest) latest = rows[i].time;
    }
    state.cleared = latest;
    writeState(state);
    return state;
}

/** 是否接收通知（设置页开关） */
function isEnabled() {
    return readState().enabled;
}

/** 开关通知接收；关掉时未读红点不再提示 */
function setEnabled(enabled) {
    const state = readState();
    state.enabled = !!enabled;
    writeState(state);
    return state.enabled;
}

module.exports = {
    STORE_KEY: STORE_KEY,
    CATEGORY_ALL: CATEGORY_ALL,
    CATEGORY_SYSTEM: CATEGORY_SYSTEM,
    CATEGORY_ENTRY: CATEGORY_ENTRY,
    CATEGORY_TODO: CATEGORY_TODO,
    CATEGORY_LABEL: CATEGORY_LABEL,
    CATEGORY_ICON: CATEGORY_ICON,
    formatTime: formatTime,
    formatShort: formatShort,
    readState: readState,
    build: build,
    filter: filter,
    unreadCount: unreadCount,
    markRead: markRead,
    markAllRead: markAllRead,
    clearAll: clearAll,
    isEnabled: isEnabled,
    setEnabled: setEnabled,
};
