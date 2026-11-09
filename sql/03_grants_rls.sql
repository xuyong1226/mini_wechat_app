-- 03 统一用户主体：GRANT + RLS
--
-- 两道门缺一不可：先 GRANT 给 authenticated，再 CREATE POLICY。
-- 只开 RLS 不给 GRANT → 42501；只 GRANT 不开 RLS → 全表可读。
-- anon 一律不授权：身份表不允许未登录读取。

grant select, insert, update, delete on public.user_link        to authenticated;
grant select, insert, update, delete on public.user_credential  to authenticated;
grant select, insert, update, delete on public.user_bind_ticket to authenticated;

revoke all on public.user_link, public.user_credential, public.user_bind_ticket from anon;

alter table public.user_link        enable row level security;
alter table public.user_credential  enable row level security;
alter table public.user_bind_ticket enable row level security;

-- user_link ---------------------------------------------------------------
-- 读：自己那一行 + 本主体下所有行（合并后要能看到兄弟 uid）
drop policy if exists user_link_read on public.user_link;
create policy user_link_read on public.user_link
    for select
    using (uid = auth.uid() or subject_id = public.current_subject_id());

-- 建：只能建自己这一行；主体是自己，或持有效票据并入别的主体
drop policy if exists user_link_insert on public.user_link;
create policy user_link_insert on public.user_link
    for insert
    with check (
        uid = auth.uid()
        and (subject_id = uid or public.verify_bind_ticket(ticket_id, subject_id))
    );

-- 改：只改自己这一行；改 subject_id 必须有票据（否则可把数据并到别人主体 → 越权）
drop policy if exists user_link_update on public.user_link;
create policy user_link_update on public.user_link
    for update
    using (uid = auth.uid())
    with check (
        uid = auth.uid()
        and (subject_id = uid or public.verify_bind_ticket(ticket_id, subject_id))
    );

-- 删：只能删自己这一行（= 退出合并，主体回落到自己）
drop policy if exists user_link_delete on public.user_link;
create policy user_link_delete on public.user_link
    for delete
    using (uid = auth.uid());

-- user_credential ---------------------------------------------------------
drop policy if exists user_credential_read on public.user_credential;
create policy user_credential_read on public.user_credential
    for select
    using (subject_id = public.current_subject_id());

-- 新增：主体必须是当前主体，且 uid 必须是当前会话（不能替别人登记凭据）
drop policy if exists user_credential_insert on public.user_credential;
create policy user_credential_insert on public.user_credential
    for insert
    with check (
        subject_id = public.current_subject_id()
        and uid = auth.uid()
    );

-- 改：自己 uid 的凭据（合并时把 subject_id 改到新主体）或本主体下的凭据
drop policy if exists user_credential_update on public.user_credential;
create policy user_credential_update on public.user_credential
    for update
    using (subject_id = public.current_subject_id() or uid = auth.uid())
    with check (subject_id = public.current_subject_id());

drop policy if exists user_credential_delete on public.user_credential;
create policy user_credential_delete on public.user_credential
    for delete
    using (subject_id = public.current_subject_id());

-- user_bind_ticket --------------------------------------------------------
-- 只能给自己所在的主体出票，票据 id 用 gen_random_uuid()，不可枚举。
drop policy if exists user_bind_ticket_read on public.user_bind_ticket;
create policy user_bind_ticket_read on public.user_bind_ticket
    for select
    using (subject_id = public.current_subject_id());

drop policy if exists user_bind_ticket_insert on public.user_bind_ticket;
create policy user_bind_ticket_insert on public.user_bind_ticket
    for insert
    with check (
        subject_id = public.current_subject_id()
        and created_by = auth.uid()
    );

drop policy if exists user_bind_ticket_update on public.user_bind_ticket;
create policy user_bind_ticket_update on public.user_bind_ticket
    for update
    using (subject_id = public.current_subject_id())
    with check (subject_id = public.current_subject_id());
