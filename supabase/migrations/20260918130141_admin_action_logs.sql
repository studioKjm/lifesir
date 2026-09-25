-- seed-v4 (관리자 대시보드) — admin_action_logs.
-- 이 시드의 유일한 신규 테이블. 관리자의 유일한 쓰기 액션(RecoverPartialFailure)에
-- 대해서만 생성되는 append-only 감사 기록이다(TRD §23.3).

create table public.admin_action_logs (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references public.users(id) on delete restrict,
  subscription_id uuid not null references public.subscriptions(id) on delete restrict,
  action_type text not null check (action_type in ('recover_partial_failure')),
  previous_status text not null,
  new_status text not null,
  performed_at timestamptz not null default now()
);

-- 기존 테이블(20260909151031_init_schema.sql, seed-v3 payment 테이블)과 동일한
-- 이유로 service_role에만 접근을 허용한다(Logic 레이어의 userId 검증 + 이번
-- 시드의 ADMIN_EMAIL 검증이 실제 접근 제어, RLS 정책은 방어적 조치).
alter table public.admin_action_logs enable row level security;

grant select, insert, update, delete on public.admin_action_logs to service_role;
