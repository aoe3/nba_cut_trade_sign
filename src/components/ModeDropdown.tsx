import { useEffect, useRef, useState } from "react";

import type { AppMode } from "../App";

type ModeDropdownProps = {
  activeMode: AppMode;
  onChangeMode: (mode: AppMode) => void;
};

const MODE_LABELS: Record<AppMode, string> = {
  daily: "Daily",
  forever: "Forever",
  beatTheScore: "Beat The Score",
  shootout: "Shootout",
  stackBattle: "Draft Battle",
};

/**
 * Dropdown used across all modes to switch between game variants.
 */
export function ModeDropdown({ activeMode, onChangeMode }: ModeDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  function handleSelect(mode: AppMode) {
    onChangeMode(mode);
    setIsOpen(false);
  }

  return (
    <div
      ref={rootRef}
      className={`mode-dropdown${isOpen ? " mode-dropdown--open" : ""}`}
    >
      <button
        type="button"
        className="mode-dropdown__trigger"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label="Mode selector"
        onClick={() => setIsOpen((open) => !open)}
      >
        <span className="mode-dropdown__label">Mode:</span>
        <span className="mode-dropdown__value">{MODE_LABELS[activeMode]}</span>
        <span className="mode-dropdown__chevron" aria-hidden="true">
          ▾
        </span>
      </button>

      {isOpen ? (
        <div
          className="mode-dropdown__menu"
          role="listbox"
          aria-label="Choose mode"
        >
          {(Object.entries(MODE_LABELS) as [AppMode, string][]).map(
            ([value, label]) => (
              <button
                key={value}
                type="button"
                role="option"
                aria-selected={value === activeMode}
                className={`mode-dropdown__option${
                  value === activeMode ? " mode-dropdown__option--active" : ""
                }`}
                onClick={() => handleSelect(value)}
              >
                {label}
              </button>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}
