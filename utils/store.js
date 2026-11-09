/**
 * 数据层：entries（记录）与 todos（待办）两张表的读写封装。
 * 归属由服务端 owner_id + RLS 决定，前端不发送 owner_id。
 */

const { cloud } = require('./cloud');
const { createTableAccess } = require('./workbuddy-data-access');

const ENTRY_COLUMNS = [
    'id', 'type', 'title', 'content', 'category', 'tags', 'keywords',
    'summary', 'key_points', 'todo_items', 'related_ids', 'created_at', 'updated_at',
];

const TODO_COLUMNS = [
    'id', 'title', 'priority', 'due_text', 'status', 'source_entry_id', 'sort_order',
    'created_at', 'updated_at',
];

let ownerName = null;

/** 会话恢复后写入昵称快照（仅展示用，不参与鉴权） */
function setOwnerName(name) {
    ownerName = name || null;
}

function getOwnerName() {
    return ownerName;
}

function toMs(value) {
    if (!value) return Date.now();
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : Date.now();
}

function fromEntryRow(row) {
    if (!row) return null;
    return {
        id: row.id,
        type: row.type || 'idea',
        title: row.title || '',
        content: row.content || '',
        category: row.category || 'general',
        tags: Array.isArray(row.tags) ? row.tags : [],
        keywords: Array.isArray(row.keywords) ? row.keywords : [],
        summary: row.summary || '',
        keyPoints: Array.isArray(row.key_points) ? row.key_points : [],
        todoItems: Array.isArray(row.todo_items) ? row.todo_items : [],
        relatedIds: Array.isArray(row.related_ids) ? row.related_ids : [],
        createdAt: toMs(row.created_at),
        updatedAt: toMs(row.updated_at),
    };
}

function toEntryRow(payload) {
    const row = {};
    if (payload.type !== undefined) row.type = payload.type;
    if (payload.title !== undefined) row.title = payload.title;
    if (payload.content !== undefined) row.content = payload.content;
    if (payload.category !== undefined) row.category = payload.category;
    if (payload.tags !== undefined) row.tags = payload.tags || [];
    if (payload.keywords !== undefined) row.keywords = payload.keywords || [];
    if (payload.summary !== undefined) row.summary = payload.summary;
    if (payload.keyPoints !== undefined) row.key_points = payload.keyPoints || [];
    if (payload.todoItems !== undefined) row.todo_items = payload.todoItems || [];
    if (payload.relatedIds !== undefined) row.related_ids = payload.relatedIds || [];
    if (payload.updatedAt !== undefined) row.updated_at = new Date(payload.updatedAt).toISOString();
    if (ownerName) row.owner_name = ownerName;
    return row;
}

function fromTodoRow(row) {
    if (!row) return null;
    return {
        id: row.id,
        title: row.title || '',
        priority: row.priority || 'normal',
        due: row.due_text || '',
        status: row.status || 'open',
        sourceEntryId: row.source_entry_id === null || row.source_entry_id === undefined
            ? null : row.source_entry_id,
        sortOrder: row.sort_order === null || row.sort_order === undefined ? 0 : row.sort_order,
        createdAt: toMs(row.created_at),
        updatedAt: toMs(row.updated_at),
    };
}

function toTodoRow(payload) {
    const row = {};
    if (payload.title !== undefined) row.title = payload.title;
    if (payload.priority !== undefined) row.priority = payload.priority;
    if (payload.due !== undefined) row.due_text = payload.due;
    if (payload.status !== undefined) row.status = payload.status;
    if (payload.sourceEntryId !== undefined) row.source_entry_id = payload.sourceEntryId;
    if (payload.sortOrder !== undefined) row.sort_order = payload.sortOrder;
    if (payload.updatedAt !== undefined) row.updated_at = new Date(payload.updatedAt).toISOString();
    if (ownerName) row.owner_name = ownerName;
    return row;
}

const entries = createTableAccess(cloud, {
    table: 'entries',
    columns: ENTRY_COLUMNS,
    fromRow: fromEntryRow,
    toRow: toEntryRow,
    orderBy: { column: 'created_at', ascending: false },
});

const todos = createTableAccess(cloud, {
    table: 'todos',
    columns: TODO_COLUMNS,
    fromRow: fromTodoRow,
    toRow: toTodoRow,
    orderBy: { column: 'created_at', ascending: false },
});

/** 读取当前会话；未登录返回 null */
async function getSession() {
    try {
        const result = await cloud.auth.getSession();
        if (result.error || !result.data) return null;
        const user = result.data.user || {};
        setOwnerName(user.name || null);
        return result.data;
    } catch (error) {
        return null;
    }
}

module.exports = {
    cloud,
    entries,
    todos,
    getSession,
    setOwnerName,
    getOwnerName,
    fromEntryRow,
    toEntryRow,
    fromTodoRow,
    toTodoRow,
};
