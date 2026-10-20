"""Builds dashboard/data/covid.json from the same public datasets the 2021
Java app read live:

  - New York Times cases and deaths by state, and for the whole US
    (github.com/nytimes/covid-19-data, final update March 2023)
  - Our World in Data vaccinations by state and by manufacturer
    (github.com/owid/covid-19-data, archived)

Both projects have stopped updating, so the dashboard runs on a weekly
snapshot of the full archive instead of fetching on launch.

Usage (standard library only):
    python3 scripts/build_data.py            # downloads the CSVs
    python3 scripts/build_data.py RAW_DIR    # or reads them from RAW_DIR
"""

import csv
import io
import json
import os
import statistics
import sys
import urllib.request
from datetime import date, timedelta

SOURCES = {
    "us-states.csv": "https://raw.githubusercontent.com/nytimes/covid-19-data/master/us-states.csv",
    "us.csv": "https://raw.githubusercontent.com/nytimes/covid-19-data/master/us.csv",
    "us_state_vaccinations.csv": "https://raw.githubusercontent.com/owid/covid-19-data/master/public/data/vaccinations/us_state_vaccinations.csv",
    "vaccinations-by-manufacturer.csv": "https://raw.githubusercontent.com/owid/covid-19-data/master/public/data/vaccinations/vaccinations-by-manufacturer.csv",
}

# The NYT stopped on 2023-03-23; the last full week ends on this Saturday.
FIRST_WEEK = date(2020, 3, 7)
LAST_WEEK = date(2023, 3, 18)
# A vaccination reading this many days old still counts for a week (states
# didn't report every day).
VAX_STALE_DAYS = 14
OUT = os.path.join(os.path.dirname(__file__), "..", "dashboard", "data", "covid.json")


def read_csv(raw_dir, name):
    if raw_dir:
        with open(os.path.join(raw_dir, name), newline="") as f:
            return list(csv.DictReader(f))
    with urllib.request.urlopen(SOURCES[name]) as response:
        return list(csv.DictReader(io.TextIOWrapper(response, encoding="utf-8")))


def num(value):
    return float(value) if value not in ("", None) else None


def weeks():
    day = FIRST_WEEK
    while day <= LAST_WEEK:
        yield day
        day += timedelta(days=7)


def reading_at(series, day):
    """series: sorted list of (date, value) for a running total.

    Returns (value, estimated). A report from the last VAX_STALE_DAYS counts as
    is. Across a longer reporting gap the value is interpolated between the
    reports on either side (totals only grow, so a straight line is a fair
    guess) and flagged as estimated. Before the first report there's nothing.
    """
    before = after = None
    for d, value in series:
        if d <= day:
            before = (d, value)
        else:
            after = (d, value)
            break
    if before is None:
        return None, False
    if (day - before[0]).days <= VAX_STALE_DAYS:
        return before[1], False
    if after is None:
        return None, False
    share = (day - before[0]).days / (after[0] - before[0]).days
    return before[1] + (after[1] - before[1]) * share, True


def case_series(rows):
    """Weekly cumulative cases/deaths and 7-day average new cases/deaths."""
    by_day = {date.fromisoformat(r["date"]): (int(r["cases"]), int(r["deaths"])) for r in rows}
    days = sorted(by_day)

    def at(day):
        # Cumulative totals carry forward over reporting gaps.
        found = (0, 0)
        for d in days:
            if d > day:
                break
            found = by_day[d]
        return found

    out = {"cases": [], "deaths": [], "newCases": [], "newDeaths": []}
    for day in weeks():
        cases, deaths = at(day)
        week_ago_cases, week_ago_deaths = at(day - timedelta(days=7))
        out["cases"].append(cases)
        out["deaths"].append(deaths)
        # Data corrections can make a week negative; a negative average isn't real.
        out["newCases"].append(round(max(0, cases - week_ago_cases) / 7, 1))
        out["newDeaths"].append(round(max(0, deaths - week_ago_deaths) / 7, 2))
    return out


def main():
    raw_dir = sys.argv[1] if len(sys.argv) > 1 else None
    states = read_csv(raw_dir, "us-states.csv")
    nation = read_csv(raw_dir, "us.csv")
    vax = read_csv(raw_dir, "us_state_vaccinations.csv")
    makers = read_csv(raw_dir, "vaccinations-by-manufacturer.csv")

    # Regions are the 50 states and DC: the ones on the map. FIPS codes come
    # from the NYT file, keyed by name.
    fips_by_name = {r["state"]: r["fips"].zfill(2) for r in states if int(r["fips"]) <= 56}
    fips_by_name = {name: fips for name, fips in fips_by_name.items() if fips not in ("60", "66", "69", "72", "78")}
    owid_name = {"New York": "New York State"}

    vax_by_location = {}
    for r in vax:
        vax_by_location.setdefault(r["location"], []).append(r)

    regions = {}
    for name, fips in sorted(fips_by_name.items(), key=lambda item: item[1]):
        rows = [r for r in states if r["state"] == name]
        regions[fips] = {"name": name, **case_series(rows)}
        regions[fips]["vax"] = vax_by_location.get(owid_name.get(name, name), [])
    regions["US"] = {"name": "United States", **case_series(nation), "vax": vax_by_location["United States"]}

    for fips, region in regions.items():
        rows = sorted(region.pop("vax"), key=lambda r: r["date"])
        # Population isn't in these files, but OWID gives doses both as a count
        # and per hundred people, so their ratio recovers the population it used.
        pops = [
            num(r["total_vaccinations"]) / num(r["total_vaccinations_per_hundred"]) * 100
            for r in rows
            if num(r["total_vaccinations"]) and num(r["total_vaccinations_per_hundred"])
        ]
        region["pop"] = round(statistics.median(pops))

        estimated = set()

        def series(field, digits):
            points = [(date.fromisoformat(r["date"]), num(r[field])) for r in rows if num(r[field]) is not None]
            out = []
            for i, day in enumerate(weeks()):
                value, guessed = reading_at(points, day)
                if guessed:
                    estimated.add(i)
                out.append(round(value, digits) if value is not None else None)
            return out

        region["vaxOne"] = series("people_vaccinated_per_hundred", 2)
        region["vaxFull"] = series("people_fully_vaccinated_per_hundred", 2)
        region["boosted"] = series("total_boosters_per_hundred", 2)
        region["doses"] = [int(v) if v is not None else None for v in series("total_vaccinations", 0)]
        # Week indexes where any vaccination figure was interpolated.
        region["estimated"] = sorted(estimated)

    # US doses by manufacturer at the last week.
    us_makers = {}
    for r in makers:
        if r["location"] == "United States" and date.fromisoformat(r["date"]) <= LAST_WEEK:
            us_makers[r["vaccine"]] = (r["date"], int(r["total_vaccinations"]))
    makers_out = sorted(
        ({"name": name, "doses": doses, "asOf": as_of} for name, (as_of, doses) in us_makers.items()),
        key=lambda m: -m["doses"],
    )

    data = {
        "weeks": [day.isoformat() for day in weeks()],
        "regions": regions,
        "makers": makers_out,
        "sources": {name: url for name, url in SOURCES.items()},
    }
    with open(OUT, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    print(f"wrote {OUT}: {len(data['weeks'])} weeks, {len(regions)} regions, {os.path.getsize(OUT) // 1024} KB")


if __name__ == "__main__":
    main()
