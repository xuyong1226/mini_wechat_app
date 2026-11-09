-- 04 业务表切到「主体口径」
--
-- 存量数据 owner_id 存的是原始 uid，不做数据迁移：
--   * 新数据 DEFAULT current_subject_id()，直接写主体
--   * 读/写判定统一用 owner_id = any(current_subject_scope())
--     → 合并后所有 uid 的数据互相可见，合并前建的记录也能看到
-- 这样合并不需要挪数据，也就不存在「挪一半失败」的中间态。

alter table public.entries      alter column owner_id set default public.current_subject_id();
alter table public.todos        alter column owner_id set default public.current_subject_id();
alter table public.user_profile alter column owner_id set default public.current_subject_id();

drop policy if exists entries_read_own on public.entries;
create policy entries_read_own on public.entries
    for select using (owner_id = any (public.current_subject_scope()));

drop policy if exists entries_insert_own on public.entries;
create policy entries_insert_own on public.entries
    for insert with check (owner_id = any (public.current_subject_scope()));

drop policy if exists entries_update_own on public.entries;
create policy entries_update_own on public.entries
    for update
    using (owner_id = any (public.current_subject_scope()))
    with check (owner_id = any (public.current_subject_scope()));

drop policy if exists entries_delete_own on public.entries;
create policy entries_delete_own on public.entries
    for delete using (owner_id = any (public.current_subject_scope()));

drop policy if exists todos_read_own on public.todos;
create policy todos_read_own on public.todos
    for select using (owner_id = any (public.current_subject_scope()));

drop policy if exists todos_insert_own on public.todos;
create policy todos_insert_own on public.todos
    for insert with check (owner_id = any (public.current_subject_scope()));

drop policy if exists todos_update_own on public.todos;
create policy todos_update_own on public.todos
    for update
    using (owner_id = any (public.current_subject_scope()))
    with check (owner_id = any (public.current_subject_scope()));

drop policy if exists todos_delete_own on public.todos;
create policy todos_delete_own on public.todos
    for delete using (owner_id = any (public.current_subject_scope()));

drop policy if exists user_profile_read_own on public.user_profile;
create policy user_profile_read_own on public.user_profile
    for select using (owner_id = any (public.current_subject_scope()));

drop policy if exists user_profile_insert_own on public.user_profile;
create policy user_profile_insert_own on public.user_profile
    for insert with check (owner_id = any (public.current_subject_scope()));

drop policy if exists user_profile_update_own on public.user_profile;
create policy user_profile_update_own on public.user_profile
    for update
    using (owner_id = any (public.current_subject_scope()))
    with check (owner_id = any (public.current_subject_scope()));

drop policy if exists user_profile_delete_own on public.user_profile;
create policy user_profile_delete_own on public.user_profile
    for delete using (owner_id = any (public.current_subject_scope()));
