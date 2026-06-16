-- Gắn danh sách nhóm Facebook mỗi nhân sự quản lý (JSONB).
-- Chạy trong Supabase SQL Editor nếu bảng staff_users đã tồn tại.

alter table public.staff_users
  add column if not exists managed_groups jsonb not null default '[]'::jsonb;

update public.staff_users
set managed_groups = '[]'::jsonb
where managed_groups is null;

create index if not exists staff_users_managed_groups_gin_idx
  on public.staff_users using gin (managed_groups);

select pg_notify('pgrst', 'reload schema');
