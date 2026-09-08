# Technical Requirements Document — 건강 도메인 1주일 프로토타입

> Source seed: `.harness/ouroboros/seeds/seed-v1.yaml` (v1, ambiguity 0.11)
> Generated: 2026-09-09

## 1. Overview

- **목표 요약**: 부모-자녀가 함께 쓰는 건강 관리 앱의 1주일 UI/UX 프로토타입. 연령대별로 다르게 응답하는 AI 에이전트와, 동의 기반으로 자녀가 부모의 건강 데이터를 확인하는 가족 케어 경험을 검증한다.
- **아키텍처 패턴**: 3-tier layered (ARCHITECTURE_INVARIANTS.md Part 1 준수)
- **스택**: Next.js(App Router) + React, Supabase(Postgres + Auth), Vercel AI Gateway(LLM), Playwright(E2E)

```
[Presentation]                [Logic]                      [Data]
src/app, src/components  →   src/services            →    src/lib/data, src/lib/llm
페이지/컴포넌트/                비즈니스 규칙,                  Supabase 레포지토리,
Route Handler/Server Action    권한 검증, 프롬프트 조립          LLM 클라이언트
```

**핵심 설계 결정 (레이어 경계 관련, 논의 확정본)**: seed-v1의 must 제약 "API routes/Server Actions가 Logic 계층"을 물리적 배치가 아니라 **역할**로 해석한다. `src/app` 아래의 Route Handler/Server Action은 요청을 파싱해 `src/services`를 호출하는 얇은 어댑터로만 두고, 실제 비즈니스 로직·Data 레이어 호출은 전부 `src/services`에 둔다. 이렇게 해야 `src/app` 전체(페이지+API 모두)를 "Data 레이어 직접 호출 금지" 게이트 규칙 하나로 일관되게 강제할 수 있다 (아래 4장, 게이트 정비 참고).

## 2. Layer Design

### 2.1 Presentation Layer — `src/app/`, `src/components/`

| 페이지/라우트 | 설명 | AC |
|---|---|---|
| `app/(auth)/signup/page.tsx` | 회원가입 폼 (email, password, name, birth_date) | AC-001 |
| `app/(auth)/login/page.tsx` | 로그인 폼 | AC-001 |
| `app/dashboard/page.tsx` | 본인 HealthLog 대시보드 (Server Component) | AC-006 |
| `app/dashboard/[careLinkId]/page.tsx` | 부모 대시보드, 읽기전용, 15초 polling | AC-007 |
| `app/care-links/page.tsx` | CareLink 요청 보내기/목록/수락·거절 | AC-003, AC-004 |
| `app/chat/page.tsx` | AI 에이전트 대화 UI (스트리밍 표시) | AC-008, AC-009 |
| `app/api/chat/route.ts` | LLM 스트리밍 응답 Route Handler | AC-008 |
| `app/api/dashboard/[careLinkId]/route.ts` | polling용 JSON 엔드포인트 (CareLink 권한 재검증) | AC-007 |
| `middleware.ts` | 세션 체크, 미인증 시 `/login` 리다이렉트 | AC-001 |

**컴포넌트**: `HealthLogForm`, `DashboardChart`, `CareLinkRequestCard`, `ChatWindow`

**책임**: HTTP 요청/응답 처리, 입력 검증(형식), UI 렌더링. `src/services`의 함수를 호출하는 것 외에 비즈니스 로직·Data 접근 없음.

**요청/응답 DTO** (`src/types/dto.ts`):
```ts
SignUpInput { email, password, name, birthDate }
HealthLogInput { logType: 'exercise'|'sleep'|'weight'|'meal'|'medication', value, unit?, loggedAt, note?, targetUserId? }
DashboardView { entries: HealthLogEntryDTO[], summaryByType: Record<LogType, Summary> }
CareLinkRequestInput { targetEmail }
CareLinkDecisionInput { careLinkId, decision: 'accept'|'reject' }
ChatMessageInput { conversationId, content }
```

### 2.2 Logic Layer — `src/services/`

| 서비스 | 책임 | AC | Complexity |
|---|---|---|---|
| `auth-service.ts` | 회원가입 오케스트레이션(Supabase Auth 호출 + AgentPersona 매칭 트리거), 로그인 | AC-001 | medium |
| `agent-persona-service.ts` | birth_date → age_band(10s/20s/30s/40s/50s_plus) 매핑, AgentPersona 조회 | AC-002 | medium |
| `care-link-service.ts` | CareLink 요청/수락/거절, pending→accepted/rejected 상태 전이 강제 | AC-003 | medium |
| `care-link-service.ts` (권한 검증) | 다른 서비스가 호출하는 `assertCareLinkAccepted(actorId, targetId)` — 미승인 시 예외 | AC-004 | high |
| `health-log-service.ts` | HealthLog 생성, 본인/대리입력(CareLink accepted) 권한 체크 | AC-005 | medium |
| `dashboard-service.ts` | 본인/부모 대시보드 공용 집계, `assertCareLinkAccepted` 재호출 | AC-006, AC-007 | medium |
| `agent-conversation-service.ts` | 최근 HealthLog N건을 프롬프트 컨텍스트로 조립, LLMClient 호출, 실패 시 폴백 메시지로 변환 | AC-008 | high |
| `agent-conversation-service.ts` (persona 반영) | AgentPersona.tone/system_prompt를 프롬프트에 결합 | AC-009 | medium |

**에러 핸들링 원칙**: Data 레이어에서 던진 예외(`LLMError`, `RepositoryError`)는 반드시 Logic이 catch하여 사용자에게 보여줄 수 있는 결과(DTO 또는 폴백 값)로 변환한다. Presentation과 Data는 서로의 예외 타입을 알지 못한다.

### 2.3 Data Layer — `src/lib/data/`, `src/lib/llm/`

| 모듈 | 책임 |
|---|---|
| `supabase-client.ts` | 서버 전용 Supabase 클라이언트 생성 (service role, `src/lib/data` 내부에서만 사용) |
| `user-repository.ts` | User CRUD |
| `care-link-repository.ts` | CareLink CRUD, status 갱신 |
| `health-log-repository.ts` | HealthLog CRUD, user_id/logged_by_user_id별 조회 |
| `conversation-repository.ts`, `message-repository.ts` | Conversation/Message CRUD |
| `agent-persona-repository.ts` | age_band → AgentPersona 조회 |
| `llm-client.ts` | Vercel AI Gateway 호출 래퍼 (`ai` SDK, `"anthropic/claude-*"` 등 provider/model 문자열) |

**엔티티 → 테이블**: seed-v1 `ontology.entities` 그대로 Postgres 테이블화 (users, care_links, health_logs, conversations, messages, agent_personas). `users`는 Supabase Auth의 `auth.users`와 1:1 확장 테이블(`public.users`, FK = auth.users.id)로 둔다.

## 3. Layer Communication

- **Presentation → Logic**: `src/app`의 Server Action/Route Handler가 `src/services`의 함수를 직접 호출 (서버 사이드 함수 호출, HTTP 아님)
- **Logic → Data**: Logic이 `src/lib/data`, `src/lib/llm`의 함수를 직접 호출 (repository 패턴)
- **데이터 전달 형식**: Presentation↔Logic 경계는 `src/types/dto.ts`의 DTO로 엄격히 분리. Logic↔Data 경계는 리소스 절약을 위해 repository 반환 타입을 그대로 재사용(1주 스코프 한정 결정, seed tech_decisions에 근거)

## 4. Directory Structure

```
src/
  app/
    (auth)/signup/page.tsx
    (auth)/login/page.tsx
    dashboard/page.tsx
    dashboard/[careLinkId]/page.tsx
    care-links/page.tsx
    chat/page.tsx
    api/
      chat/route.ts
      dashboard/[careLinkId]/route.ts
    layout.tsx
  components/
    health-log-form.tsx
    dashboard-chart.tsx
    care-link-request-card.tsx
    chat-window.tsx
  services/
    auth-service.ts
    agent-persona-service.ts
    care-link-service.ts
    health-log-service.ts
    dashboard-service.ts
    agent-conversation-service.ts
  lib/
    data/
      supabase-client.ts
      user-repository.ts
      care-link-repository.ts
      health-log-repository.ts
      conversation-repository.ts
      message-repository.ts
      agent-persona-repository.ts
    llm/
      llm-client.ts
  types/
    dto.ts
  middleware.ts
tests/
  unit/services/          # Logic 단위 테스트
  integration/data/        # Data 통합 테스트
  e2e/                      # Playwright
```

### 게이트 정비 (이번 TRD와 함께 반영)
- `.harness/gates/rules/boundaries.yaml`에 App Router 대응 규칙 추가: `src/app` 전체(페이지+`api/`)에서 `@/lib/data`, `@/lib/llm`, `@supabase/supabase-js`, `prisma` 직접 import 금지 → `src/services` 경유 강제
- `src/lib/data`, `src/lib/llm`에서 `react`/`next/*`/`@/app`/`@/components` import 금지 (Data→Presentation 역참조 차단)
- `ARCHITECTURE_INVARIANTS.md` Part 1 항목 4에 "CareLink 동의 없는 접근 금지"를 프로젝트 고유 invariant로 채움, Part 2 Dependency Boundaries 표를 위 규칙으로 채움

## 5. Test Strategy

- **Logic (`tests/unit/services/`)**: 각 서비스를 순수 함수처럼 테스트. `src/lib/data`, `src/lib/llm`은 레이어 경계에서만 mock. 예 — `care-link-service.test.ts`: pending→accepted 전이, 미승인 상태에서 `assertCareLinkAccepted`가 예외를 던지는지(AC-004)
- **Data (`tests/integration/data/`)**: 실제 Supabase(테스트 프로젝트/스키마) 대상 통합 테스트. repository CRUD와 FK 제약(HealthLog는 반드시 User에 belongs_to) 검증
- **Presentation (`tests/e2e/`, Playwright)**: AC-011 전체 플로우(회원가입→로그인→CareLink 요청/수락→HealthLog 기록→대시보드 확인→AI 대화) + AC-004(미승인 상태 접근 거부) + AC-010(신규 사용자/미연결/LLM 실패 예외 화면) 별도 시나리오
- **원칙**: 구현 직후 해당 테스트를 바로 작성한다 (CLAUDE.md "구현과 테스트를 함께 작성" / 일괄 작성 금지)

## 6. Decisions & Trade-offs

| 결정 | 이유 | Resource | Impact |
|---|---|---|---|
| Supabase (Postgres+Auth) | Next.js와 궁합 좋고 무료 티어, 인증 내장 | 낮음 | 표준 Postgres라 락인 낮음 |
| Vercel AI Gateway | provider 무관 문자열로 모델 호출, 관측성 내장 | 낮음 | 벤더 락인 없음, 모델 교체 쉬움 |
| 부모 대시보드 갱신 = 15초 polling | `useEffect`/SWR만으로 구현 가능 | 매우 낮음 | 진짜 실시간은 아니나 1주 스코프엔 충분. Future: Supabase Realtime |
| Playwright | Next.js와 궁합 좋고 설치 간단, `webapp-testing` 스킬과 일치 | 낮음 | — |
| Route Handler/Server Action을 얇게 유지, 실 로직은 `src/services` | 게이트가 `src/app` 전체를 일관되게 감시 가능 | 낮음(설계 시점 결정, 구현 비용 동일) | 경계 위반을 자동으로 잡을 수 있어 유지보수성 ↑ |
| Presentation↔Logic만 엄격 DTO, Logic↔Data는 타입 재사용 | 1주 스코프에서 보일러플레이트 최소화 | 낮음 | 추후 Data 스키마 변경 시 Logic도 함께 변경 필요(허용된 트레이드오프) |

## 7. Implementation Order

`/decompose`에서 이 순서를 레이어별 원자 태스크로 쪼갠다:

1. **Data**: `supabase-client.ts` → 6개 repository → `llm-client.ts` (각 repository 직후 integration test)
2. **Logic**: `agent-persona-service` → `auth-service` → `care-link-service`(+`assertCareLinkAccepted`) → `health-log-service` → `dashboard-service` → `agent-conversation-service` (각 서비스 직후 unit test)
3. **Presentation**: `middleware.ts`(세션) → 회원가입/로그인 페이지 → care-links 페이지 → health-log-form/dashboard 페이지(본인→부모) → chat 페이지 (완성되는 대로 관련 Playwright 시나리오 작성, 마지막에 AC-011 풀 플로우)
