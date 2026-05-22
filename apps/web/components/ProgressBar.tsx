// Course progress bar: completed / total lessons. Renders nothing when the
// course has no lessons.
export default function ProgressBar({
  completed,
  total,
}: {
  completed: number;
  total: number;
}) {
  if (!total) return null;
  const pct = Math.min(100, Math.round((completed / total) * 100));
  return (
    <div className="progress">
      <div
        className="progress-track"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="progress-label">
        {completed} / {total} lessons · {pct}%
      </span>
    </div>
  );
}
