import { useEffect, useMemo, useState } from "react";

type TurnOwner = "user" | "cpu";
type CoinSide = "heads" | "tails";
type TossWinner = TurnOwner | null;

type ShootoutCoinFlipModalProps = {
  isOpen: boolean;
  onComplete: (firstTurn: TurnOwner) => void;
  cpuPrefersFirstOnWin?: boolean;
};

export function ShootoutCoinFlipModal({
  isOpen,
  onComplete,
  cpuPrefersFirstOnWin = false,
}: ShootoutCoinFlipModalProps) {
  const [pickedSide, setPickedSide] = useState<CoinSide | null>(null);
  const [isFlipping, setIsFlipping] = useState(false);
  const [resultSide, setResultSide] = useState<CoinSide | null>(null);
  const [flipTargetSide, setFlipTargetSide] = useState<CoinSide>("heads");
  const [tossWinner, setTossWinner] = useState<TossWinner>(null);
  const [firstTurn, setFirstTurn] = useState<TurnOwner | null>(null);
  const [countdownProgress, setCountdownProgress] = useState(100);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setPickedSide(null);
    setIsFlipping(false);
    setResultSide(null);
    setFlipTargetSide("heads");
    setTossWinner(null);
    setFirstTurn(null);
    setCountdownProgress(100);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !firstTurn) {
      return;
    }

    setCountdownProgress(100);

    const totalMs = 2400;
    const startedAt = window.performance.now();

    const intervalId = window.setInterval(() => {
      const elapsed = window.performance.now() - startedAt;
      const remainingRatio = Math.max(0, 1 - elapsed / totalMs);
      setCountdownProgress(remainingRatio * 100);
    }, 50);

    const timeoutId = window.setTimeout(() => {
      window.clearInterval(intervalId);
      setCountdownProgress(0);
      onComplete(firstTurn);
    }, totalMs);

    return () => {
      window.clearInterval(intervalId);
      window.clearTimeout(timeoutId);
    };
  }, [firstTurn, isOpen, onComplete]);

  const resultMessage = useMemo(() => {
    if (!resultSide) {
      return "Call the coin flip to decide who gets the first move.";
    }

    if (tossWinner === "user") {
      if (!firstTurn) {
        return `It landed on ${resultSide}. You won the toss.`;
      }

      if (firstTurn === "user") {
        return `It landed on ${resultSide}. You won the toss and chose to go first.`;
      }

      return `It landed on ${resultSide}. You won the toss and chose for CPU to go first.`;
    }

    if (tossWinner === "cpu") {
      if (firstTurn === "user") {
        return `It landed on ${resultSide}. CPU won the toss and chose for you to go first.`;
      }

      if (firstTurn === "cpu") {
        return `It landed on ${resultSide}. CPU won the toss and chose for CPU to go first.`;
      }

      return `It landed on ${resultSide}. CPU won the toss.`;
    }

    return "Call the coin flip to decide who gets the first move.";
  }, [firstTurn, resultSide, tossWinner]);

  function handlePick(side: CoinSide) {
    if (isFlipping || resultSide || firstTurn) {
      return;
    }

    const landedSide: CoinSide = Math.random() < 0.5 ? "heads" : "tails";
    const winner: TossWinner = landedSide === side ? "user" : "cpu";

    setPickedSide(side);
    setFlipTargetSide(landedSide);
    setIsFlipping(true);

    window.setTimeout(() => {
      setResultSide(landedSide);
      setTossWinner(winner);
      setIsFlipping(false);

      if (winner === "user") {
        return;
      }

      const cpuFirstTurn: TurnOwner = cpuPrefersFirstOnWin
        ? "cpu"
        : Math.random() < 0.5
          ? "user"
          : "cpu";
      setFirstTurn(cpuFirstTurn);
    }, 1100);
  }

  if (!isOpen) {
    return null;
  }

  const coinClassName = [
    "shootout-coin",
    isFlipping
      ? flipTargetSide === "tails"
        ? "shootout-coin--flipping-to-tails"
        : "shootout-coin--flipping-to-heads"
      : resultSide === "tails"
        ? "shootout-coin--result-tails"
        : "shootout-coin--result-heads",
  ].join(" ");

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Shootout coin flip"
    >
      <div className="modal-card modal--shootout-coin">
        <div className="modal-content">
          <h2 className="modal-title">Shootout</h2>

          <div className="shootout-coin-modal__body">
            <div className={coinClassName} aria-hidden="true">
              <div className="shootout-coin__face shootout-coin__face--front">
                H
              </div>
              <div className="shootout-coin__face shootout-coin__face--back">
                T
              </div>
            </div>

            <div className="shootout-coin-modal__message">{resultMessage}</div>

            {!pickedSide ? (
              <div className="shootout-coin-modal__choices">
                <button
                  type="button"
                  className="mode-btn mode-btn--forever"
                  onClick={() => handlePick("heads")}
                >
                  Heads
                </button>
                <button
                  type="button"
                  className="mode-btn mode-btn--forever"
                  onClick={() => handlePick("tails")}
                >
                  Tails
                </button>
              </div>
            ) : null}

            {tossWinner === "user" && !firstTurn ? (
              <div className="shootout-coin-modal__choices">
                <button
                  type="button"
                  className="mode-btn mode-btn--forever"
                  onClick={() => setFirstTurn("user")}
                >
                  I Go First
                </button>
                <button
                  type="button"
                  className="mode-btn mode-btn--forever"
                  onClick={() => setFirstTurn("cpu")}
                >
                  CPU Goes First
                </button>
              </div>
            ) : null}

            {firstTurn ? (
              <div className="shootout-coin-modal__countdown">
                <div className="shootout-coin-modal__countdown-label">
                  Starting game…
                </div>
                <div className="shootout-coin-modal__countdown-track">
                  <div
                    className="shootout-coin-modal__countdown-fill"
                    style={{ width: `${countdownProgress}%` }}
                  />
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
