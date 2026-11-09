/**
 * 大模型接入层：模型列表 + 流式对话收集。
 * 只用公开的 SDK 方法，不自行拼接 /.cloud/llm/** 路径。
 */

const { cloud } = require('./cloud');

let cachedModel = null;
let modelListCache = null;
// 优先选用支持结构化输出、非纯推理的模型；按此顺序回退
const PREFERRED_MODEL_IDS = [
    'hunyuan-chat',
    'deepseek-v4.1-flash',
    'glm-4.7',
    'default',
];

/** 拉取模型列表。SDK 直接返回数组；同时兼容 {data:[...]} 形态，避免误判为空列表。 */
async function listModels() {
    if (modelListCache) return modelListCache;
    const result = await cloud.llm.models.list();
    if (result && !Array.isArray(result) && result.error) {
        throw new Error(result.error.message || '获取模型列表失败');
    }
    const models = Array.isArray(result)
        ? result
        : (result && Array.isArray(result.data) ? result.data : []);
    modelListCache = models;
    return models;
}

function pickModel(models) {
    const usable = models.filter(function (m) {
        return m && m.disabled !== true && m.enabled !== false;
    });
    if (!usable.length) return null;

    for (let i = 0; i < PREFERRED_MODEL_IDS.length; i += 1) {
        const hit = usable.find(function (m) { return m.id === PREFERRED_MODEL_IDS[i]; });
        if (hit) return hit;
    }
    // 退而求其次：选非纯推理、且支持工具调用/结构化输出的普通对话模型
    const general = usable.find(function (m) {
        return m.onlyReasoning !== true && m.supportsToolCall !== false && !/image|video/i.test(m.id);
    });
    if (general) return general;
    return usable[0];
}

async function resolveModel() {
    if (cachedModel) return cachedModel;
    const models = await listModels();
    const model = pickModel(models);
    if (!model) {
        throw new Error('当前没有可用的模型');
    }
    cachedModel = model;
    return cachedModel;
}

/**
 * 单轮调用，收集完整文本。
 * @param {Array} messages 必须以 system 开头
 * @param {object} [opts] { json:boolean, temperature }
 * @returns {Promise<string>}
 */
async function complete(messages, opts) {
    const options = opts || {};
    const model = await resolveModel();
    const payload = {
        model: model.id,
        messages: messages,
        stream: true,
    };
    if (options.json) payload.response_format = { type: 'json_object' };
    if (typeof options.temperature === 'number') payload.temperature = options.temperature;

    let content = '';
    for await (const chunk of cloud.llm.chat.completions.create(payload)) {
        const delta = chunk.choices && chunk.choices[0] ? chunk.choices[0].delta : null;
        if (delta && delta.content) content += delta.content;
    }
    return content;
}

/** 解析 JSON 输出，失败时回退 */
function parseJson(text, fallback) {
    if (!text) return fallback;
    let raw = String(text).trim();
    const fence = raw.indexOf('```');
    if (fence === 0) {
        raw = raw.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
    }
    try {
        return JSON.parse(raw);
    } catch (error) {
        const start = raw.indexOf('{');
        const end = raw.lastIndexOf('}');
        if (start !== -1 && end > start) {
            try {
                return JSON.parse(raw.slice(start, end + 1));
            } catch (err) {
                return fallback;
            }
        }
        return fallback;
    }
}

/** 把错误转成用户可读文案 */
function describeError(error) {
    if (!error) return '调用失败，请重试';
    const code = error.code || (error.error && error.error.code) || '';
    const message = error.message || (error.error && error.error.message) || '';
    if (code.indexOf('quota_') === 0) return '模型额度不足，请稍后再试';
    if (code.indexOf('auth_') === 0) return '当前环境无法调用模型，请检查云服务配置';
    if (code.indexOf('gateway_') === 0 || code.indexOf('model_') === 0) return '模型服务暂时不可用，请重试';
    if (code.indexOf('request_') === 0) return '请求参数不被模型服务接受';
    return message || '调用失败，请重试';
}

module.exports = {
    listModels: listModels,
    resolveModel: resolveModel,
    complete: complete,
    parseJson: parseJson,
    describeError: describeError,
};
