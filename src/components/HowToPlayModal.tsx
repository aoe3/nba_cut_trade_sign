import { useEffect } from "react";

type HowToPlayModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

export function HowToPlayModal({ isOpen, onClose }: HowToPlayModalProps) {
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
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="how-to-play-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          className="modal-close-btn"
          type="button"
          onClick={onClose}
          aria-label="Close how to play"
        >
          ×
        </button>

        <div className="modal-content">
          <div className="modal-eyebrow">How To Play</div>
          <h2 id="how-to-play-title" className="modal-title">
            Welcome to Cut / Trade / Sign
          </h2>
          <h2>
            The NBA version of{" "}
            <a href="https://en.wikipedia.org/wiki/Fuck,_marry,_kill">
              "F*ck, Marry, Kill"
            </a>
          </h2>

          <h3>
            Here's how to play: Construct the HIGHEST scoring roster... That's
            it!
            <br></br>
          </h3>

          <h3>
            TL;DR for below: Cut / Sign / Trade players to build the
            highest-scoring lineup with only 5 moves.<br></br>Signing a player
            uses 0 moves. All cuts, trades, and signings are FINAL!
            <br></br>
            <br></br>
          </h3>
          <ul className="how-to-list">
            <li>
              You can Sign a player (for free) and "lock them in" to your
              roster! However, a <strong>Trade</strong> or <strong>Cut</strong>{" "}
              will use up 1 of your 5 moves.
            </li>
            <li>
              Cutting a player replaces them with someone random. They may be
              better, worse, or around the same. It's a toss-up!
            </li>
            <li>
              Trades offer 3 players around that original player's score. Could
              be slightly better. Could be slightly worse. It's good for small
              score bumps... if you pick the right one.
              <br></br>
              <strong>Note 1:</strong>{" "}
              <strong>Starting a trade is irreversible</strong>! You must pick
              one of the three options and hit "Execute Trade" before
              continuing!<br></br>
              <strong>Note 2:</strong> It's meant to be extremely rare, but a
              trade <i>may</i> offer three players that are all marginally
              worse. :/<br></br>
              <i>
                - Oh, and uh... you didn't hear it from me... but stars
                sometimes sneak into the trade rumors...
              </i>
            </li>
            <li>
              All <s>sales</s> trades and cuts are final and non-refundable! No
              takebacksies, exchanges, or store credit!
            </li>
            <li>
              When your 5 Trades/Cuts are gone, every remaining unlocked player
              is automatically locked as the currently offered player.
            </li>
            <li>
              A player's score factors in:{" "}
              <strong>
                <a href="https://www.basketball-reference.com/about/bpm2.html">
                  BPM
                </a>
                ,{" "}
                <a href="https://www.basketball-reference.com/about/per.html">
                  PER
                </a>
                ,{" "}
                <a href="https://www.basketball-reference.com/about/ws.html">
                  WS/48
                </a>
                ,{" "}
                <a href="https://instatglossary.hudl.com/basketball/parameters/additional-data/usg/">
                  USG%
                </a>
                , MPG,
              </strong>{" "}
              and <strong>games played</strong> (sorry, AD), with a little buff,
              or nerf, based on per-game averages and shooting percentages.
              (There are many metrics. I chose a few to try and shape each
              player's impact on winning.)
            </li>
            <li>
              Your <strong>Final Score</strong> is the sum of locked player
              scores. Your <strong>Puzzle %</strong> measures how close you were
              to the best possible roster for that puzzle. We pre-solve puzzles
              to find the best and worst possible 5-move games.
            </li>
            <li>
              Your "Rating" is how well you did relative to the range of
              possible scores:
              <br></br>
              <span className="rating--gleague">G-League</span> &lt; 15% &lt;={" "}
              <span className="rating--bench">Bench</span> &lt; 35% &lt;={" "}
              <span className="rating--starter">Starter</span> &lt; 60 &lt;={" "}
              <span className="rating--superstar_normal">Superstar</span> &lt;
              85 &lt;= <span className="rating--legend_normal">Legend</span>
            </li>
            <li>
              Use the move counter (look for green or red circles) on top to
              keep track of how any moves you have left!
            </li>
            <li>
              "Forever" Mode allows you to regenerate game boards over and over
              and over... and over... and over.{" "}
              <a href="https://www.youtube.com/watch?v=l60MnDJklnM">
                <s>Stop it. Get some help.</s>
              </a>
            </li>
            <li>
              "Beat The Score" mode creates a lineup for you to beat... but
              you'll ONLY know their ending score to start!
            </li>
            <li>
              "Shootout" mode is YOU vs. the CPU in turn-based decision warfare!
            </li>
            <li>
              "Draft Battle" Draft the best 3-man team! You only know 3 of their
              stats to start!
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
