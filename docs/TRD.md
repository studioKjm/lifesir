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

---

# seed-v3 — 결제 기능 (토스페이먼츠 구독형 정기결제)

> seed-v2의 브라운필드 확장 — 3개 시드 로드맵(OAuth → 결제 → 어드민)의 두 번째

## 15. Overview

- **목표 요약**: AI 코치(`/chat`)만 토스페이먼츠 정기결제 구독(월 9,900원/연 99,000원)으로 잠근다. 건강 기록·케어링크는 영구 무료. 7일 무료체험(카드 등록 필수, 평생 1회)을 거쳐 자동 유료 전환한다.
- **핵심 리서치 결론** ([토스페이먼츠 공식 문서](https://docs.tosspayments.com) 확인):
  - 빌링키 발급: 클라이언트 `payment.requestBillingAuth()` → `successUrl`로 `authKey`+`customerKey` 콜백 → 서버가 `POST /v1/billing/authorizations/issue`로 billingKey 교환
  - 자동결제 실행: 서버가 `POST /v1/billing/{billingKey}` 직접 호출(customerKey, amount, orderId, orderName)
  - **"토스페이먼츠에서는 자체적으로 스케줄링 기능을 제공하지 않는다"** — 공식 문서 명시. seed-v3 인터뷰의 "우리 서버가 직접 트리거" 결정은 애초에 유일한 선택지였음이 리서치로 확인됨
  - **신규 npm 의존성 불필요** — 클라이언트는 `<script src="https://js.tosspayments.com/v2/standard">` 스크립트 태그로, 서버는 순수 REST(`fetch`)로 호출
- **아키텍처 패턴**: 3-tier layered 유지 (seed-v1/v2와 동일 원칙)

```
[Presentation]                         [Logic]                          [Data]
PlanSelector(플랜선택)             →   subscription-service(신규)   →   toss-client(신규)
app/subscription/page.tsx               - startFreeTrial()                - REST fetch, Basic Auth
  (구독 시작/상태조회/해지 통합)          - resubscribe()                   (신규 npm 패키지 없음)
app/subscription/callback/route.ts      - cancelSubscription()
  (authKey 콜백, 얇은 어댑터)            - checkAICoachAccess()          subscription-repository(신규)
app/subscription/actions.ts         billing-service(신규)              payment-method-repository(신규)
src/lib/toss-browser.ts(신규,           - runDailyBilling()              payment-attempt-repository(신규)
  Presentation 쪽 공개 유틸)             - expireCanceledSubscriptions()
app/api/cron/billing/route.ts
  (Vercel Cron이 호출, 얇은 어댑터)
app/chat/page.tsx (수정) + api/chat/route.ts (수정) — checkAICoachAccess 게이트 추가
```

## 16. Layer Design

### 16.1 Presentation Layer — `src/app/`, `src/components/`, `src/lib/toss-browser.ts`

| 페이지/라우트/컴포넌트 | 설명 | AC |
|---|---|---|
| `components/PlanSelector.tsx` (신규, client component) | 월간/연간 플랜 선택 UI. `src/lib/toss-browser.ts`로 `requestBillingAuth()` 호출 후 토스 카드 등록 화면으로 리다이렉트 | AC-002 |
| `src/lib/toss-browser.ts` (신규, Data 레이어 아님) | 브라우저에서 토스 v2 SDK(`<script src="https://js.tosspayments.com/v2/standard">`)를 로드하고 `TossPayments(clientKey).payment({customerKey}).requestBillingAuth('CARD', {...})`를 호출하는 유틸. `NEXT_PUBLIC_TOSS_CLIENT_KEY`(퍼블릭 키)만 사용 — `src/lib/supabase-browser.ts`(seed-v2)와 동일한 위치/역할의 선례를 그대로 따른다 | AC-002 |
| `app/subscription/page.tsx` (신규) | 구독 상태에 따라 조건부 렌더링: 유효 구독 없음 → `PlanSelector` 노출(AC-002/AC-008), 유효 구독 있음 → 상태(플랜/다음결제일 또는 만료일)+해지 버튼(AC-009) — seed-v1/v2의 "한 페이지, 조건부 렌더링" 관례(로그인 페이지의 에러 배너 등)를 따른다 | AC-002, AC-008, AC-009 |
| `app/subscription/callback/route.ts` (신규) | 토스 `successUrl`/`failUrl` 콜백. `authKey`+`customerKey` 파싱 후 `subscription-service.startFreeTrial()` 호출, 결과에 따라 `/chat` 또는 `/subscription?error=...`로 리다이렉트 — seed-v2 `app/auth/callback/route.ts`와 완전히 동일한 "얇은 어댑터" 패턴(실제 로직은 Logic에) | AC-002 |
| `app/subscription/actions.ts` (신규) | `cancelSubscriptionAction`(Server Action, AC-006), `resubscribeAction`(Server Action, AC-008 후속 재구독 — 단, 최초 구독과 달리 카드가 이미 있으므로 리다이렉트 없이 즉시 서버에서 청구) |
| `app/chat/page.tsx` (수정) | 렌더링 전 `subscription-service.checkAICoachAccess()` 호출 — 차단이면 `ChatWindow` 대신 구독 유도 배너(`/subscription`으로 링크) 표시 | AC-001 |
| `app/api/chat/route.ts` (수정) | 페이지 게이트를 우회한 직접 API 호출을 막기 위해 서버 쪽에서도 동일하게 `checkAICoachAccess()` 재확인(defense in depth) — 차단이면 403 | AC-001 |
| `app/api/cron/billing/route.ts` (신규) | Vercel Cron이 매일 호출. `Authorization` 헤더의 `CRON_SECRET`을 검증한 뒤(§16.2) `billing-service.runDailyBilling()` + `expireCanceledSubscriptions()`를 호출하고 결과를 JSON으로 반환하는 얇은 어댑터 | AC-004, AC-005, AC-007 |
| `src/proxy.ts` (matcher 확장) | `/subscription/:path*`를 보호 경로에 추가. `/api/cron/billing`은 세션 기반이 아니라 별도 시크릿으로 인증하므로 matcher에 추가하지 않는다(추가하면 오히려 Vercel Cron 호출이 세션 없음으로 차단됨) | AC-002, AC-009 |

**책임**: HTTP 요청/응답, 토스 SDK 리다이렉트 트리거(브라우저), UI 렌더링. 비즈니스 로직·Data 접근 없음.

### 16.2 Logic Layer — `src/services/subscription-service.ts`, `src/services/billing-service.ts` (신규)

| 함수 | 책임 | AC | Complexity |
|---|---|---|---|
| `subscription-service.startFreeTrial(userId, plan, authKey)` | PaymentMethod 존재 여부 확인(불변식 강제) → `toss-client.issueBillingKey(authKey, customerKey=userId)` → `payment-method-repository.create` + `subscription-repository.create(status=trial, trial_end_at=+7일)` | AC-002, AC-003 | high |
| `subscription-service.resubscribe(userId, plan)` | 유효 Subscription 없음 확인 → 기존 PaymentMethod의 billingKey로 `toss-client.chargeBilling()` 즉시 호출 → 성공 시 `subscription-repository.create(status=active)`, 실패 시 레코드 생성 없이 에러 반환 | AC-008 | high |
| `subscription-service.cancelSubscription(userId)` | 현재 유효 Subscription 조회 → `status=canceled`, `canceled_at=now`, `next_billing_at=null` 갱신 | AC-006 | medium |
| `subscription-service.checkAICoachAccess(userId)` | 최신 Subscription 조회 후 상태머신 판정(trial/active → 허용, canceled이며 `current_period_end >= now` → 허용, 그 외 → 차단+사유) — 읽기 전용 | AC-001 | medium |
| `billing-service.runDailyBilling()` | `subscription-repository.findDueToday()`(오늘 `next_billing_at`이고 trial/active) 순회 → 각각 `toss-client.chargeBilling()` 호출 → 성공: `payment-attempt-repository.create(success)` + Subscription 갱신(status=active, 다음 주기), 실패(사유 불문, Phase 3 결정): `payment-attempt-repository.create(failure)` + `status=past_due`, `next_billing_at=null` | AC-004, AC-005 | high |
| `billing-service.expireCanceledSubscriptions()` | `subscription-repository.findExpiredCanceled()`(status=canceled, `current_period_end < now`) 순회 → `status=expired` | AC-007 | medium |

**에러 핸들링**: `toss-client` 호출 실패(PG 명시적 거절이든 네트워크/타임아웃이든, Phase 3 논의에서 사용자가 "구분하지 않는다"로 결정)는 `runDailyBilling` 내부에서 동일하게 `past_due` 처리로 귀결된다 — 별도 재시도 로직을 만들지 않는다(seed-v3 must_not). `startFreeTrial`/`resubscribe`는 사용자가 화면 앞에 있는 동기 호출이므로 실패를 `SubscriptionError`로 던져 Presentation이 즉시 안내한다(seed-v1/v2의 `AuthError` 패턴과 동일한 관례).

**cron 인증**: `app/api/cron/billing/route.ts`는 Presentation이지만, "누가 호출했는지"를 Logic이 아니라 Route Handler 자신이 헤더 비교로 판정한다(로그인 세션이 없는 시스템 호출이라 Logic의 userId 기반 권한 체계와 다른 층위) — `CRON_SECRET` 환경변수와 `Authorization: Bearer` 헤더를 단순 문자열 비교. Vercel Cron은 `CRON_SECRET` 환경변수가 설정되어 있으면 이 헤더를 자동으로 실어 보낸다.

### 16.3 Data Layer — `src/lib/data/`

| 모듈 | 책임 |
|---|---|
| `toss-client.ts` (신규) | `issueBillingKey(authKey, customerKey)` → `POST /v1/billing/authorizations/issue`, `chargeBilling(billingKey, {customerKey, amount, orderId, orderName})` → `POST /v1/billing/{billingKey}`. `TOSS_SECRET_KEY`(서버 전용)로 Basic Auth 헤더 생성. `src/app`/`src/components`에서 직접 import 금지(boundaries.yaml에 추가 필요) |
| `subscription-repository.ts` (신규) | `create`, `findLatestByUserId`, `findDueToday()`(오늘 청구 대상), `findExpiredCanceled()`(만료 처리 대상), `updateStatus` |
| `payment-method-repository.ts` (신규) | `create`, `findByUserId` (User당 최대 1건 — DB 레벨에서도 `user_id` UNIQUE 제약으로 불변식을 이중 보장) |
| `payment-attempt-repository.ts` (신규) | `create` (조회 API는 이번 스코프에 없음 — 감사 기록 목적) |

**신규 테이블 3개** (`supabase/migrations/`):
```sql
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
```
RLS는 기존 테이블(users, health_logs 등)과 동일하게 비활성 — 접근 제어는 Logic 레이어의 userId 검증으로만 한다(seed-v1부터의 기존 관례, service_role 키만 사용).

## 17. Layer Communication

- **Presentation → Logic**: Server Action(해지/재구독) 또는 Route Handler(카드등록 콜백, cron) — seed-v2와 동일한 "얇은 어댑터" 원칙
- **Logic → Data**: repository/client wrapper 패턴 (기존과 동일)
- **`toss-browser.ts`**: `supabase-browser.ts`(seed-v2)와 동일한 예외 — anon/퍼블릭 키만 쓰고 DB/시크릿 접근이 없는 "브라우저 리다이렉트 트리거"라 Presentation의 UI 내비게이션 책임 범위로 본다

### 게이트 정비 (이번 TRD와 함께 반영 예정)
- `.harness/gates/rules/boundaries.yaml`, `ARCHITECTURE_INVARIANTS.md`: `src/lib/data/toss-client.ts`는 기존 Data 레이어 규칙(“src/app”/“src/components”에서 직접 import 금지)을 그대로 적용받는다 — 새 예외 불필요
- `src/lib/toss-browser.ts`는 `src/lib/supabase-browser.ts`와 같은 이유로 게이트 규칙 대상 밖에 위치 — 새 예외 불필요

## 18. Directory Structure (diff, seed-v2 대비)

```
src/
  app/
    subscription/
      page.tsx                      (신규) — 구독 시작/상태조회/해지 통합 페이지
      callback/route.ts             (신규) — 토스 authKey 콜백
      actions.ts                    (신규) — cancelSubscriptionAction, resubscribeAction
    api/
      cron/billing/route.ts         (신규) — Vercel Cron 진입점
      chat/route.ts                 (수정) — checkAICoachAccess 게이트 추가
    chat/page.tsx                   (수정) — checkAICoachAccess 게이트 + 구독유도 배너
  components/
    PlanSelector.tsx                (신규, client component)
  services/
    subscription-service.ts         (신규)
    billing-service.ts              (신규)
  lib/
    data/
      toss-client.ts                (신규)
      subscription-repository.ts    (신규)
      payment-method-repository.ts  (신규)
      payment-attempt-repository.ts (신규)
    toss-browser.ts                 (신규, Data 레이어 아님)
  proxy.ts                          (수정) — matcher에 /subscription/:path* 추가
supabase/migrations/
  ..._payment_tables.sql            (신규) — payment_methods/subscriptions/payment_attempts 3개 테이블
```

## 19. Test Strategy

- **Logic (`tests/unit/services/`)**: `subscription-service`(trial 1회 제한 위반 시도, checkAICoachAccess의 5개 상태 분기, cancelSubscription), `billing-service`(runDailyBilling 성공/실패 분기, 대상 없음일 때 no-op, expireCanceledSubscriptions) — `toss-client`는 mock
- **Data (`tests/integration/data/`)**: `payment-method-repository`의 `user_id` UNIQUE 제약 실제 위반 테스트(실제 Postgres), `subscription-repository.findDueToday`/`findExpiredCanceled` 쿼리 정확성. 실제 토스페이먼츠 API 호출은 통합 테스트로 다루지 않는다(외부 서비스 의존, `toss-client` 자체는 mock 없는 순수 fetch 래퍼라 로직이 거의 없어 단위 테스트도 최소화)
- **Presentation (`tests/e2e/`)**: `/subscription` 페이지 조건부 렌더링(구독 없음/trial/active/past_due/canceled 각 상태별 UI), `/api/cron/billing`의 시크릿 인증(틀린 시크릿 401), `/chat` 게이트(차단/허용). **토스페이먼츠 실제 카드 등록 화면은 자동화하지 않고 수동 검증**한다 — 단, 토스 문서에 확인된 `sandbox: {paymentResult: 'SUCCESS'|'FAIL'}` 옵션으로 인증 자체는 시뮬레이션 가능해 seed-v2의 구글 로그인보다 E2E 커버리지를 더 넓힐 수 있다(/run에서 Navigator와 함께 실제 적용 여부 판단)
- **원칙**: 구현과 테스트를 함께 작성

## 20. Decisions & Trade-offs

| 결정 | 이유 | Resource | Impact |
|---|---|---|---|
| 일일 스케줄러 인프라로 Vercel Cron 채택 | 이미 Vercel에 배포된 프로젝트, `vercel.ts`의 `crons` 설정만으로 충분, 신규 의존성/서버 운영 불필요 | 매우 낮음 | 로컬 개발 중엔 cron이 안 돌아 수동 트리거 스크립트가 별도로 필요(운영 비용 낮음) |
| 토스페이먼츠 연동에 npm SDK를 설치하지 않는다 | 클라이언트는 스크립트 태그, 서버는 순수 REST로 충분함을 공식 문서로 확인 | 없음(리서치로 확인된 사실) | 신규 의존성 0개, 번들 크기 영향 없음 |
| `customerKey`를 별도 발급하지 않고 `User.id`(UUID)를 그대로 사용 | 토스 요구사항(2-300자, 특수문자 포함, 예측 불가)을 UUID가 이미 충족 | 없음 | 별도 필드/생성 로직 불필요 |
| 결제 실패 원인(카드거절 vs 시스템오류)을 구분하지 않고 동일하게 즉시 past_due 처리 | 사용자 결정(Phase 3 논의) — 구현 단순성 우선, seed-v3의 "자동 재시도 없음" 제약과도 일관됨 | 낮음 | 토스 서버 일시 장애 시에도 정상 결제자가 차단될 수 있음(허용된 트레이드오프, 재구독으로 즉시 복구 가능) |
| 구독 상태 조회·시작·해지를 페이지 하나(`/subscription`)에서 조건부 렌더링 | seed-v1/v2의 기존 "단일 페이지, 조건부 렌더링" 관례(로그인 에러 배너 등)를 그대로 따름 — 페이지 수를 늘리지 않음 | 낮음 | 라우팅 단순, 페이지 내부 분기는 다소 늘어남(허용 범위) |
| `PaymentMethod`/`Subscription`/`PaymentAttempt`를 `User`와 분리된 별도 테이블로 | Ontologist 분석(seed-v3.yaml tech_decisions) — 재구독마다 새 Subscription이 생기는 1:N 관계는 User 필드로 표현 불가 | 중간(신규 테이블 3개, 마이그레이션) | 감사 추적 가능, 도메인 책임 분리로 향후 확장(어드민 대시보드 seed-v4)이 쉬워짐 |

## 21. Implementation Order

`/decompose`에서 이 순서를 레이어별 원자 태스크로 쪼갠다:

1. **Data**: 마이그레이션(payment_methods/subscriptions/payment_attempts, +integration test) → `toss-client.ts` → 3개 repository(+integration test)
2. **Logic**: `subscription-service.checkAICoachAccess`(가장 많은 곳에서 재사용되므로 먼저) → `startFreeTrial` → `cancelSubscription` → `resubscribe` → `billing-service.runDailyBilling` → `expireCanceledSubscriptions` (각 직후 unit test, `toss-client` mock)
3. **Presentation**: `src/lib/toss-browser.ts` → `PlanSelector` → `app/subscription/page.tsx` + `callback/route.ts` + `actions.ts` → `app/chat/page.tsx`/`api/chat/route.ts` 게이트 추가 → `api/cron/billing/route.ts` (완성되는 대로 관련 Playwright 시나리오 작성, 마지막에 AC-001~011 전체 확인 + 토스 실제 카드 등록 수동 검증)

# seed-v4 — 관리자 대시보드

> seed-v3의 브라운필드 확장 — 3개 시드 로드맵(OAuth → 결제 → 어드민)의 마지막

## 22. Overview

- **목표 요약**: 단일 운영자를 위한 `/admin`을 만들어 매출/구독 현황을 보고, "결제는 성공했는데 DB 반영에 실패해 방치된 구독"만 안전하게 복구할 수 있게 한다.
- **핵심 설계 원칙**: 새 권한 체계(Role/is_admin)를 만들지 않고 `session.email === ADMIN_EMAIL` 런타임 비교로 접근을 제한한다. 유일한 쓰기 액션(구독 복구)은 서버가 반드시 재판정을 거치고, 모든 조회/조작 진입점(페이지·Server Action)이 각각 독립적으로 관리자 여부를 재확인한다(seed-v3 AC-001의 defense-in-depth 패턴 재사용).
- **아키텍처 패턴**: 3-tier layered 유지 (seed-v1~v3와 동일 원칙, 새 레이어 없음)

```
[Presentation]                      [Logic]                              [Data]
app/admin/page.tsx              →   admin-service.ts (신규)          →   admin-action-log-repository.ts (신규)
  (매출 요약+서비스 통계)              - getRevenueSummary()
app/admin/subscribers/               - getServiceStats()                  subscription-repository.ts (확장)
  page.tsx (검색/목록)            →   - listSubscribers()              →     - countByStatus()
  [userId]/page.tsx (상세)       →   - getSubscriberDetail()                - searchSubscribers()
app/admin/anomalies/                 - detectStuckSubscriptions()           - findStuckCandidates()
  page.tsx (탐지+복구)            →   - detectDuplicateActiveSubs()          - findDuplicateActiveGroups()
  actions.ts (복구 Server Action)→   - recoverStuckSubscription()
                                      - classifyStuckSubscription()         payment-attempt-repository.ts (확장)
src/proxy.ts (matcher 확장)          - isAdminEmail() (판정 헬퍼)             - findLatestBySubscriptionId()
src/components/AppShell.tsx (확장)                                          - findBySubscriptionId()
  (관리자에게만 "관리자" 네비 노출)                                            - sumSuccessAmountInRange()

                                                                          health-log-repository.ts (확장)
                                                                            - countAll()
                                                                          care-link-repository.ts (확장)
                                                                            - countByStatus()
```

## 23. Layer Design

### 23.1 Presentation Layer — `src/app/admin/`, `src/components/AppShell.tsx`(확장)

| 페이지/라우트 | 설명 | AC |
|---|---|---|
| `app/admin/page.tsx` (신규) | 상태별 구독자 수 분포 + 기간(쿼리 파라미터) 매출 합계 + 서비스 전체 집계(가입자/HealthLog/CareLink 수)를 숫자/테이블로 렌더링. `getSession()` → `isAdminEmail` 확인 → 아니면 `/dashboard`로 리다이렉트 | AC-001, AC-004, AC-008 |
| `app/admin/subscribers/page.tsx` (신규) | 검색어(email/name)·상태 필터를 쿼리 파라미터로 받아 `admin-service.listSubscribers()` 호출, 테이블 렌더링. 각 행에 상세 링크 | AC-002, AC-008 |
| `app/admin/subscribers/[userId]/page.tsx` (신규) | 해당 유저의 Subscription 이력 + 각 Subscription의 PaymentAttempt 전체를 시간순 테이블로 렌더링 | AC-003, AC-008 |
| `app/admin/anomalies/page.tsx` (신규) | `detectStuckSubscriptions()`(recoverable/not_recoverable/undetermined 3분류 배지) + `detectDuplicateActiveSubscriptions()`(중복 유효 구독 유저 목록) 두 섹션. recoverable 건에만 복구 버튼(Server Action `actions.ts`) 노출 | AC-005, AC-006, AC-007, AC-008 |
| `app/admin/anomalies/actions.ts` (신규) | `recoverStuckSubscriptionAction(subscriptionId)` — Server Action. **페이지의 `isAdminEmail` 체크와 별개로 이 함수 자신도 세션을 다시 읽어 `isAdminEmail`을 재확인한다**(defense-in-depth, AC-008 "API 직접 호출해도 차단") | AC-006, AC-008 |
| `src/proxy.ts` (matcher 확장) | `/admin/:path*`를 보호 경로에 추가 — "로그인 자체가 안 됨"은 여기서 값싸게 걸러진다(ARCHITECTURE_INVARIANTS.md 각주: DB 테이블 조회 금지, `auth.getUser()`만 사용하므로 이 제약 위반 없음). **"로그인은 했지만 관리자가 아님"은 proxy가 판정하지 않는다** — 각 페이지/Server Action이 `isAdminEmail`로 재확인 | AC-008 |
| `src/components/AppShell.tsx` (확장) | `AppShellProps`에 `isAdmin?: boolean` 추가. `NAV_ITEMS` 상수를 컴포넌트 내부에서 조립하는 함수로 바꿔, `isAdmin`일 때만 `{key:"admin", href:"/admin", label:"관리자"}`를 추가한다 — 비관리자에게는 링크 자체를 노출하지 않는다 | (UX, AC 없음) |

**책임**: HTTP 요청/응답, UI 렌더링, 관리자 판정의 "재확인" 호출(판정 로직 자체는 Logic). 비즈니스 로직·Data 직접 접근 없음.

### 23.2 Logic Layer — `src/services/admin-service.ts` (신규)

| 함수 | 책임 | AC | Complexity |
|---|---|---|---|
| `isAdminEmail(email: string \| null \| undefined): boolean` | `process.env.ADMIN_EMAIL`과 정확히 일치하는지 비교하는 순수 함수. env 미설정 시 항상 `false`(fail-closed — seed-v3 `CRON_SECRET` 패턴과 동일 원칙) | AC-008 | low |
| `getRevenueSummary(range?: {start, end}): Promise<RevenueSummaryView>` | `subscriptionRepository.countByStatus()` + `paymentAttemptRepository.sumSuccessAmountInRange(range)` 조합 | AC-001 | medium |
| `getServiceStats(): Promise<ServiceStatsView>` | `healthLogRepository.countAll()` + `careLinkRepository.countByStatus("accepted")` + 가입자 수(기존 `user-repository`에 `countAll()` 추가) 조합 | AC-004 | low |
| `listSubscribers(query: {search?, status?, page?}): Promise<SubscriberListItem[]>` | `subscriptionRepository.searchSubscribers(query)` 위임(사실상 얇은 통과 — 검색/필터/페이지네이션 자체는 Data 레이어 쿼리 책임) | AC-002 | medium |
| `getSubscriberDetail(userId): Promise<SubscriberDetailView>` | 유저의 Subscription 전체(`subscriptionRepository`에 신규 `findAllByUserId` 필요) + 각 Subscription의 PaymentAttempt(`paymentAttemptRepository.findBySubscriptionId`) 조합 | AC-003 | medium |
| `classifyStuckSubscription(sub, latestAttempt): "recoverable" \| "not_recoverable" \| "undetermined"` | 순수 함수. `latestAttempt === null` → `undetermined`, `latestAttempt.result === "success"` → `recoverable`, `latestAttempt.result === "failure"` → `not_recoverable`. **`detectStuckSubscriptions`와 `recoverStuckSubscription` 양쪽이 이 함수 하나를 공유**(Ontologist 검증 근거, §Phase 3 논의점 3) | AC-005, AC-006 | high |
| `detectStuckSubscriptions(): Promise<StuckSubscriptionView[]>` | `subscriptionRepository.findStuckCandidates()`(status IN trial,active AND next_billing_at IS NULL AND current_period_end < now) 순회 → 각각 `paymentAttemptRepository.findLatestBySubscriptionId()` 조회 → `classifyStuckSubscription()`로 분류해 반환 | AC-005 | high |
| `detectDuplicateActiveSubscriptions(): Promise<DuplicateSubscriptionGroup[]>` | `subscriptionRepository.findDuplicateActiveGroups()`(user_id별 유효 Subscription 2건 이상) 위임 | AC-007 | low |
| `recoverStuckSubscription(adminUserId, subscriptionId): Promise<RecoverResult>` | 대상 Subscription 재조회 → 최신 PaymentAttempt 재조회 → `classifyStuckSubscription()`로 **서버 재검증**(클라이언트가 recoverable이라 주장해도 신뢰하지 않는다) → `recoverable`이 아니면 `AdminError("NOT_RECOVERABLE")` → recoverable이면 `subscription-service.addBillingPeriod()`(기존 함수 재사용, 새로 만들지 않음)로 다음 주기 계산 → `subscriptionRepository.updateStatus(id, {status:"active", currentPeriodStart, currentPeriodEnd, nextBillingAt})` → 성공 시 `adminActionLogRepository.create(...)`. 로그 기록만 실패하면 `console.error`로 크게 남기고 `outcome:"recovered_log_failed"`를 반환(§Phase 3 논의점 2, billing-service의 `partial_failure`와 같은 급의 잔여 위험 — 여기는 외부 결제가 아니라 내부 상태 변경이라 위험도는 더 낮음) | AC-006 | high |

**에러 핸들링**: `AdminError`(코드: `NOT_ADMIN`, `NOT_RECOVERABLE`, `SUBSCRIPTION_NOT_FOUND`) — seed-v1~v3의 `AuthError`/`SubscriptionError`와 동일한 관례(도메인 에러를 코드화해 Presentation이 안내 문구로 매핑).

### 23.3 Data Layer — `src/lib/data/`

| 모듈 | 책임 |
|---|---|
| `admin-action-log-repository.ts` (신규) | `create(input)`만 — 조회 UI는 이번 스코프에 없다(seed-v4 scope.future, `payment-attempt-repository`가 create-only였던 것과 동일한 선례) |
| `subscription-repository.ts` (확장) | `countByStatus()`, `searchSubscribers({search, status, page})`(users와 embedded select로 조인), `findAllByUserId(userId)`, `findStuckCandidates()`, `findDuplicateActiveGroups()` |
| `payment-attempt-repository.ts` (확장) | `findLatestBySubscriptionId(id)`, `findBySubscriptionId(id)`, `sumSuccessAmountInRange({start, end})` |
| `health-log-repository.ts` (확장) | `countAll()` |
| `care-link-repository.ts` (확장) | `countByStatus(status)` |
| `user-repository.ts` (확장) | `countAll()` |

**신규 테이블 1개** (`supabase/migrations/`):
```sql
create table public.admin_action_logs (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references public.users(id) on delete restrict,
  subscription_id uuid not null references public.subscriptions(id) on delete restrict,
  action_type text not null check (action_type in ('recover_partial_failure')),
  previous_status text not null,
  new_status text not null,
  performed_at timestamptz not null default now()
);
alter table public.admin_action_logs enable row level security;
grant select, insert, update, delete on public.admin_action_logs to service_role;
```
`on delete restrict`(payment_attempts의 `cascade`와 다름) — 감사 로그는 "참조 대상이 사라지면 같이 지워지는" 부속 데이터가 아니라 그 자체가 보존 대상이라는 의미를 명시적으로 건다(실제로 User/Subscription을 삭제하는 기능이 현재 없어 지금 당장 차이는 없지만, 의도를 코드로 남긴다).

RLS는 seed-v3의 payment 테이블들과 동일하게 **활성화 + service_role에만 grant**한다(seed-v3 TRD §16.3의 "RLS 비활성" 서술은 실제 마이그레이션 파일과 다른 stale한 문서 오류였음 — 참고로만 남기고 이번 절에서는 실제 적용된 패턴을 정확히 따른다).

## 24. Layer Communication

- **Presentation → Logic**: 서버 컴포넌트가 `admin-service`를 직접 호출(조회), Server Action이 `admin-service.recoverStuckSubscription()` 호출(쓰기) — seed-v1~v3와 동일한 원칙
- **Logic → Data**: repository 패턴 (기존과 동일)
- **`admin-service.recoverStuckSubscription`이 `subscription-service.addBillingPeriod`를 import**하는 것은 Logic→Logic 참조라 레이어 경계 위반이 아니다 — 같은 "다음 결제 주기 계산" 로직을 두 파일에 복제하지 않기 위함(GEN-002 원칙)

### 게이트 정비 (이번 TRD와 함께 반영 예정)
- `.harness/gates/rules/boundaries.yaml`: 새로 추가되는 파일들(`app/admin/**`, `services/admin-service.ts`, `lib/data/admin-action-log-repository.ts`)은 기존 규칙(`src/app`→Data 직접 import 금지 등)을 그대로 적용받는다 — 새 예외 불필요

## 25. Directory Structure (diff, seed-v3 대비)

```
src/
  app/
    admin/
      page.tsx                        (신규) — 매출/서비스 통계 요약
      subscribers/
        page.tsx                      (신규) — 구독자 검색/목록
        [userId]/page.tsx             (신규) — 구독자 상세(구독+결제 이력)
      anomalies/
        page.tsx                      (신규) — partial_failure/중복구독 탐지
        actions.ts                    (신규) — recoverStuckSubscriptionAction
  components/
    AppShell.tsx                      (확장) — isAdmin prop, 조건부 "관리자" 네비
  services/
    admin-service.ts                  (신규)
  lib/
    data/
      admin-action-log-repository.ts  (신규)
      subscription-repository.ts      (확장)
      payment-attempt-repository.ts   (확장)
      health-log-repository.ts        (확장)
      care-link-repository.ts         (확장)
      user-repository.ts              (확장)
  proxy.ts                            (수정) — matcher에 /admin/:path* 추가
supabase/migrations/
  ..._admin_action_logs.sql           (신규) — admin_action_logs 테이블 1개
```

## 26. Test Strategy

- **Logic (`tests/unit/services/admin-service.test.ts`)**: `isAdminEmail`(일치/불일치/env 미설정), `classifyStuckSubscription`(recoverable/not_recoverable/undetermined 3분기 각각), `recoverStuckSubscription`(서버 재검증에서 not_recoverable이면 거부하는 경로가 핵심 — 클라이언트 주장을 신뢰하면 안 됨을 직접 테스트), 로그 기록 실패 시 `recovered_log_failed` 분기 — repository는 전부 mock
- **Data (`tests/integration/data/`)**: `subscription-repository.findStuckCandidates`/`findDuplicateActiveGroups`/`searchSubscribers`/`countByStatus` 쿼리 정확성(실제 Postgres), `payment-attempt-repository.findLatestBySubscriptionId`/`sumSuccessAmountInRange`, `admin-action-log-repository.create`
- **Presentation (`tests/e2e/`)**: `/admin/*` 전체에 대해 (a) 비로그인 → `/login` 리다이렉트, (b) 로그인했지만 비관리자 → `/dashboard` 리다이렉트, (c) 관리자 → 정상 렌더 3단계를 각 페이지마다 반복 확인(AC-008). `anomalies` 페이지에서 recoverable/not_recoverable 뱃지 노출 차이, 복구 버튼 클릭 후 상태 반영, **Server Action을 비관리자 세션으로 직접 호출해도 거부되는지**(defense-in-depth 직접 검증)
- **원칙**: 구현과 테스트를 함께 작성

## 27. Decisions & Trade-offs

| 결정 | 이유 | Resource | Impact |
|---|---|---|---|
| 관리자 판정을 새 엔티티/필드 없이 `ADMIN_EMAIL` 환경변수 런타임 비교로 | 관리자가 단일 운영자 1명(인터뷰 확정) — 권한 체계 도입 비용이 가치보다 큼 | 매우 낮음 | 관리자가 여러 명이 되면 이 함수(`isAdminEmail`) 하나만 교체하면 되는 좁은 변경 지점 |
| `proxy.ts`는 로그인 여부만 확인, 관리자 여부는 각 페이지/Server Action이 재확인 | `proxy.ts`는 DB 테이블 조회 금지 제약이 있고(ARCHITECTURE_INVARIANTS.md), 관리자 판정은 매 진입점에서 독립적으로 재확인해야 UI 우회(API 직접 호출)도 막힌다(seed-v3 AC-001 defense-in-depth 선례) | 낮음(코드 중복 몇 줄) | AC-008을 "페이지 리다이렉트"뿐 아니라 "직접 호출도 차단"까지 실제로 충족 |
| partial_failure의 recoverable/not_recoverable 판정을 새 스키마 없이 기존 `PaymentAttempt.result` 재해석으로 | `BillingOutcome`을 영속화하려면 seed-v3의 완결된 `billing-service.ts`를 다시 건드려야 함(과한 변경) — Ontologist 검증 결과 "가장 최근 PaymentAttempt.result"만으로 대부분 구분 가능함이 확인됨 | 낮음 | 극희귀 케이스(PaymentAttempt 기록 자체 실패)는 `undetermined`로 명시적으로 분리해 안전 마진 확보 |
| `recoverStuckSubscription`은 status뿐 아니라 `current_period`/`next_billing_at`까지 재계산(인터뷰 확정) | status만 바꾸면 이후 cron이 이 구독을 영원히 놓침 — "복구"가 매 주기 관리자 개입이 필요한 반쪽짜리가 됨 | 낮음(기존 `addBillingPeriod` 재사용) | 복구된 구독은 다음 cron 사이클부터 완전히 정상 동작 |
| Subscription 갱신 → 성공 시에만 AdminActionLog 기록(순서 고정, 진짜 트랜잭션 아님) | PostgREST 기반이라 진짜 DB 트랜잭션 불가(seed-v3에서 이미 마주친 제약) — "로그가 실제 안 일어난 일을 기록"하는 것보다 "일어난 일이 로그에 누락"되는 쪽이 덜 위험하다고 판단 | 낮음 | 로그 기록 실패는 `recovered_log_failed`로 명시적으로 드러나 사람이 확인 가능(billing-service의 `partial_failure`와 같은 원칙) |
| `AdminActionLog`(신규 엔티티)를 조회하는 UI는 만들지 않는다(scope.future) | 인터뷰에서 "구독 상태를 바꿀 때 기록"만 확정됐고 로그 열람 UI는 요구되지 않음 — 만들면 검증되지 않은 스코프 확장(Ontologist 지적) | 없음(안 만듦) | 필요해지면 `admin-action-log-repository`에 조회 함수만 추가하면 되는 좁은 확장 지점으로 남겨둠 |

## 28. Implementation Order

`/decompose`에서 이 순서를 레이어별 원자 태스크로 쪼갠다:

1. **Data**: 마이그레이션(`admin_action_logs`, +integration test) → `admin-action-log-repository.ts` → 기존 5개 repository(subscription/payment-attempt/health-log/care-link/user) 확장(각 함수 추가 직후 integration test)
2. **Logic**: `admin-service.isAdminEmail`(가장 많은 곳에서 재사용되므로 먼저) → `getServiceStats`/`getRevenueSummary`(단순 조합) → `listSubscribers`/`getSubscriberDetail` → `classifyStuckSubscription`(순수 함수, 단위테스트 집중) → `detectStuckSubscriptions`/`detectDuplicateActiveSubscriptions` → `recoverStuckSubscription`(가장 복잡, 서버 재검증 경로를 반드시 테스트) (각 직후 unit test)
3. **Presentation**: `src/proxy.ts` matcher 확장 → `app/admin/page.tsx` → `app/admin/subscribers/page.tsx` + `[userId]/page.tsx` → `app/admin/anomalies/page.tsx` + `actions.ts` → `AppShell.tsx` 확장(마지막 — 다른 모든 라우트가 존재해야 네비 링크가 의미 있음) (완성되는 대로 관련 Playwright 시나리오 작성, 마지막에 AC-001~008 전체 확인)
