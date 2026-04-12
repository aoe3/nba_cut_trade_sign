import { useState } from "react";
import "./App.css";
import { BeatTheScorePage } from "./pages/BeatTheScorePage";
import { DailyPage } from "./pages/DailyPage";
import { ForeverPage } from "./pages/ForeverPage";
import { ShootoutPage } from "./pages/ShootoutPage";
import { DraftBattlePage } from "./pages/DraftBattlePage";

export type AppMode =
  | "daily"
  | "forever"
  | "beatTheScore"
  | "shootout"
  | "draftBattle";

/**
 * Hosts the four game modes and controls mode-to-mode transitions.
 */
export default function App() {
  const [mode, setMode] = useState<AppMode>("daily");
  const [autoGenerateToken, setAutoGenerateToken] = useState(0);

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
}
