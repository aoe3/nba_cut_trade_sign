type LoadingOverlayProps = {
  title: string;
  currentStatus: string;
  logs: string[];
};

export function LoadingOverlay({ title }: LoadingOverlayProps) {
  return (
    <div className="loading-overlay" role="presentation">
      <div className="loading-card" role="status" aria-live="polite">
        <div className="loading-content">
          <h2 className="loading-title">{title}</h2>

          <div className="loading-live-line">
            Please wait. We're solving the game on our end to calibrate your
            score bounds
            <span className="loading-ellipsis" />
          </div>
        </div>
      </div>
    </div>
  );
}
