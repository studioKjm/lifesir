// T-003 — 공용 에러 배너 (AC-010) — 폼 제출 실패 등 액션성 에러에 사용.
// 데이터 없음/권한없음처럼 "화면 전체를 대체"하는 경우는 EmptyState를 쓴다.

export interface ErrorBannerProps {
  message: string;
  onRetry?: () => void;
}

export function ErrorBanner({ message, onRetry }: ErrorBannerProps) {
  return (
    <div role="alert">
      <p>{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry}>
          다시 시도
        </button>
      )}
    </div>
  );
}
