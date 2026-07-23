-- Keep comment/action history in Supabase so Render restarts do not erase it.
-- Run after supabase_ai_reply_suggestions.sql on existing projects.

alter table public.comment_logs
  drop constraint if exists comment_logs_status_check;

alter table public.comment_logs
  add constraint comment_logs_status_check
  check (status in ('success', 'failed', 'processed'));

create index if not exists comment_logs_created_at_idx
  on public.comment_logs (created_at desc);

create index if not exists comment_logs_staff_id_idx
  on public.comment_logs (staff_id);

notify pgrst, 'reload schema';

select status, count(*) as rows
from public.comment_logs
group by status
order by status;
