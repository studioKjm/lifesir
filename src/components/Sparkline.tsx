// 7일 추이 스파크라인. 값의 최소~최대를 높이에 맞춰 그리고, 기록 없는 날(null)은
// 건너뛰어 앞뒤 기록을 잇는다. 기록이 하나뿐이거나 모두 같으면 가운데 수평선.
const W = 120;
const H = 36;
const PAD = 4;

export function Sparkline({ values, label }: { values: (number | null)[]; label: string }) {
  const points = values
    .map((v, i) => (v === null ? null : { x: PAD + (i * (W - 2 * PAD)) / (values.length - 1), v }))
    .filter((p): p is { x: number; v: number } => p !== null);

  if (points.length === 0) {
    return (
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${label} 7일 기록 없음`}>
        <line x1={PAD} x2={W - PAD} y1={H - PAD} y2={H - PAD} stroke="var(--border)" strokeWidth="1.5" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
      </svg>
    );
  }

  const min = Math.min(...points.map((p) => p.v));
  const max = Math.max(...points.map((p) => p.v));
  const y = (v: number) => (max === min ? H / 2 : H - PAD - ((v - min) / (max - min)) * (H - 2 * PAD));
  const coords = points.map((p) => `${p.x},${y(p.v)}`);
  const first = points[0];
  const last = points[points.length - 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${label} 7일 추이`}>
      {points.length > 1 && (
        <path d={`M${coords.join("L")}L${last.x},${H}L${first.x},${H}Z`} fill="var(--blue)" fillOpacity="0.1" />
      )}
      <polyline
        points={points.length > 1 ? coords.join(" ") : `${PAD},${y(last.v)} ${W - PAD},${y(last.v)}`}
        fill="none"
        stroke="var(--blue)"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
