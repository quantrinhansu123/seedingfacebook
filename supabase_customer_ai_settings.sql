-- Bảng lưu cấu hình AI theo từng user/khách.
-- Dùng để khách nhập API key một lần trong màn Content/Kịch bản.

create extension if not exists pgcrypto;

create table if not exists public.customer_ai_settings (
    id            uuid primary key default gen_random_uuid(),
    staff_key     text not null unique,
    staff_id      text,
    username      text,
    customer_name text,
    provider      text not null default 'gemini',
    model         text not null default 'gemini-3.1-pro-preview',
    api_key       text,
    api_keys      jsonb not null default '{}'::jsonb,
    content_setup jsonb not null default '{}'::jsonb,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);

alter table public.customer_ai_settings
add column if not exists content_setup jsonb not null default '{}'::jsonb;

create or replace function public.set_customer_ai_settings_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists trg_customer_ai_settings_updated_at on public.customer_ai_settings;
create trigger trg_customer_ai_settings_updated_at
before update on public.customer_ai_settings
for each row
execute function public.set_customer_ai_settings_updated_at();

create index if not exists idx_customer_ai_settings_staff_key
on public.customer_ai_settings (staff_key);

-- App hiện dùng backend riêng nhưng backend đang cầm publishable key.
-- Bật RLS và tạo policy mở cho anon/authenticated để PostgREST cho ghi bảng này.
-- Cách bảo mật hơn cho production: dùng SUPABASE_SERVICE_ROLE_KEY ở backend,
-- rồi thay policy mở này bằng policy chặt hơn hoặc chỉ dùng service_role.
alter table public.customer_ai_settings enable row level security;

drop policy if exists "customer_ai_settings_anon_select" on public.customer_ai_settings;
drop policy if exists "customer_ai_settings_anon_insert" on public.customer_ai_settings;
drop policy if exists "customer_ai_settings_anon_update" on public.customer_ai_settings;
drop policy if exists "customer_ai_settings_anon_delete" on public.customer_ai_settings;
drop policy if exists "customer_ai_settings_anon_all" on public.customer_ai_settings;

create policy "customer_ai_settings_anon_all"
on public.customer_ai_settings
for all
to anon, authenticated
using (true)
with check (true);

grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on public.customer_ai_settings to anon, authenticated, service_role;

notify pgrst, 'reload schema';

select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as force_rls
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'customer_ai_settings';
