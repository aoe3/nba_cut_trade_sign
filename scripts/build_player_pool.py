#!/usr/bin/env python3
"""Builds the player pool consumed by puzzle generation and local analysis tools."""

from __future__ import annotations

import csv
import json
import os
import random
import re
import sys
import time
import unicodedata
from dataclasses import asdict, dataclass
from typing import Any, Callable, Dict, List, Optional, Tuple, TypeVar

import requests
from bs4 import BeautifulSoup
from nba_api.stats.endpoints import (
    commonallplayers,
    leaguedashplayerstats,
    leaguedashteamstats,
)

DEFAULT_JSON_OUTPUT_PATH = "src/data/players.json"
DEFAULT_CURRENT_SEASON = "2025-26"
DEFAULT_PREVIOUS_SEASON = "2024-25"

NBA_TIMEOUT_SECONDS = 75
HTML_TIMEOUT_SECONDS = 45
MAX_RETRIES = 6
RETRY_BACKOFF_SECONDS = 5.0

CURRENT_SEASON_DURABILITY_THRESHOLD_GAMES = 20

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

T = TypeVar("T")

from nba_api.stats.endpoints import (
    commonallplayers,
    leaguedashplayerstats,
    leaguedashteamstats,
)

def nba_request(factory: Callable[..., T], **kwargs: Any) -> T:
    return retry_nba_endpoint(
        lambda: factory(
            headers=NBA_HEADERS,
            timeout=NBA_TIMEOUT_SECONDS,
            **kwargs,
        )
    )

@dataclass
class OutputPlayer:
    id: str
    nbaPlayerId: int
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


"""Build the player pool used by puzzle generation from NBA and Basketball Reference data."""
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

    time.sleep(2.5)

    active_players = [
        row for row in all_players_rows if safe_int(row.get("ROSTERSTATUS")) == 1
    ]
    print(f"Found {len(active_players)} active roster players.")

    team_id_to_abbr = build_team_id_to_abbr_map(active_players)

    print("Fetching current-season player stats...")
    current_player_stats = fetch_league_dash_player_stats(current_season)

    time.sleep(2.5)

    players_with_games: List[Dict[str, Any]] = []
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

    time.sleep(2.5)

    print("Fetching current-season team stats...")
    current_team_stats = fetch_league_dash_team_stats(current_season, team_id_to_abbr)

    print("Fetching Basketball Reference advanced stats...")
    br_advanced = fetch_basketball_reference_advanced(current_season)

    print("Fetching Basketball Reference contracts...")
    br_contracts = fetch_basketball_reference_contracts()

    outputs: List[OutputPlayer] = []

    for player_row in players_with_games:
        player_id = safe_int(player_row.get("PERSON_ID"))
        if player_id is None:
            continue

        fallback_name = str(player_row.get("DISPLAY_FIRST_LAST") or "").strip()
        fallback_team = str(player_row.get("TEAM_ABBREVIATION") or "").strip() or "FA"

        if not fallback_name:
            continue

        current_row = current_player_stats.get(player_id)
        previous_row = previous_player_stats.get(player_id)
        team_row = current_team_stats.get(fallback_team)

        normalized_name = normalize_name(fallback_name)
        formatted_name = CONTRACT_NAME_ALIASES.get(normalized_name, normalized_name)

        adv_rows_for_player = br_advanced.get(formatted_name, {})
        adv_entry, adv_team_used = select_advanced_entry(
            adv_rows_for_player=adv_rows_for_player,
            fallback_team=fallback_team,
        )

        contract_entry = (
            br_contracts.get((formatted_name, fallback_team))
            or br_contracts.get((formatted_name, None))
        )

        position = normalize_position(adv_entry.get("position") if adv_entry else None)
        age = adv_entry.get("age") if adv_entry else None
        bpm = adv_entry.get("bpm") if adv_entry else None
        per = adv_entry.get("per") if adv_entry else None
        ws48 = adv_entry.get("ws48") if adv_entry else None
        usg_pct = adv_entry.get("usgPct") if adv_entry else None
        minutes_played = adv_entry.get("minutesPlayed") if adv_entry else None
        salary = contract_entry.get("salary") if contract_entry else None

        is_rookie: Optional[bool] = previous_row is None

        current_games_played = safe_int(current_row.get("GP")) if current_row is not None else None
        current_team_games_played = safe_int(team_row.get("GP")) if team_row is not None else None
        previous_games_played = safe_int(previous_row.get("GP")) if previous_row is not None else None

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

        ppg = round_or_none(
            safe_float(current_row.get("PTS")) if current_row is not None else None,
            1,
        )
        rpg = round_or_none(
            safe_float(current_row.get("REB")) if current_row is not None else None,
            1,
        )
        apg = round_or_none(
            safe_float(current_row.get("AST")) if current_row is not None else None,
            1,
        )
        spg = round_or_none(
            safe_float(current_row.get("STL")) if current_row is not None else None,
            1,
        )
        bpg = round_or_none(
            safe_float(current_row.get("BLK")) if current_row is not None else None,
            1,
        )

        fgm = round_or_none(
            safe_float(current_row.get("FGM")) if current_row is not None else None,
            1,
        )
        fga = round_or_none(
            safe_float(current_row.get("FGA")) if current_row is not None else None,
            1,
        )
        three_pm = round_or_none(
            safe_float(current_row.get("FG3M")) if current_row is not None else None,
            1,
        )
        three_pa = round_or_none(
            safe_float(current_row.get("FG3A")) if current_row is not None else None,
            1,
        )

        fg_pct = round_or_none(
            safe_float(current_row.get("FG_PCT")) if current_row is not None else None,
            4,
        )
        three_pct = round_or_none(
            safe_float(current_row.get("FG3_PCT")) if current_row is not None else None,
            4,
        )
        ft_pct = round_or_none(
            safe_float(current_row.get("FT_PCT")) if current_row is not None else None,
            4,
        )

        outputs.append(
            OutputPlayer(
                id=slugify(fallback_name),
                nbaPlayerId=player_id,
                name=fallback_name,
                team=fallback_team,
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
                ppg=ppg,
                rpg=rpg,
                apg=apg,
                spg=spg,
                bpg=bpg,
                fgm=fgm,
                fga=fga,
                threePm=three_pm,
                threePa=three_pa,
                fgPct=fg_pct,
                threePct=three_pct,
                ftPct=ft_pct,
                headshotUrl=build_headshot_url(player_id),
            )
        )

    outputs.sort(key=lambda p: p.name)

    before_filter_count = len(outputs)

    outputs = [
        p
        for p in outputs
        if p.salary is not None
        and p.age is not None
        and p.bpm is not None
        and p.per is not None
        and p.ws48 is not None
        and p.usgPct is not None
        and p.minutesPlayed is not None
        and p.minutesPerGame is not None
        and p.minuteShareOfTeam is not None
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


def retry_nba_endpoint(factory: Callable[[], T]) -> T:
    last_error: Optional[Exception] = None

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            return factory()
        except Exception as exc:
            last_error = exc
            if attempt < MAX_RETRIES:
                base_sleep = RETRY_BACKOFF_SECONDS * (2 ** (attempt - 1))
                jitter = random.uniform(0.5, 2.0)
                sleep_for = base_sleep + jitter
                print(f"  NBA request failed (attempt {attempt}/{MAX_RETRIES}): {exc}")
                print(f"  Retrying in {sleep_for:.1f}s...")
                time.sleep(sleep_for)

    assert last_error is not None
    raise last_error


def fetch_common_all_players(season: str) -> List[Dict[str, Any]]:
    endpoint = nba_request(
        commonallplayers.CommonAllPlayers,
        is_only_current_season=1,
        league_id="00",
        season=season,
    )
    return endpoint.get_normalized_dict()["CommonAllPlayers"]


def fetch_league_dash_player_stats(season: str) -> Dict[int, Dict[str, Any]]:
    endpoint = nba_request(
        leaguedashplayerstats.LeagueDashPlayerStats,
        season=season,
        season_type_all_star="Regular Season",
        per_mode_detailed="PerGame",
        measure_type_detailed_defense="Base",
        league_id_nullable="00",
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
    endpoint = nba_request(
        leaguedashteamstats.LeagueDashTeamStats,
        season=season,
        season_type_all_star="Regular Season",
        per_mode_detailed="PerGame",
        measure_type_detailed_defense="Base",
        league_id_nullable="00",
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
                base_sleep = RETRY_BACKOFF_SECONDS * (2 ** (attempt - 1))
                jitter = random.uniform(0.5, 2.0)
                sleep_for = base_sleep + jitter
                print(f"  HTML request failed (attempt {attempt}/{MAX_RETRIES}): {exc}")
                print(f"  Retrying in {sleep_for:.1f}s...")
                time.sleep(sleep_for)

    assert last_error is not None
    raise last_error


def load_br_soup(html: str) -> BeautifulSoup:
    lowered = html.lower()

    if (
        "access denied" in lowered
        or "forbidden" in lowered
        or "just a moment" in lowered
    ):
        raise RuntimeError("Basketball Reference blocked the request.")

    uncommented_html = re.sub(r"<!--|-->", "", html)
    return BeautifulSoup(uncommented_html, "lxml")


def first_of(node: Any, selectors: List[str]) -> Any:
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


def fetch_basketball_reference_advanced(
    season: str,
) -> Dict[str, Dict[str, Dict[str, Any]]]:
    end_year = season_to_end_year(season)
    url = f"https://www.basketball-reference.com/leagues/NBA_{end_year}_advanced.html"
    html = fetch_html(url)
    soup = load_br_soup(html)

    table = find_br_stats_table(
        soup,
        required_data_stats={
            "name_display",
            "team_name_abbr",
            "pos",
            "age",
            "per",
            "ws_per_48",
            "bpm",
            "usg_pct",
            "mp",
        },
    )

    if table is None:
        with open("br_advanced_debug.html", "w", encoding="utf-8") as f:
            f.write(html)
        raise RuntimeError(
            "Could not find Basketball Reference advanced stats table. "
            "Saved raw HTML to br_advanced_debug.html"
        )

    result: Dict[str, Dict[str, Dict[str, Any]]] = {}

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
        per_cell = tr.select_one('td[data-stat="per"]')
        ws48_cell = tr.select_one('td[data-stat="ws_per_48"]')
        bpm_cell = tr.select_one('td[data-stat="bpm"]')
        usg_pct_cell = tr.select_one('td[data-stat="usg_pct"]')
        mp_cell = tr.select_one('td[data-stat="mp"]')

        player_name = player_cell.get_text(strip=True) if player_cell else ""
        team = team_cell.get_text(strip=True) if team_cell else ""

        if not player_name or not team:
            continue

        normalized_player = normalize_name(player_name)

        row_data: Dict[str, Any] = {
            "position": pos_cell.get_text(strip=True) if pos_cell else None,
            "age": safe_int(age_cell.get_text(strip=True) if age_cell else None),
            "per": safe_float(per_cell.get_text(strip=True) if per_cell else None),
            "ws48": safe_float(ws48_cell.get_text(strip=True) if ws48_cell else None),
            "bpm": safe_float(bpm_cell.get_text(strip=True) if bpm_cell else None),
            "usgPct": safe_float(usg_pct_cell.get_text(strip=True) if usg_pct_cell else None),
            "minutesPlayed": safe_int(mp_cell.get_text(strip=True) if mp_cell else None),
        }

        bucket = result.setdefault(normalized_player, {})
        bucket[team.upper()] = row_data

        if "__fallback__" not in bucket:
            bucket["__fallback__"] = row_data

    return result


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

    fallback_team_upper = fallback_team.upper()
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
        team = team_cell.get_text(strip=True).upper() if team_cell else None

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


if __name__ == "__main__":
    main()