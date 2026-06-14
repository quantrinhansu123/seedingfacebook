-- Sửa lỗi 42501: new row violates row-level security policy
-- Chạy file này trong Supabase SQL Editor (project xhesagiugewwtuedxyxo)

-- Xóa policy cũ (nếu có)
drop policy if exists "allow anon select content scripts" on public.content_scripts;
drop policy if exists "allow anon insert content scripts" on public.content_scripts;
drop policy if exists "allow anon update content scripts" on public.content_scripts;
drop policy if exists "allow anon delete content scripts" on public.content_scripts;
drop policy if exists "content_scripts_anon_all" on public.content_scripts;

-- Tắt RLS (giống các bảng khác trong supabase_schema.sql)
alter table public.content_scripts disable row level security;

-- Quyền cho app dùng publishable/anon key
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on public.content_scripts to anon, authenticated, service_role;

notify pgrst, 'reload schema';

select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'content_scripts';
