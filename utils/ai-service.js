/**
 * 智能服务层：把「本地规则引擎」与「大模型」组合成页面用的能力。
 *
 * 策略：优先用大模型产出高质量结果；模型不可用（未开通/额度/网络）时自动回落到
 * 本地规则引擎，功能不中断。这样小程序在任何环境下都能用。
 */

const ai = require('./ai');
const text = require('./text');
const llm = require('./llm');

const SYSTEM = '你是用户的个人信息管家助手。回答要具体、可执行，不要编造用户没有记录过的信息。';

// ---------------------------------------------------------------------------
// 单条记录分析（分类 / 标签 / 摘要 / 重点 / 待办）
// ---------------------------------------------------------------------------

/**
 * @param {string} content 原始文本
 * @param {string} [hintType] 用户手动指定的类型
 * @returns {Promise<object>}
 */
async function analyzeEntry(content, hintType) {
    const local = localAnalyze(content, hintType);
    if (!content || content.length < 8) return local;

    try {
        const messages = [
            {
                role: 'system',
                content: SYSTEM + '\n你的任务：把用户随手记下的一段文字，整理成结构化条目。'
                    + '只输出 JSON，格式为：'
                    + '{"type":"idea|material|todo","category":"客户商务|物流调度|财务结算|行动待办|资料参考|学习成长|想法灵感|生活健康|综合",'
                    + '"tags":["最多3个标签"],"keywords":["最多6个关键词"],"summary":"不超过60字的摘要",'
                    + '"keyPoints":["最多5条重点，每条不超过30字"],"todos":[{"title":"待办事项","priority":"high|normal|low","due":"截止时间或空字符串"}]}'
                    + '。type 表示条目性质；category 只能是给定枚举之一。',
            },
            {
                role: 'user',
                content: '请整理这段内容：\n' + content,
            },
        ];
        const raw = await llm.complete(messages, { json: true });
        const parsed = llm.parseJson(raw, null);
        if (!parsed || !parsed.type) return local;

        const type = ['idea', 'material', 'todo'].indexOf(parsed.type) !== -1
            ? parsed.type : local.type;
        const category = text.CATEGORY_LIST.indexOf(parsed.category) !== -1
            ? parsed.category : local.category;
        const tags = Array.isArray(parsed.tags) ? parsed.tags.slice(0, 5) : local.tags;
        const keywords = Array.isArray(parsed.keywords) && parsed.keywords.length
            ? parsed.keywords.slice(0, 8) : local.keywords;
        const summary = typeof parsed.summary === 'string' && parsed.summary.trim()
            ? parsed.summary.trim() : local.summary;
        const keyPoints = Array.isArray(parsed.keyPoints)
            ? parsed.keyPoints.filter(Boolean).slice(0, 6) : local.keyPoints;
        const todos = Array.isArray(parsed.todos)
            ? parsed.todos.filter(function (t) { return t && t.title; }).map(function (t) {
                return {
                    title: String(t.title).substr(0, 80),
                    done: false,
                    priority: ['high', 'normal', 'low'].indexOf(t.priority) !== -1 ? t.priority : 'normal',
                    due: typeof t.due === 'string' ? t.due : '',
                };
            })
            : local.todos;

        return {
            type: type,
            category: category,
            tags: tags,
            keywords: keywords,
            summary: summary,
            keyPoints: keyPoints,
            todos: todos,
            engine: 'llm',
        };
    } catch (error) {
        return local;
    }
}

function localAnalyze(content, hintType) {
    const type = ai.classifyType(content, hintType);
    const tags = ai.classifyTags(content);
    const category = ai.classifyCategory(content, tags);
    const keywords = text.topKeywords(content, ai.MAX_KEYWORDS).map(function (k) { return k.word; });
    const keyPoints = ai.extractKeyPoints(content);
    let todos = ai.extractTodos(content);
    if (type === 'todo' && !todos.length) {
        todos = [{ title: String(content).substr(0, 60), done: false, priority: 'normal', due: '' }];
    }
    return {
        type: type,
        category: category,
        tags: tags,
        keywords: keywords,
        summary: ai.summarize(content, 90),
        keyPoints: keyPoints,
        todos: todos,
        engine: 'local',
    };
}

// ---------------------------------------------------------------------------
// 智能问答
// ---------------------------------------------------------------------------

/**
 * @param {Array} entries
 * @param {string} question
 * @returns {Promise<{answer, refs, empty, suggestions, engine}>}
 */
async function askQuestion(entries, question) {
    const hits = ai.search(entries, question, 6);
    if (!hits.length) {
        const local = ai.answer(entries, question);
        return Object.assign({}, local, { engine: 'local' });
    }

    const context = hits.map(function (h, i) {
        const e = h.entry;
        const date = new Date(e.createdAt);
        const day = date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
        return '【记录' + (i + 1) + '｜' + day + '｜' + (e.title || '无标题') + '】\n' + e.content;
    }).join('\n\n');

    const messages = [
        {
            role: 'system',
            content: SYSTEM + '\n请只依据下面用户的记录回答问题。'
                + '回答要点：1）先给直接结论；2）再列依据并标注来自哪条记录（用【记录N】）；'
                + '3）如果记录不足以回答，直说缺什么；4）最后给一条下一步动作建议。',
        },
        {
            role: 'user',
            content: '我的问题：' + question + '\n\n以下是我的相关记录：\n' + context,
        },
    ];

    try {
        const answer = await llm.complete(messages, {});
        const refs = hits.map(function (h) {
            return {
                id: h.entry.id,
                title: h.entry.title || ai.summarize(h.entry.content, 24),
                type: h.entry.type,
                score: h.score,
            };
        });
        return {
            answer: answer.trim(),
            refs: refs,
            empty: false,
            suggestions: [],
            engine: 'llm',
        };
    } catch (error) {
        const local = ai.answer(entries, question);
        return Object.assign({}, local, { engine: 'local' });
    }
}

// ---------------------------------------------------------------------------
// 阶段总结 + 行动建议
// ---------------------------------------------------------------------------

/**
 * @param {Array} entries
 * @param {number} days
 * @returns {Promise<object>}
 */
async function buildStageReport(entries, days) {
    const local = ai.stageReport(entries, { days: days });

    if (!entries.length) {
        return Object.assign({}, local, { engine: 'local' });
    }

    const from = new Date(Date.now() - days * 24 * 3600 * 1000);
    const scope = entries.filter(function (e) { return (e.createdAt || 0) >= from.getTime(); });
    const usable = scope.length ? scope : entries;

    const digest = usable.slice(0, 60).map(function (e, i) {
        const day = new Date(e.createdAt);
        return '【' + (i + 1) + '｜' + (day.getMonth() + 1) + '/' + day.getDate() + '｜'
            + (e.title || '无标题') + '】' + ai.summarize(e.content, 120);
    }).join('\n');

    const messages = [
        {
            role: 'system',
            content: SYSTEM + '\n请根据用户最近一段时间的记录，输出一份阶段总结与行动建议。'
                + '只输出 JSON，格式为：'
                + '{"summary":"150字以内的阶段总结","actions":[{"title":"行动标题（不超过20字）","detail":"具体说明（不超过50字）"}]}'
                + '。actions 给 3-5 条，按优先级从高到低排列，每条都要能直接执行。',
        },
        {
            role: 'user',
            content: '统计口径：最近 ' + days + ' 天，共 ' + usable.length + ' 条记录。\n\n记录摘要：\n'
                + digest,
        },
    ];

    try {
        const raw = await llm.complete(messages, { json: true });
        const parsed = llm.parseJson(raw, null);
        if (!parsed || !parsed.summary) return Object.assign({}, local, { engine: 'local' });

        const actions = Array.isArray(parsed.actions)
            ? parsed.actions.filter(function (a) { return a && a.title; }).slice(0, 6).map(function (a) {
                return {
                    title: String(a.title).substr(0, 24),
                    detail: String(a.detail || '').substr(0, 60),
                };
            })
            : local.actions;

        return {
            summary: String(parsed.summary).trim(),
            actions: actions.length ? actions : local.actions,
            stats: local.stats,
            categories: local.categories,
            keywords: local.keywords,
            tags: local.tags,
            engine: 'llm',
        };
    } catch (error) {
        return Object.assign({}, local, { engine: 'local' });
    }
}

// ---------------------------------------------------------------------------
// 关联内容
// ---------------------------------------------------------------------------

async function relateEntries(entry, others) {
    const local = ai.relate(entry, others, 5);
    return local;
}

function pad(n) {
    return n < 10 ? '0' + n : String(n);
}

module.exports = {
    analyzeEntry: analyzeEntry,
    askQuestion: askQuestion,
    buildStageReport: buildStageReport,
    relateEntries: relateEntries,
    localAnalyze: localAnalyze,
    search: ai.search,
    summarize: ai.summarize,
    organizeTodos: ai.organizeTodos,
    extractTodos: ai.extractTodos,
};
