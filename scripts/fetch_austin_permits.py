#!/usr/bin/env python3
"""Fetch and clean Austin permits. Only GETs the source; never calls our API."""

import argparse
from collections import Counter
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from email.utils import parsedate_to_datetime
import json
import os
from pathlib import Path
import tempfile
import time
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, Request, build_opener
from urllib.robotparser import RobotFileParser


ROOT = Path(__file__).resolve().parents[1]
BASE_URL = "https://data.austintexas.gov"
ENDPOINT = BASE_URL + "/resource/3syk-w9eu.json"
DATASET_URL = BASE_URL + "/Building-and-Development/Issued-Construction-Permits/3syk-w9eu/about_data"
TERMS_URL = BASE_URL + "/stories/s/ranj-cccq"
USER_AGENT = "ConstructionTrackerDataCollector/1.0"
FIELDS = ("permit_number,original_address1,original_city,original_state,original_zip,"
          "latitude,longitude,council_district,issue_date,permittype,"
          "permit_class_mapped,permit_class,work_class,status_current")
WHERE = ("permittype='BP' AND permit_class_mapped='Residential' "
         "AND permit_class='R- 101 Single Family Houses' AND work_class='New' "
         "AND status_current='Active' AND issue_date >= '2025-01-01T00:00:00'")
ORDER = "issue_date DESC,permit_number ASC"


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


class RejectedRecord(ValueError):
    """A stable exclusion reason, without applicant or contractor details."""


def text_field(row, key, maximum, reason):
    value = row.get(key)
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > maximum:
        raise RejectedRecord(reason)
    return value.strip()


def coordinate(value, maximum):
    if value is None or (isinstance(value, str) and not value.strip()):
        raise RejectedRecord("missing_coordinate")
    if isinstance(value, bool) or not isinstance(value, (str, int, float, Decimal)):
        raise RejectedRecord("invalid_coordinate")
    try:
        number = Decimal(str(value))
        if not number.is_finite() or not -maximum <= number <= maximum:
            raise RejectedRecord("invalid_coordinate")
        # Decimal rounding first; JSON uses numbers compatible with the Java DTO.
        return float(number.quantize(Decimal("0.0000001"), rounding=ROUND_HALF_UP))
    except InvalidOperation as exc:
        raise RejectedRecord("invalid_coordinate") from exc


def clean_record(row, fetched_at):
    if not isinstance(row, dict):
        raise RejectedRecord("invalid_record")
    required = {"permittype": "BP", "permit_class_mapped": "Residential",
                "permit_class": "R- 101 Single Family Houses", "work_class": "New",
                "status_current": "Active"}
    if any(row.get(key) != value for key, value in required.items()):
        raise RejectedRecord("outside_selected_scope")
    try:
        issued = datetime.fromisoformat(row["issue_date"])
        if issued.date().isoformat() < "2025-01-01":
            raise RejectedRecord("outside_selected_scope")
    except (KeyError, TypeError, ValueError) as exc:
        if isinstance(exc, RejectedRecord):
            raise
        raise RejectedRecord("invalid_issue_date") from exc

    permit = text_field(row, "permit_number", 128, "invalid_permit_number")
    street = text_field(row, "original_address1", 512, "invalid_address")
    parts = [street]
    for key in ("original_city", "original_state", "original_zip"):
        value = row.get(key)
        if value is not None and str(value).strip():
            parts.append(str(value).strip())
    address = ", ".join(parts)
    if len(address) > 512:
        raise RejectedRecord("invalid_address")
    try:
        district_value = row.get("council_district")
        if isinstance(district_value, bool):
            raise ValueError("boolean district")
        district = Decimal(str(district_value))
        if not district.is_finite() or district != district.to_integral_value() or not 1 <= district <= 10:
            raise ValueError("district must be 1..10")
    except (InvalidOperation, ValueError) as exc:
        raise RejectedRecord("invalid_council_district") from exc

    lat = coordinate(row.get("latitude"), Decimal(90))
    lng = coordinate(row.get("longitude"), Decimal(180))
    # A source URL identifies the original row, retaining its full permit suffix.
    escaped_permit = permit.replace("'", "''")
    source_url = ENDPOINT + "?" + urlencode({"$select": FIELDS, "$where": "permit_number='" + escaped_permit + "'"})
    if len(source_url) > 2048:
        raise RejectedRecord("source_url_too_long")
    return {"permitNo": permit, "address": address,
            "community": f"Austin Council District {int(district)}",
            "lat": lat, "lng": lng, "sourceUrl": source_url,
            "sourceFetchedAt": fetched_at}


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Do not request a redirect destination before checking its robots rules.
        return None


class PublicDataClient:
    def __init__(self, delay=2.0, opener=None, clock=time.monotonic, sleeper=time.sleep):
        self.delay = max(2.0, delay)
        self.opener = opener if opener is not None else build_opener(NoRedirect()).open
        self.clock = clock
        self.sleeper = sleeper
        self.last_started = None
        self.robots = None

    def get(self, url):
        if self.robots is not None and not self.robots.can_fetch(USER_AGENT, url):
            raise RuntimeError("robots.txt forbids the requested API URL")
        for attempt in range(4):
            if self.last_started is not None:
                wait = self.delay - (self.clock() - self.last_started)
                if wait > 0:
                    self.sleeper(wait)
            self.last_started = self.clock()
            request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json,text/plain"})
            try:
                with self.opener(request, timeout=30) as response:
                    # Recheck redirects rather than bypass a robots prohibition.
                    if response.geturl() != url:
                        raise RuntimeError("Unexpected redirect; inspect source and robots before retrying")
                    body = response.read().decode("utf-8")
                return body, utc_now()
            except HTTPError as exc:
                retry_after = exc.headers.get("Retry-After") if exc.headers else None
                exc.close()
                if exc.code not in (429, 502, 503, 504) or attempt == 3:
                    raise
                wait = self.delay * (2 ** attempt)
                if retry_after:
                    try:
                        requested = float(retry_after)
                    except ValueError:
                        requested = (parsedate_to_datetime(retry_after) - datetime.now(timezone.utc)).total_seconds()
                    wait = max(wait, requested)
                if wait > 60:
                    raise RuntimeError("Server requests a long pause; stop and retry later") from exc
                self.sleeper(wait)
        raise RuntimeError("Request retries exhausted")

    def check_robots(self):
        robots_url = BASE_URL + "/robots.txt"
        body, checked_at = self.get(robots_url)
        if not any(line.strip().lower().startswith("user-agent:") for line in body.splitlines()):
            raise RuntimeError("Unrecognized robots.txt; no dataset request was made")
        self.robots = RobotFileParser(robots_url)
        self.robots.parse(body.splitlines())
        if not self.robots.can_fetch(USER_AGENT, ENDPOINT):
            raise RuntimeError("robots.txt forbids the dataset API")
        crawl_delay = self.robots.crawl_delay(USER_AGENT)
        request_rate = self.robots.request_rate(USER_AGENT)
        self.delay = max(self.delay, crawl_delay or 0,
                         request_rate.seconds / request_rate.requests if request_rate else 0)
        return {"url": robots_url, "checkedAt": checked_at,
                "crawlDelaySeconds": crawl_delay, "effectiveDelaySeconds": self.delay}


def collect(client, target=200, page_size=200):
    robots = client.check_robots()
    houses = {}
    exclusions = Counter()
    exclusion_examples = []
    acquired = pages = 0
    while len(houses) < target:
        url = ENDPOINT + "?" + urlencode({"$select": FIELDS, "$where": WHERE, "$order": ORDER,
                                          "$limit": page_size, "$offset": pages * page_size})
        body, fetched_at = client.get(url)
        rows = json.loads(body)
        if not isinstance(rows, list) or len(rows) > page_size:
            raise RuntimeError("Unexpected API response; previous output is preserved")
        pages += 1
        acquired += len(rows)
        for row in rows:
            try:
                house = clean_record(row, fetched_at)
                if house["permitNo"] in houses:
                    raise RejectedRecord("duplicate_permit_number")
                houses[house["permitNo"]] = house
            except RejectedRecord as exc:
                reason = str(exc)
                exclusions[reason] += 1
                if len(exclusion_examples) < 20:
                    exclusion_examples.append({"permitNo": row.get("permit_number") if isinstance(row, dict) else None,
                                               "reason": reason})
        if len(rows) < page_size:
            break
    if len(houses) < target:
        raise RuntimeError(f"Only {len(houses)} valid unique records from {acquired} rows; "
                           f"need {target}; exclusions={dict(exclusions)}. Previous output is preserved.")
    selected = list(houses.values())[:target]
    report = {"datasetUrl": DATASET_URL, "termsUrl": TERMS_URL, "filter": WHERE, "order": ORDER,
              "robots": robots, "completedAt": utc_now(), "pages": pages,
              "acquired": acquired, "validUnique": len(houses), "selected": len(selected),
              "validNotSelected": len(houses) - len(selected), "excluded": sum(exclusions.values()),
              "exclusionReasons": dict(exclusions), "exclusionExamples": exclusion_examples,
              "imported": 0, "note": "Collection only; no API import or database writes."}
    return selected, report


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                         prefix="." + path.name, delete=False) as handle:
            temporary = Path(handle.name)
            json.dump(data, handle, ensure_ascii=False, indent=2, allow_nan=False)
            handle.write("\n")
        os.replace(temporary, path)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=200, help="Unique valid records, at least 200")
    parser.add_argument("--page-size", type=int, default=200, help="Rows per serial GET (1..1000)")
    parser.add_argument("--delay", type=float, default=2.0, help="Minimum request interval, at least 2 seconds")
    parser.add_argument("--sample-size", type=int, default=20, help="Repository sample size (0..50)")
    args = parser.parse_args()
    if args.limit < 200 or not 1 <= args.page_size <= 1000 or not 0 <= args.sample_size <= 50:
        parser.error("limit must be >=200, page-size 1..1000, sample-size 0..50")
    if not 2 <= args.delay <= 60:
        parser.error("delay must be 2..60 seconds")
    try:
        houses, report = collect(PublicDataClient(args.delay), args.limit, args.page_size)
        write_json(ROOT / "data/local/austin-houses.json", houses)
        write_json(ROOT / "data/local/austin-collection-report.json", report)
        write_json(ROOT / "data/samples/austin-houses.json", houses[:args.sample_size])
        print(json.dumps(report, ensure_ascii=False, indent=2))
    except (OSError, ValueError, RuntimeError) as exc:
        parser.exit(1, f"Collection failed: {exc}\n")


if __name__ == "__main__":
    main()
