type MoveCounterProps = {
  movesRemaining: number;
};

export function MoveCounter({ movesRemaining }: MoveCounterProps) {
  const total = 5;
  const used = total - movesRemaining;

  return (
    <div className="move-counter">
      <div className="move-counter__label">Trades/Cuts Remaining</div>
      <div className="move-counter__dots">
        {Array.from({ length: total }).map((_, index) => {
          const isUsed = index < used;
          return (
            <span
              key={index}
              className={`move-dot ${isUsed ? "move-dot--used" : ""}`}
            />
          );
        })}
      </div>
    </div>
  );
}
