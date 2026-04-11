"""
Usage:
  python3 scripts/build_player_pool.py
  python3 scripts/build_player_pool.py src/data/players.json
  python3 scripts/build_player_pool.py src/data/players.json src/data/players.csv
  python3 scripts/build_player_pool.py src/data/players.json src/data/players.csv 2025-26

Default JSON output:
  src/data/players.json

What this script does:
- Uses nba_api bulk endpoints for:
  - all active rostered players
  - current-season player stats
  - previous-season player stats
  - current-season team stats
- Uses Basketball Reference advanced stats page for:
  - age
  - position
  - BPM
- Uses Basketball Reference contracts page for:
  - salary
- Uses CommonPlayerInfo ONLY for likely-rookie candidates
  - players with no previous-season stats row
  - this keeps per-player NBA calls very low

Install:
  python3 -m pip install nba_api requests beautifulsoup4 lxml
"""

from __future__ import annotations

"""Legacy player-pool builder kept for reference during data-pipeline iteration."""

import csv
import json
import os
import re
import sys
import time
import unicodedata
from dataclasses import dataclass, asdict
from typing import Any, Dict, Optional, List, Tuple

import requests
from bs4 import BeautifulSoup

from nba_api.stats.endpoints import (
    commonallplayers,
    commonplayerinfo,
    leaguedashplayerstats,
    leaguedashteamstats,
)


DEFAULT_JSON_OUTPUT_PATH = "src/data/players.json"
DEFAULT_CURRENT_SEASON = "2025-26"
DEFAULT_PREVIOUS_SEASON = "2024-25"

NBA_TIMEOUT_SECONDS = 45
HTML_TIMEOUT_SECONDS = 45
MAX_RETRIES = 3
RETRY_BACKOFF_SECONDS = 1.5
ROOKIE_INFO_SLEEP_SECONDS = 0.25

NBA_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/146.0.0.0 Safari/537.36"
    ),
    "Referer": "https://www.nba.com/",
    "Origin": "https://www.nba.com",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "Connection": "keep-alive",
}

HTML_HEADERS = {
    "User-Agent": NBA_HEADERS["User-Agent"],
    "Accept-Language": "en-US,en;q=0.9",
}

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

@dataclass
class OutputPlayer:
    id: str
    nbaPlayerId: int
    name: str
    team: str
    position: str
    age: Optional[int]
    bpm: Optional[float]
    salary: Optional[int]
    gamesPlayed: Optional[int]
    teamGamesPlayed: Optional[int]
    isRookie: Optional[bool]
    durability: Optional[float]
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

    print("Fetching CommonAllPlayers...")
    all_players_rows = fetch_common_all_players(current_season)
    active_players = [
        row for row in all_players_rows if safe_int(row.get("ROSTERSTATUS")) == 1
    ]
    print(f"Found {len(active_players)} active roster players.")

    team_id_to_abbr = build_team_id_to_abbr_map(active_players)

    print("Fetching current-season player stats...")
    current_player_stats = fetch_league_dash_player_stats(current_season)

    players_with_games = []

    for player_row in active_players:
        player_id = safe_int(player_row.get("PERSON_ID"))
        if player_id is None:
            continue

        current_row = current_player_stats.get(player_id)
        current_gp = safe_int(current_row.get("GP")) if current_row is not None else None

        if current_gp is not None and current_gp > 0:
            players_with_games.append(player_row)

    print(f"Players with at least 1 game played this season: {len(players_with_games)}")

    print("Fetching previous-season player stats...")
    previous_player_stats = fetch_league_dash_player_stats(previous_season)

    print("Fetching current-season team stats...")
    current_team_stats = fetch_league_dash_team_stats(
        current_season,
        team_id_to_abbr,
    )

    print("Fetching Basketball Reference advanced stats...")
    br_advanced = fetch_basketball_reference_advanced(current_season)

    print("Fetching Basketball Reference contracts...")
    br_contracts = fetch_basketball_reference_contracts()


    outputs: List[OutputPlayer] = []

    total = len(players_with_games)
    for index, player_row in enumerate(players_with_games, start=1):
        player_id = safe_int(player_row.get("PERSON_ID"))
        if player_id is None:
            continue

        fallback_name = str(player_row.get("DISPLAY_FIRST_LAST") or "").strip()
        fallback_team = str(player_row.get("TEAM_ABBREVIATION") or "").strip() or "FA"

        if not fallback_name:
            continue


        display_name = fallback_name
        team = fallback_team

        current_row = current_player_stats.get(player_id)
        previous_row = previous_player_stats.get(player_id)
        team_row = current_team_stats.get(team)

        if team_row is None:
            print(f"  No team stats found for team='{team}' player='{display_name}'")

        normalized_name = normalize_name(display_name)
        formatted_name = CONTRACT_NAME_ALIASES.get(normalized_name, normalized_name)

        adv_entry = (
            br_advanced.get((formatted_name, team))
            or br_advanced.get((formatted_name, "TOT"))
            or br_advanced.get((formatted_name, None))
        )

        contract_entry = (
            br_contracts.get((formatted_name, team))
            or br_contracts.get((formatted_name, None))
        )

        position = normalize_position(
            adv_entry.get("position") if adv_entry else None
        )
        age = adv_entry.get("age") if adv_entry else None
        bpm = adv_entry.get("bpm") if adv_entry else None
        salary = contract_entry.get("salary") if contract_entry else None

        is_rookie: Optional[bool] = previous_row is None

        use_current_season_durability = is_rookie is True

        if use_current_season_durability:
            games_played = safe_int(current_row.get("GP")) if current_row is not None else None
            team_games_played = safe_int(team_row.get("GP")) if team_row is not None else None
        else:
            games_played = safe_int(previous_row.get("GP")) if previous_row is not None else None
            team_games_played = 82

        durability = (
            round(games_played / team_games_played, 4)
            if games_played is not None and team_games_played not in (None, 0)
            else None
        )

        outputs.append(
            OutputPlayer(
                id=slugify(display_name),
                nbaPlayerId=player_id,
                name=display_name,
                team=team,
                position=position,
                age=age,
                bpm=bpm,
                salary=salary,
                gamesPlayed=games_played,
                teamGamesPlayed=team_games_played,
                isRookie=is_rookie,
                durability=durability,
                headshotUrl=build_headshot_url(player_id),
            )
        )

    outputs.sort(key=lambda p: p.name)

    before_filter_count = len(outputs)

    outputs = [
        p for p in outputs
        if p.salary is not None
        and p.age is not None
        and p.bpm is not None
    ]

    filtered_out_count = before_filter_count - len(outputs)

    print(f"Filtered out players missing required fields: {filtered_out_count}")
    print(f"Final usable player pool: {len(outputs)}")

    ensure_parent_dir(output_json_path)
    with open(output_json_path, "w", encoding="utf-8") as f:
        json.dump([asdict(p) for p in outputs], f, indent=2)

    if output_csv_path:
        ensure_parent_dir(output_csv_path)
        write_csv(output_csv_path, outputs)

    print(f"Done. Wrote {len(outputs)} players.")
    print(f"JSON: {output_json_path}")
    






    





    

    if output_csv_path:
        print(f"CSV:  {output_csv_path}")


def looks_like_season(value: str) -> bool:
    return bool(re.fullmatch(r"\d{4}-\d{2}", value))


def derive_previous_season(current_season: str) -> str:
    start_year = int(current_season.split("-")[0])
    prev_start_year = start_year - 1
    prev_end_short = str(start_year)[2:]
    return f"{prev_start_year}-{prev_end_short}"


def build_headshot_url(player_id: int) -> str:
    return f"https://cdn.nba.com/headshots/nba/latest/1040x760/{player_id}.png"


def season_to_end_year(season: str) -> int:
    parts = season.split("-")
    if len(parts) != 2:
        raise ValueError(f"Invalid season format: {season}")
    start_year = int(parts[0])
    end_suffix = int(parts[1])
    century = (start_year // 100) * 100
    return century + end_suffix


def normalize_name(name: str) -> str:
    value = unicodedata.normalize("NFKD", name)
    value = "".join(ch for ch in value if not unicodedata.combining(ch))
    value = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b\.?", "", value, flags=re.IGNORECASE)
    value = re.sub(r"[^a-zA-Z0-9]+", " ", value)
    return value.strip().lower()


def slugify(value: str) -> str:
    value = unicodedata.normalize("NFKD", value)
    value = "".join(ch for ch in value if not unicodedata.combining(ch))
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


def safe_int(value: Any) -> Optional[int]:
    try:
        if value is None or value == "":
            return None
        return int(float(value))
    except (TypeError, ValueError):
        return None


def safe_float(value: Any) -> Optional[float]:
    try:
        if value is None or value == "":
            return None
        return float(str(value).replace(",", "").replace("$", ""))
    except (TypeError, ValueError):
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
        "salary",
        "gamesPlayed",
        "teamGamesPlayed",
        "isRookie",
        "durability",
        "headshotUrl",
    ]
    with open(file_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=headers)
        writer.writeheader()
        for row in rows:
            writer.writerow(asdict(row))


def fetch_common_all_players(season: str) -> List[Dict[str, Any]]:
    endpoint = retry_nba_endpoint(
        lambda: commonallplayers.CommonAllPlayers(
            is_only_current_season=1,
            league_id="00",
            season=season,
            timeout=NBA_TIMEOUT_SECONDS,
        )
    )
    return endpoint.get_normalized_dict()["CommonAllPlayers"]


def fetch_league_dash_player_stats(season: str) -> Dict[int, Dict[str, Any]]:
    endpoint = retry_nba_endpoint(
        lambda: leaguedashplayerstats.LeagueDashPlayerStats(
            season=season,
            season_type_all_star="Regular Season",
            per_mode_detailed="PerGame",
            measure_type_detailed_defense="Base",
            league_id_nullable="00",
            timeout=NBA_TIMEOUT_SECONDS,
        )
    )
    rows = endpoint.get_normalized_dict()["LeagueDashPlayerStats"]
    return {
        int(row["PLAYER_ID"]): row
        for row in rows
        if row.get("PLAYER_ID") is not None
    }


def fetch_league_dash_team_stats(
    season: str,
    team_id_to_abbr: Dict[int, str],
) -> Dict[str, Dict[str, Any]]:
    endpoint = retry_nba_endpoint(
        lambda: leaguedashteamstats.LeagueDashTeamStats(
            season=season,
            season_type_all_star="Regular Season",
            per_mode_detailed="PerGame",
            measure_type_detailed_defense="Base",
            league_id_nullable="00",
            timeout=NBA_TIMEOUT_SECONDS,
        )
    )
    rows = endpoint.get_normalized_dict()["LeagueDashTeamStats"]

    result: Dict[str, Dict[str, Any]] = {}

    for row in rows:
        team_id = safe_int(row.get("TEAM_ID"))
        if team_id is None:
            continue

        team_abbr = team_id_to_abbr.get(team_id)
        if team_abbr:
            result[team_abbr] = row

    return result


def build_team_id_to_abbr_map(players: List[Dict[str, Any]]) -> Dict[int, str]:
    mapping: Dict[int, str] = {}

    for row in players:
        team_id = safe_int(row.get("TEAM_ID"))
        team_abbr = str(row.get("TEAM_ABBREVIATION") or "").strip()

        if team_id and team_abbr:
            mapping[team_id] = team_abbr

    return mapping


def fetch_is_rookie_with_common_player_info(
    player_id: int, player_name: str
) -> Optional[bool]:
    try:
        endpoint = retry_nba_endpoint(
            lambda: commonplayerinfo.CommonPlayerInfo(
                player_id=player_id,
                league_id_nullable="00",
                timeout=NBA_TIMEOUT_SECONDS,
            )
        )
        rows = endpoint.get_normalized_dict()["CommonPlayerInfo"]
        if not rows:
            return None
        season_exp = rows[0].get("SEASON_EXP")
        exp_value = safe_int(season_exp)
        return None if exp_value is None else exp_value == 0
    except Exception as exc:
        print(f"  Rookie lookup fallback for {player_name}: {exc}")
        return None


def retry_nba_endpoint(factory):
    last_error: Optional[Exception] = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            return factory()
        except Exception as exc:
            last_error = exc
            if attempt < MAX_RETRIES:
                sleep_for = RETRY_BACKOFF_SECONDS * attempt
                print(f"  NBA request failed (attempt {attempt}/{MAX_RETRIES}): {exc}")
                print(f"  Retrying in {sleep_for:.1f}s...")
                time.sleep(sleep_for)
    assert last_error is not None
    raise last_error


def fetch_html(url: str) -> str:
    last_error: Optional[Exception] = None

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = requests.get(
                url,
                headers={
                    "User-Agent": NBA_HEADERS["User-Agent"],
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.9",
                    "Referer": "https://www.google.com/",
                    "Cache-Control": "no-cache",
                    "Pragma": "no-cache",
                },
                timeout=HTML_TIMEOUT_SECONDS,
            )
            response.raise_for_status()
            return response.text
        except Exception as exc:
            last_error = exc
            if attempt < MAX_RETRIES:
                sleep_for = RETRY_BACKOFF_SECONDS * attempt
                print(f"  HTML request failed (attempt {attempt}/{MAX_RETRIES}): {exc}")
                print(f"  Retrying in {sleep_for:.1f}s...")
                time.sleep(sleep_for)

    assert last_error is not None
    raise last_error


def load_br_soup(html: str) -> BeautifulSoup:
    lowered = html.lower()

    if "access denied" in lowered or "forbidden" in lowered or "just a moment" in lowered:
        raise RuntimeError("Basketball Reference blocked the request.")

    uncommented_html = re.sub(r"<!--|-->", "", html)
    return BeautifulSoup(uncommented_html, "lxml")


def fetch_basketball_reference_advanced(
    season: str,
) -> Dict[Tuple[str, Optional[str]], Dict[str, Any]]:
    end_year = season_to_end_year(season)
    url = f"https://www.basketball-reference.com/leagues/NBA_{end_year}_advanced.html"
    html = fetch_html(url)
    soup = load_br_soup(html)

    table = find_br_stats_table(
        soup,
        required_data_stats={"name_display", "team_name_abbr", "pos", "age", "bpm"},
    )
    if table is None:
        with open("br_advanced_debug.html", "w", encoding="utf-8") as f:
            f.write(html)
        raise RuntimeError(
            "Could not find Basketball Reference advanced stats table. "
            "Saved raw HTML to br_advanced_debug.html"
        )

    result: Dict[Tuple[str, Optional[str]], Dict[str, Any]] = {}

    for tr in table.select("tbody tr"):
        classes = tr.get("class", [])
        if "thead" in classes:
            continue

        player_cell = first_of(
            tr,
            [
                'td[data-stat="name_display"]',
                'td[data-stat="player"]',
            ],
        )
        team_cell = first_of(
            tr,
            [
                'td[data-stat="team_name_abbr"]',
                'td[data-stat="team_id"]',
            ],
        )
        pos_cell = tr.select_one('td[data-stat="pos"]')
        age_cell = tr.select_one('td[data-stat="age"]')
        bpm_cell = tr.select_one('td[data-stat="bpm"]')

        player_name = player_cell.get_text(strip=True) if player_cell else ""
        team = team_cell.get_text(strip=True) if team_cell else None

        if not player_name:
            continue

        key = (normalize_name(player_name), team or None)
        result[key] = {
            "position": pos_cell.get_text(strip=True) if pos_cell else None,
            "age": safe_int(age_cell.get_text(strip=True) if age_cell else None),
            "bpm": safe_float(bpm_cell.get_text(strip=True) if bpm_cell else None),
        }

        fallback_key = (normalize_name(player_name), None)
        if fallback_key not in result:
            result[fallback_key] = result[key]

    return result


def debug_contract_key_search(
    br_contracts: Dict[Tuple[str, Optional[str]], Dict[str, Any]],
    needle: str,
) -> None:
    normalized_needle = normalize_name(needle)
    print(f"\nSearching contract keys for: {needle} ({normalized_needle})")

    matches = []
    for key, value in br_contracts.items():
        name_key, team_key = key
        if (
            normalized_needle in name_key
            or any(part in name_key for part in normalized_needle.split())
        ):
            matches.append((key, value))

    for key, value in matches[:25]:
        print(key, value)

    if not matches:
        print("  No partial key matches found.")


def fetch_basketball_reference_contracts() -> Dict[Tuple[str, Optional[str]], Dict[str, Any]]:
    url = "https://www.basketball-reference.com/contracts/players.html"
    html = fetch_html(url)
    soup = load_br_soup(html)

    table = find_br_stats_table(
        soup,
        required_data_stats={"player", "team_id"},
    )
    
    if table is None:
        with open("br_contracts_debug.html", "w", encoding="utf-8") as f:
            f.write(html)
        raise RuntimeError(
            "Could not find Basketball Reference contracts table. "
            "Saved raw HTML to br_contracts_debug.html"
        )
    
        

    result: Dict[Tuple[str, Optional[str]], Dict[str, Any]] = {}

    for tr in table.select("tbody tr"):
        classes = tr.get("class", [])
        if "thead" in classes:
            continue

        player_cell = first_of(
            tr,
            [
                'td[data-stat="player"]',
                'td[data-stat="name_display"]',
            ],
        )
        team_cell = first_of(
            tr,
            [
                'td[data-stat="team_id"]',
                'td[data-stat="team_name_abbr"]',
            ],
        )
        salary_cell = tr.select_one('td[data-stat="y1"]')

        player_name = player_cell.get_text(strip=True) if player_cell else ""

        if player_name in {"Alperen Sengun", "Bogdan Bogdanovic"}:
            print("DEBUG CONTRACT ROW")
            print("player:", player_name)
            print("team:", team)
            print("cells:", [td.get_text(" ", strip=True) for td in tr.select("td")])

        team = team_cell.get_text(strip=True) if team_cell else None

        if not player_name:
            continue

        if salary_cell is None:
            right_cells = tr.select("td.right")
            salary_text = right_cells[0].get_text(strip=True) if right_cells else ""
        else:
            salary_text = salary_cell.get_text(strip=True)

        salary = safe_int(str(salary_text).replace("$", "").replace(",", ""))

        normalized = normalize_name(player_name)
        key = (normalized, team or None)

        existing = result.get(key)
        if existing is None or (existing.get("salary") is None and salary is not None):
            result[key] = {"salary": salary}

        fallback_key = (normalized, None)
        fallback_existing = result.get(fallback_key)
        if fallback_existing is None or (fallback_existing.get("salary") is None and salary is not None):
            result[fallback_key] = {"salary": salary}

    return result


def find_br_stats_table(
    soup: BeautifulSoup,
    required_data_stats: set[str],
):
    for table in soup.select("table"):
        data_stats = {
            el.get("data-stat")
            for el in table.select("[data-stat]")
            if el.get("data-stat")
        }
        if required_data_stats.issubset(data_stats):
            return table
    return None


def first_of(node, selectors: list[str]):
    for selector in selectors:
        match = node.select_one(selector)
        if match is not None:
            return match
    return None


if __name__ == "__main__":
    main()
