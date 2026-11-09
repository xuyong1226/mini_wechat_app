const ROUTE_INDEX = {
    'pages/index/index': 0,
    'pages/search/search': 1,
    'pages/todo/todo': 2,
    'pages/report/report': 3,
    'pages/profile/profile': 4,
};

function currentIndex() {
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
    if (!pages.length) return null;
    const route = pages[pages.length - 1].route || '';
    const index = ROUTE_INDEX[route];
    return typeof index === 'number' ? index : null;
}

Component({
    data: {
        selected: 0,
        list: [
            { pagePath: '/pages/index/index', text: '记录' },
            { pagePath: '/pages/search/search', text: '检索' },
            { pagePath: '/pages/todo/todo', text: '待办' },
            { pagePath: '/pages/report/report', text: '总结' },
            { pagePath: '/pages/profile/profile', text: '我的' },
        ],
    },

    lifetimes: {
        attached() {
            const index = currentIndex();
            if (index !== null) this.setData({ selected: index });
        },
    },

    pageLifetimes: {
        show() {
            const index = currentIndex();
            if (index !== null && index !== this.data.selected) {
                this.setData({ selected: index });
            }
        },
    },

    methods: {
        onTap(event) {
            const path = event.currentTarget.dataset.path;
            const index = Number(event.currentTarget.dataset.index);
            if (index === this.data.selected) return;
            this.setData({ selected: index });
            wx.switchTab({ url: path });
        },
    },
});
