import json
from math import ceil, floor, sqrt
from pathlib import Path

PLAYERS_PATH = Path("src/data/players.json")

PEAK_MIN_AGE = 27
PEAK_MAX_AGE = 31

BPM_P10 = -4.9
BPM_P75 = 1.5
BPM_P90 = 2.9
BPM_STAR_MAX = 8.0

PER_P10 = 8.8
PER_P25 = 11.1
PER_P75 = 17.0
PER_P90 = 20.2
PER_STAR_MAX = 28.0

WS48_P10 = 0.010
WS48_P75 = 0.133
WS48_P90 = 0.166
WS48_STAR_MAX = 0.260

USG_P10 = 12.4
USG_P25 = 15.0
USG_P50 = 18.2
USG_P75 = 22.4
USG_P90 = 26.7
USG_STAR_MAX = 33.5

BOX_PPG_AVG = 11.5
BOX_RPG_AVG = 4.5
BOX_APG_AVG = 2.8
BOX_SPG_AVG = 0.8
BOX_BPG_AVG = 0.6

BOX_PPG_HIGH = 28.0
BOX_RPG_HIGH = 12.0
BOX_APG_HIGH = 9.0
BOX_SPG_HIGH = 2.0
BOX_BPG_HIGH = 2.2

BOX_PPG_WEIGHT = 0.46
BOX_RPG_WEIGHT = 0.18
BOX_APG_WEIGHT = 0.20
BOX_SPG_WEIGHT = 0.08
BOX_BPG_WEIGHT = 0.08

BOX_SCORE_BUMP_MAX = 7.0


def is_finite_number(value):
    return isinstance(value, (int, float))


def clamp(value, min_value, max_value):
    return min(max(value, min_value), max_value)


def normalize(value, min_value, max_value):
    if not is_finite_number(value):
        return 0.0
    if max_value == min_value:
        return 0.0
    return clamp((value - min_value) / (max_value - min_value), 0.0, 1.0)


def safe_number(value, fallback=0):
    return value if is_finite_number(value) else fallback


def sort_numbers(values):
    return sorted(values)


def percentile(sorted_values, p):
    if not sorted_values:
        raise ValueError("Cannot compute percentile of empty array.")

    if len(sorted_values) == 1:
        return sorted_values[0]

    clamped_p = max(0.0, min(1.0, p))
    index = (len(sorted_values) - 1) * clamped_p
    lower_index = floor(index)
    upper_index = ceil(index)

    if lower_index == upper_index:
        return sorted_values[lower_index]

    lower_value = sorted_values[lower_index]
    upper_value = sorted_values[upper_index]
    weight = index - lower_index

    return lower_value + (upper_value - lower_value) * weight


def format_money(value):
    return f"${round(value):,}"


def print_percentiles(label, sorted_values, formatter=None):
    fmt = formatter or (lambda value: f"{value:.2f}")

    print(f"\n=== {label} Percentiles ===")
    print(f"P10:    {fmt(percentile(sorted_values, 0.10))}")
    print(f"P25:    {fmt(percentile(sorted_values, 0.25))}")
    print(f"Median: {fmt(percentile(sorted_values, 0.50))}")
    print(f"P75:    {fmt(percentile(sorted_values, 0.75))}")
    print(f"P90:    {fmt(percentile(sorted_values, 0.90))}")


def print_histogram(label, values, bucket_count=10, formatter=None):
    if not values:
        return

    min_value = min(values)
    max_value = max(values)
    fmt = formatter or (lambda value: f"{value:.2f}")

    print(f"\n=== {label} Histogram ({bucket_count} buckets) ===")

    if min_value == max_value:
        print(f"{fmt(min_value)} to {fmt(max_value)}: {len(values)}")
        return

    width = (max_value - min_value) / bucket_count
    buckets = [0] * bucket_count

    for value in values:
        index = int((value - min_value) / width)
        if index >= bucket_count:
            index = bucket_count - 1
        if index < 0:
            index = 0
        buckets[index] += 1

    total_count = len(values)

    for i in range(bucket_count):
        start = min_value + i * width
        end = max_value if i == bucket_count - 1 else min_value + (i + 1) * width
        count = buckets[i]
        bar_length = max(1, round((count / total_count) * 40))
        bar = "#" * bar_length
        print(
            f"{fmt(start).rjust(10)} to {fmt(end).rjust(10)} | "
            f"{str(count).rjust(3)} | {bar}"
        )


def age_score(age):
    if PEAK_MIN_AGE <= age <= PEAK_MAX_AGE:
        return 1.0

    if age < PEAK_MIN_AGE:
        return clamp(1 - (PEAK_MIN_AGE - age) / 9, 0.55, 1.0)

    return clamp(1 - (age - PEAK_MAX_AGE) / 7, 0.35, 1.0)


def durability_score(player):
    games_played = safe_number(player.get("gamesPlayed"), 0)
    team_games_played = safe_number(player.get("teamGamesPlayed"), 0)

    if team_games_played <= 0:
        return 0.0

    return clamp(games_played / team_games_played, 0.0, 1.0)


def active_role_share(player):
    explicit_active_share = safe_number(player.get("activeMinuteShare"), -1)
    if explicit_active_share >= 0:
        return clamp(explicit_active_share, 0.0, 1.0)

    mpg = safe_number(player.get("minutesPerGame"), -1)
    if mpg >= 0:
        return clamp(mpg / 240.0, 0.0, 1.0)

    minutes_played = safe_number(player.get("minutesPlayed"), -1)
    games_played = safe_number(player.get("gamesPlayed"), 0)
    if minutes_played >= 0 and games_played > 0:
        return clamp((minutes_played / games_played) / 240.0, 0.0, 1.0)

    return 0.0


def season_minute_share(player):
    stored_share = safe_number(player.get("minuteShareOfTeam"), -1)
    if stored_share >= 0:
        return clamp(stored_share, 0.0, 1.0)

    minutes_played = safe_number(player.get("minutesPlayed"), -1)
    team_games_played = safe_number(player.get("teamGamesPlayed"), 0)

    if minutes_played < 0 or team_games_played <= 0:
        return 0.0

    total_team_minutes = team_games_played * 240.0
    if total_team_minutes <= 0:
        return 0.0

    return clamp(minutes_played / total_team_minutes, 0.0, 1.0)


def sample_confidence(player):
    games_played = safe_number(player.get("gamesPlayed"), 0)
    team_games_played = safe_number(player.get("teamGamesPlayed"), 0)

    if team_games_played <= 0:
        return 0.35

    participation = clamp(games_played / team_games_played, 0.0, 1.0)
    return clamp(0.35 + participation * 0.65, 0.35, 1.0)


def role_confidence(player):
    role_share = active_role_share(player)
    return clamp(0.45 + normalize(role_share, 0.04, 0.14) * 0.55, 0.45, 1.0)


def season_share_confidence(player):
    share = season_minute_share(player)
    return clamp(0.20 + normalize(share, 0.01, 0.10) * 0.80, 0.20, 1.0)


def minutes_confidence(player):
    minutes = safe_number(player.get("minutesPlayed"), -1)

    if minutes < 0:
        return 0.35

    if minutes <= 250:
        return clamp(0.12 + normalize(minutes, 0, 250) * 0.18, 0.12, 0.30)

    if minutes <= 700:
        return clamp(0.30 + normalize(minutes, 250, 700) * 0.28, 0.30, 0.58)

    if minutes <= 1400:
        return clamp(0.58 + normalize(minutes, 700, 1400) * 0.22, 0.58, 0.80)

    if minutes <= 2200:
        return clamp(0.80 + normalize(minutes, 1400, 2200) * 0.15, 0.80, 0.95)

    return clamp(0.95 + normalize(minutes, 2200, 2800) * 0.05, 0.95, 1.0)


def blended_trust(player):
    role = role_confidence(player)
    sample = sample_confidence(player)
    minute_trust = minutes_confidence(player)
    season_trust = season_share_confidence(player)

    return sqrt(sqrt(role * sample) * sqrt(minute_trust * season_trust))


def efficiency_confidence(player):
    return clamp(blended_trust(player), 0.25, 1.0)


def impact_confidence(player):
    return clamp(blended_trust(player) * 0.94 + 0.06, 0.28, 1.0)


def creator_confidence(player):
    return clamp(blended_trust(player), 0.25, 1.0)


def volume_confidence(player):
    active_role = active_role_share(player)
    season_role = season_minute_share(player)
    minute_trust = minutes_confidence(player)

    role_blend = active_role * 0.60 + season_role * 0.40

    return clamp(
        (0.52 + normalize(role_blend, 0.03, 0.13) * 0.48)
        * (0.72 + minute_trust * 0.28),
        0.38,
        1.0,
    )


def availability_confidence(player):
    games_played = safe_number(player.get("gamesPlayed"), 0)
    team_games_played = safe_number(player.get("teamGamesPlayed"), 0)

    if team_games_played <= 0:
        return 0.45

    participation = clamp(games_played / team_games_played, 0.0, 1.0)
    minute_trust = minutes_confidence(player)

    return clamp((0.45 + participation * 0.55) * (0.80 + minute_trust * 0.20), 0.35, 1.0)


def bpm_score(bpm):
    base = normalize(bpm, BPM_P10, BPM_P90) * 11.5
    star_tier = normalize(bpm, BPM_P90, BPM_STAR_MAX)
    star_bonus = star_tier * 4 + (star_tier ** 2) * 3
    return base + star_bonus


def per_score(per):
    base = normalize(per, PER_P10, PER_P90) * 4.0
    star_bonus = normalize(per, PER_P90, PER_STAR_MAX) * 1.25
    return base + star_bonus


def ws48_score(ws48):
    base = normalize(ws48, WS48_P10, WS48_P90) * 1.1
    star_bonus = normalize(ws48, WS48_P90, WS48_STAR_MAX) * 0.25
    return base + star_bonus


def usage_load_score(usg_pct):
    base = normalize(usg_pct, USG_P10, USG_P90) * 2.6
    star_bonus = normalize(usg_pct, USG_P90, USG_STAR_MAX) * 1.8
    return base + star_bonus


def responsibility_multiplier(bpm, per, usg_pct):
    load = normalize(usg_pct, USG_P25, USG_STAR_MAX)
    impact = normalize(bpm, 0, BPM_STAR_MAX)
    scoring = normalize(per, PER_P25, PER_STAR_MAX)

    quality = clamp(impact * 0.7 + scoring * 0.3, 0.0, 1.0)
    return clamp(0.92 + load * quality * 0.32, 0.92, 1.24)


def creator_bonus(bpm, per, usg_pct):
    usg_load = normalize(usg_pct, USG_P50, USG_STAR_MAX)
    impact = normalize(bpm, BPM_P75, BPM_STAR_MAX)
    scoring = normalize(per, PER_P75, PER_STAR_MAX)

    return clamp((impact * 0.65 + scoring * 0.35) * usg_load * 4.2, 0.0, 4.2)


def get_points_per_game(player):
    return safe_number(
        player.get("pointsPerGame"),
        safe_number(player.get("ppg"), 0),
    )


def get_rebounds_per_game(player):
    return safe_number(
        player.get("reboundsPerGame"),
        safe_number(player.get("rpg"), 0),
    )


def get_assists_per_game(player):
    return safe_number(
        player.get("assistsPerGame"),
        safe_number(player.get("apg"), 0),
    )


def get_steals_per_game(player):
    return safe_number(
        player.get("stealsPerGame"),
        safe_number(player.get("spg"), 0),
    )


def get_blocks_per_game(player):
    return safe_number(
        player.get("blocksPerGame"),
        safe_number(player.get("bpg"), 0),
    )


def centered_stat_delta(value, average, high):
    if not is_finite_number(value):
        return 0.0

    if value >= average:
        return normalize(value, average, high)

    return -normalize(value, 0, average)


def box_score_confidence(player):
    trust = blended_trust(player)
    availability = availability_confidence(player)
    volume = volume_confidence(player)

    return clamp(trust * 0.40 + availability * 0.35 + volume * 0.25, 0.30, 1.0)


def box_score_bump(player):
    ppg = get_points_per_game(player)
    rpg = get_rebounds_per_game(player)
    apg = get_assists_per_game(player)
    spg = get_steals_per_game(player)
    bpg = get_blocks_per_game(player)

    ppg_delta = centered_stat_delta(ppg, BOX_PPG_AVG, BOX_PPG_HIGH)
    rpg_delta = centered_stat_delta(rpg, BOX_RPG_AVG, BOX_RPG_HIGH)
    apg_delta = centered_stat_delta(apg, BOX_APG_AVG, BOX_APG_HIGH)
    spg_delta = centered_stat_delta(spg, BOX_SPG_AVG, BOX_SPG_HIGH)
    bpg_delta = centered_stat_delta(bpg, BOX_BPG_AVG, BOX_BPG_HIGH)

    weighted_delta = (
        ppg_delta * BOX_PPG_WEIGHT
        + rpg_delta * BOX_RPG_WEIGHT
        + apg_delta * BOX_APG_WEIGHT
        + spg_delta * BOX_SPG_WEIGHT
        + bpg_delta * BOX_BPG_WEIGHT
    )

    confidence = box_score_confidence(player)

    return clamp(
        weighted_delta * BOX_SCORE_BUMP_MAX * confidence,
        -BOX_SCORE_BUMP_MAX,
        BOX_SCORE_BUMP_MAX,
    )


def game_score(player):
    bpm = safe_number(player.get("bpm"), 0)
    per = safe_number(player.get("per"), PER_P10)
    ws48 = safe_number(player.get("ws48"), WS48_P10)
    usg_pct = safe_number(player.get("usgPct"), USG_P10)
    age = safe_number(player.get("age"), PEAK_MIN_AGE)

    impact_points = (
        bpm_score(bpm)
        * responsibility_multiplier(bpm, per, usg_pct)
        * impact_confidence(player)
    )

    low_usage_penalty = clamp(
        0.88 + normalize(usg_pct, USG_P25, USG_P75) * 0.12,
        0.88,
        1.0,
    )

    efficiency_points = (
        (per_score(per) + ws48_score(ws48))
        * efficiency_confidence(player)
        * low_usage_penalty
    )

    responsibility_points = usage_load_score(usg_pct) * creator_confidence(player)
    creator_points = creator_bonus(bpm, per, usg_pct) * creator_confidence(player)

    production_points = (
        impact_points
        + efficiency_points
        + responsibility_points
        + creator_points
    ) * volume_confidence(player)

    durability_points = durability_score(player) * 2.0
    age_points = age_score(age) * 1.5
    counting_stat_points = box_score_bump(player)

    total = production_points + durability_points + age_points + counting_stat_points

    return round(clamp(total, 0.0, 45.0), 1)


def display_role_share(player):
    return active_role_share(player)


def print_top_game_scores(players, count=25):
    ranked = sorted(players, key=lambda p: game_score(p), reverse=True)[:count]

    print(f"\n=== Top {count} Players By Game Score ===")
    for index, player in enumerate(ranked, start=1):
        print(
            f"{str(index).rjust(2)}. {player['name']} {player['team']} {player['position']} | "
            f"Score {game_score(player):.1f} | "
            f"Box {box_score_bump(player):+.1f} | "
            f"BPM {player['bpm']:.1f} | PER {player['per']:.1f} | "
            f"WS/48 {player['ws48']:.3f} | USG% {player['usgPct']:.1f} | "
            f"PPG {get_points_per_game(player):.1f} | RPG {get_rebounds_per_game(player):.1f} | "
            f"APG {get_assists_per_game(player):.1f} | "
            f"MPG {safe_number(player.get('minutesPerGame'), 0):.1f} | "
            f"Role {display_role_share(player):.3f} | "
            f"GP {safe_number(player.get('gamesPlayed'), 0):.0f}/{safe_number(player.get('teamGamesPlayed'), 0):.0f}"
        )


def print_top_by_position(players, count=10):
    positions = ["PG", "SG", "SF", "PF", "C"]

    for position in positions:
        ranked = sorted(
            [p for p in players if p.get("position") == position],
            key=lambda p: game_score(p),
            reverse=True,
        )[:count]

        print(f"\n=== Top {count} {position}s By Game Score ===")
        for index, player in enumerate(ranked, start=1):
            print(
                f"{str(index).rjust(2)}. {player['name']} {player['team']} | "
                f"Score {game_score(player):.1f} | "
                f"Box {box_score_bump(player):+.1f} | "
                f"BPM {player['bpm']:.1f} | PER {player['per']:.1f} | "
                f"WS/48 {player['ws48']:.3f} | USG% {player['usgPct']:.1f} | "
                f"PPG {get_points_per_game(player):.1f} | RPG {get_rebounds_per_game(player):.1f} | "
                f"APG {get_assists_per_game(player):.1f} | "
                f"MPG {safe_number(player.get('minutesPerGame'), 0):.1f} | "
                f"Role {display_role_share(player):.3f} | "
                f"GP {safe_number(player.get('gamesPlayed'), 0):.0f}/{safe_number(player.get('teamGamesPlayed'), 0):.0f}"
            )


def print_low_minute_share_high_scores(players, count=15, max_share=0.085):
    ranked = sorted(
        [p for p in players if display_role_share(p) <= max_share],
        key=lambda p: game_score(p),
        reverse=True,
    )[:count]

    print(f"\n=== Low Role-Share Players With High Game Scores ===")
    for index, player in enumerate(ranked, start=1):
        print(
            f"{str(index).rjust(2)}. {player['name']} {player['team']} {player['position']} | "
            f"Score {game_score(player):.1f} | Box {box_score_bump(player):+.1f} | "
            f"Role {display_role_share(player):.3f} | "
            f"MPG {safe_number(player.get('minutesPerGame'), 0):.1f} | "
            f"GP {safe_number(player.get('gamesPlayed'), 0):.0f}/{safe_number(player.get('teamGamesPlayed'), 0):.0f} | "
            f"BPM {player['bpm']:.1f} | PER {player['per']:.1f} | "
            f"WS/48 {player['ws48']:.3f} | USG% {player['usgPct']:.1f} | "
            f"PPG {get_points_per_game(player):.1f} | APG {get_assists_per_game(player):.1f}"
        )


def print_high_minute_share_high_scores(players, count=15, min_share=0.115):
    ranked = sorted(
        [p for p in players if display_role_share(p) >= min_share],
        key=lambda p: game_score(p),
        reverse=True,
    )[:count]

    print(f"\n=== High Role-Share Players With High Game Scores ===")
    for index, player in enumerate(ranked, start=1):
        print(
            f"{str(index).rjust(2)}. {player['name']} {player['team']} {player['position']} | "
            f"Score {game_score(player):.1f} | Box {box_score_bump(player):+.1f} | "
            f"Role {display_role_share(player):.3f} | "
            f"MPG {safe_number(player.get('minutesPerGame'), 0):.1f} | "
            f"GP {safe_number(player.get('gamesPlayed'), 0):.0f}/{safe_number(player.get('teamGamesPlayed'), 0):.0f} | "
            f"BPM {player['bpm']:.1f} | PER {player['per']:.1f} | "
            f"WS/48 {player['ws48']:.3f} | USG% {player['usgPct']:.1f} | "
            f"PPG {get_points_per_game(player):.1f} | APG {get_assists_per_game(player):.1f}"
        )


"""Print score distribution snapshots for tuning the player-pool model."""
def main():
    players = json.loads(PLAYERS_PATH.read_text())

    players = [
        p for p in players
        if is_finite_number(p.get("bpm"))
        and is_finite_number(p.get("per"))
        and is_finite_number(p.get("ws48"))
        and is_finite_number(p.get("usgPct"))
        and is_finite_number(p.get("gamesPlayed"))
        and is_finite_number(p.get("teamGamesPlayed"))
        and (
            is_finite_number(p.get("minutesPlayed"))
            or is_finite_number(p.get("minutesPerGame"))
            or is_finite_number(p.get("activeMinuteShare"))
        )
    ]

    bpm_values = sort_numbers([p["bpm"] for p in players])
    per_values = sort_numbers([p["per"] for p in players])
    ws48_values = sort_numbers([p["ws48"] for p in players])
    usg_values = sort_numbers([p["usgPct"] for p in players])
    minutes_played_values = sort_numbers(
        [p["minutesPlayed"] for p in players if is_finite_number(p.get("minutesPlayed"))]
    )
    mpg_values = sort_numbers(
        [p["minutesPerGame"] for p in players if is_finite_number(p.get("minutesPerGame"))]
    )
    role_share_values = sort_numbers([display_role_share(p) for p in players])
    stored_minute_share_values = sort_numbers(
        [
            p["minuteShareOfTeam"]
            for p in players
            if is_finite_number(p.get("minuteShareOfTeam"))
        ]
    )
    game_score_values = sort_numbers([game_score(p) for p in players])
    box_bump_values = sort_numbers([box_score_bump(p) for p in players])

    print(f"Loaded {len(players)} players from {PLAYERS_PATH}")

    print("\n=== BPM Range ===")
    print(f"Min BPM: {bpm_values[0]:.1f}")
    print(f"Max BPM: {bpm_values[-1]:.1f}")

    print("\n=== PER Range ===")
    print(f"Min PER: {per_values[0]:.1f}")
    print(f"Max PER: {per_values[-1]:.1f}")

    print("\n=== WS/48 Range ===")
    print(f"Min WS/48: {ws48_values[0]:.3f}")
    print(f"Max WS/48: {ws48_values[-1]:.3f}")

    print("\n=== USG% Range ===")
    print(f"Min USG%: {usg_values[0]:.1f}")
    print(f"Max USG%: {usg_values[-1]:.1f}")

    if minutes_played_values:
        print("\n=== Minutes Played Range ===")
        print(f"Min Minutes: {minutes_played_values[0]:.0f}")
        print(f"Max Minutes: {minutes_played_values[-1]:.0f}")

    if mpg_values:
        print("\n=== Minutes Per Game Range ===")
        print(f"Min MPG: {mpg_values[0]:.1f}")
        print(f"Max MPG: {mpg_values[-1]:.1f}")

    if role_share_values:
        print("\n=== Active Role Share Range ===")
        print(f"Min Role: {role_share_values[0]:.3f}")
        print(f"Max Role: {role_share_values[-1]:.3f}")

    if stored_minute_share_values:
        print("\n=== Stored Minute Share Of Team Range ===")
        print(f"Min Stored Share: {stored_minute_share_values[0]:.3f}")
        print(f"Max Stored Share: {stored_minute_share_values[-1]:.3f}")

    print("\n=== Box Score Bump Range ===")
    print(f"Min Box Bump: {box_bump_values[0]:.1f}")
    print(f"Max Box Bump: {box_bump_values[-1]:.1f}")

    print_percentiles("BPM", bpm_values, lambda value: f"{value:.2f}")
    print_percentiles("PER", per_values, lambda value: f"{value:.2f}")
    print_percentiles("WS/48", ws48_values, lambda value: f"{value:.3f}")
    print_percentiles("USG%", usg_values, lambda value: f"{value:.2f}")

    if minutes_played_values:
        print_percentiles("Minutes Played", minutes_played_values, lambda value: f"{value:.0f}")

    if mpg_values:
        print_percentiles("Minutes Per Game", mpg_values, lambda value: f"{value:.1f}")

    if role_share_values:
        print_percentiles("Active Role Share", role_share_values, lambda value: f"{value:.3f}")

    if stored_minute_share_values:
        print_percentiles(
            "Stored Minute Share Of Team",
            stored_minute_share_values,
            lambda value: f"{value:.3f}",
        )

    print_percentiles("Box Score Bump", box_bump_values, lambda value: f"{value:.1f}")
    print_percentiles("Game Score", game_score_values, lambda value: f"{value:.1f}")

    print_histogram("BPM", bpm_values, 12, lambda value: f"{value:.1f}")
    print_histogram("PER", per_values, 12, lambda value: f"{value:.1f}")
    print_histogram("WS/48", ws48_values, 12, lambda value: f"{value:.3f}")
    print_histogram("USG%", usg_values, 12, lambda value: f"{value:.1f}")

    if minutes_played_values:
        print_histogram("Minutes Played", minutes_played_values, 12, lambda value: f"{value:.0f}")

    if mpg_values:
        print_histogram("Minutes Per Game", mpg_values, 12, lambda value: f"{value:.1f}")

    if role_share_values:
        print_histogram("Active Role Share", role_share_values, 12, lambda value: f"{value:.3f}")

    if stored_minute_share_values:
        print_histogram(
            "Stored Minute Share Of Team",
            stored_minute_share_values,
            12,
            lambda value: f"{value:.3f}",
        )

    print_histogram("Box Score Bump", box_bump_values, 12, lambda value: f"{value:.1f}")
    print_histogram("Game Score", game_score_values, 12, lambda value: f"{value:.1f}")

    print_top_game_scores(players, 25)
    print_top_by_position(players, 10)
    print_low_minute_share_high_scores(players, 15)
    print_high_minute_share_high_scores(players, 15)


if __name__ == "__main__":
    main()