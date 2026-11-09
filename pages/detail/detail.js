const store = require('../../utils/store');
const aiService = require('../../utils/ai-service');
const guard = require('../../utils/auth-guard');

const CATEGORY_NAMES = {
    client: '客户商务',
    logistics: '物流调度',
    finance: '财务结算',
    task: '行动待办',
    material: '资料参考',
    study: '学习成长',
    idea: '想法灵感',
    life: '生活健康',
    general: '综合',
};

Page({
    data: {
        viewState: 'loading',
        errorMessage: '',
        entry: null,
        related: [],
        todos: [],
    },

    onLoad(options) {
        this.entryId = options.id;
        this.restore();
    },

    async restore() {
        this.setData({ viewState: 'loading', errorMessage: '' });
        // 详情页同样需要登录门禁：未登录不读数据，避免展示误导性的「记录不存在」
        const session = await getApp().ensureSession();
        if (!session) {
            getApp().resetSession();
            this.setData({ viewState: 'error', errorMessage: '请先登录后查看' });
            guard.goLogin();
            return;
        }
        const listResult = await store.entries.list();
        if (listResult.error) {
            this.setData({
                viewState: 'error',
                errorMessage: listResult.error.message || '读取失败',
            });
            return;
        }
        const all = listResult.data || [];
        let entry = null;
        for (let i = 0; i < all.length; i += 1) {
            if (String(all[i].id) === String(this.entryId)) {
                entry = all[i];
                break;
            }
        }
        if (!entry) {
            this.setData({ viewState: 'error', errorMessage: '这条记录不存在或已被删除' });
            return;
        }

        const others = all.filter(function (e) { return String(e.id) !== String(entry.id); });
        const rel = await aiService.relateEntries(entry, others);
        const byId = {};
        for (let i = 0; i < all.length; i += 1) byId[String(all[i].id)] = all[i];

        const related = rel.map(function (r) {
            const e = byId[String(r.id)];
            if (!e) return null;
            return {
                id: e.id,
                title: e.title || aiService.summarize(e.content, 24),
                preview: (e.summary || e.content || '').substr(0, 50),
                reasons: r.reasons || [],
            };
        }).filter(Boolean);

        const todos = (entry.todoItems || []).map(function (t, i) {
            return { index: i, title: t.title, priority: t.priority, due: t.due };
        });

        this.setData({
            viewState: 'ready',
            entry: Object.assign({}, entry, {
                categoryName: CATEGORY_NAMES[entry.category] || '综合',
                typeText: entry.type === 'idea' ? '想法' : (entry.type === 'material' ? '资料' : '待办'),
                timeText: formatTime(entry.createdAt),
            }),
            related: related,
            todos: todos,
        });
    },

    onRelatedTap(event) {
        const id = event.currentTarget.dataset.id;
        wx.redirectTo({ url: '/pages/detail/detail?id=' + id });
    },

    async onDelete() {
        const confirm = await new Promise(function (resolve) {
            wx.showModal({
                title: '删除记录',
                content: '删除后不可恢复，关联的待办也会一并移除',
                success: function (res) { resolve(res.confirm); },
                fail: function () { resolve(false); },
            });
        });
        if (!confirm) return;

        const entry = this.data.entry;
        const result = await store.entries.remove(entry.id);
        if (result.error) {
            wx.showToast({ title: result.error.message || '删除失败', icon: 'none' });
            return;
        }

        // 同步删除来源待办
        const todoResult = await store.todos.list();
        if (!todoResult.error) {
            const related = (todoResult.data || []).filter(function (t) {
                return String(t.sourceEntryId) === String(entry.id);
            });
            for (let i = 0; i < related.length; i += 1) {
                await store.todos.remove(related[i].id);
            }
        }

        wx.showToast({ title: '已删除', icon: 'success' });
        setTimeout(function () {
            wx.navigateBack({ fail: function () { wx.switchTab({ url: '/pages/index/index' }); } });
        }, 600);
    },

    onRetry() {
        this.restore();
    },
});

function formatTime(ms) {
    const d = new Date(ms);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' '
        + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function pad(n) {
    return n < 10 ? '0' + n : String(n);
}
