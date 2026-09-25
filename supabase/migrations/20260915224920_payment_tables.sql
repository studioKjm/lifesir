-- seed-v3 (결제 기능) — payment_methods / subscriptions / payment_attempts
-- User당 PaymentMethod는 최대 1건(무료체험 평생 1회 불변식의 DB 레벨 최종 방어선).
-- Subscription은 User 생애주기 동안 여러 건(재구독마다 새 레코드) 가능.

create table public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete cascade,
  billing_key text not null,
  card_last4 text not null,
  registered_at timestamptz not null default now()
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  plan text not null check (plan in ('monthly', 'yearly')),
  amount integer not null,
  status text not null check (status in ('trial', 'active', 'canceled', 'past_due', 'expired')),
  trial_end_at timestamptz,
  current_period_start timestamptz not null,
  current_period_end timestamptz not null,
  next_billing_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now()
);
create index subscriptions_user_id_idx on public.subscriptions(user_id);
-- 일일 스케줄러가 "오늘 청구 대상"을 조회할 때 쓴다(billing-service.runDailyBilling).
create index subscriptions_next_billing_at_idx on public.subscriptions(next_billing_at) where next_billing_at is not null;

create table public.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  attempted_at timestamptz not null default now(),
  result text not null check (result in ('success', 'failure')),
  amount integer not null,
  pg_transaction_id text,
  failure_reason text
);

-- 기존 테이블(20260909151031_init_schema.sql)과 동일한 이유로 service_role에만
-- 권한을 준다 — 서버 코드(src/lib/data)만 접근하고, 브라우저가 anon/authenticated
-- 롤로 직접 접근할 계획이 없다. RLS는 "enable"만 해두고(행 단위 정책은 아직
-- 없음) service_role은 RLS를 우회하므로 기능에는 영향 없다 — 실수로 anon/
-- authenticated 키가 쓰이는 사고가 나더라도 기본값이 "거부"가 되게 하는
-- 방어적 조치다.
alter table public.payment_methods enable row level security;
alter table public.subscriptions enable row level security;
alter table public.payment_attempts enable row level security;

grant select, insert, update, delete on
  public.payment_methods,
  public.subscriptions,
  public.payment_attempts
to service_role;
