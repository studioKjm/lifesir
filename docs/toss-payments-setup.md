# 토스페이먼츠 설정 가이드 (seed-v3)

이 문서의 단계는 에이전트가 대신 할 수 없다 — 토스페이먼츠 개발자센터 계정에
대한 실제 접근이 필요한 외부 작업이다.

## 1. 토스페이먼츠 개발자센터에서 키 발급

1. https://developers.tosspayments.com 접속 → 회원가입/로그인
2. 상점(내 개발자센터) 생성 — 테스트 연동만 할 거면 별도 사업자 등록 없이 바로 발급된다
3. **API 키** 메뉴에서 아래 두 키를 확인:
   - **클라이언트 키**(`test_ck_...`) — 브라우저에 노출되는 공개 키
   - **시크릿 키**(`test_sk_...`) — 서버 전용, 절대 클라이언트/로그에 노출 금지
4. 테스트 키는 실제 카드가 청구되지 않는 sandbox 모드다 — 로컬 개발/E2E는 전부 이 키로 진행한다. 실 서비스 전환 시 별도로 라이브 키를 발급받아야 한다(가맹점 심사 필요, 이번 스코프 밖).

## 2. 로컬 환경변수에 등록

`.env.local`에 이미 자리를 만들어뒀다:

```
TOSS_SECRET_KEY=<시크릿 키, test_sk_...>
NEXT_PUBLIC_TOSS_CLIENT_KEY=<클라이언트 키, test_ck_...>
```

`TOSS_SECRET_KEY`는 `src/lib/data/toss-client.ts`(Data 레이어)에서만 읽는다 —
다른 레이어나 클라이언트 코드로 절대 넘기지 않는다.

## 3. Vercel Cron 배포 설정 (T-023, 결제 청구 스케줄러용)

일일 정기결제(`/api/cron/billing`)를 실제로 매일 실행하려면 Vercel 배포
환경에 별도로 아래가 필요하다(로컬 개발 중엔 cron이 돌지 않는다 — 수동으로
`curl`해서 확인한다). `CRON_SECRET`은 외부 발급이 필요 없는 값(우리가 직접
정하는 임의 문자열)이라 `.env.local`엔 이미 로컬 전용 값이 채워져 있다 —
운영 배포 시엔 그 값을 재사용하지 말고 새로 강한 무작위 값을 생성한다:

1. Vercel 프로젝트 환경변수에 `CRON_SECRET`(무작위 문자열, `.env.local`과 다른 값)을 추가
2. `vercel.ts`(또는 `vercel.json`)의 `crons` 설정에 `/api/cron/billing`을 등록(T-023에서 함께 처리)
3. Vercel이 설정된 스케줄마다 `Authorization: Bearer <CRON_SECRET>` 헤더를 실어 자동으로 호출한다 — 별도 외부 cron 서비스 불필요

로컬에서 수동으로 확인하려면:
```bash
curl -H "Authorization: Bearer <.env.local의 CRON_SECRET 값>" http://127.0.0.1:3100/api/cron/billing
```

## 4. 확인 방법

- 토스페이먼츠 개발자센터의 **연동 테스트 페이지**에서 테스트 카드로 빌링키
  발급이 실제로 되는지 확인할 수 있다.
- 이 앱에서의 실제 동작(카드 등록 → 무료체험 시작 → AI 코치 사용)은
  `.harness/ouroboros/tasks/seed-v3-decomposition.yaml`의
  `manual_verification_checklist` 참고 — 실제 sandbox 카드로 사람이 직접
  클릭해 확인해야 하는 항목들이다.
