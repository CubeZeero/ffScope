/** Progress values use 0..1; negative or non-finite values mean unknown duration. */
export function ProgressBar({ progress, label, spinner = false }: { progress: number; label: string; spinner?: boolean }) {
  const indeterminate = !Number.isFinite(progress) || progress < 0;
  const percent = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  return (
    <div className="frame-progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={indeterminate ? undefined : percent}>
      {spinner && <span className="spinner" aria-hidden="true" />}
      <div className="progress-track">
        <div className={`progress-fill ${indeterminate ? "indeterminate" : ""}`} style={indeterminate ? undefined : { width: `${percent}%` }} />
      </div>
      <span className="progress-label">{indeterminate ? label : `${percent}%`}</span>
    </div>
  );
}
