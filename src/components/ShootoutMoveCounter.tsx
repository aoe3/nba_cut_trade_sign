type ShootoutMoveCounterProps = {
  userMovesRemaining: number;
  cpuMovesRemaining: number;
};

function renderDots(used: number, total: number, keyPrefix: string) {
  return Array.from({ length: total }).map((_, index) => {
    const isUsed = index < used;
    return (
      <span
        key={`${keyPrefix}-${index}`}
        className={`move-dot ${isUsed ? "move-dot--used" : ""}`.trim()}
      />
    );
  });
}

export function ShootoutMoveCounter({
  userMovesRemaining,
  cpuMovesRemaining,
}: ShootoutMoveCounterProps) {
  const total = 5;
  const userUsed = total - userMovesRemaining;
  const cpuUsed = total - cpuMovesRemaining;

  return (
    <div className="move-counter shootout-move-counter">
      <div className="move-counter__label">Trades/Cuts Remaining</div>
      <div className="shootout-move-counter__track" aria-label="Shootout moves remaining">
        <div className="shootout-move-counter__side shootout-move-counter__side--user">
          {renderDots(userUsed, total, "user")}
        </div>

        <span className="shootout-move-counter__divider" aria-hidden="true" />

        <div className="shootout-move-counter__side shootout-move-counter__side--cpu">
          {renderDots(cpuUsed, total, "cpu")}
        </div>
      </div>
    </div>
  );
}
