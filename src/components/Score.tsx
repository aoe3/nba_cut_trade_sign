type ScoreBarProps = {
  finalScore: number | null;
  finalScorePct: number | null;
  puzzleRating: string;
  ratingClass: string;
  bestScore?: number;
  worstScore?: number;
};

export function ScoreBar({
  finalScore,
  finalScorePct,
  puzzleRating,
  ratingClass,
  bestScore,
  worstScore,
}: ScoreBarProps) {
  return (
    <footer className="scorebar">
      <div className="scorebar__group">
        <div className="scorebar__label">Final Score</div>
        <div className="scorebar__value">
          {finalScore?.toFixed(1) ?? "--"}
        </div>
      </div>

      <div className="scorebar__group">
        <div className="scorebar__label">Puzzle %</div>
        <div className="scorebar__value">
          {finalScorePct !== null ? `${finalScorePct.toFixed(1)}%` : "--"}
        </div>
      </div>

      <div className="scorebar__group">
        <div className="scorebar__label">Rating</div>
        <div className={`scorebar__value ${ratingClass}`}>
          {puzzleRating}
        </div>
      </div>

      <div className="scorebar__group">
        <div className="scorebar__label">Range</div>
        <div className="scorebar__value scorebar__value--small">
          {typeof worstScore === "number" && typeof bestScore === "number"
            ? `${worstScore.toFixed(1)} – ${bestScore.toFixed(1)}`
            : "--"}
        </div>
      </div>
    </footer>
  );
}
