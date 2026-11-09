// 消息中心（SCREEN 11 / 11b）：通知由既有业务数据派生，不另建云端表。
// 复用 utils/notifications.js 的已读/清空状态；清空走墨黑二次确认条防误删。

const store = require('../../utils/store');
const guard = require('../../utils/auth-guard');
const notifications = require('../../utils/notifications');

const FILTERS = [
    { key: notifications.CATEGORY_ALL, label: '全部' },
    { key: notifications.CATEGORY_SYSTEM, label: '系统' },
    { key: notifications.CATEGORY_ENTRY, label: '记录' },
    { key: notifications.CATEGORY_TODO, label: '待办' },
];

Page({
    data: {
        filters: FILTERS,
        active: notifications.CATEGORY_ALL,
        list: [],
        total: 0,
        unread: 0,
        showClear: false,
    },

    onLoad() {
        this.restore();
    },

    onShow() {
        // 从设置页返回 / 切回本页时刷新未读状态
        if (this.loaded) this.refresh();
    },

    async restore() {
        const session = await getApp().ensureSession();
        if (!session) {
            getApp().resetSession();
            guard.goLogin();
            return;
        }
        this.loaded = true;
        await this.refresh();
    },

    /** 重新从 entries / todos 派生通知，并套用本地已读与清空状态 */
    async refresh() {
        const [entryResult, todoResult] = await Promise.all([
            store.entries.list(),
            store.todos.list(),
        ]);
        const all = notifications.build({
            entries: entryResult.error ? [] : (entryResult.data || []),
            todos: todoResult.error ? [] : (todoResult.data || []),
        }, notifications.readState());
        this.all = all;
        this.setData({
            total: all.length,
            unread: notifications.unreadCount(all),
            list: notifications.filter(all, this.data.active),
        });
    },

    onFilter(event) {
        const key = event.currentTarget.dataset.key;
        if (!key || key === this.data.active) return;
        this.setData({
            active: key,
            list: notifications.filter(this.all || [], key),
        });
    },

    /** 点一条即标记已读 */
    onTapItem(event) {
        const id = event.currentTarget.dataset.id;
        if (!id) return;
        notifications.markRead(id);
        this.refresh();
    },

    /** 右上角刷子：一键已读 */
    onMarkAll() {
        notifications.markAllRead(this.all || []);
        this.refresh();
        wx.showToast({ title: '已全部标为已读', icon: 'none' });
    },

    onAskClear() {
        this.setData({ showClear: true });
    },

    onCancelClear() {
        this.setData({ showClear: false });
    },

    /** 确认清空：只写本地清空时间点，不动业务数据 */
    onConfirmClear() {
        notifications.clearAll(this.all || []);
        this.setData({ showClear: false });
        this.refresh();
        wx.showToast({ title: '通知已清空', icon: 'none' });
    },
});
