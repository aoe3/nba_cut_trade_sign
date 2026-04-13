import { useEffect } from "react";

export type DesktopModeNoticeModalProps = {
  isOpen: boolean;
  modeLabel: string;
  onClose: () => void;
};

export function DesktopModeNoticeModal({
  isOpen,
  modeLabel,
  onClose,
}: DesktopModeNoticeModalProps) {
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="desktop-mode-notice-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="desktop-mode-notice-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="desktop-mode-notice-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          className="desktop-mode-notice-close"
          type="button"
          onClick={onClose}
          aria-label="Close desktop recommendation notice"
        >
          ×
        </button>

        <div className="desktop-mode-notice-eyebrow">Heads up</div>
        <h2 id="desktop-mode-notice-title" className="desktop-mode-notice-title">
          {modeLabel} is intended for desktop.
        </h2>
        <p className="desktop-mode-notice-copy">
          You may play on mobile, but it is highly recommended not to.
        </p>
      </div>
    </div>
  );
}
