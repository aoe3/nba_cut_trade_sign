#!/usr/bin/env python3
"""Build an ESPN player ID + headshot map for NBA players.

This script is meant to be a low-drama replacement for the NBA player-ID/headshot
part of the current pipeline.

Default behavior:
- Scrape the current-season Basketball Reference advanced table to get player names.
- Pull the ESPN NBA athlete index from ESPN's public/undocumented endpoints.
- Fuzzy-match BBR names to ESPN athlete names.
- Write a JSON mapping with ESPN IDs and headshot URLs.

Outputs look like:
{
  "lebron james": {
    "inputName": "LeBron James",
    "espnId": "1966",
    "espnName": "LeBron James",
    "headshotUrl": "https://a.espncdn.com/i/headshots/nba/players/full/1966.png",
    "matchType": "exact"
  }
}

You can also read names from an existing players.json instead of BBR.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import unicodedata
from dataclasses import asdict, dataclass
from difflib import SequenceMatcher
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import requests
from bs4 import BeautifulSoup

DEFAULT_CURRENT_SEASON = "2025-26"
DEFAULT_OUTPUT_PATH = "src/data/espn_headshots.json"
DEFAULT_PLAYERS_JSON_PATH = "src/data/players.json"
DEFAULT_TIMEOUT_SECONDS = 30
DEFAULT_MAX_RETRIES = 4
DEFAULT_RETRY_BACKOFF_SECONDS = 2.0
DEFAULT_SLEEP_BETWEEN_REQUESTS_SECONDS = 0.35

ESPN_SITE_BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba"
ESPN_CORE_BASE = "https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba"
ESPN_HEADSHOT_TEMPLATE = "https://a.espncdn.com/i/headshots/nba/players/full/{espn_id}.png"
BASKETBALL_REFERENCE_ADVANCED_TEMPLATE = (
    "https://www.basketball-reference.com/leagues/NBA_{end_year}_advanced.html"
)

REQUEST_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/146.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "Referer": "https://www.espn.com/",
}

HTML_HEADERS = {
    "User-Agent": REQUEST_HEADERS["User-Agent"],
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "Referer": "https://www.google.com/",
}

NAME_ALIASES = {
    "aj green": "a j green",
    "p j tucker": "pj tucker",
    "r j barrett": "rj barrett",
    "r j lewis": "rj lewis",
    "alperen sengun": "alperen sengun",
    "bogdan bogdanovic": "bogdan bogdanovic",
    "dennis schroder": "dennis schroder",
    "jonas valanciunas": "jonas valanciunas",
    "jusuf nurkic": "jusuf nurkic",
    "kristaps porzingis": "kristaps porzingis",
    "luka doncic": "luka doncic",
    "moussa diabate": "moussa diabate",
    "nikola jokic": "nikola jokic",
    "nikola jovic": "nikola jovic",
    "nikola vucevic": "nikola vucevic",
    "ronald holland": "ron holland",
    "karl anthony towns": "karl anthony towns",
}


@dataclass
class EspnPlayerMatch:
    inputName: str
    normalizedInputName: str
    espnId: str
    espnName: str
    normalizedEspnName: str
    headshotUrl: str
    athleteApiRef: Optional[str]
    matchType: str
    similarity: float


class FetchError(RuntimeError):
    pass


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Scrape ESPN IDs + headshots for NBA players."
    )
    parser.add_argument(
        "--season",
        default=DEFAULT_CURRENT_SEASON,
        help="Season in YYYY-YY format used when scraping BBR names.",
    )
    parser.add_argument(
        "--output",
        default=DEFAULT_OUTPUT_PATH,
        help="Output JSON path.",
    )
    parser.add_argument(
        "--players-json",
        default=DEFAULT_PLAYERS_JSON_PATH,
        help="Path to an existing players.json file.",
    )
    parser.add_argument(
        "--source",
        choices=["bbr", "players_json"],
        default="bbr",
        help="Where to get the input player names from.",
    )
    parser.add_argument(
        "--min-similarity",
        type=float,
        default=0.88,
        help="Minimum fuzzy-match similarity for fallback matches.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Optional cap on number of input names, useful for testing.",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print extra debugging output.",
    )
    return parser.parse_args()


def ensure_parent_dir(file_path: str) -> None:
    parent = os.path.dirname(file_path)
    if parent:
        os.makedirs(parent, exist_ok=True)


def season_to_end_year(season: str) -> int:
    start_year_str, end_suffix_str = season.split("-")
    start_year = int(start_year_str)
    end_suffix = int(end_suffix_str)
    century = (start_year // 100) * 100
    return century + end_suffix


def normalize_name(name: str) -> str:
    value = unicodedata.normalize("NFKD", name)
    value = "".join(ch for ch in value if not unicodedata.combining(ch))
    value = value.replace("’", "'")
    value = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b\.?", "", value, flags=re.IGNORECASE)
    value = re.sub(r"[^a-zA-Z0-9]+", " ", value)
    value = re.sub(r"\s+", " ", value).strip().lower()
    return NAME_ALIASES.get(value, value)


def similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, a, b).ratio()


def request_json(
    session: requests.Session,
    url: str,
    params: Optional[Dict[str, Any]] = None,
    timeout: int = DEFAULT_TIMEOUT_SECONDS,
) -> Dict[str, Any]:
    last_error: Optional[Exception] = None

    for attempt in range(1, DEFAULT_MAX_RETRIES + 1):
        try:
            response = session.get(url, headers=REQUEST_HEADERS, params=params, timeout=timeout)
            response.raise_for_status()
            return response.json()
        except Exception as exc:
            last_error = exc
            if attempt < DEFAULT_MAX_RETRIES:
                sleep_for = DEFAULT_RETRY_BACKOFF_SECONDS * attempt
                print(f"  Request failed ({attempt}/{DEFAULT_MAX_RETRIES}) for {url}: {exc}")
                print(f"  Retrying in {sleep_for:.1f}s...")
                time.sleep(sleep_for)

    raise FetchError(f"Failed to fetch JSON from {url}: {last_error}")


def request_html(session: requests.Session, url: str, timeout: int = DEFAULT_TIMEOUT_SECONDS) -> str:
    last_error: Optional[Exception] = None

    for attempt in range(1, DEFAULT_MAX_RETRIES + 1):
        try:
            response = session.get(url, headers=HTML_HEADERS, timeout=timeout)
            response.raise_for_status()
            return response.text
        except Exception as exc:
            last_error = exc
            if attempt < DEFAULT_MAX_RETRIES:
                sleep_for = DEFAULT_RETRY_BACKOFF_SECONDS * attempt
                print(f"  HTML request failed ({attempt}/{DEFAULT_MAX_RETRIES}) for {url}: {exc}")
                print(f"  Retrying in {sleep_for:.1f}s...")
                time.sleep(sleep_for)

    raise FetchError(f"Failed to fetch HTML from {url}: {last_error}")


def load_bbr_soup(html: str) -> BeautifulSoup:
    uncommented_html = re.sub(r"<!--|-->", "", html)
    return BeautifulSoup(uncommented_html, "lxml")


def scrape_names_from_bbr_advanced(session: requests.Session, season: str) -> List[str]:
    end_year = season_to_end_year(season)
    url = BASKETBALL_REFERENCE_ADVANCED_TEMPLATE.format(end_year=end_year)
    html = request_html(session, url)
    soup = load_bbr_soup(html)

    table = soup.select_one("table#advanced")
    if table is None:
        raise FetchError(f"Could not find advanced table at {url}")

    seen: Dict[str, str] = {}
    for row in table.select("tbody tr"):
        if "thead" in (row.get("class") or []):
            continue
        player_cell = row.select_one('td[data-stat="player"]') or row.select_one(
            'td[data-stat="name_display"]'
        )
        if player_cell is None:
            continue
        name = player_cell.get_text(strip=True)
        if not name:
            continue
        norm = normalize_name(name)
        if norm and norm not in seen:
            seen[norm] = name

    return sorted(seen.values())


def load_names_from_players_json(path: str) -> List[str]:
    with open(path, "r", encoding="utf-8") as f:
        rows = json.load(f)

    seen: Dict[str, str] = {}
    for row in rows:
        name = str(row.get("name") or "").strip()
        if not name:
            continue
        norm = normalize_name(name)
        if norm and norm not in seen:
            seen[norm] = name

    return sorted(seen.values())


def fetch_espn_team_list(session: requests.Session) -> List[Dict[str, Any]]:
    url = f"{ESPN_SITE_BASE}/teams"
    data = request_json(session, url, params={"lang": "en", "region": "us"})
    sports = data.get("sports") or []
    if not sports:
        raise FetchError("ESPN teams response missing sports list.")

    leagues = sports[0].get("leagues") or []
    if not leagues:
        raise FetchError("ESPN teams response missing leagues list.")

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

            # Case 1: section-style wrapper with "items"
            items = entry.get("items")
            if isinstance(items, list):
                for athlete in items:
                    if isinstance(athlete, dict):
                        athletes.append(athlete)
                continue

            # Case 2: athlete object directly in the list
            if entry.get("id") and (
                entry.get("displayName") or entry.get("fullName") or entry.get("shortName")
            ):
                athletes.append(entry)

    elif isinstance(raw_athletes, dict):
        # Case 3: athletes is a dict with nested groups
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


def fetch_espn_athlete_index(session: requests.Session, verbose: bool = False) -> Dict[str, Dict[str, Any]]:
    teams = fetch_espn_team_list(session)
    print(f"Fetched {len(teams)} ESPN teams.")

    by_normalized_name: Dict[str, Dict[str, Any]] = {}
    total_athletes = 0

    for team in teams:
        team_id = str(team.get("id") or "").strip()
        team_name = str(team.get("displayName") or team.get("name") or "").strip()
        if not team_id:
            continue

        if verbose:
            print(f"Fetching roster for {team_name} ({team_id})...")

        athletes = fetch_espn_roster_athletes_for_team(session, team_id)
        if verbose:
            print(f"  -> got {len(athletes)} athletes")
        total_athletes += len(athletes)

        for athlete in athletes:
            athlete_id = str(athlete.get("id") or "").strip()
            athlete_name = str(
                athlete.get("displayName") or athlete.get("fullName") or athlete.get("shortName") or ""
            ).strip()
            if not athlete_id or not athlete_name:
                continue

            norm = normalize_name(athlete_name)
            if not norm:
                continue

            headshot = athlete.get("headshot") or {}
            headshot_url = (
                headshot.get("href")
                or ESPN_HEADSHOT_TEMPLATE.format(espn_id=athlete_id)
            )
            athlete_ref = athlete.get("$ref")

            candidate = {
                "espnId": athlete_id,
                "espnName": athlete_name,
                "normalizedEspnName": norm,
                "headshotUrl": headshot_url,
                "athleteApiRef": athlete_ref,
                "team": str(team.get("abbreviation") or "").strip(),
            }

            existing = by_normalized_name.get(norm)
            if existing is None:
                by_normalized_name[norm] = candidate
                continue

            # Prefer entries with an explicit headshot href.
            existing_has_explicit_headshot = bool(existing.get("headshotUrl"))
            candidate_has_explicit_headshot = bool(candidate.get("headshotUrl"))
            if candidate_has_explicit_headshot and not existing_has_explicit_headshot:
                by_normalized_name[norm] = candidate

        time.sleep(DEFAULT_SLEEP_BETWEEN_REQUESTS_SECONDS)

    if verbose and by_normalized_name:
        print("Sample indexed ESPN names:")
        for i, (name, entry) in enumerate(by_normalized_name.items()):
            print(f"  - {name} -> {entry['espnId']} ({entry['espnName']})")
            if i >= 9:
                break
            
    print(
        f"Indexed {len(by_normalized_name)} unique ESPN athlete names from {total_athletes} roster entries."
    )
    return by_normalized_name


def choose_best_match(
    input_name: str,
    espn_index: Dict[str, Dict[str, Any]],
    min_similarity: float,
) -> Optional[EspnPlayerMatch]:
    normalized_input = normalize_name(input_name)
    if not normalized_input:
        return None

    exact = espn_index.get(normalized_input)
    if exact is not None:
        return EspnPlayerMatch(
            inputName=input_name,
            normalizedInputName=normalized_input,
            espnId=str(exact["espnId"]),
            espnName=str(exact["espnName"]),
            normalizedEspnName=str(exact["normalizedEspnName"]),
            headshotUrl=str(exact["headshotUrl"]),
            athleteApiRef=exact.get("athleteApiRef"),
            matchType="exact",
            similarity=1.0,
        )

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

    return EspnPlayerMatch(
        inputName=input_name,
        normalizedInputName=normalized_input,
        espnId=str(best_entry["espnId"]),
        espnName=str(best_entry["espnName"]),
        normalizedEspnName=str(best_entry["normalizedEspnName"]),
        headshotUrl=str(best_entry["headshotUrl"]),
        athleteApiRef=best_entry.get("athleteApiRef"),
        matchType="fuzzy",
        similarity=round(best_score, 4),
    )


def build_mapping(
    input_names: Sequence[str],
    espn_index: Dict[str, Dict[str, Any]],
    min_similarity: float,
) -> Tuple[Dict[str, Dict[str, Any]], List[str]]:
    result: Dict[str, Dict[str, Any]] = {}
    unmatched: List[str] = []

    for name in input_names:
        match = choose_best_match(name, espn_index, min_similarity=min_similarity)
        if match is None:
            unmatched.append(name)
            continue
        result[match.normalizedInputName] = asdict(match)

    return result, unmatched


def main() -> None:
    args = parse_args()

    session = requests.Session()

    if args.source == "players_json":
        print(f"Loading names from {args.players_json}...")
        input_names = load_names_from_players_json(args.players_json)
    else:
        print(f"Scraping names from Basketball Reference advanced table for {args.season}...")
        input_names = scrape_names_from_bbr_advanced(session, args.season)

    if args.limit is not None:
        input_names = input_names[: args.limit]

    print(f"Loaded {len(input_names)} input player names.")

    print("Building ESPN athlete index from team rosters...")
    espn_index = fetch_espn_athlete_index(session, verbose=args.verbose)

    print("Matching input names to ESPN athletes...")
    mapping, unmatched = build_mapping(
        input_names=input_names,
        espn_index=espn_index,
        min_similarity=args.min_similarity,
    )

    ensure_parent_dir(args.output)
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(mapping, f, indent=2, sort_keys=True)

    unmatched_path = f"{os.path.splitext(args.output)[0]}_unmatched.json"
    with open(unmatched_path, "w", encoding="utf-8") as f:
        json.dump(unmatched, f, indent=2)

    print(f"Matched {len(mapping)} players.")
    print(f"Unmatched {len(unmatched)} players.")
    print(f"Wrote mapping:   {args.output}")
    print(f"Wrote unmatched: {unmatched_path}")

    if unmatched:
        print("First few unmatched names:")
        for name in unmatched[:25]:
            print(f"  - {name}")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("Interrupted.")
        sys.exit(130)
