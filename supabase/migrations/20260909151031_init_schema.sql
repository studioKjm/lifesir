-- Initial schema for seed-v1 (건강 도메인 1주일 프로토타입)
-- Entities from .harness/ouroboros/seeds/seed-v1.yaml ontology
--
-- NOTE on RLS: all tables have RLS enabled, but no policies are defined.
-- This means only the Supabase service role key can read/write (it bypasses
-- RLS by design). Only server-side code in src/lib/data uses the service
-- role key (never exposed to the client) — see ARCHITECTURE_INVARIANTS.md
-- Part 1 #1. If a future feature needs the browser to call Supabase
-- directly, add explicit per-user policies then (out of scope for seed-v1).

create extension if not exists "pgcrypto";

-- ─── agent_personas ────────────────────────────────────────────────
create table public.agent_personas (
  id uuid primary key default gen_random_uuid(),
  age_band text not null check (age_band in ('10s', '20s', '30s', '40s', '50s_plus')),
  tone text not null,
  system_prompt text not null,
  unique (age_band)
);
alter table public.agent_personas enable row level security;

-- ─── users (public.users extends auth.users 1:1) ──────────────────
create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  name text not null,
  birth_date date not null,
  agent_persona_id uuid references public.agent_personas (id),
  created_at timestamptz not null default now()
);
alter table public.users enable row level security;

-- ─── care_links ─────────────────────────────────────────────────────
create table public.care_links (
  id uuid primary key default gen_random_uuid(),
  requester_user_id uuid not null references public.users (id) on delete cascade,
  target_user_id uuid not null references public.users (id) on delete cascade,
  status text not null check (status in ('pending', 'accepted', 'rejected', 'revoked')) default 'pending',
  consent_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  check (requester_user_id <> target_user_id),
  unique (requester_user_id, target_user_id)
);
alter table public.care_links enable row level security;
create index care_links_target_idx on public.care_links (target_user_id, status);
create index care_links_requester_idx on public.care_links (requester_user_id, status);

-- ─── health_logs ────────────────────────────────────────────────────
create table public.health_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  logged_by_user_id uuid not null references public.users (id),
  log_type text not null check (log_type in ('exercise', 'sleep', 'weight', 'meal', 'medication')),
  value text not null,
  unit text,
  logged_at timestamptz not null,
  note text,
  created_at timestamptz not null default now()
);
alter table public.health_logs enable row level security;
create index health_logs_user_idx on public.health_logs (user_id, log_type, logged_at desc);

-- ─── conversations / messages ───────────────────────────────────────
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  agent_persona_id uuid not null references public.agent_personas (id),
  started_at timestamptz not null default now()
);
alter table public.conversations enable row level security;
create index conversations_user_idx on public.conversations (user_id, started_at desc);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  created_at timestamptz not null default now()
);
alter table public.messages enable row level security;
create index messages_conversation_idx on public.messages (conversation_id, created_at asc);

-- ─── grants ──────────────────────────────────────────────────────
-- RLS "enable"는 행 단위 접근을 제어할 뿐, 테이블 자체에 대한 권한(GRANT)은
-- 별개로 필요하다. 이 프로젝트는 서버 코드(src/lib/data)가 service_role
-- 키로만 접근하고(ARCHITECTURE_INVARIANTS.md #1), 브라우저가 anon/authenticated
-- 롤로 직접 접근할 계획이 없으므로 service_role에만 권한을 준다.
grant usage on schema public to service_role;
grant select, insert, update, delete on
  public.agent_personas,
  public.users,
  public.care_links,
  public.health_logs,
  public.conversations,
  public.messages
to service_role;

-- ─── seed data: 5 age-band AgentPersonas (AC-002) ──────────────────
insert into public.agent_personas (age_band, tone, system_prompt) values
  ('10s', '친근하고 격려하는 반말 섞인 톤', '당신은 10대 사용자를 위한 건강 코치입니다. 친근하고 격려하는 말투를 쓰고, 어려운 의학 용어 대신 쉬운 말로 설명하세요.'),
  ('20s', '캐주얼하고 목표지향적인 톤', '당신은 20대 사용자를 위한 건강 코치입니다. 자기관리와 목표 달성에 초점을 맞춰 실용적인 조언을 캐주얼한 어투로 제공하세요.'),
  ('30s', '균형 잡힌 전문적인 톤', '당신은 30대 사용자를 위한 건강 코치입니다. 일과 삶의 균형을 고려하여 실행 가능한 조언을 신뢰감 있는 어투로 제공하세요.'),
  ('40s', '차분하고 신중한 톤', '당신은 40대 사용자를 위한 건강 코치입니다. 만성질환 예방과 꾸준한 관리에 초점을 맞춰 차분하고 신중하게 조언하세요.'),
  ('50s_plus', '정중하고 세심한 존댓말 톤', '당신은 50대 이상 사용자를 위한 건강 코치입니다. 정중한 존댓말을 사용하고, 안전과 꾸준함을 강조하며 세심하게 조언하세요.');
