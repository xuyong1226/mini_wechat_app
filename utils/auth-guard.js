/**
 * 登录页拆分后的跳转辅助：
 * 未登录 -> 独立登录页（带来源）-> 登录成功返回原目标页并恢复会话。
 * 仅服务于登录链路，不涉及业务数据处理。
 */

const TAB_PAGES = [
    'pages/index/index',
    'pages/search/search',
    'pages/todo/todo',
    'pages/report/report',
    'pages/profile/profile',
];
const VALID_TARGETS = TAB_PAGES;
const LOGIN_ROUTE = 'pages/login/login';
const DEFAULT_TARGET = 'pages/index/index';

let pendingLogin = false;
let loginSucceeded = false;

function normalizeFrom(route) {
    return VALID_TARGETS.indexOf(route) >= 0 ? route : DEFAULT_TARGET;
}

/** 未登录时进入独立登录页；已在登录页则不重复跳转 */
function goLogin() {
    const pages = getCurrentPages();
    const current = pages.length ? pages[pages.length - 1].route : '';
    if (pendingLogin || current === LOGIN_ROUTE) return;
    pendingLogin = true;
    // reLaunch：清空页面栈，登录页成为唯一页面（未登录不进入主应用）
    wx.reLaunch({
        url: '/' + LOGIN_ROUTE + '?from=' + encodeURIComponent(normalizeFrom(current)),
        complete: function () { pendingLogin = false; },
    });
}

/** 登录成功标记，供目标页 onShow 消费一次 */
function markSucceeded() {
    loginSucceeded = true;
}

function consumeSucceeded() {
    if (!loginSucceeded) return false;
    loginSucceeded = false;
    return true;
}

/** 返回原本的目标页面（目标均为 tab 页，用 switchTab） */
function backToTarget(from) {
    const target = normalizeFrom(from);
    const pages = getCurrentPages();
    const prev = pages.length > 1 ? pages[pages.length - 2] : null;
    if (prev && prev.route === target) {
        wx.navigateBack({
            fail: function () { wx.switchTab({ url: '/' + target }); },
        });
        return;
    }
    wx.switchTab({
        url: '/' + target,
        fail: function () { wx.reLaunch({ url: '/' + target }); },
    });
}

module.exports = {
    TAB_PAGES: TAB_PAGES,
    LOGIN_ROUTE: LOGIN_ROUTE,
    normalizeFrom: normalizeFrom,
    goLogin: goLogin,
    markSucceeded: markSucceeded,
    consumeSucceeded: consumeSucceeded,
    backToTarget: backToTarget,
};
