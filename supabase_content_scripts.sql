-- ============================================================
-- content_scripts — thư viện kịch bản (trang /kich-ban)
--
-- CÁCH CHẠY:
--   1. Mở https://supabase.com/dashboard → chọn đúng project
--   2. SQL Editor → New query
--   3. Dán TOÀN BỘ file này → Run
--   4. Thấy dòng cuối: table_name = content_scripts
--   5. Đợi 5 giây, reload trang Kịch bản
--
-- KHÔNG chạy supabase_schema.sql nếu chỉ cần kịch bản
-- (file đó có thể lỗi post_id ở bảng leads).
-- ============================================================

create table if not exists public.content_scripts (
    id                    text primary key,
    title                 text not null default '',
    platform              text not null default 'TikTok',
    status                text not null default 'draft',
    writer                text not null default '',
    script_date           text not null default '',
    blocks                jsonb not null default '[]'::jsonb,
    created_by_staff_id   text,
    created_by_staff_name text,
    created_at            timestamptz not null default now(),
    updated_at            timestamptz not null default now()
);

-- Ràng buộc (bỏ qua nếu đã có)
do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'content_scripts_status_check'
    ) then
        alter table public.content_scripts
            add constraint content_scripts_status_check
            check (status in ('draft', 'pending', 'approved'));
    end if;

    if not exists (
        select 1 from pg_constraint
        where conname = 'content_scripts_blocks_array_check'
    ) then
        alter table public.content_scripts
            add constraint content_scripts_blocks_array_check
            check (jsonb_typeof(blocks) = 'array');
    end if;
end $$;

-- Cột bổ sung nếu bảng cũ thiếu
alter table public.content_scripts add column if not exists title                 text default '';
alter table public.content_scripts add column if not exists platform              text default 'TikTok';
alter table public.content_scripts add column if not exists status                text default 'draft';
alter table public.content_scripts add column if not exists writer                text default '';
alter table public.content_scripts add column if not exists script_date           text default '';
alter table public.content_scripts add column if not exists blocks                jsonb default '[]'::jsonb;
alter table public.content_scripts add column if not exists created_by_staff_id   text;
alter table public.content_scripts add column if not exists created_by_staff_name text;
alter table public.content_scripts add column if not exists created_at            timestamptz default now();
alter table public.content_scripts add column if not exists updated_at            timestamptz default now();

create index if not exists content_scripts_status_idx
    on public.content_scripts (status);

create index if not exists content_scripts_updated_at_idx
    on public.content_scripts (updated_at desc);

-- RLS: Supabase mặc định bật RLS → phải tắt hoặc thêm policy (app dùng anon key)
drop policy if exists "allow anon select content scripts" on public.content_scripts;
drop policy if exists "allow anon insert content scripts" on public.content_scripts;
drop policy if exists "allow anon update content scripts" on public.content_scripts;
drop policy if exists "allow anon delete content scripts" on public.content_scripts;
drop policy if exists "content_scripts_anon_all" on public.content_scripts;

alter table public.content_scripts disable row level security;

grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on public.content_scripts to anon, authenticated, service_role;

-- Báo PostgREST tải lại schema (bắt buộc sau khi tạo bảng mới)
notify pgrst, 'reload schema';
-- Nếu app vẫn báo PGRST205: Dashboard → Settings → API → Reload schema

-- Kiểm tra: phải trả về "content_scripts"
select to_regclass('public.content_scripts')::text as table_name;
