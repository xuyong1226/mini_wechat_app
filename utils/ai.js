/**
 * 智能引擎（本地规则实现）。
 *
 * 设计成可插拔：所有能力都从这里导出；当前用本地规则实现（无需联网、无需密钥）。
 * 未来接入云端大模型时，只需在 app.js 里调用 setEngine({ ... }) 覆盖同名方法，
 * 页面代码不用改。
 */

const text = require('./text');

const MAX_KEYWORDS = 8;

// ---------------------------------------------------------------------------
// 1. 自动分类
// ---------------------------------------------------------------------------

/**
 * 判断条目类型：想法 / 资料 / 待办
 * @param {string} content 正文
 * @param {string} [hint] 用户手动指定的类型
 */
function classifyType(content, hint) {
    if (hint && ['idea', 'material', 'todo'].indexOf(hint) !== -1) return hint;

    const src = text.normalize(content);
    if (!src) return 'idea';

    const todoHints = ['待办', '要做', '记得', '别忘', '截止', '安排', '跟进', '催', '完成', '提交',
        '确认一下', '处理', '准备', '尽快', '明天', '后天', '本周', '下周', '前给', '前发', '之前'];
    const materialHints = ['资料', '文档', '附件', '规范', '标准', '流程', '制度', '说明', '手册', '报告',
        '参考', '链接', '网址', 'http', '方案', '需求', '摘录', '纪要'];
    const ideaHints = ['想法', '灵感', '点子', '设想', '如果', '或许', '能不能', '是不是', '构想', '创意'];

    function score(hints) {
        let s = 0;
        for (let i = 0; i < hints.length; i += 1) {
            if (src.indexOf(hints[i]) !== -1) s += hints[i].length;
        }
        return s;
    }

    const scores = {
        todo: score(todoHints),
        material: score(materialHints),
        idea: score(ideaHints),
    };

    let best = 'idea';
    let bestScore = scores.idea;
    if (scores.todo > bestScore) { best = 'todo'; bestScore = scores.todo; }
    if (scores.material > bestScore) { best = 'material'; bestScore = scores.material; }
    return best;
}

/**
 * 自动打标签（业务维度）
 */
function classifyTags(content) {
    const src = text.normalize(content);
    const tags = [];
    const rules = [
        { tag: '客户', words: ['客户', '甲方', '货主', '对接人'] },
        { tag: '价格', words: ['报价', '单价', '费用', '成本', '利润', '毛利', '金额', '结算'] },
        { tag: '时间敏感', words: ['截止', '今天', '明天', '后天', '本周', '下周', '月底', '尽快', '立刻'] },
        { tag: '合同', words: ['合同', '协议', '盖章', '签字', '条款'] },
        { tag: '异常', words: ['异常', '投诉', '破损', '延误', '错发', '漏发', '退货', '拒收', '问题'] },
        { tag: '流程', words: ['流程', '步骤', '审批', '签字', '归档', '交接'] },
        { tag: '改进', words: ['优化', '改进', '提升', '降低', '建议', '方案'] },
    ];
    for (let i = 0; i < rules.length; i += 1) {
        for (let j = 0; j < rules[i].words.length; j += 1) {
            if (src.indexOf(rules[i].words[j]) !== -1) {
                tags.push(rules[i].tag);
                break;
            }
        }
    }
    return tags;
}

/**
 * 分类（业务域）
 */
function classifyCategory(content, tags) {
    const src = text.normalize(content);
    const all = tags || [];
    let best = 'general';
    let bestScore = 0;
    for (let i = 0; i < text.CATEGORY_RULES.length; i += 1) {
        const rule = text.CATEGORY_RULES[i];
        let s = 0;
        for (let j = 0; j < rule.keywords.length; j += 1) {
            if (src.indexOf(rule.keywords[j]) !== -1) s += rule.keywords[j].length;
        }
        if (s > bestScore) { bestScore = s; best = rule.key; }
    }
    if (bestScore === 0 && all.indexOf('客户') !== -1) best = 'client';
    return best;
}

// ---------------------------------------------------------------------------
// 2. 摘要
// ---------------------------------------------------------------------------

/**
 * 抽取式摘要：按关键词覆盖度给句子打分，取高分句。
 */
function summarize(content, maxChars) {
    const limit = maxChars || 110;
    const src = String(content || '').trim();
    if (!src) return '';
    if (src.length <= limit) return src;

    const sentences = text.splitSentences(src);
    if (sentences.length <= 1) return src.substr(0, limit) + (src.length > limit ? '…' : '');

    const weights = {};
    const kw = text.topKeywords(src, 20);
    for (let i = 0; i < kw.length; i += 1) weights[kw[i].word] = kw[i].weight;

    const scored = sentences.map(function (s, idx) {
        const tokens = text.tokenize(s).tokens;
        let score = 0;
        const seen = {};
        for (let i = 0; i < tokens.length; i += 1) {
            const w = tokens[i];
            if (weights[w]) {
                score += seen[w] ? 0.3 : weights[w];
                seen[w] = true;
            }
        }
        // 位置加权：靠前的句子更可能是主旨
        score += Math.max(0, 3 - idx) * 0.8;
        // 长度惩罚：过短的句子信息量低
        if (s.length < 8) score *= 0.6;
        return { text: s, score: score, idx: idx };
    });

    scored.sort(function (a, b) { return b.score - a.score; });

    const picked = [];
    let total = 0;
    for (let i = 0; i < scored.length && total < limit; i += 1) {
        if (picked.indexOf(scored[i].idx) !== -1) continue;
        picked.push(scored[i].idx);
        total += scored[i].text.length;
    }
    picked.sort(function (a, b) { return a - b; });

    let out = '';
    for (let i = 0; i < picked.length; i += 1) {
        out += sentences[picked[i]];
    }
    if (out.length > limit) out = out.substr(0, limit) + '…';
    return out;
}

// ---------------------------------------------------------------------------
// 3. 重点信息提取
// ---------------------------------------------------------------------------

const ACTION_WORDS = ['需要', '要', '记得', '别忘', '安排', '跟进', '提交', '确认', '联系', '催', '发给',
    '发给', '准备', '处理', '完成', '核查', '通知', '沟通', '汇报', '申请', '签字', '盖章', '寄出',
    '打印', '回传', '催收', '核对', '安排'];

/**
 * 提取重点信息：时间点 / 金额 / 数量 / 关键动作 / 人名线索
 */
function extractKeyPoints(content) {
    const src = String(content || '');
    const points = [];
    const signals = text.extractSignals(src);

    const push = function (label, value) {
        const item = label + '：' + value;
        for (let i = 0; i < points.length; i += 1) {
            if (points[i].indexOf(label + '：') === 0 && points[i] === item) return;
        }
        points.push(item);
    };

    const uniq = function (arr) {
        const out = [];
        for (let i = 0; i < arr.length; i += 1) {
            if (out.indexOf(arr[i]) === -1) out.push(arr[i]);
        }
        return out;
    };

    const dates = uniq(signals.dates);
    for (let i = 0; i < dates.length && i < 3; i += 1) push('时间', dates[i]);

    const amounts = uniq(signals.amounts);
    for (let i = 0; i < amounts.length && i < 3; i += 1) push('金额', amounts[i]);

    const percents = uniq(signals.percents);
    for (let i = 0; i < percents.length && i < 2; i += 1) push('比例', percents[i]);

    const quantities = uniq(signals.quantities);
    for (let i = 0; i < quantities.length && i < 3; i += 1) push('数量', quantities[i]);

    // 关键动作句
    const sentences = text.splitSentences(src);
    const actionSentences = [];
    for (let i = 0; i < sentences.length; i += 1) {
        for (let j = 0; j < ACTION_WORDS.length; j += 1) {
            if (sentences[i].indexOf(ACTION_WORDS[j]) !== -1) {
                actionSentences.push(sentences[i].trim());
                break;
            }
        }
    }
    const uniqActions = uniq(actionSentences);
    for (let i = 0; i < uniqActions.length && i < 3; i += 1) {
        if (uniqActions[i].length > 40) push('动作', uniqActions[i].substr(0, 40) + '…');
        else push('动作', uniqActions[i]);
    }

    return points;
}

// ---------------------------------------------------------------------------
// 4. 待办抽取与整理
// ---------------------------------------------------------------------------

const PRIORITY_HIGH = ['紧急', '加急', '立刻', '马上', '今天必须', '尽快', '优先', 'asap', 'ASAP', '重要且急'];
const PRIORITY_LOW = ['不急', '有空', '闲时', '以后', '后续再', '择期'];

/**
 * 从正文中抽取待办项
 */
function extractTodos(content) {
    const sentences = text.splitSentences(String(content || ''));
    const todos = [];
    for (let i = 0; i < sentences.length; i += 1) {
        const raw = sentences[i].trim();
        if (!raw) continue;
        let hit = false;
        for (let j = 0; j < ACTION_WORDS.length; j += 1) {
            if (raw.indexOf(ACTION_WORDS[j]) !== -1) { hit = true; break; }
        }
        if (!hit) continue;
        const title = raw.replace(/^[，,。;；\s-]+/, '').substr(0, 60);
        if (title.length < 2) continue;
        todos.push({
            title: title,
            done: false,
            priority: detectPriority(raw),
            due: detectDue(raw),
        });
    }
    return todos;
}

function detectPriority(source) {
    for (let i = 0; i < PRIORITY_HIGH.length; i += 1) {
        if (source.indexOf(PRIORITY_HIGH[i]) !== -1) return 'high';
    }
    for (let i = 0; i < PRIORITY_LOW.length; i += 1) {
        if (source.indexOf(PRIORITY_LOW[i]) !== -1) return 'low';
    }
    return 'normal';
}

function detectDue(source) {
    const signals = text.extractSignals(source);
    if (signals.dates.length) return signals.dates[0];
    if (source.indexOf('今天') !== -1) return '今天';
    if (source.indexOf('明天') !== -1) return '明天';
    if (source.indexOf('后天') !== -1) return '后天';
    if (source.indexOf('本周') !== -1) return '本周';
    if (source.indexOf('下周') !== -1) return '下周';
    if (source.indexOf('月底') !== -1) return '月底';
    return '';
}

/**
 * 整理待办：合并、排序、去重
 */
function organizeTodos(todos) {
    const map = {};
    const order = [];
    for (let i = 0; i < todos.length; i += 1) {
        const t = todos[i];
        const key = text.normalize(t.title).substr(0, 24);
        if (!key) continue;
        if (!map[key]) {
            map[key] = {
                title: t.title,
                done: false,
                priority: t.priority || 'normal',
                due: t.due || '',
                count: 1,
            };
            order.push(key);
        } else {
            map[key].count += 1;
            if (map[key].priority !== 'high' && t.priority === 'high') map[key].priority = 'high';
            if (!map[key].due && t.due) map[key].due = t.due;
        }
    }
    const list = order.map(function (k) { return map[k]; });
    const rank = { high: 0, normal: 1, low: 2 };
    list.sort(function (a, b) {
        if (a.done !== b.done) return a.done ? 1 : -1;
        if (rank[a.priority] !== rank[b.priority]) return rank[a.priority] - rank[b.priority];
        return 0;
    });
    return list;
}

// ---------------------------------------------------------------------------
// 5. 关键词检索
// ---------------------------------------------------------------------------

/**
 * 关键词检索：返回 [{entry, score, hits}]
 */
function search(entries, query, limit) {
    const max = limit || 20;
    const q = text.normalize(query);
    if (!q) return [];
    const qTokens = text.tokenize(q).tokens;
    const qSet = {};
    for (let i = 0; i < qTokens.length; i += 1) qSet[qTokens[i]] = true;

    const rawHits = [];
    for (let i = 0; i < entries.length; i += 1) {
        const e = entries[i];
        const hay = text.normalize((e.title || '') + ' ' + (e.content || ''));
        if (!hay) continue;
        let score = 0;
        const hits = [];

        // 直接子串命中
        if (hay.indexOf(q) !== -1) { score += 6; hits.push(q); }

        // 词命中
        const eTokens = text.tokenize(hay).tokens;
        const eSet = {};
        const counts = {};
        for (let k = 0; k < eTokens.length; k += 1) {
            eSet[eTokens[k]] = true;
            counts[eTokens[k]] = (counts[eTokens[k]] || 0) + 1;
        }
        for (const t in qSet) {
            if (!Object.prototype.hasOwnProperty.call(qSet, t)) continue;
            if (eSet[t]) {
                score += 2 + Math.min(counts[t], 3) * 0.5;
                if (hits.indexOf(t) === -1) hits.push(t);
            }
        }

        // 标签命中
        const tags = e.tags || [];
        for (let k = 0; k < tags.length; k += 1) {
            if (q.indexOf(tags[k]) !== -1 || tags[k].indexOf(q) !== -1) {
                score += 2.5;
                if (hits.indexOf(tags[k]) === -1) hits.push(tags[k]);
            }
        }

        if (score > 0) {
            rawHits.push({ entry: e, score: Math.round(score * 100) / 100, hits: hits.slice(0, 5) });
        }
    }

    rawHits.sort(function (a, b) { return b.score - a.score; });
    return rawHits.slice(0, max);
}

// ---------------------------------------------------------------------------
// 6. 内容关联
// ---------------------------------------------------------------------------

/**
 * 为每条内容计算关联条目（基于关键词重合 + 标签重合 + 分类相同）
 * @returns {Array<{id, score, reasons}>}
 */
function relate(entry, others, limit) {
    const max = limit || 4;
    const aSet = {};
    const aTokens = text.tokenize((entry.title || '') + ' ' + (entry.content || '')).tokens;
    const aCounts = {};
    for (let i = 0; i < aTokens.length; i += 1) { aSet[aTokens[i]] = true; aCounts[aTokens[i]] = 1; }

    const results = [];
    for (let i = 0; i < others.length; i += 1) {
        const b = others[i];
        if (b.id === entry.id) continue;
        const bSet = {};
        const bTokens = text.tokenize((b.title || '') + ' ' + (b.content || '')).tokens;
        for (let k = 0; k < bTokens.length; k += 1) bSet[bTokens[k]] = true;

        const sim = text.jaccard(aSet, bSet);

        const sharedTags = [];
        const aTags = entry.tags || [];
        const bTags = b.tags || [];
        for (let k = 0; k < aTags.length; k += 1) {
            if (bTags.indexOf(aTags[k]) !== -1) sharedTags.push(aTags[k]);
        }
        const sameCategory = !!(entry.category && entry.category === b.category);

        // 既没有词面重合、标签不同、类目也不同，则不算关联
        if (sim <= 0 && !sharedTags.length && !sameCategory) continue;

        let score = sim * 5;
        const reasons = [];

        if (sharedTags.length) {
            score += sharedTags.length * 1.6;
            reasons.push('同属「' + sharedTags.join('、') + '」');
        }
        if (sameCategory) {
            score += 1.2;
            reasons.push('同类目');
        }
        // 共享关键词
        const shared = [];
        for (const t in aSet) {
            if (Object.prototype.hasOwnProperty.call(aSet, t) && bSet[t]) shared.push(t);
        }
        if (shared.length) {
            reasons.push('共享关键词「' + shared.slice(0, 3).join('、') + '」');
        }

        results.push({
            id: b.id,
            score: Math.round(score * 100) / 100,
            reasons: reasons.slice(0, 2),
        });
    }
    results.sort(function (x, y) { return y.score - x.score; });
    return results.slice(0, max);
}

// ---------------------------------------------------------------------------
// 7. 智能问答（基于已有内容）
// ---------------------------------------------------------------------------

/**
 * @param {Array} entries 全部条目
 * @param {string} question 用户问题
 * @returns {{answer, refs, empty, suggestions}}
 */
function answer(entries, question) {
    const q = text.normalize(question);
    if (!q) {
        return { answer: '请输入你的问题，我会基于已记录的内容回答。', refs: [], empty: true, suggestions: [] };
    }
    const hits = search(entries, question, 5);
    if (!hits.length) {
        return {
            answer: '现有记录里没有找到与「' + question + '」直接相关的内容。可以先记录一条，我再基于它回答。',
            refs: [],
            empty: true,
            suggestions: buildSuggestions(entries),
        };
    }

    const refs = [];
    const lines = [];
    for (let i = 0; i < hits.length; i += 1) {
        const e = hits[i].entry;
        refs.push({ id: e.id, title: e.title || '(无标题)', type: e.type, score: hits[i].score });
        const snippet = summarize(e.content, 70);
        lines.push('• ' + (e.title || snippet.substr(0, 24)) + '：' + snippet);
    }

    const answerText = '根据你的记录，与「' + question + '」最相关的是这 ' + hits.length + ' 条：\n'
        + lines.join('\n');

    return { answer: answerText, refs: refs, empty: false, suggestions: [] };
}

/**
 * 基于已有内容给出建议（当检索无结果时）
 */
function buildSuggestions(entries) {
    const todos = [];
    for (let i = 0; i < entries.length; i += 1) {
        if (entries[i].type === 'todo') todos.push(entries[i]);
    }
    const out = [];
    if (todos.length) out.push('有 ' + todos.length + ' 条待办尚未处理，可以先去「待办」页清一清。');
    if (!entries.length) out.push('还没有任何记录，先在首页记下第一条想法或资料吧。');
    else out.push('换个关键词试试，或先在首页补一条相关记录。');
    return out;
}

// ---------------------------------------------------------------------------
// 8. 阶段总结 + 后续行动建议
// ---------------------------------------------------------------------------

/**
 * @param {Array} entries
 * @param {object} [opts] { days }
 * @returns {{summary, stats, actions, categories, keywords}}
 */
function stageReport(entries, opts) {
    const options = opts || {};
    const days = options.days || 7;
    const now = options.now || Date.now();
    const from = now - days * 24 * 3600 * 1000;

    const inRange = [];
    for (let i = 0; i < entries.length; i += 1) {
        if ((entries[i].createdAt || 0) >= from) inRange.push(entries[i]);
    }
    const scope = inRange.length ? inRange : entries;

    const typeCount = { idea: 0, material: 0, todo: 0 };
    const catCount = {};
    const tagCount = {};
    const kwCount = {};
    let doneCount = 0;
    let openTodos = 0;

    for (let i = 0; i < scope.length; i += 1) {
        const e = scope[i];
        if (typeCount[e.type] !== undefined) typeCount[e.type] += 1;
        if (e.category) catCount[e.category] = (catCount[e.category] || 0) + 1;
        const tags = e.tags || [];
        for (let k = 0; k < tags.length; k += 1) tagCount[tags[k]] = (tagCount[tags[k]] || 0) + 1;
        const kws = e.keywords || [];
        for (let k = 0; k < kws.length; k += 1) kwCount[kws[k]] = (kwCount[kws[k]] || 0) + 1;
        const todos = e.todoItems || e.todos || [];
        for (let k = 0; k < todos.length; k += 1) {
            if (todos[k].done) doneCount += 1;
            else openTodos += 1;
        }
    }

    const topTags = topOf(tagCount, 5);
    const topKws = topOf(kwCount, 6);

    const parts = [];
    parts.push('最近 ' + days + ' 天共记录 ' + scope.length + ' 条');
    parts.push('想法 ' + typeCount.idea + ' 条、资料 ' + typeCount.material + ' 条、待办 ' + typeCount.todo + ' 条');
    if (topTags.length) parts.push('高频标签：' + topTags.map(function (t) { return t.name; }).join('、'));
    if (topKws.length) parts.push('出现最多的关键词：' + topKws.map(function (t) { return t.name; }).join('、'));
    if (openTodos) parts.push('还有 ' + openTodos + ' 项待办没有收口');
    else if (scope.length) parts.push('待办已全部收口');

    const summary = parts.join('；') + '。';

    // 后续行动建议
    const actions = [];
    if (openTodos > 0) {
        actions.push({
            title: '清理 ' + openTodos + ' 项未完成待办',
            detail: '在「待办」页按优先级排序，先处理高优先级的部分。',
        });
    }
    if (typeCount.idea > typeCount.material + typeCount.todo) {
        actions.push({
            title: '想法偏多，需要落成行动',
            detail: '本阶段想法 ' + typeCount.idea + ' 条，建议挑出最有把握的转成待办或资料，避免只停留在想法。',
        });
    }
    if (typeCount.material >= 3 && typeCount.material > typeCount.idea) {
        actions.push({
            title: '资料需要沉淀成结论',
            detail: '已积累 ' + typeCount.material + ' 条资料，建议做一次归纳，产出可复用的检查清单或口径。',
        });
    }
    if (topKws.length && topKws[0].count >= 3) {
        actions.push({
            title: '围绕「' + topKws[0].name + '」形成一条主线',
            detail: '该关键词反复出现，说明是当前阶段的核心主题，值得单独成条推进。',
        });
    }
    if (hasTag(topTags, '客户')) {
        actions.push({ title: '客户相关事项需要明确责任人', detail: '把客户类记录逐条标注跟进人和下一步动作。' });
    }
    if (hasTag(topTags, '异常')) {
        actions.push({ title: '复盘异常类记录', detail: '异常反复出现时，先归因再定措施，别只做一次性补救。' });
    }
    if (!actions.length) {
        actions.push({ title: '保持当前节奏', detail: '本阶段记录与待办都收敛，可以把注意力放到新输入上。' });
    }

    const categories = [];
    for (const key in catCount) {
        if (Object.prototype.hasOwnProperty.call(catCount, key)) {
            categories.push({ key: key, count: catCount[key] });
        }
    }
    categories.sort(function (a, b) { return b.count - a.count; });

    return {
        summary: summary,
        stats: {
            total: scope.length,
            days: days,
            idea: typeCount.idea,
            material: typeCount.material,
            todo: typeCount.todo,
            done: doneCount,
            open: openTodos,
        },
        actions: actions,
        categories: categories,
        keywords: topKws,
        tags: topTags,
    };
}

function topOf(counts, limit) {
    const list = [];
    for (const key in counts) {
        if (Object.prototype.hasOwnProperty.call(counts, key)) {
            list.push({ name: key, count: counts[key] });
        }
    }
    list.sort(function (a, b) { return b.count - a.count; });
    return list.slice(0, limit);
}

/** topTags 是 {name,count} 数组，按名称判断存在性 */
function hasTag(topTags, name) {
    for (let i = 0; i < topTags.length; i += 1) {
        if (topTags[i].name === name) return true;
    }
    return false;
}

// ---------------------------------------------------------------------------
// 引擎装配
// ---------------------------------------------------------------------------

const localEngine = {
    name: 'local',
    classifyType: classifyType,
    classifyTags: classifyTags,
    classifyCategory: classifyCategory,
    summarize: summarize,
    extractKeyPoints: extractKeyPoints,
    extractTodos: extractTodos,
    organizeTodos: organizeTodos,
    search: search,
    relate: relate,
    answer: answer,
    stageReport: stageReport,
};

let engine = localEngine;

/** 覆盖引擎（接入云端大模型时调用） */
function setEngine(next) {
    engine = Object.assign({}, localEngine, next || {});
}

function getEngine() {
    return engine;
}

module.exports = {
    localEngine: localEngine,
    setEngine: setEngine,
    getEngine: getEngine,
    classifyType: classifyType,
    classifyTags: classifyTags,
    classifyCategory: classifyCategory,
    summarize: summarize,
    extractKeyPoints: extractKeyPoints,
    extractTodos: extractTodos,
    organizeTodos: organizeTodos,
    search: search,
    relate: relate,
    answer: answer,
    stageReport: stageReport,
    MAX_KEYWORDS: MAX_KEYWORDS,
};
