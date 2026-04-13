import { useEffect, useMemo, useState } from "react";
import "./App.css";
import { BeatTheScorePage } from "./pages/BeatTheScorePage";
import { DailyPage } from "./pages/DailyPage";
import { ForeverPage } from "./pages/ForeverPage";
import { ShootoutPage } from "./pages/ShootoutPage";
import { DraftBattlePage } from "./pages/DraftBattlePage";
import { DesktopModeNoticeModal } from "./components/DesktopModeNoticeModal";

export type AppMode =
  | "daily"
  | "forever"
  | "beatTheScore"
  | "shootout"
  | "draftBattle";

const MOBILE_DESKTOP_NOTICE_MODES: Partial<Record<AppMode, string>> = {
  beatTheScore: "Beat The Score",
  shootout: "Shootout",
  draftBattle: "Draft Battle",
};

const MOBILE_NOTICE_MEDIA_QUERY = "(max-width: 900px)";

/**
 * Hosts the four game modes and controls mode-to-mode transitions.
 */
export default function App() {
  const [mode, setMode] = useState<AppMode>("daily");
  const [autoGenerateToken, setAutoGenerateToken] = useState(0);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [isDesktopModeNoticeOpen, setIsDesktopModeNoticeOpen] = useState(false);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }

    const mediaQuery = window.matchMedia(MOBILE_NOTICE_MEDIA_QUERY);

    const updateViewportState = (event?: MediaQueryListEvent) => {
      setIsMobileViewport(event ? event.matches : mediaQuery.matches);
    };

    updateViewportState();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", updateViewportState);
      return () =>
        mediaQuery.removeEventListener("change", updateViewportState);
    }

    mediaQuery.addListener(updateViewportState);
    return () => mediaQuery.removeListener(updateViewportState);
  }, []);

  const desktopModeNoticeLabel = useMemo(
    () => MOBILE_DESKTOP_NOTICE_MODES[mode],
    [mode],
  );

  useEffect(() => {
    if (
      !desktopModeNoticeLabel ||
      !isMobileViewport ||
      typeof window === "undefined"
    ) {
      setIsDesktopModeNoticeOpen(false);
      return;
    }

    const sessionKey = `desktop-mode-notice:${mode}`;
    const hasSeenNotice = window.sessionStorage.getItem(sessionKey) === "true";

    if (hasSeenNotice) {
      setIsDesktopModeNoticeOpen(false);
      return;
    }

    setIsDesktopModeNoticeOpen(true);
    window.sessionStorage.setItem(sessionKey, "true");
  }, [desktopModeNoticeLabel, isMobileViewport, mode]);

  const selectedPage = (() => {
    if (mode === "daily") {
      return (
        <DailyPage
          activeMode={mode}
          onChangeMode={setMode}
          onCreateNewForeverGame={() => {
            setAutoGenerateToken((previous) => previous + 1);
            setMode("forever");
          }}
        />
      );
    }

    if (mode === "beatTheScore") {
      return <BeatTheScorePage activeMode={mode} onChangeMode={setMode} />;
    }

    if (mode === "shootout") {
      return <ShootoutPage activeMode={mode} onChangeMode={setMode} />;
    }

    if (mode === "draftBattle") {
      return <DraftBattlePage activeMode={mode} onChangeMode={setMode} />;
    }

    return (
      <ForeverPage
        activeMode={mode}
        autoGenerateToken={autoGenerateToken}
        onChangeMode={setMode}
      />
    );
  })();

  return (
    <>
      {selectedPage}
      <DesktopModeNoticeModal
        isOpen={isDesktopModeNoticeOpen}
        modeLabel={desktopModeNoticeLabel ?? "This mode"}
        onClose={() => setIsDesktopModeNoticeOpen(false)}
      />
    </>
  );
}
