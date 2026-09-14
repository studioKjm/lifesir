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
| `app/dashboard/[careLinkId]/page.tsx` | 부모 대시보드. 기록 열람은 읽기전용(15초 polling) + HealthLogForm으로 대리 기록 | AC-005, AC-007 |
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

---

# seed-v2 — 구글 OAuth 로그인 + 세션 관리 표준화

> Source seed: `.harness/ouroboros/seeds/seed-v2.yaml` (v2, ambiguity 0.125)
> Generated: 2026-09-13
> seed-v1의 브라운필드 확장 — 3개 시드 로드맵(OAuth → 결제 → 어드민)의 첫 번째

## 8. Overview

- **목표 요약**: 이메일/비밀번호 로그인을 그대로 두고 구글 OAuth를 두 번째 로그인 옵션으로 추가한다. 이 과정에서 세션 관리를 기존 커스텀 쿠키(T-018/T-019)에서 Supabase 표준(`@supabase/ssr`)으로 전환한다.
- **핵심 리서치 결론**: 동일 이메일 계정 자동 연결(AC-003)은 우리 코드가 구현하지 않는다 — Supabase Auth(GoTrue)가 표준 OAuth 플로우를 타기만 하면 verified 이메일 기준으로 자동 처리한다 ([Supabase 공식 문서](https://supabase.com/docs/guides/auth/auth-identity-linking)).
- **아키텍처 패턴**: 3-tier layered 유지 (seed-v1과 동일 원칙)

```
[Presentation]                    [Logic]                        [Data]
로그인 페이지 구글 버튼      →   auth-service(확장)          →  supabase-client(확장)
app/auth/callback/route.ts        - exchangeGoogleSession()        - createServerSupabaseClient()
app/onboarding/                   - completeOnboarding()             (요청마다 새로 생성, 캐싱 금지)
src/proxy.ts (재작성)             - getSessionUser() 재작성        - createBrowserSupabaseClient()
                                                                      (anon key, src/lib/supabase-browser.ts)
                                                                    - 기존 admin.createUser 기반
                                                                      이메일가입 로직은 변경 없음
```

## 9. Layer Design

### 9.1 Presentation Layer — `src/app/`, `src/components/`

> Google Cloud Console에서 OAuth 클라이언트를 발급받는 절차는 `docs/google-oauth-setup.md` 참고 (에이전트가 대신 할 수 없는 외부 계정 작업).

| 페이지/라우트/컴포넌트 | 설명 | AC |
|---|---|---|
| `components/GoogleSignInButton.tsx` (신규, client component) | "구글로 계속하기" 버튼. `@/lib/supabase-browser`의 브라우저 클라이언트로 `signInWithOAuth()` 호출 후 구글로 리다이렉트 | AC-001 |
| `app/(auth)/login/page.tsx` (수정) | 기존 이메일/비밀번호 폼은 그대로, `GoogleSignInButton` 추가 | AC-001, AC-002 |
| `app/auth/callback/route.ts` (신규) | OAuth 콜백. `auth-service.exchangeGoogleSession(code)` 호출 후 세션 쿠키가 심긴 상태로 `/dashboard`(또는 온보딩 필요 시 그대로 두고 배너로 유도)로 리다이렉트 | AC-001, AC-003 |
| `app/onboarding/page.tsx`, `app/onboarding/actions.ts` (신규) | 생년월일 입력 폼 + Server Action(`auth-service.completeOnboarding` 호출) | AC-004 |
| `components/OnboardingBanner.tsx` (신규) | AgentPersona 미매칭 사용자에게 대시보드/채팅 상단에 노출되는 소프트 유도 배너 (강제 리다이렉트 아님) | AC-004 |
| `src/proxy.ts` (재작성) | `@supabase/ssr`의 서버 클라이언트로 세션을 읽고 필요 시 갱신. 쿠키 존재 여부만 보던 기존 로직 대체 | AC-005 |
| `src/app/_lib/session.ts` (대폭 축소/제거) | `getSession()`은 유지하되 내부 구현을 `@supabase/ssr` 기반으로 교체. `AUTH_COOKIE_NAME` 커스텀 쿠키 관련 코드는 삭제 | AC-005, AC-006 |

**책임**: HTTP 요청/응답 처리, OAuth 리다이렉트 트리거(브라우저), UI 렌더링. 비즈니스 로직·Data 접근 없음 — seed-v1과 동일 원칙.

**`GoogleSignInButton`이 `src/lib/supabase-browser`를 직접 부르는 것에 대한 근거**: `signInWithOAuth()`는 DB 조회나 비즈니스 로직 실행이 아니라 "브라우저를 구글 동의화면으로 보내는 것"뿐이다 — `<a href={url}>`과 기능적으로 동급이라 Presentation의 UI 내비게이션 책임 범위 안에 있다고 판단했다. 이 클라이언트는 anon/publishable key만 사용하며 서비스 롤 키에는 절대 접근하지 않는다(§8 게이트 정비 참고).

### 9.2 Logic Layer — `src/services/auth-service.ts` (확장)

| 함수 | 책임 | AC | Complexity |
|---|---|---|---|
| `exchangeGoogleSession(code)` | `@/lib/data`의 서버 클라이언트로 `exchangeCodeForSession(code)` 호출, 결과를 기존 `AuthResult` DTO로 변환 | AC-001, AC-003 | high |
| `getSessionUser()` (재작성) | 기존엔 커스텀 액세스 토큰을 인자로 받았지만, `@supabase/ssr` 전환 후엔 요청 쿠키에서 세션을 직접 읽는 방식으로 바뀐다. 반환 타입(`{id, email, name}`)은 유지해 Presentation 쪽 호출부(`getSession()`)를 안 건드린다 | AC-005 | high |
| `completeOnboarding(userId, birthDate)` | `agent-persona-service.getPersonaForBirthDate` 재사용(seed-v1) + `user-repository`로 `birth_date`/`agent_persona_id` 갱신 | AC-004 | medium |
| `signUp`, `signIn` (변경 없음) | 기존 `admin.createUser`/`signInWithPassword` 로직 그대로. 세션을 쿠키에 심는 부분만 `@supabase/ssr` 헬퍼로 교체 | AC-002 | low(변경) |

**에러 핸들링**: `exchangeGoogleSession` 실패(코드 만료, 미verified 이메일로 인한 연결 거부 등)는 `AuthError`로 통일해 Presentation이 안내 메시지를 보여줄 수 있게 한다 (seed-v1 패턴 재사용).

### 9.3 Data Layer — `src/lib/data/`, `src/lib/supabase-browser.ts`(신규)

| 모듈 | 책임 |
|---|---|
| `supabase-client.ts` (확장) | `createServerSupabaseClient()` 추가 — `@supabase/ssr`의 `createServerClient`, 쿠키 getAll/setAll 어댑터 필요. **요청마다 새로 생성하며 절대 캐싱하지 않는다** — 캐싱하면 2026-09-11에 발견한 세션 유출 버그(NEXT-005 컨벤션)와 동일한 클래스의 문제가 재발한다. 기존 `getSupabaseClient()`(서비스 롤 싱글턴), `createAuthClient()`(서비스 롤 논캐시)는 그대로 유지 |
| `user-repository.ts` (수정) | `CreateUserInput.birthDate`를 optional로, `birth_date` 컬럼도 nullable로 마이그레이션. `updateProfile(id, {birthDate, agentPersonaId})` 같은 갱신 함수 추가 |
| `src/lib/supabase-browser.ts` (신규, Data 레이어 아님) | `createBrowserSupabaseClient()` — `@supabase/ssr`의 `createBrowserClient`, anon/publishable key만 사용. `src/lib/data`가 아니라 별도 위치에 둬서 "서버 전용 Data 레이어"와 명확히 분리한다 — `src/components`가 이 모듈만은 예외적으로 import할 수 있다(§10 게이트 정비) |

**엔티티 변경**: `users.birth_date` NOT NULL → NULL 허용 (마이그레이션 필요). `users.agent_persona_id`는 기존과 동일하게 이미 nullable.

## 10. Layer Communication

- **Presentation → Logic**: 기존과 동일(Server Action/Route Handler가 `src/services` 직접 호출). 예외적으로 `GoogleSignInButton`(client component)만 브라우저 전용 `src/lib/supabase-browser`를 직접 호출 — DB/서비스 롤 접근이 아니므로 계층 위반으로 보지 않는다
- **Logic → Data**: 기존과 동일
- **`src/proxy.ts`**: 페이지도 서비스도 아닌 프레임워크 진입점이라 레이어 표의 대상이 아니다. 세션 갱신을 위해 `@supabase/ssr` 서버 클라이언트를 직접 만드는 것을 예외로 허용한다(Supabase 공식 패턴과 동일, T-018부터의 기존 관례) — 여기서 DB 테이블 조회/변경은 하지 않는다

### 게이트 정비 (이번 TRD와 함께 반영, 완료됨)
- `ARCHITECTURE_INVARIANTS.md` Part 2, `.harness/gates/rules/boundaries.yaml`: `src/app`·`src/components` 금지 목록에 `@supabase/ssr` 추가
- `src/components`가 `@/lib/supabase-browser`만은 예외적으로 import할 수 있음을 문서화(게이트 스크립트가 함수 단위 화이트리스트를 지원하지 않으므로, 애초에 그 모듈을 `@/lib/data` 바깥에 둬서 규칙에 안 걸리게 하는 방식으로 해결)
- `src/proxy.ts`의 `@supabase/ssr` 서버 클라이언트 직접 생성은 예외로 명문화(ARCHITECTURE_INVARIANTS.md Part 2 각주)

## 11. Directory Structure (diff, seed-v1 대비)

```
src/
  app/
    auth/callback/route.ts        (신규) — OAuth 콜백
    onboarding/
      page.tsx                    (신규)
      actions.ts                  (신규)
    (auth)/login/page.tsx         (수정) — 구글 버튼 추가
  components/
    GoogleSignInButton.tsx        (신규, client component)
    OnboardingBanner.tsx          (신규)
  services/
    auth-service.ts               (수정) — exchangeGoogleSession, completeOnboarding 추가, getSessionUser 재작성
  lib/
    data/
      supabase-client.ts          (수정) — createServerSupabaseClient 추가
      user-repository.ts          (수정) — birthDate optional, updateProfile 추가
    supabase-browser.ts           (신규, Data 레이어 아님)
  proxy.ts                        (재작성) — @supabase/ssr 기반 세션 갱신
  app/_lib/session.ts             (축소) — AUTH_COOKIE_NAME 관련 코드 제거
supabase/migrations/
  ..._nullable_birth_date.sql     (신규) — users.birth_date NOT NULL 제거
```

## 12. Test Strategy

- **Logic (`tests/unit/services/`)**: `exchangeGoogleSession`(성공/코드만료/미verified 연결거부), `completeOnboarding`(정상/이미 매칭된 경우), `getSessionUser` 재작성분 — `@supabase/ssr` 클라이언트는 mock
- **Data (`tests/integration/data/`)**: `user-repository`의 `birthDate` optional 생성 + 이후 갱신 시나리오. 실제 Google OAuth 핸드셰이크는 통합 테스트로 다루지 않는다(외부 서비스 의존)
- **Presentation (`tests/e2e/`)**: 콜백 라우트는 가짜 인가 코드로 세션 교환 실패/성공 경로를 E2E로 검증. **실제 구글 동의화면 클릭은 자동화하지 않고 수동 검증**(seed-v2 non_goals) — 이 경계를 테스트 파일 주석에 명시한다
- **원칙**: seed-v1과 동일, 구현과 테스트를 함께 작성한다

## 13. Decisions & Trade-offs

| 결정 | 이유 | Resource | Impact |
|---|---|---|---|
| 세션 관리를 `@supabase/ssr` 표준으로 전환 | OAuth 리다이렉트 흐름과 자연스럽게 맞고 공식 권장 방식 | 중간(기존 T-018/T-019 재작성 필요) | 유지보수 비용 ↓, 신규 의존성 1개 추가 |
| 계정 자동 연결을 GoTrue 내장 기능에 위임 | 우리가 직접 구현·검증할 코드가 사라짐, 보안 검증도 Supabase가 담당 | 매우 낮음 | 커스텀 로직 대비 버그 표면적 ↓ |
| 브라우저 Supabase 클라이언트를 `src/lib/data` 밖에 배치 | 게이트 규칙에 함수 단위 예외를 만들 필요 없이, 애초에 그 경로가 규칙 대상이 아니게 설계 | 낮음 | 게이트 스크립트 수정 최소화 |
| 온보딩을 강제 리다이렉트가 아닌 배너 유도로 | seed-v2 must 제약("생년월일 입력 전에도 정상 사용 가능") 충족 | 낮음 | UX 마찰 감소, 대신 미매칭 상태가 오래 지속될 수 있음(허용된 트레이드오프) |
| 구글 동의화면은 수동 검증, 콜백부터 자동 E2E | 실제 구글 로그인 흐름을 Playwright로 안정적으로 자동화하기 어려움(사용자 결정) | 낮음 | 이 경계 밖의 회귀는 수동 검증에 의존 |

## 14. Implementation Order

`/decompose`에서 이 순서를 레이어별 원자 태스크로 쪼갠다:

1. **Data**: `users.birth_date` nullable 마이그레이션 → `user-repository` 수정(+integration test) → `supabase-client.createServerSupabaseClient` → `src/lib/supabase-browser.ts`
2. **Logic**: `auth-service.exchangeGoogleSession` → `auth-service.getSessionUser` 재작성 → `auth-service.completeOnboarding` (각 직후 unit test, `@supabase/ssr` mock)
3. **Presentation**: `src/proxy.ts` 재작성(세션 게이트) → `GoogleSignInButton` + 로그인 페이지 수정 → `app/auth/callback/route.ts` → `app/onboarding/` → `OnboardingBanner` → 로그아웃 통합 확인 (완성되는 대로 관련 Playwright 시나리오 작성, 마지막에 AC-001~007 전체 확인 + 구글 동의화면 수동 검증)
