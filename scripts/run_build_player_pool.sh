#!/usr/bin/env bash
set -Eeuo pipefail

REPO_DIR="/root/nba_cut_trade_sign"
OUTPUT_PATH="$REPO_DIR/src/data/players.json"
TMP_PATH="/tmp/players.json"
LOG_DIR="$REPO_DIR/logs"
TIMESTAMP="$(date +%Y-%m-%d_%H-%M-%S)"
LOG_FILE="$LOG_DIR/build_player_pool_$TIMESTAMP.log"

mkdir -p "$LOG_DIR"

exec > >(tee -a "$LOG_FILE") 2>&1

echo "===== build_player_pool run started at $(date) ====="

cd "$REPO_DIR"

echo "Current branch:"
git branch --show-current || true

echo "Fetching latest repo state..."
git fetch origin

echo "Resetting repo to origin/main..."
git reset --hard origin/main

echo "Removing old temp output if present..."
rm -f "$TMP_PATH"

echo "Running builder..."
python3 scripts/build_player_pool.py "$TMP_PATH"

echo "Validating JSON output..."
python3 - <<'PY'
import json
from pathlib import Path

tmp = Path("/tmp/players.json")
if not tmp.exists():
    raise SystemExit("Validation failed: /tmp/players.json was not created.")

data = json.loads(tmp.read_text(encoding="utf-8"))

if not isinstance(data, list):
    raise SystemExit("Validation failed: top-level JSON is not a list.")

if len(data) == 0:
    raise SystemExit("Validation failed: player list is empty.")

required_keys = {
    "id",
    "nbaPlayerId",
    "name",
    "team",
    "position",
    "age",
    "bpm",
    "per",
    "ws48",
    "usgPct",
    "salary",
    "gamesPlayed",
    "teamGamesPlayed",
    "isRookie",
    "durability",
    "minutesPlayed",
    "minutesPerGame",
    "minuteShareOfTeam",
    "ppg",
    "rpg",
    "apg",
    "spg",
    "bpg",
    "fgm",
    "fga",
    "threePm",
    "threePa",
    "fgPct",
    "threePct",
    "ftPct",
    "headshotUrl",
}

sample = data[0]
missing = sorted(required_keys - set(sample.keys()))
if missing:
    raise SystemExit(f"Validation failed: missing keys in first player: {missing}")

print(f"Validation passed: {len(data)} players.")
PY

echo "Replacing players.json..."
mv "$TMP_PATH" "$OUTPUT_PATH"

echo "Checking for changes..."
git add src/data/players.json

if git diff --cached --quiet; then
  echo "No changes detected. Nothing to commit."
  echo "===== build_player_pool run finished successfully at $(date) ====="
  exit 0
fi

echo "Committing updated players.json..."
git config user.name "build-bot"
git config user.email "build-bot@local"
git commit -m "chore: refresh player pool"

echo "Pushing to GitHub..."
git push origin main

echo "===== build_player_pool run finished successfully at $(date) ====="
