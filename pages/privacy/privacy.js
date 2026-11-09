Page({
    data: {},

    onLoad(options) {
        const doc = options && options.doc;
        if (doc !== 'terms' && doc !== 'privacy') return;
        // 页面自然滚动后，用 selector 定位到对应篇目
        setTimeout(function () {
            wx.pageScrollTo({
                selector: '#' + doc,
                duration: 0,
            });
        }, 120);
    },
});
