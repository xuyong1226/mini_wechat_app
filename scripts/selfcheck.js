/**
 * 本地逻辑自测：验证文本引擎与智能引擎的输出是否符合预期。
 * 运行：node scripts/selfcheck.js
 */

const text = require('../utils/text');
const ai = require('../utils/ai');

let pass = 0;
let fail = 0;

function check(name, condition, detail) {
    if (condition) {
        pass += 1;
        console.log('  PASS  ' + name);
    } else {
        fail += 1;
        console.log('  FAIL  ' + name + (detail ? (' -> ' + detail) : ''));
    }
}

const ENTRIES = [
    {
        id: 1,
        type: 'todo',
        title: '跟京信对账',
        content: '明天上午要把京信9月的账单核对完，发票金额 128500 元，截止本周五，记得提前跟财务确认对账口径。',
        category: 'finance',
        tags: ['客户', '时间敏感', '异常'],
        keywords: ['京信', '对账', '账单', '核对', '发票', '金额'],
        createdAt: Date.now() - 2 * 24 * 3600 * 1000,
        todoItems: [{ title: '把京信9月的账单核对完', done: false, priority: 'high', due: '明天' }],
    },
    {
        id: 2,
        type: 'material',
        title: '专线运价表',
        content: '零担计费支持按方、按公斤、按里程、按件四种方式。广州到长沙按方报价 320 元每方，计费重量取实重与体积重较大值。',
        category: 'logistics',
        tags: ['价格'],
        keywords: ['零担', '计费', '报价', '体积重'],
        createdAt: Date.now() - 5 * 24 * 3600 * 1000,
        todoItems: [],
    },
    {
        id: 3,
        type: 'idea',
        title: '短驳比价自动化',
        content: '能不能做一个自动比价的小工具，把零担和整车报价放一起逐单比较，按目的地自动分给专线承运商，这样每天能省不少时间。',
        category: 'idea',
        tags: ['改进'],
        keywords: ['短驳', '比价', '整车', '专线'],
        createdAt: Date.now() - 9 * 24 * 3600 * 1000,
        todoItems: [],
    },
    {
        id: 4,
        type: 'material',
        title: '京信回单归档规范',
        content: '回单需要扫描归档，签收后 3 个工作日内上传，超过时限系统会标记异常。上个月有 12 票回单超标，要跟网点强调一下。',
        category: 'logistics',
        tags: ['流程', '异常'],
        keywords: ['回单', '签收', '归档', '超时'],
        createdAt: Date.now() - 20 * 24 * 3600 * 1000,
        todoItems: [],
    },
];

console.log('\n[1] 文本引擎');
{
    const tokens = text.tokenize('运单回单归档和签收时限').tokens;
    check('词典切出业务词', tokens.indexOf('回单') !== -1 && tokens.indexOf('归档') !== -1, JSON.stringify(tokens));

    const kw = text.topKeywords('京信的对账单要核对，账单金额对不上，需要重新核对京信的账单', 5);
    check('关键词提取', kw.length > 0 && kw[0].count >= 2, JSON.stringify(kw));

    const signals = text.extractSignals('明天上午完成，金额 128500 元，效率提升 20%，共 12 票');
    check('日期识别', signals.dates.length > 0, JSON.stringify(signals.dates));
    check('金额识别', signals.amounts.length > 0, JSON.stringify(signals.amounts));
    check('比例识别', signals.percents.length > 0, JSON.stringify(signals.percents));
    check('数量识别', signals.quantities.length > 0, JSON.stringify(signals.quantities));
}

console.log('\n[2] 分类与标签');
{
    const todoType = ai.classifyType('明天要记得提交对账报告，截止本周五');
    check('待办识别', todoType === 'todo', todoType);

    const materialType = ai.classifyType('这是专线公司的运价标准文档和结算流程说明');
    check('资料识别', materialType === 'material', materialType);

    const ideaType = ai.classifyType('能不能把短驳和整车报价放一起做自动比价');
    check('想法识别', ideaType === 'idea', ideaType);

    const tags = ai.classifyTags('客户合同金额和截止时间');
    check('标签识别', tags.indexOf('客户') !== -1 && tags.indexOf('合同') !== -1, JSON.stringify(tags));

    const category = ai.classifyCategory('京信客户的运单结算对账和发票金额', ['客户']);
    check('类目识别', category === 'client' || category === 'finance', category);
}

console.log('\n[3] 摘要与重点');
{
    const long = '今天上午去了一趟网点，看了回单归档的情况。'
        + '发现有三票回单超过三个工作日没有上传，其中两票是客户签收后没给回单。'
        + '另外还跟调度确认了下周零担的运价，报价没变。';
    const summary = ai.summarize(long, 60);
    check('摘要非空', summary.length > 0);
    check('摘要不超长', summary.length <= 62, String(summary.length));

    const points = ai.extractKeyPoints('明天上午前把对账做完，金额 128500 元，截止本周五');
    check('重点含时间', points.some(function (p) { return p.indexOf('时间') === 0; }), JSON.stringify(points));
    check('重点含金额', points.some(function (p) { return p.indexOf('金额') === 0; }), JSON.stringify(points));
}

console.log('\n[4] 待办抽取与整理');
{
    const todos = ai.extractTodos('明天要记得提交对账报告，记得跟财务确认口径。');
    check('抽到待办', todos.length >= 1, JSON.stringify(todos));

    const merged = ai.organizeTodos([
        { title: '提交对账报告', done: false, priority: 'normal', due: '' },
        { title: '提交对账报告', done: false, priority: 'high', due: '明天' },
        { title: '催回单', done: false, priority: 'low', due: '' },
    ]);
    check('去重合并', merged.length === 2, JSON.stringify(merged));
    check('优先级合并取高', merged[0].priority === 'high', JSON.stringify(merged));
    check('排序高优先在前', merged[0].title === '提交对账报告', JSON.stringify(merged));
}

console.log('\n[5] 检索与关联');
{
    const hits = ai.search(ENTRIES, '回单');
    check('检索命中回单', hits.length >= 1 && hits[0].entry.id === 4, JSON.stringify(hits.map(function (h) { return h.entry.id; })));

    const hits3 = ai.search(ENTRIES, '承运商');
    check('检索命中承运商', hits3.length >= 1, JSON.stringify(hits3.map(function (h) { return h.entry.id; })));

    const hits2 = ai.search(ENTRIES, '对账');
    check('检索命中对账', hits2.length >= 1 && hits2[0].entry.id === 1, JSON.stringify(hits2.map(function (h) { return h.entry.id; })));

    const rel = ai.relate(ENTRIES[0], ENTRIES.slice(1), 3);
    check('关联有结果', rel.length > 0, JSON.stringify(rel));

    const rel2 = ai.relate(ENTRIES[1], [ENTRIES[3]], 3);
    check('物流相关内容关联', rel2.length > 0, JSON.stringify(rel2));
}

console.log('\n[6] 问答');
{
    const answer = ai.answer(ENTRIES, '京信的对账进展怎么样');
    check('问答有内容', answer.answer.length > 0);
    check('问答有引用', answer.refs.length > 0, JSON.stringify(answer.refs));
    check('问答非空标记正确', answer.empty === false);
}

console.log('\n[7] 阶段总结');
{
    const report = ai.stageReport(ENTRIES, { days: 30 });
    check('总结非空', report.summary.length > 0, report.summary);
    check('统计总数正确', report.stats.total === 4, String(report.stats.total));
    check('未收口待办数正确', report.stats.open === 1, String(report.stats.open));
    check('行动建议非空', report.actions.length > 0, JSON.stringify(report.actions));
    check('类目分布有数据', report.categories.length > 0, JSON.stringify(report.categories));
}

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败\n');
process.exit(fail === 0 ? 0 : 1);
