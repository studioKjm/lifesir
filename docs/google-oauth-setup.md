# 구글 OAuth 설정 가이드 (seed-v2)

이 문서의 단계는 에이전트가 대신 할 수 없다 — Google Cloud Console과 Supabase 대시보드에
대한 실제 계정 접근이 필요한 외부 작업이다.

## 1. Google Cloud Console에서 OAuth 클라이언트 발급

1. https://console.cloud.google.com/apis/credentials 로 이동 (프로젝트가 없으면 새로 생성)
2. "OAuth 동의 화면" 먼저 설정 (User Type: External, 앱 이름/이메일 등 최소 정보만)
3. "사용자 인증 정보 만들기" → "OAuth 클라이언트 ID" → 애플리케이션 유형: **웹 애플리케이션**
4. **승인된 리디렉션 URI**에 아래를 등록 (로컬 개발용):
   - `http://127.0.0.1:54321/auth/v1/callback` (로컬 Supabase Auth의 콜백 — 우리 앱의 `/auth/callback`이 아니라 Supabase 자체 콜백이다)
   - 운영 배포 시에는 `https://<project-ref>.supabase.co/auth/v1/callback`도 추가
5. 생성된 **클라이언트 ID**와 **클라이언트 보안 비밀번호**를 복사

## 2. 로컬 환경변수에 등록

`.env.local`에 이미 자리를 만들어뒀다:

```
SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=<클라이언트 ID>
SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=<클라이언트 보안 비밀번호>
```

## 3. 로컬 Supabase 설정 반영

`supabase/config.toml`의 `[auth.external.google]`에서 `enabled = false`를
`enabled = true`로 바꾼 뒤, 로컬 Supabase를 재기동한다:

```bash
supabase stop
supabase start
```

(config.toml 변경은 `supabase start`/`stop` 재기동 시에만 반영된다 — 이미 떠 있는
상태에서 파일만 고치면 적용되지 않는다.)

## 4. 운영 배포 시 추가로 할 일 (이번 스코프 밖, 참고용)

- `supabase/config.toml`의 `skip_nonce_check = true`는 **로컬 전용 설정**이다.
  운영 배포에서는 반드시 `false`로 되돌린다(별도 배포 설정 파일 또는 Supabase
  대시보드의 프로덕션 프로젝트 설정에서 관리 — 이 리포의 config.toml은 로컬
  전용이다).
- Supabase 대시보드(호스팅 프로젝트)의 Authentication → Providers → Google에도
  동일한 클라이언트 ID/Secret을 등록해야 한다.
- `additional_redirect_urls`에 운영 도메인을 추가해야 한다.

## 5. 확인 방법

로컬 Supabase Studio(`http://127.0.0.1:54323`)의 Authentication → Providers에서
Google이 활성화되어 있는지 확인할 수 있다. 실제 로그인 동작은
`tests/e2e/oauth-flow.spec.ts`가 콜백부터는 자동으로 검증하지만, "구글로
계속하기" 버튼 클릭 → 실제 구글 동의화면 진입은 사람이 브라우저로 직접
확인해야 한다(`.harness/ouroboros/tasks/seed-v2-decomposition.yaml`의
`manual_verification_checklist` 참고).
