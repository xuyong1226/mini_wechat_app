const store = require('../../utils/store');
const aiService = require('../../utils/ai-service');
const guard = require('../../utils/auth-guard');
const profileStore = require('../../utils/profile');

const TYPE_FILTERS = [
    { key: 'all', label: '全部' },
    { key: 'idea', label: '想法' },
    { key: 'material', label: '资料' },
    { key: 'todo', label: '待办' },
];

const HEAD_DATE = (function () {
    const d = new Date();
    const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
    return (d.getMonth() + 1) + '.' + (d.getDate() < 10 ? '0' : '') + d.getDate() + '　周' + week;
})();

Page({
    data: {
        headDate: HEAD_DATE,
        viewState: 'loading',
        errorMessage: '',
        authState: 'checking',
        draft: '',
        composerFocus: false,
        draftType: '',
        saving: false,
        analyzing: false,
        filters: TYPE_FILTERS,
        activeFilter: 'all',
        entries: [],
        dayGroups: [],
        total: 0,
        todayCount: 0,
        showLogin: false,
    },

    onLoad() {
        this.restore();
    },

    onShow() {
        if (typeof this.getTabBar === 'function' && this.getTabBar()) {
            this.getTabBar().setData({ selected: 0 });
        }
        if (guard.consumeSucceeded()) {
            getApp().resetSession();
            this.restore();
        }
        if (this.data.authState === 'signed-in') {
            this.loadEntries();
        }
    },

    async restore() {
        this.setData({ viewState: 'loading', errorMessage: '' });
        const session = await getApp().ensureSession();
        if (!session) {
            getApp().resetSession();
            this.setData({
                authState: 'signed-out',
                viewState: 'ready',
                entries: [],
                dayGroups: [],
                total: 0,
                todayCount: 0,
            });
            guard.goLogin();
            return;
        }
        store.setOwnerName((session.user && session.user.name) || null);
        this.setData({ authState: 'signed-in' });
        // 首次进入时随机分配昵称（幂等，之后复用同一条资料）
        profileStore.ensureProfile();
        await this.loadEntries();
    },

    async loadEntries() {
        this.setData({ viewState: 'loading', errorMessage: '' });
        const result = await store.entries.list();
        if (result.error) {
            this.setData({
                viewState: 'error',
                errorMessage: result.error.message || '读取失败，请重试',
            });
            return;
        }
        const entries = result.data || [];
        this.allEntries = entries;
        const shown = this.filterEntries(entries);
        this.setData({
            viewState: 'ready',
            entries: shown,
            dayGroups: groupByDay(shown),
            total: entries.length,
            todayCount: countToday(entries),
        });
    },

    filterEntries(entries) {
        const filter = this.data.activeFilter;
        const list = filter === 'all'
            ? entries
            : entries.filter(function (e) { return e.type === filter; });
        return list.map(function (e) {
            return Object.assign({}, e, {
                timeText: formatTime(e.createdAt),
                preview: (e.summary || e.content || '').substr(0, 60),
            });
        });
    },

    onFilterTap(event) {
        const key = event.currentTarget.dataset.key;
        this.setData({ activeFilter: key });
        const shown = this.filterEntries(this.allEntries || []);
        this.setData({ entries: shown, dayGroups: groupByDay(shown) });
    },

    onDraftInput(event) {
        this.setData({ draft: event.detail.value });
    },

    onDraftTypeTap(event) {
        const type = event.currentTarget.dataset.type;
        this.setData({ draftType: this.data.draftType === type ? '' : type });
    },

    async onSave() {
        const content = (this.data.draft || '').trim();
        if (!content) {
            wx.showToast({ title: '先写点什么', icon: 'none' });
            return;
        }
        if (this.data.saving) return;

        this.setData({ saving: true, analyzing: true });
        let analysis;
        try {
            analysis = await aiService.analyzeEntry(content, this.data.draftType || undefined);
        } catch (error) {
            analysis = aiService.localAnalyze(content, this.data.draftType || undefined);
        }

        const now = Date.now();
        const title = firstLine(content, 24);
        const payload = {
            type: analysis.type,
            title: title,
            content: content,
            category: analysis.category,
            tags: analysis.tags,
            keywords: analysis.keywords,
            summary: analysis.summary,
            keyPoints: analysis.keyPoints,
            todoItems: analysis.todos,
            relatedIds: [],
            createdAt: now,
            updatedAt: now,
        };

        const result = await store.entries.create(payload);
        this.setData({ saving: false, analyzing: false });
        if (result.error) {
            wx.showToast({ title: result.error.message || '保存失败', icon: 'none' });
            return;
        }

        // 待办条目同步到待办表
        if (payload.type === 'todo' && payload.todoItems.length) {
            await this.syncTodos(result.data.id, payload.todoItems);
        }

        this.setData({ draft: '', draftType: '' });
        wx.showToast({ title: '已保存', icon: 'success' });
        await this.loadEntries();
    },

    async syncTodos(entryId, items) {
        for (let i = 0; i < items.length; i += 1) {
            const item = items[i];
            await store.todos.create({
                title: item.title,
                priority: item.priority || 'normal',
                due: item.due || '',
                status: 'open',
                sourceEntryId: entryId,
                sortOrder: i,
                updatedAt: Date.now(),
            });
        }
    },

    onEntryTap(event) {
        const id = event.currentTarget.dataset.id;
        wx.navigateTo({ url: '/pages/detail/detail?id=' + id });
    },

    onRetry() {
        this.restore();
    },

    /** SCREEN 14 空状态主按钮：回到顶部并聚焦输入框 */
    onEmptyAction() {
        wx.pageScrollTo({ scrollTop: 0, duration: 200 });
        this.setData({ composerFocus: false });
        const self = this;
        setTimeout(function () { self.setData({ composerFocus: true }); }, 220);
    },

    onGoLogin() {
        guard.goLogin();
    },
});

function firstLine(content, max) {
    const line = String(content).split(/\n|\r/)[0].trim();
    return line.length > max ? line.substr(0, max) + '…' : line;
}

function formatTime(ms) {
    const d = new Date(ms);
    const now = new Date();
    const sameDay = d.getFullYear() === now.getFullYear()
        && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    const hm = (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
    if (sameDay) return hm;
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + hm;
}

function dayKey(ms) {
    const d = new Date(ms);
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}

/** 记录流按日期分组：今天 / 昨天 / M月D日，供左侧时间轴渲染 */
function groupByDay(list) {
    const groups = [];
    const map = {};
    const now = Date.now();
    const today = dayKey(now);
    const yesterday = dayKey(now - 86400000);
    for (let i = 0; i < list.length; i += 1) {
        const e = list[i];
        const created = e.createdAt || now;
        const key = dayKey(created);
        if (!map[key]) {
            const d = new Date(created);
            let label = (d.getMonth() + 1) + '月' + d.getDate() + '日';
            let en = 'ARCHIVE';
            if (key === today) { label = '今天'; en = 'TODAY'; }
            else if (key === yesterday) { label = '昨天'; en = 'YESTERDAY'; }
            map[key] = { key: key, label: label, en: en, items: [] };
            groups.push(map[key]);
        }
        map[key].items.push(e);
    }
    return groups;
}

function countToday(entries) {
    const today = dayKey(Date.now());
    return entries.filter(function (e) { return dayKey(e.createdAt || 0) === today; }).length;
}
