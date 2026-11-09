/**
 * 云服务客户端（唯一实例）。
 * 配置来自 workbuddy_cloud_service 返回的 publicConfig，前端只持有公开值。
 *
 * 采用惰性初始化：小程序运行时才创建客户端，因此本模块在 Node 等无 wx 环境下
 * 也能被安全 require（便于本地脚本自测）。
 */

const { createMiniProgramWorkBuddyCloud } = require('@tencent-ai/workbuddy-cloud-sdk/miniprogram');
const { createDiagnosticWx } = require('./workbuddy-cloud-diagnostics');

const PUBLIC_CONFIG = {
    endpoint: 'https://mp-api.app.workbuddy.host',
    publishableKey: 'wbpk_va5fLh2P6q1EkjTz693VC8_h6BrhYdG0s2N72hkx3CEGDKeedEpSmaZ',
    workBuddyOAuthClientId: 'cb_jq6QyEPkOkJXPcpz0JxS_wbapp_va5fLh2P6q1EkjTz693VC8',
};

let instance = null;

function getCloud() {
    if (instance) return instance;
    instance = createMiniProgramWorkBuddyCloud({
        endpoint: PUBLIC_CONFIG.endpoint,
        publishableKey: PUBLIC_CONFIG.publishableKey,
        workBuddyOAuthClientId: PUBLIC_CONFIG.workBuddyOAuthClientId,
        wx: createDiagnosticWx(wx),
    });
    return instance;
}

// 惰性代理：任何属性访问都在首次使用时才真正初始化客户端
const cloud = new Proxy({}, {
    get(_target, prop) {
        return getCloud()[prop];
    },
});

module.exports = { cloud, getCloud, PUBLIC_CONFIG };
