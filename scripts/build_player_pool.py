
#!/usr/bin/env python3
"""Build a players.json-style output without nba_api.

Compatibility mode:
- Emits the same players.json schema expected from build_player_pool.py.
- Keeps nbaPlayerId present but null because nba_api IDs are no longer available here.
- Does not emit espnPlayerId in the final output schema.

Data sources:
- Basketball Reference:
  - current-season per-game table
  - previous-season per-game table
  - current-season advanced table
  - contracts table
  - current-season team summary table for team GP
- ESPN:
  - public/undocumented team roster endpoints for ESPN athlete IDs + headshots

Notes:
- This is intentionally a test replacement builder.
- We keep `nbaPlayerId` as null and add `espnPlayerId`.
- For traded players, we prefer aggregate (TOT) stats when available, but use the
  last listed non-aggregate team row as the player's current/display team.
"""

from __future__ import annotations

import csv
import json
import os
import re
import sys
import time
import unicodedata
from dataclasses import asdict, dataclass
from difflib import SequenceMatcher
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

import requests
from bs4 import BeautifulSoup

DEFAULT_JSON_OUTPUT_PATH = "src/data/players.json"
DEFAULT_CURRENT_SEASON = "2025-26"
DEFAULT_PREVIOUS_SEASON = "2024-25"
DEFAULT_ESPN_CACHE_PATH = "src/data/espn_headshots.json"
DEFAULT_ESPN_SALARY_CACHE_PATH = "src/data/espn_salaries.json"

HTML_TIMEOUT_SECONDS = 45
JSON_TIMEOUT_SECONDS = 30
MAX_RETRIES = 5
RETRY_BACKOFF_SECONDS = 2.0
SLEEP_BETWEEN_ESPN_REQUESTS_SECONDS = 0.35

CURRENT_SEASON_DURABILITY_THRESHOLD_GAMES = 20
ESPN_MIN_SIMILARITY = 0.88

BASKETBALL_REFERENCE_ADVANCED_TEMPLATE = (
    "https://www.basketball-reference.com/leagues/NBA_{end_year}_advanced.html"
)
BASKETBALL_REFERENCE_PER_GAME_TEMPLATE = (
    "https://www.basketball-reference.com/leagues/NBA_{end_year}_per_game.html"
)
BASKETBALL_REFERENCE_LEAGUE_TEMPLATE = (
    "https://www.basketball-reference.com/leagues/NBA_{end_year}.html"
)
BASKETBALL_REFERENCE_CONTRACTS_URL = (
    "https://www.basketball-reference.com/contracts/players.html"
)

ESPN_SITE_BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba"
ESPN_HEADSHOT_TEMPLATE = "https://a.espncdn.com/i/headshots/nba/players/full/{espn_id}.png"
ESPN_SALARIES_URL_TEMPLATE = "https://www.espn.com/nba/salaries/_/page/{page}"
MAX_ESPN_SALARY_PAGES = 20

USE_MIN_SALARY_FALLBACK = True
# Compatibility with build_player_pool.py output schema: nbaPlayerId remains present, espnPlayerId is not emitted.
IMPUTED_MIN_SALARY = 1000000

HTML_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/146.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.google.com/",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "Connection": "keep-alive",
}

JSON_HEADERS = {
    "User-Agent": HTML_HEADERS["User-Agent"],
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "Referer": "https://www.espn.com/",
}

# Used to clean names generally and to bridge ESPN/BBR naming differences.
NAME_ALIASES = {
    "aj green": "a j green",
    "p j tucker": "pj tucker",
    "r j barrett": "rj barrett",
    "r j lewis": "rj lewis",
    "ronald holland": "ron holland",
    "karl anthony towns": "karl anthony towns",
}

# Used specifically when matching BBR contract names, which can be mangled.
CONTRACT_NAME_ALIASES = {
    "aj green": "a j green",
    "alperen sengun": "alperen a enga1 4n",
    "bogdan bogdanovic": "bogdan bogdanovia",
    "dennis schroder": "dennis schra der",
    "egor demin": "egor dn min",
    "hugo gonzalez": "hugo gonza lez",
    "jonas valanciunas": "jonas valana ia nas",
    "jusuf nurkic": "jusuf nurkia",
    "karlo matkovic": "karlo matkovia",
    "kasparas jakucionis": "kasparas jakua ionis",
    "kristaps porzingis": "kristaps porzia a is",
    "luka doncic": "luka dona ia",
    "moussa diabate": "moussa diabata",
    "nikola jokic": "nikola jokia",
    "nikola jovic": "nikola jovia",
    "nikola topic": "nikola topia",
    "nikola vucevic": "nikola vua evia",
    "nolan traore": "nolan traora",
    "pacome dadiet": "paca me dadiet",
    "ronald holland": "ron holland",
    "tidjane salaun": "tidjane salaa1 4n",
    "yanic konan niederhauser": "yanic konan niederha user",
}

BBR_TO_STANDARD_TEAM = {
    "ATL": "ATL",
    "BOS": "BOS",
    "BRK": "BKN",
    "BKN": "BKN",
    "CHO": "CHA",
    "CHA": "CHA",
    "CHI": "CHI",
    "CLE": "CLE",
    "DAL": "DAL",
    "DEN": "DEN",
    "DET": "DET",
    "GSW": "GSW",
    "HOU": "HOU",
    "IND": "IND",
    "LAC": "LAC",
    "LAL": "LAL",
    "MEM": "MEM",
    "MIA": "MIA",
    "MIL": "MIL",
    "MIN": "MIN",
    "NOP": "NOP",
    "NYK": "NYK",
    "OKC": "OKC",
    "ORL": "ORL",
    "PHI": "PHI",
    "PHO": "PHX",
    "PHX": "PHX",
    "POR": "POR",
    "SAC": "SAC",
    "SAS": "SAS",
    "TOR": "TOR",
    "UTA": "UTA",
    "WAS": "WAS",
    "TOT": "TOT",
}


FULL_TEAM_NAME_TO_ABBR = {
    "Atlanta Hawks": "ATL",
    "Boston Celtics": "BOS",
    "Brooklyn Nets": "BKN",
    "Charlotte Hornets": "CHA",
    "Chicago Bulls": "CHI",
    "Cleveland Cavaliers": "CLE",
    "Dallas Mavericks": "DAL",
    "Denver Nuggets": "DEN",
    "Detroit Pistons": "DET",
    "Golden State Warriors": "GSW",
    "Houston Rockets": "HOU",
    "Indiana Pacers": "IND",
    "Los Angeles Clippers": "LAC",
    "Los Angeles Lakers": "LAL",
    "Memphis Grizzlies": "MEM",
    "Miami Heat": "MIA",
    "Milwaukee Bucks": "MIL",
    "Minnesota Timberwolves": "MIN",
    "New Orleans Pelicans": "NOP",
    "New York Knicks": "NYK",
    "Oklahoma City Thunder": "OKC",
    "Orlando Magic": "ORL",
    "Philadelphia 76ers": "PHI",
    "Phoenix Suns": "PHX",
    "Portland Trail Blazers": "POR",
    "Sacramento Kings": "SAC",
    "San Antonio Spurs": "SAS",
    "Toronto Raptors": "TOR",
    "Utah Jazz": "UTA",
    "Washington Wizards": "WAS",
}



ALL_STANDARD_TEAM_ABBRS = set(FULL_TEAM_NAME_TO_ABBR.values())
STANDARD_TO_BBR_CONTRACT_TEAM = {"BKN": "BRK", "CHA": "CHO", "PHX": "PHO"}

MOJIBAKE_MARKERS = ("Ã", "Å", "Ä", "Ð", "Ñ", "â", "€", "™", "œ", "ž", "š")


@dataclass
class FilteredPlayerReport:
    name: str
    team: str
    position: str
    missingFields: List[str]

@dataclass
class OutputPlayer:
    id: str
    nbaPlayerId: Optional[int]
    name: str
    team: str
    position: str
    age: Optional[int]
    bpm: Optional[float]
    per: Optional[float]
    ws48: Optional[float]
    usgPct: Optional[float]
    salary: Optional[int]
    gamesPlayed: Optional[int]
    teamGamesPlayed: Optional[int]
    isRookie: Optional[bool]
    durability: Optional[float]
    minutesPlayed: Optional[int]
    minutesPerGame: Optional[float]
    minuteShareOfTeam: Optional[float]
    ppg: Optional[float]
    rpg: Optional[float]
    apg: Optional[float]
    spg: Optional[float]
    bpg: Optional[float]
    fgm: Optional[float]
    fga: Optional[float]
    threePm: Optional[float]
    threePa: Optional[float]
    fgPct: Optional[float]
    threePct: Optional[float]
    ftPct: Optional[float]
    headshotUrl: str


def main() -> None:
    arg1 = sys.argv[1] if len(sys.argv) > 1 else None
    arg2 = sys.argv[2] if len(sys.argv) > 2 else None
    arg3 = sys.argv[3] if len(sys.argv) > 3 else None

    output_json_path = DEFAULT_JSON_OUTPUT_PATH
    output_csv_path: Optional[str] = None
    current_season = DEFAULT_CURRENT_SEASON

    if arg1 is None:
        pass
    elif looks_like_season(arg1):
        current_season = arg1
    else:
        output_json_path = arg1

    if arg2:
        if looks_like_season(arg2):
            current_season = arg2
        else:
            output_csv_path = arg2

    if arg3:
        current_season = arg3

    previous_season = (
        DEFAULT_PREVIOUS_SEASON
        if current_season == DEFAULT_CURRENT_SEASON
        else derive_previous_season(current_season)
    )

    print(f"Building player pool for {current_season}...")
    print(f"JSON output: {output_json_path}")
    if output_csv_path:
        print(f"CSV output:  {output_csv_path}")

    print("Fetching current-season BBR per-game stats...")
    current_box = fetch_basketball_reference_per_game(current_season)

    fallback_team_gp = build_team_gp_fallback_from_current_box(current_box)

    print("Fetching previous-season BBR per-game stats...")
    previous_box = fetch_basketball_reference_per_game(previous_season)

    print("Fetching current-season BBR advanced stats...")
    br_advanced = fetch_basketball_reference_advanced(current_season)

    print("Fetching current-season BBR team GP...")
    current_team_gp = fetch_basketball_reference_team_games_played(current_season)

    print("Fetching Basketball Reference contracts...")
    br_contracts = fetch_basketball_reference_contracts()

    print("Fetching Basketball Reference team contract fallbacks...")
    team_contracts = fetch_basketball_reference_team_contracts(sorted({group["displayTeam"] for group in current_box.values()}))

    print("Fetching ESPN salary fallbacks...")
    espn_salary_lookup = load_or_build_espn_salary_lookup(DEFAULT_ESPN_SALARY_CACHE_PATH)

    player_names = [group["displayName"] for _, group in sorted(current_box.items())]
    print(f"Loaded {len(player_names)} current-season players with at least 1 game from BBR.")

    print("Fetching ESPN headshots...")
    espn_lookup = load_or_build_espn_lookup(player_names, DEFAULT_ESPN_CACHE_PATH)

    outputs: List[OutputPlayer] = []
    salary_debug_rows: List[Dict[str, Any]] = []
    minute_share_debug_rows: List[Dict[str, Any]] = []

    for normalized_name, current_group in current_box.items():
        display_name = canonicalize_person_name(current_group["displayName"])
        display_team = current_group["displayTeam"]
        stats_row = current_group["statsRow"]

        prev_group = previous_box.get(normalized_name)

        formatted_contract_name = CONTRACT_NAME_ALIASES.get(normalized_name, normalized_name)

        adv_rows_for_player = br_advanced.get(normalized_name) or br_advanced.get(formatted_contract_name, {})
        adv_entry, adv_team_used = select_advanced_entry(
            adv_rows_for_player=adv_rows_for_player,
            fallback_team=display_team,
        )

        salary, salary_source = lookup_salary(
            display_name=display_name,
            display_team=display_team,
            normalized_name=normalized_name,
            formatted_contract_name=formatted_contract_name,
            br_contracts=br_contracts,
            team_contracts=team_contracts,
            espn_salary_lookup=espn_salary_lookup,
        )

        position = normalize_position(
            (adv_entry or {}).get("position") or stats_row.get("position")
        )
        age = first_not_none(
            (adv_entry or {}).get("age"),
            stats_row.get("age"),
        )
        bpm = (adv_entry or {}).get("bpm")
        per = (adv_entry or {}).get("per")
        ws48 = (adv_entry or {}).get("ws48")
        usg_pct = (adv_entry or {}).get("usgPct")
        minutes_played = (adv_entry or {}).get("minutesPlayed")
        current_games_played = stats_row.get("gamesPlayed")
        current_team_games_played = (
            current_team_gp.get(display_team)
            or current_team_gp.get(normalize_team_abbr(adv_team_used or ""))
            or fallback_team_gp.get(display_team)
            or fallback_team_gp.get(normalize_team_abbr(adv_team_used or ""))
        )

        previous_stats_row = prev_group["statsRow"] if prev_group is not None else None
        previous_games_played = (previous_stats_row or {}).get("gamesPlayed")
        is_rookie: Optional[bool] = prev_group is None

        use_current_season_durability = False
        if (
            current_team_games_played is not None
            and current_team_games_played >= CURRENT_SEASON_DURABILITY_THRESHOLD_GAMES
        ):
            use_current_season_durability = True
        elif is_rookie is True:
            use_current_season_durability = True

        if use_current_season_durability:
            games_played = current_games_played
            team_games_played = current_team_games_played
        else:
            games_played = previous_games_played
            team_games_played = 82

        durability = (
            round(games_played / team_games_played, 4)
            if games_played is not None and team_games_played not in (None, 0)
            else None
        )

        minutes_per_game = (
            round(minutes_played / current_games_played, 2)
            if minutes_played is not None and current_games_played not in (None, 0)
            else None
        )

        minute_share_of_team = compute_minute_share_of_team(
            minutes_played=minutes_played,
            current_team_games_played=current_team_games_played,
            current_games_played=current_games_played,
            adv_team_used=adv_team_used,
        )

        espn_entry = espn_lookup.get(normalized_name)
        headshot_url = str((espn_entry or {}).get("headshotUrl") or "")

        salary_debug_rows.append({
            "name": display_name,
            "team": display_team,
            "normalizedName": normalized_name,
            "formattedContractName": formatted_contract_name,
            "salary": salary,
            "salarySource": salary_source,
        })

        if minute_share_of_team is None:
            minute_share_debug_rows.append({
                "name": display_name,
                "team": display_team,
                "normalizedName": normalized_name,
                "advTeamUsed": adv_team_used,
                "minutesPlayed": minutes_played,
                "currentGamesPlayed": current_games_played,
                "currentTeamGamesPlayed": current_team_games_played,
                "isAggregateAdvTeam": bool(adv_team_used is not None and is_aggregate_team_code(adv_team_used)),
            })

        outputs.append(
            OutputPlayer(
                id=slugify(display_name),
                nbaPlayerId=None,
                name=display_name,
                team=display_team,
                position=position,
                age=age,
                bpm=bpm,
                per=per,
                ws48=ws48,
                usgPct=usg_pct,
                salary=salary,
                gamesPlayed=games_played,
                teamGamesPlayed=team_games_played,
                isRookie=is_rookie,
                durability=durability,
                minutesPlayed=minutes_played,
                minutesPerGame=minutes_per_game,
                minuteShareOfTeam=minute_share_of_team,
                ppg=stats_row.get("ppg"),
                rpg=stats_row.get("rpg"),
                apg=stats_row.get("apg"),
                spg=stats_row.get("spg"),
                bpg=stats_row.get("bpg"),
                fgm=stats_row.get("fgm"),
                fga=stats_row.get("fga"),
                threePm=stats_row.get("threePm"),
                threePa=stats_row.get("threePa"),
                fgPct=stats_row.get("fgPct"),
                threePct=stats_row.get("threePct"),
                ftPct=stats_row.get("ftPct"),
                headshotUrl=headshot_url,
            )
        )

    outputs.sort(key=lambda p: p.name)

    before_filter_count = len(outputs)
    filtered_players_report: List[FilteredPlayerReport] = []

    missing_counts = {
        "salary": 0,
        "age": 0,
        "bpm": 0,
        "per": 0,
        "ws48": 0,
        "usgPct": 0,
        "minutesPlayed": 0,
        "minutesPerGame": 0,
        "minuteShareOfTeam": 0,
        "headshotUrl": 0,
    }

    filtered_outputs: List[OutputPlayer] = []
    for p in outputs:
        missing = False
        missing_fields: List[str] = []

        if p.salary is None:
            missing_counts["salary"] += 1
            missing_fields.append("salary")
            missing = True
        if p.age is None:
            missing_counts["age"] += 1
            missing_fields.append("age")
            missing = True
        if p.bpm is None:
            missing_counts["bpm"] += 1
            missing_fields.append("bpm")
            missing = True
        if p.per is None:
            missing_counts["per"] += 1
            missing_fields.append("per")
            missing = True
        if p.ws48 is None:
            missing_counts["ws48"] += 1
            missing_fields.append("ws48")
            missing = True
        if p.usgPct is None:
            missing_counts["usgPct"] += 1
            missing_fields.append("usgPct")
            missing = True
        if p.minutesPlayed is None:
            missing_counts["minutesPlayed"] += 1
            missing_fields.append("minutesPlayed")
            missing = True
        if p.minutesPerGame is None:
            missing_counts["minutesPerGame"] += 1
            missing_fields.append("minutesPerGame")
            missing = True
        if p.minuteShareOfTeam is None:
            missing_counts["minuteShareOfTeam"] += 1
            missing_fields.append("minuteShareOfTeam")
            missing = True
        if p.headshotUrl == "":
            missing_counts["headshotUrl"] += 1
            missing_fields.append("headshotUrl")
            missing = True

        if missing:
            filtered_players_report.append(
                FilteredPlayerReport(
                    name=p.name,
                    team=p.team,
                    position=p.position,
                    missingFields=missing_fields,
                )
            )
        else:
            filtered_outputs.append(p)

    outputs = filtered_outputs
    filtered_out_count = before_filter_count - len(outputs)

    print(f"Filtered out players missing required fields: {filtered_out_count}")
    print("Missing field counts:")
    for key, value in missing_counts.items():
        print(f"  {key}: {value}")
    print(f"Final usable player pool: {len(outputs)}")

    ensure_parent_dir(output_json_path)
    with open(output_json_path, "w", encoding="utf-8") as f:
        json.dump([asdict(p) for p in outputs], f, indent=2)

    filtered_report_path = derive_filtered_report_path(output_json_path)
    ensure_parent_dir(filtered_report_path)
    with open(filtered_report_path, "w", encoding="utf-8") as f:
        json.dump([asdict(p) for p in filtered_players_report], f, indent=2)

    salary_debug_path = derive_debug_report_path(output_json_path, "salary_debug")
    ensure_parent_dir(salary_debug_path)
    with open(salary_debug_path, "w", encoding="utf-8") as f:
        json.dump(salary_debug_rows, f, indent=2)

    minute_share_debug_path = derive_debug_report_path(output_json_path, "minute_share_debug")
    ensure_parent_dir(minute_share_debug_path)
    with open(minute_share_debug_path, "w", encoding="utf-8") as f:
        json.dump(minute_share_debug_rows, f, indent=2)

    if output_csv_path:
        ensure_parent_dir(output_csv_path)
        write_csv(output_csv_path, outputs)

    print(f"Done. Wrote {len(outputs)} players.")
    print(f"JSON: {output_json_path}")
    print(f"Filtered players report: {filtered_report_path}")
    print(f"Salary debug report: {salary_debug_path}")
    print(f"Minute-share debug report: {minute_share_debug_path}")
    if output_csv_path:
        print(f"CSV:  {output_csv_path}")



def build_team_gp_fallback_from_current_box(current_box: Dict[str, Dict[str, Any]]) -> Dict[str, int]:
    fallback: Dict[str, int] = {}
    for group in current_box.values():
        team = normalize_team_abbr(str(group.get("displayTeam") or ""))
        stats_row = group.get("statsRow") or {}
        gp = safe_int(stats_row.get("gamesPlayed"))
        if team and gp is not None:
            fallback[team] = max(fallback.get(team, 0), gp)
    return fallback

def derive_filtered_report_path(output_json_path: str) -> str:
    base, ext = os.path.splitext(output_json_path)
    if not ext:
        return f"{output_json_path}_filtered_players.json"
    return f"{base}_filtered_players{ext}"


def derive_debug_report_path(output_json_path: str, suffix: str) -> str:
    base, ext = os.path.splitext(output_json_path)
    if not ext:
        return f"{output_json_path}_{suffix}.json"
    return f"{base}_{suffix}{ext}"

def first_present(row: Dict[str, Any], keys: Sequence[str]) -> Optional[str]:
    for key in keys:
        value = row.get(key)
        if value not in (None, ""):
            return str(value)
    return None

def looks_like_season(value: str) -> bool:
    return bool(re.fullmatch(r"\d{4}-\d{2}", value))


def derive_previous_season(current_season: str) -> str:
    start_year = int(current_season.split("-")[0])
    prev_start_year = start_year - 1
    prev_end_short = str(start_year)[2:]
    return f"{prev_start_year}-{prev_end_short}"


def season_to_end_year(season: str) -> int:
    start_year_str, end_suffix_str = season.split("-")
    start_year = int(start_year_str)
    end_suffix = int(end_suffix_str)
    century = (start_year // 100) * 100
    return century + end_suffix


def maybe_fix_mojibake(value: str) -> str:
    if not value or not any(marker in value for marker in MOJIBAKE_MARKERS):
        return value

    candidates = [value]
    for encoding in ("latin-1", "cp1252"):
        try:
            repaired = value.encode(encoding).decode("utf-8")
            candidates.append(repaired)
        except Exception:
            pass

    def score(text: str) -> tuple[int, int, int]:
        bad_markers = sum(text.count(marker) for marker in MOJIBAKE_MARKERS)
        non_ascii_letters = sum(1 for ch in text if ord(ch) > 127 and ch.isalpha())
        replacement_chars = text.count("�")
        return (bad_markers, replacement_chars, non_ascii_letters)

    return min(candidates, key=score)


def canonicalize_person_name(name: str) -> str:
    value = maybe_fix_mojibake(name)
    value = unicodedata.normalize("NFKD", value)
    value = "".join(ch for ch in value if not unicodedata.combining(ch))
    value = value.replace("’", "'")
    value = re.sub(r"\s+", " ", value).strip()
    return value


def normalize_name(name: str) -> str:
    value = canonicalize_person_name(name)
    value = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b\.?", "", value, flags=re.IGNORECASE)
    value = re.sub(r"[^a-zA-Z0-9]+", " ", value)
    value = re.sub(r"\s+", " ", value).strip().lower()
    return NAME_ALIASES.get(value, value)


def slugify(value: str) -> str:
    value = canonicalize_person_name(value)
    value = re.sub(r"[^a-zA-Z0-9]+", "_", value)
    return value.strip("_").lower()


def normalize_position(raw: Optional[str]) -> str:
    upper = (raw or "").upper().strip()
    if "PG" in upper:
        return "PG"
    if "SG" in upper:
        return "SG"
    if "SF" in upper:
        return "SF"
    if "PF" in upper:
        return "PF"
    if upper == "C" or upper.startswith("C") or upper.endswith("C") or "C-" in upper:
        return "C"
    if "G" in upper:
        return "SG"
    if "F" in upper:
        return "SF"
    return "C"


def normalize_team_abbr(team: Optional[str]) -> str:
    text = (team or "").strip()
    if not text:
        return ""

    if text in FULL_TEAM_NAME_TO_ABBR:
        return FULL_TEAM_NAME_TO_ABBR[text]

    upper = text.upper()
    return BBR_TO_STANDARD_TEAM.get(upper, upper)


def is_aggregate_team_code(team_code: str) -> bool:
    upper = (team_code or "").upper().strip()
    return upper == "TOT" or bool(re.fullmatch(r"\d+TM", upper))


def safe_int(value: Any) -> Optional[int]:
    try:
        if value is None or value == "":
            return None
        return int(float(str(value).replace(",", "").replace("$", "")))
    except (TypeError, ValueError):
        return None


def safe_float(value: Any) -> Optional[float]:
    try:
        if value is None or value == "":
            return None
        return float(str(value).replace(",", "").replace("$", ""))
    except (TypeError, ValueError):
        return None


def round_or_none(value: Optional[float], digits: int) -> Optional[float]:
    if value is None:
        return None
    return round(value, digits)


def first_not_none(*values: Any) -> Any:
    for value in values:
        if value is not None:
            return value
    return None


def ensure_parent_dir(file_path: str) -> None:
    parent = os.path.dirname(file_path)
    if parent:
        os.makedirs(parent, exist_ok=True)


def write_csv(file_path: str, rows: List[OutputPlayer]) -> None:
    headers = [
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
    ]
    with open(file_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=headers)
        writer.writeheader()
        for row in rows:
            writer.writerow(asdict(row))


def retry_request(fn):
    last_error: Optional[Exception] = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            return fn()
        except Exception as exc:
            last_error = exc
            if attempt < MAX_RETRIES:
                sleep_for = RETRY_BACKOFF_SECONDS * attempt
                print(f"  Request failed ({attempt}/{MAX_RETRIES}): {exc}")
                print(f"  Retrying in {sleep_for:.1f}s...")
                time.sleep(sleep_for)
    assert last_error is not None
    raise last_error


def fetch_html(url: str) -> str:
    def run() -> str:
        response = requests.get(url, headers=HTML_HEADERS, timeout=HTML_TIMEOUT_SECONDS)
        response.raise_for_status()
        if not response.encoding or response.encoding.lower() in ("iso-8859-1", "latin-1", "ascii"):
            response.encoding = response.apparent_encoding or "utf-8"
        return maybe_fix_mojibake(response.text)
    return retry_request(run)


def request_json(
    session: requests.Session,
    url: str,
    params: Optional[Dict[str, Any]] = None,
    timeout: int = JSON_TIMEOUT_SECONDS,
) -> Dict[str, Any]:
    def run() -> Dict[str, Any]:
        response = session.get(
            url,
            headers=JSON_HEADERS,
            params=params,
            timeout=timeout,
        )

        response.raise_for_status()

        content_type = response.headers.get("content-type", "").lower()

        # 🚨 ESPN sometimes returns HTML instead of JSON
        if "application/json" not in content_type:
            raise RuntimeError(
                f"Expected JSON but got {content_type} from {url}"
            )

        try:
            return response.json()
        except Exception:
            # Save debug response so you can inspect it if needed
            with open("espn_bad_response.html", "w", encoding="utf-8") as f:
                f.write(response.text)

            raise RuntimeError(
                f"Failed to parse JSON from {url}. "
                f"Saved raw response to espn_bad_response.html"
            )

    return retry_request(run)


def load_br_soup(html: str) -> BeautifulSoup:
    lowered = html.lower()
    if "access denied" in lowered or "forbidden" in lowered or "just a moment" in lowered:
        raise RuntimeError("Basketball Reference blocked the request.")
    uncommented_html = re.sub(r"<!--|-->", "", html)
    return BeautifulSoup(uncommented_html, "lxml")


def first_of(node: Any, selectors: Sequence[str]) -> Any:
    for selector in selectors:
        match = node.select_one(selector)
        if match is not None:
            return match
    return None


def find_br_stats_table(
    soup: BeautifulSoup,
    required_data_stats: set[str],
) -> Optional[Any]:
    for table in soup.select("table"):
        data_stats = {
            el.get("data-stat")
            for el in table.select("[data-stat]")
            if el.get("data-stat")
        }
        if required_data_stats.issubset(data_stats):
            return table
    return None


def parse_bbr_player_rows_from_table(table: Any) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []

    for tr in table.select("tbody tr"):
        if "thead" in (tr.get("class") or []):
            continue

        player_cell = first_of(
            tr,
            [
                'th[data-stat="player"]',
                'td[data-stat="player"]',
                'th[data-stat="name_display"]',
                'td[data-stat="name_display"]',
            ],
        )
        team_cell = first_of(
            tr,
            [
                'td[data-stat="team_id"]',
                'td[data-stat="team_name_abbr"]',
                'th[data-stat="team_id"]',
                'th[data-stat="team_name_abbr"]',
            ],
        )

        if player_cell is None or team_cell is None:
            continue

        name = canonicalize_person_name(player_cell.get_text(strip=True))
        team = normalize_team_abbr(team_cell.get_text(strip=True))

        if not name or not team:
            continue

        row_data: Dict[str, Any] = {
            "name": name,
            "team": team,
        }

        for cell in tr.select("th[data-stat], td[data-stat]"):
            data_stat = cell.get("data-stat")
            if not data_stat:
                continue
            row_data[data_stat] = cell.get_text(strip=True)

        rows.append(row_data)

    return rows


def choose_stats_and_display_team(rows: List[Dict[str, Any]]) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    if not rows:
        return None, None

    non_aggregate_rows = [row for row in rows if not is_aggregate_team_code(str(row.get("team") or ""))]
    aggregate_rows = [row for row in rows if is_aggregate_team_code(str(row.get("team") or ""))]

    stats_row = aggregate_rows[0] if aggregate_rows else non_aggregate_rows[-1] if non_aggregate_rows else rows[-1]
    display_team = non_aggregate_rows[-1]["team"] if non_aggregate_rows else str(stats_row.get("team") or "")
    return stats_row, normalize_team_abbr(display_team)


def fetch_basketball_reference_per_game(season: str) -> Dict[str, Dict[str, Any]]:
    end_year = season_to_end_year(season)
    url = BASKETBALL_REFERENCE_PER_GAME_TEMPLATE.format(end_year=end_year)
    html = fetch_html(url)
    soup = load_br_soup(html)

    def non_header_rows(candidate: Any) -> List[Any]:
        return [
            tr
            for tr in candidate.select("tbody tr")
            if "thead" not in (tr.get("class") or [])
        ]

    def looks_like_player_per_game_table(candidate: Any) -> bool:
        data_stats = {
            el.get("data-stat")
            for el in candidate.select("[data-stat]")
            if el.get("data-stat")
        }

        has_name = "player" in data_stats or "name_display" in data_stats
        has_games = "g" in data_stats or "games" in data_stats
        has_team = "team_id" in data_stats or "team_name_abbr" in data_stats
        has_points = "pts_per_g" in data_stats or "pts" in data_stats
        has_fg = "fg_per_g" in data_stats or "fg" in data_stats
        enough_rows = len(non_header_rows(candidate)) >= 100

        return has_name and has_games and has_team and has_points and has_fg and enough_rows

    table = None

    # Try known IDs first, but only accept them if they look real.
    for selector in (
        "table#per_game_stats",
        "table#per_game",
        "table#players_per_game",
    ):
        candidate = soup.select_one(selector)
        if candidate is not None and looks_like_player_per_game_table(candidate):
            table = candidate
            break

    # Fall back to scanning every table.
    if table is None:
        for candidate in soup.select("table"):
            if looks_like_player_per_game_table(candidate):
                table = candidate
                break

    if table is None:
        with open("br_per_game_debug.html", "w", encoding="utf-8") as f:
            f.write(html)

        debug_tables: List[Dict[str, Any]] = []
        for candidate in soup.select("table"):
            debug_tables.append(
                {
                    "id": candidate.get("id"),
                    "class": candidate.get("class"),
                    "row_count": len(non_header_rows(candidate)),
                    "sample_data_stats": sorted(
                        {
                            el.get("data-stat")
                            for el in candidate.select("[data-stat]")
                            if el.get("data-stat")
                        }
                    )[:80],
                }
            )

        with open("br_per_game_tables_debug.json", "w", encoding="utf-8") as f:
            json.dump(debug_tables, f, indent=2)

        raise RuntimeError(
            "Could not find Basketball Reference per-game player table. "
            "Saved raw HTML to br_per_game_debug.html and table metadata to br_per_game_tables_debug.json"
        )

    parsed_rows = parse_bbr_player_rows_from_table(table)

    if len(parsed_rows) < 100:
        with open("br_per_game_debug.html", "w", encoding="utf-8") as f:
            f.write(html)

        debug_info = {
            "selected_table_id": table.get("id"),
            "selected_table_class": table.get("class"),
            "selected_row_count": len(non_header_rows(table)),
            "parsed_row_count": len(parsed_rows),
            "selected_table_data_stats": sorted(
                {
                    el.get("data-stat")
                    for el in table.select("[data-stat]")
                    if el.get("data-stat")
                }
            )[:120],
        }

        with open("br_per_game_selected_table_debug.json", "w", encoding="utf-8") as f:
            json.dump(debug_info, f, indent=2)

        raise RuntimeError(
            "Selected a per-game table candidate, but parsed too few player rows. "
            "Saved raw HTML to br_per_game_debug.html and selected-table metadata to "
            "br_per_game_selected_table_debug.json"
        )

    by_player: Dict[str, List[Dict[str, Any]]] = {}
    display_name_by_norm: Dict[str, str] = {}

    for row in parsed_rows:
        name = str(row["name"])
        norm = normalize_name(name)
        if not norm:
            continue
        by_player.setdefault(norm, []).append(row)
        display_name_by_norm.setdefault(norm, name)

    result: Dict[str, Dict[str, Any]] = {}
    for norm, rows in by_player.items():
        stats_row_raw, display_team = choose_stats_and_display_team(rows)
        if stats_row_raw is None or not display_team:
            continue

        games_played = safe_int(first_present(stats_row_raw, ["g", "games"]))
        if games_played is None or games_played <= 0:
            continue

        result[norm] = {
            "displayName": canonicalize_person_name(display_name_by_norm[norm]),
            "displayTeam": display_team,
            "statsRow": {
                "gamesPlayed": games_played,
                "position": normalize_position(first_present(stats_row_raw, ["pos"])),
                "age": safe_int(first_present(stats_row_raw, ["age"])),
                "ppg": round_or_none(
                    safe_float(first_present(stats_row_raw, ["pts_per_g", "pts"])), 1
                ),
                "rpg": round_or_none(
                    safe_float(first_present(stats_row_raw, ["trb_per_g", "trb"])), 1
                ),
                "apg": round_or_none(
                    safe_float(first_present(stats_row_raw, ["ast_per_g", "ast"])), 1
                ),
                "spg": round_or_none(
                    safe_float(first_present(stats_row_raw, ["stl_per_g", "stl"])), 1
                ),
                "bpg": round_or_none(
                    safe_float(first_present(stats_row_raw, ["blk_per_g", "blk"])), 1
                ),
                "fgm": round_or_none(
                    safe_float(first_present(stats_row_raw, ["fg_per_g", "fg"])), 1
                ),
                "fga": round_or_none(
                    safe_float(first_present(stats_row_raw, ["fga_per_g", "fga"])), 1
                ),
                "threePm": round_or_none(
                    safe_float(first_present(stats_row_raw, ["fg3_per_g", "fg3"])), 1
                ),
                "threePa": round_or_none(
                    safe_float(first_present(stats_row_raw, ["fg3a_per_g", "fg3a"])), 1
                ),
                "fgPct": round_or_none(
                    safe_float(first_present(stats_row_raw, ["fg_pct"])), 4
                ),
                "threePct": round_or_none(
                    safe_float(first_present(stats_row_raw, ["fg3_pct"])), 4
                ),
                "ftPct": round_or_none(
                    safe_float(first_present(stats_row_raw, ["ft_pct"])), 4
                ),
            },
        }

    if not result:
        raise RuntimeError(
            "Per-game table parsed, but produced zero players after row normalization."
        )

    return result


def fetch_basketball_reference_advanced(season: str) -> Dict[str, Dict[str, Dict[str, Any]]]:
    end_year = season_to_end_year(season)
    url = BASKETBALL_REFERENCE_ADVANCED_TEMPLATE.format(end_year=end_year)
    html = fetch_html(url)
    soup = load_br_soup(html)

    # Try known table IDs first
    table = (
        soup.select_one("table#advanced_stats")
        or soup.select_one("table#advanced")
    )

    # Fallback: looser detection
    if table is None:
        for candidate in soup.select("table"):
            data_stats = {
                el.get("data-stat")
                for el in candidate.select("[data-stat]")
                if el.get("data-stat")
            }

            has_core = {"player", "team_id"}.issubset(data_stats)
            has_metrics = {"per", "bpm", "usg_pct", "mp"}.issubset(data_stats)

            if has_core and has_metrics:
                table = candidate
                break

    # If still nothing → dump debug
    if table is None:
        with open("br_advanced_debug.html", "w", encoding="utf-8") as f:
            f.write(html)

        debug_tables = []
        for candidate in soup.select("table"):
            debug_tables.append({
                "id": candidate.get("id"),
                "class": candidate.get("class"),
                "sample_data_stats": sorted({
                    el.get("data-stat")
                    for el in candidate.select("[data-stat]")
                    if el.get("data-stat")
                })[:50],
            })

        with open("br_advanced_tables_debug.json", "w", encoding="utf-8") as f:
            json.dump(debug_tables, f, indent=2)

        raise RuntimeError(
            "Could not find Basketball Reference advanced stats table. "
            "Saved raw HTML to br_advanced_debug.html and table metadata to br_advanced_tables_debug.json"
        )

    parsed_rows = parse_bbr_player_rows_from_table(table)

    result: Dict[str, Dict[str, Dict[str, Any]]] = {}

    for row in parsed_rows:
        normalized_player = normalize_name(str(row["name"]))
        team = normalize_team_abbr(str(row["team"]))

        row_data: Dict[str, Any] = {
            "position": normalize_position(row.get("pos")),
            "age": safe_int(row.get("age")),
            "per": safe_float(row.get("per")),
            "ws48": safe_float(row.get("ws_per_48")),
            "bpm": safe_float(row.get("bpm")),
            "usgPct": safe_float(row.get("usg_pct")),
            "minutesPlayed": safe_int(row.get("mp")),
        }

        bucket = result.setdefault(normalized_player, {})
        bucket[team] = row_data

        if "__fallback__" not in bucket:
            bucket["__fallback__"] = row_data

    return result


def fetch_basketball_reference_team_games_played(season: str) -> Dict[str, int]:
    end_year = season_to_end_year(season)
    url = BASKETBALL_REFERENCE_LEAGUE_TEMPLATE.format(end_year=end_year)
    html = fetch_html(url)
    soup = load_br_soup(html)

    def extract_team_gp_from_table(table: Any) -> Dict[str, int]:
        parsed: Dict[str, int] = {}

        for tr in table.select("tbody tr"):
            if "thead" in (tr.get("class") or []):
                continue

            team_cell = (
                first_of(tr, ['td[data-stat="team_name_abbr"]', 'th[data-stat="team_name_abbr"]'])
                or first_of(tr, ['td[data-stat="team"]', 'th[data-stat="team"]'])
            )
            g_cell = (
                first_of(tr, ['td[data-stat="g"]', 'th[data-stat="g"]'])
                or first_of(tr, ['td[data-stat="games"]', 'th[data-stat="games"]'])
            )

            if team_cell is None or g_cell is None:
                continue

            raw_team = canonicalize_person_name(team_cell.get_text(strip=True))
            team = normalize_team_abbr(raw_team)
            if not team or team in ("League Average", "Lg Avg") or team not in ALL_STANDARD_TEAM_ABBRS:
                continue

            games = safe_int(g_cell.get_text(strip=True))
            if games is not None and team not in parsed:
                parsed[team] = games

        return parsed

    best_result: Dict[str, int] = {}
    best_table: Optional[Any] = None

    preferred_selectors = (
        "table#per_game-team",
        "table#advanced-team",
        "table#team-stats-per_game",
        "table#team-stats-base",
    )

    candidates: List[Any] = []
    seen_ids: set[int] = set()
    for selector in preferred_selectors:
        candidate = soup.select_one(selector)
        if candidate is not None and id(candidate) not in seen_ids:
            candidates.append(candidate)
            seen_ids.add(id(candidate))

    for candidate in soup.select("table"):
        if id(candidate) not in seen_ids:
            candidates.append(candidate)
            seen_ids.add(id(candidate))

    for candidate in candidates:
        data_stats = {
            el.get("data-stat")
            for el in candidate.select("[data-stat]")
            if el.get("data-stat")
        }

        has_team = "team_name_abbr" in data_stats or "team" in data_stats
        has_gp = "g" in data_stats or "games" in data_stats
        if not (has_team and has_gp):
            continue

        parsed = extract_team_gp_from_table(candidate)
        if len(parsed) > len(best_result):
            best_result = parsed
            best_table = candidate

        if len(parsed) >= 30:
            return parsed

    if len(best_result) >= 25:
        return best_result

    with open("br_league_debug.html", "w", encoding="utf-8") as f:
        f.write(html)

    debug_tables = []
    for candidate in soup.select("table"):
        parsed = extract_team_gp_from_table(candidate)
        debug_tables.append({
            "id": candidate.get("id"),
            "class": candidate.get("class"),
            "parsed_team_count": len(parsed),
            "parsed_teams": sorted(parsed.keys()),
            "sample_data_stats": sorted({
                el.get("data-stat")
                for el in candidate.select("[data-stat]")
                if el.get("data-stat")
            })[:50],
        })

    with open("br_league_tables_debug.json", "w", encoding="utf-8") as f:
        json.dump(debug_tables, f, indent=2)

    raise RuntimeError(
        "Could not find a Basketball Reference team GP table with enough NBA teams. "
        "Saved raw HTML to br_league_debug.html and table metadata to br_league_tables_debug.json"
    )


def fetch_basketball_reference_contracts() -> Dict[Tuple[str, Optional[str]], Dict[str, Any]]:
    html = fetch_html(BASKETBALL_REFERENCE_CONTRACTS_URL)
    soup = load_br_soup(html)

    table = find_br_stats_table(
        soup,
        required_data_stats={"player", "team_id"},
    )
    if table is None:
        with open("br_contracts_debug.html", "w", encoding="utf-8") as f:
            f.write(html)
        raise RuntimeError(
            "Could not find Basketball Reference contracts table. Saved raw HTML to br_contracts_debug.html"
        )

    result: Dict[Tuple[str, Optional[str]], Dict[str, Any]] = {}
    for tr in table.select("tbody tr"):
        if "thead" in (tr.get("class") or []):
            continue

        player_cell = first_of(tr, ['td[data-stat="player"]', 'td[data-stat="name_display"]'])
        team_cell = first_of(tr, ['td[data-stat="team_id"]', 'td[data-stat="team_name_abbr"]'])
        salary_cell = tr.select_one('td[data-stat="y1"]')

        player_name = canonicalize_person_name(player_cell.get_text(strip=True)) if player_cell else ""
        team = normalize_team_abbr(team_cell.get_text(strip=True).upper()) if team_cell else None
        if not player_name:
            continue

        if salary_cell is None:
            right_cells = tr.select("td.right")
            salary_text = right_cells[0].get_text(strip=True) if right_cells else ""
        else:
            salary_text = salary_cell.get_text(strip=True)

        salary = safe_int(salary_text)
        normalized = normalize_name(player_name)
        key = (normalized, team or None)

        existing = result.get(key)
        if existing is None or (existing.get("salary") is None and salary is not None):
            result[key] = {"salary": salary}

        fallback_key = (normalized, None)
        fallback_existing = result.get(fallback_key)
        if fallback_existing is None or (
            fallback_existing.get("salary") is None and salary is not None
        ):
            result[fallback_key] = {"salary": salary}

    return result


def fetch_basketball_reference_team_contracts(team_abbrs: Sequence[str]) -> Dict[Tuple[str, str], Dict[str, Any]]:
    result: Dict[Tuple[str, str], Dict[str, Any]] = {}

    normalized_team_abbrs = [
        normalize_team_abbr(team_abbr)
        for team_abbr in team_abbrs
        if normalize_team_abbr(team_abbr)
    ]

    total_teams = len(normalized_team_abbrs)

    for index, team_abbr in enumerate(normalized_team_abbrs, start=1):
        print(f"  Team contract fallback: {team_abbr} ({index}/{total_teams})")

        bbr_team = STANDARD_TO_BBR_CONTRACT_TEAM.get(team_abbr, team_abbr)
        url = f"https://www.basketball-reference.com/contracts/{bbr_team}.html"

        try:
            html = fetch_html(url)
            soup = load_br_soup(html)
        except Exception as exc:
            print(f"    Skipping {team_abbr}: {exc}")
            continue

        table = find_br_stats_table(soup, required_data_stats={"player"})
        if table is None:
            print(f"    No contract table found for {team_abbr}")
            continue

        added_for_team = 0

        for tr in table.select("tbody tr"):
            if "thead" in (tr.get("class") or []):
                continue

            player_cell = first_of(tr, ['td[data-stat="player"]', 'td[data-stat="name_display"]'])
            if player_cell is None:
                continue

            player_name = canonicalize_person_name(player_cell.get_text(strip=True))
            if not player_name:
                continue

            salary_cell = tr.select_one('td[data-stat="y1"]')
            if salary_cell is None:
                right_cells = tr.select("td.right")
                salary_text = right_cells[0].get_text(strip=True) if right_cells else ""
            else:
                salary_text = salary_cell.get_text(strip=True)

            salary = safe_int(salary_text)
            normalized = normalize_name(player_name)
            key = (normalized, team_abbr)

            existing = result.get(key)
            if existing is None or (existing.get("salary") is None and salary is not None):
                result[key] = {"salary": salary}
                added_for_team += 1

        print(f"    Cached {added_for_team} contract entries for {team_abbr}")

    return result


def extract_espn_salary_rows_from_html(html: str) -> List[Dict[str, Any]]:
    soup = BeautifulSoup(html, "lxml")
    rows: List[Dict[str, Any]] = []

    for table in soup.select("table"):
        for tr in table.select("tr"):
            cells = tr.select("th, td")
            if len(cells) < 2:
                continue

            texts = [canonicalize_person_name(cell.get_text(" ", strip=True)) for cell in cells]
            salary_text = next((text for text in reversed(texts) if "$" in text), "")
            if not salary_text:
                continue

            player_name = ""
            for anchor in tr.select("a"):
                anchor_text = canonicalize_person_name(anchor.get_text(" ", strip=True))
                if anchor_text and "$" not in anchor_text and len(anchor_text) > 2:
                    player_name = anchor_text
                    break

            if not player_name:
                non_salary = [text for text in texts if text and "$" not in text]
                if len(non_salary) >= 2:
                    player_name = non_salary[1] if non_salary[0].isdigit() else non_salary[0]

            if not player_name:
                continue

            team = ""
            for text_value in texts:
                normalized_team = normalize_team_abbr(text_value)
                if normalized_team in ALL_STANDARD_TEAM_ABBRS:
                    team = normalized_team
                    break

            salary = safe_int(salary_text)
            if salary is None:
                continue

            rows.append({
                "name": player_name,
                "normalizedName": normalize_name(player_name),
                "team": team or None,
                "salary": salary,
            })

    return rows


def fetch_espn_salary_index() -> Dict[Tuple[str, Optional[str]], Dict[str, Any]]:
    result: Dict[Tuple[str, Optional[str]], Dict[str, Any]] = {}
    empty_pages = 0

    for page in range(1, MAX_ESPN_SALARY_PAGES + 1):
        url = ESPN_SALARIES_URL_TEMPLATE.format(page=page)
        try:
            html = fetch_html(url)
        except Exception:
            empty_pages += 1
            if empty_pages >= 2:
                break
            continue

        rows = extract_espn_salary_rows_from_html(html)
        if not rows:
            empty_pages += 1
            if empty_pages >= 2:
                break
            continue

        empty_pages = 0
        for row in rows:
            norm = row["normalizedName"]
            team = row["team"]
            salary = row["salary"]

            if not norm or salary is None:
                continue

            exact_key = (norm, team)
            fallback_key = (norm, None)

            existing = result.get(exact_key)
            if existing is None or (existing.get("salary") is None and salary is not None):
                result[exact_key] = {"salary": salary, "source": "espn_salaries"}

            fallback_existing = result.get(fallback_key)
            if fallback_existing is None or (fallback_existing.get("salary") is None and salary is not None):
                result[fallback_key] = {"salary": salary, "source": "espn_salaries"}

    return result


def load_or_build_espn_salary_lookup(cache_path: str) -> Dict[Tuple[str, Optional[str]], Dict[str, Any]]:
    cached_mapping: Dict[Tuple[str, Optional[str]], Dict[str, Any]] = {}
    if os.path.exists(cache_path):
        try:
            with open(cache_path, "r", encoding="utf-8") as f:
                raw = json.load(f)
            for key, value in raw.items():
                if "||" in key:
                    norm, team = key.split("||", 1)
                    cached_mapping[(norm, team or None)] = value
            if cached_mapping:
                print(f"Loaded existing ESPN salary cache from {cache_path}")
                return cached_mapping
        except Exception:
            cached_mapping = {}

    fetched = fetch_espn_salary_index()
    serialized = {f"{norm}||{team or ''}": value for (norm, team), value in fetched.items()}
    ensure_parent_dir(cache_path)
    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump(serialized, f, indent=2, sort_keys=True)

    print(f"Cached ESPN salary matches for {len(fetched)} keys at {cache_path}")
    return fetched


def lookup_salary(
    display_name: str,
    display_team: str,
    normalized_name: str,
    formatted_contract_name: str,
    br_contracts: Dict[Tuple[str, Optional[str]], Dict[str, Any]],
    team_contracts: Dict[Tuple[str, str], Dict[str, Any]],
    espn_salary_lookup: Dict[Tuple[str, Optional[str]], Dict[str, Any]],
) -> Tuple[Optional[int], str]:
    normalized_display_team = normalize_team_abbr(display_team)
    name_candidates: List[str] = []
    for candidate in [
        normalized_name,
        formatted_contract_name,
        normalize_name(display_name),
    ]:
        if candidate and candidate not in name_candidates:
            name_candidates.append(candidate)

    for candidate in name_candidates:
        for key in [
            (candidate, normalized_display_team),
            (candidate, None),
        ]:
            entry = br_contracts.get(key)
            if entry and entry.get("salary") is not None:
                return entry["salary"], "bbr_contracts"

    for candidate in name_candidates:
        entry = team_contracts.get((candidate, normalized_display_team))
        if entry and entry.get("salary") is not None:
            return entry["salary"], "bbr_team_contracts"

    for candidate in name_candidates:
        for key in [
            (candidate, normalized_display_team),
            (candidate, None),
        ]:
            entry = espn_salary_lookup.get(key)
            if entry and entry.get("salary") is not None:
                return entry["salary"], entry.get("source") or "espn_salaries"

    if USE_MIN_SALARY_FALLBACK:
        return IMPUTED_MIN_SALARY, "imputed_minimum"
    return None, "missing"


def select_advanced_entry(
    adv_rows_for_player: Dict[str, Dict[str, Any]],
    fallback_team: str,
) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    if not adv_rows_for_player:
        return None, None

    aggregate_codes = [
        code
        for code in adv_rows_for_player.keys()
        if code != "__fallback__" and is_aggregate_team_code(code)
    ]
    if aggregate_codes:
        best_code = sorted(
            aggregate_codes,
            key=lambda code: (
                0 if code == "TOT" else 1,
                0 if code == "2TM" else 1,
                code,
            ),
        )[0]
        return adv_rows_for_player[best_code], best_code

    fallback_team_upper = normalize_team_abbr(fallback_team.upper())
    if fallback_team_upper in adv_rows_for_player:
        return adv_rows_for_player[fallback_team_upper], fallback_team_upper

    if "__fallback__" in adv_rows_for_player:
        return adv_rows_for_player["__fallback__"], "__fallback__"

    for team_code, row in adv_rows_for_player.items():
        if team_code != "__fallback__":
            return row, team_code

    return None, None


def compute_minute_share_of_team(
    minutes_played: Optional[int],
    current_team_games_played: Optional[int],
    current_games_played: Optional[int],
    adv_team_used: Optional[str],
) -> Optional[float]:
    if minutes_played is None:
        return None

    if adv_team_used is not None and is_aggregate_team_code(adv_team_used):
        if current_games_played in (None, 0):
            return None
        return round(minutes_played / (current_games_played * 48), 4)

    if current_team_games_played in (None, 0):
        return None

    return round(minutes_played / (current_team_games_played * 240), 4)


def similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, a, b).ratio()


def fetch_espn_team_list(session: requests.Session) -> List[Dict[str, Any]]:
    url = f"{ESPN_SITE_BASE}/teams"
    data = request_json(session, url, params={"lang": "en", "region": "us"})
    sports = data.get("sports") or []
    if not sports:
        raise RuntimeError("ESPN teams response missing sports list.")

    leagues = sports[0].get("leagues") or []
    if not leagues:
        raise RuntimeError("ESPN teams response missing leagues list.")

    teams = leagues[0].get("teams") or []
    output: List[Dict[str, Any]] = []
    for entry in teams:
        team = entry.get("team") or {}
        if team:
            output.append(team)
    return output


def fetch_espn_roster_athletes_for_team(session: requests.Session, team_id: str) -> List[Dict[str, Any]]:
    url = f"{ESPN_SITE_BASE}/teams/{team_id}/roster"
    data = request_json(session, url, params={"lang": "en", "region": "us"})

    athletes: List[Dict[str, Any]] = []
    raw_athletes = data.get("athletes")

    if isinstance(raw_athletes, list):
        for entry in raw_athletes:
            if not isinstance(entry, dict):
                continue

            items = entry.get("items")
            if isinstance(items, list):
                for athlete in items:
                    if isinstance(athlete, dict):
                        athletes.append(athlete)
                continue

            if entry.get("id") and (
                entry.get("displayName") or entry.get("fullName") or entry.get("shortName")
            ):
                athletes.append(entry)

    elif isinstance(raw_athletes, dict):
        for value in raw_athletes.values():
            if isinstance(value, list):
                for entry in value:
                    if not isinstance(entry, dict):
                        continue

                    items = entry.get("items")
                    if isinstance(items, list):
                        for athlete in items:
                            if isinstance(athlete, dict):
                                athletes.append(athlete)
                    elif entry.get("id") and (
                        entry.get("displayName") or entry.get("fullName") or entry.get("shortName")
                    ):
                        athletes.append(entry)

    return athletes


def fetch_espn_athlete_index(session: requests.Session) -> Dict[str, Dict[str, Any]]:
    teams = fetch_espn_team_list(session)
    print(f"Fetched {len(teams)} ESPN teams.")

    by_normalized_name: Dict[str, Dict[str, Any]] = {}

    for team in teams:
        team_id = str(team.get("id") or "").strip()
        if not team_id:
            continue

        athletes = fetch_espn_roster_athletes_for_team(session, team_id)
        for athlete in athletes:
            athlete_id = str(athlete.get("id") or "").strip()
            athlete_name = canonicalize_person_name(str(
                athlete.get("displayName") or athlete.get("fullName") or athlete.get("shortName") or ""
            ).strip())
            if not athlete_id or not athlete_name:
                continue

            norm = normalize_name(athlete_name)
            if not norm:
                continue

            headshot = athlete.get("headshot") or {}
            headshot_url = headshot.get("href") or ESPN_HEADSHOT_TEMPLATE.format(espn_id=athlete_id)
            athlete_ref = athlete.get("$ref")

            candidate = {
                "espnId": athlete_id,
                "espnName": athlete_name,
                "normalizedEspnName": norm,
                "headshotUrl": headshot_url,
                "athleteApiRef": athlete_ref,
                "team": normalize_team_abbr(str(team.get("abbreviation") or "").strip()),
            }

            existing = by_normalized_name.get(norm)
            if existing is None:
                by_normalized_name[norm] = candidate
                continue

            if candidate.get("headshotUrl") and not existing.get("headshotUrl"):
                by_normalized_name[norm] = candidate

        time.sleep(SLEEP_BETWEEN_ESPN_REQUESTS_SECONDS)

    print(f"Indexed {len(by_normalized_name)} unique ESPN athlete names.")
    return by_normalized_name


def choose_best_espn_match(
    input_name: str,
    espn_index: Dict[str, Dict[str, Any]],
    min_similarity: float = ESPN_MIN_SIMILARITY,
) -> Optional[Dict[str, Any]]:
    normalized_input = normalize_name(input_name)
    if not normalized_input:
        return None

    exact = espn_index.get(normalized_input)
    if exact is not None:
        return exact

    best_name: Optional[str] = None
    best_entry: Optional[Dict[str, Any]] = None
    best_score = 0.0

    for candidate_name, entry in espn_index.items():
        score = similarity(normalized_input, candidate_name)
        if score > best_score:
            best_score = score
            best_name = candidate_name
            best_entry = entry

    if best_entry is None or best_name is None or best_score < min_similarity:
        return None
    return best_entry


def load_or_build_espn_lookup(
    player_names: Sequence[str],
    cache_path: str,
) -> Dict[str, Dict[str, Any]]:
    cached_mapping: Dict[str, Dict[str, Any]] = {}
    if os.path.exists(cache_path):
        try:
            with open(cache_path, "r", encoding="utf-8") as f:
                cached_mapping = json.load(f)
            print(f"Loaded existing ESPN cache from {cache_path}")
        except Exception:
            cached_mapping = {}

    missing_names = [
        name for name in player_names
        if normalize_name(name) not in cached_mapping
    ]

    if not missing_names and cached_mapping:
        return cached_mapping

    session = requests.Session()
    session.headers.update(JSON_HEADERS)
    espn_index = fetch_espn_athlete_index(session)

    for name in player_names:
        norm = normalize_name(name)
        if norm in cached_mapping:
            continue

        match = choose_best_espn_match(name, espn_index)
        if match is None:
            continue

        cached_mapping[norm] = {
            "inputName": name,
            "espnId": str(match["espnId"]),
            "espnName": str(match["espnName"]),
            "headshotUrl": str(match["headshotUrl"]),
            "athleteApiRef": match.get("athleteApiRef"),
        }

    ensure_parent_dir(cache_path)
    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump(cached_mapping, f, indent=2, sort_keys=True)

    matched = sum(1 for name in player_names if normalize_name(name) in cached_mapping)
    print(f"Cached ESPN matches for {matched}/{len(player_names)} players at {cache_path}")
    return cached_mapping


if __name__ == "__main__":
    main()
