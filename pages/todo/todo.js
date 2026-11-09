const store = require('../../utils/store');
const guard = require('../../utils/auth-guard');

const PRIORITY_TEXT = { high: '高', normal: '普通', low: '低' };
const PRIORITY_RANK = { high: 0, normal: 1, low: 2 };

const HEAD_DATE = (function () {
    const d = new Date();
    const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
    return (d.getMonth() + 1) + '.' + (d.getDate() < 10 ? '0' : '') + d.getDate() + '　周' + week;
})();

Page({
    data: {
        headDate: HEAD_DATE,
        authState: 'checking',
        viewState: 'ready',
        errorMessage: '',
        openTodos: [],
        doneTodos: [],
        total: 0,
        showDone: false,
    },

    onLoad() {
        this.restore();
    },

    onShow() {
        if (typeof this.getTabBar === 'function' && this.getTabBar()) {
            this.getTabBar().setData({ selected: 2 });
        }
        if (guard.consumeSucceeded()) {
            getApp().resetSession();
            this.restore();
        }
        if (this.data.authState === 'signed-in') {
            this.loadTodos();
        }
    },

    async restore() {
        this.setData({ viewState: 'loading' });
        const session = await getApp().ensureSession();
        if (!session) {
            getApp().resetSession();
            this.setData({ authState: 'signed-out', viewState: 'ready' });
            guard.goLogin();
            return;
        }
        this.setData({ authState: 'signed-in' });
        await this.loadTodos();
    },

    async loadTodos() {
        this.setData({ viewState: 'loading', errorMessage: '' });
        const result = await store.todos.list();
        if (result.error) {
            this.setData({
                viewState: 'error',
                errorMessage: result.error.message || '读取待办失败',
            });
            return;
        }
        const all = result.data || [];
        const sorted = all.slice().sort(function (a, b) {
            if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
            const pa = PRIORITY_RANK[a.priority] === undefined ? 1 : PRIORITY_RANK[a.priority];
            const pb = PRIORITY_RANK[b.priority] === undefined ? 1 : PRIORITY_RANK[b.priority];
            if (pa !== pb) return pa - pb;
            return (b.createdAt || 0) - (a.createdAt || 0);
        });

        const open = [];
        const done = [];
        for (let i = 0; i < sorted.length; i += 1) {
            const t = sorted[i];
            const item = {
                id: t.id,
                title: t.title,
                priority: t.priority,
                priorityText: PRIORITY_TEXT[t.priority] || '普通',
                priorityClass: 'todo-priority-' + (t.priority || 'normal'),
                due: t.due,
                status: t.status,
                sourceEntryId: t.sourceEntryId,
            };
            if (t.status === 'done') done.push(item);
            else open.push(item);
        }

        this.setData({
            viewState: 'ready',
            openTodos: open,
            doneTodos: done,
            total: all.length,
        });
    },

    /** 只有左侧方框（.todo-check-hit）的 catchtap 会派发到这里；整行不绑定任何 tap */
    async onToggle(event) {
        // 实例锁，不进 data（避免把渲染无关的变量塞进 setData）；连续点击只处理第一次
        if (this.toggling) return;
        this.toggling = true;
        try {
            const id = event.currentTarget.dataset.id;
            const status = event.currentTarget.dataset.status === 'done' ? 'open' : 'done';
            const result = await store.todos.update(id, { status: status, updatedAt: Date.now() });
            if (result.error) {
                wx.showToast({ title: result.error.message || '更新失败', icon: 'none' });
                return;
            }
            await this.loadTodos();
        } finally {
            this.toggling = false;
        }
    },

    async onDelete(event) {
        const id = event.currentTarget.dataset.id;
        const confirm = await new Promise(function (resolve) {
            wx.showModal({
                title: '删除待办',
                content: '删除后不可恢复',
                success: function (res) { resolve(res.confirm); },
                fail: function () { resolve(false); },
            });
        });
        if (!confirm) return;

        const result = await store.todos.remove(id);
        if (result.error) {
            wx.showToast({ title: result.error.message || '删除失败', icon: 'none' });
            return;
        }
        wx.showToast({ title: '已删除', icon: 'success' });
        await this.loadTodos();
    },

    onToggleShowDone() {
        this.setData({ showDone: !this.data.showDone });
    },

    onSourceTap(event) {
        const id = event.currentTarget.dataset.id;
        wx.navigateTo({ url: '/pages/detail/detail?id=' + id });
    },

    onRetry() {
        this.restore();
    },

    onGoLogin() {
        guard.goLogin();
    },
});
