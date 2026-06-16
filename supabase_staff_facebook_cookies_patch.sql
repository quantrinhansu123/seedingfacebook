-- Nhiều cookie Facebook cho mỗi nhân sự (JSONB).
-- Chạy trong Supabase SQL Editor nếu bảng staff_users đã tồn tại.

alter table public.staff_users
  add column if not exists facebook_cookies jsonb not null default '[]'::jsonb;

update public.staff_users
set facebook_cookies = case
  when coalesce(cookie, '') <> '' then jsonb_build_array(
    jsonb_build_object(
      'id', 'primary',
      'label', 'Cookie chính',
      'cookie', cookie,
      'facebook_user_id', coalesce(facebook_user_id, '')
    )
  )
  else '[]'::jsonb
end
where facebook_cookies is null
   or facebook_cookies = '[]'::jsonb;

create index if not exists staff_users_facebook_cookies_gin_idx
  on public.staff_users using gin (facebook_cookies);

select pg_notify('pgrst', 'reload schema');
