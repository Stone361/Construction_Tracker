#!/usr/bin/env python3
"""Import existing cleaned JSON through the authenticated house API only."""

import argparse
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import json
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import Request, build_opener

try:
    from .fetch_austin_permits import NoRedirect, utc_now, write_json
except ImportError:  # Direct execution: python3 scripts/import_austin_houses.py
    from fetch_austin_permits import NoRedirect, utc_now, write_json


ROOT = Path(__file__).resolve().parents[1]
PAYLOAD_FIELDS = {"permitNo", "address", "community", "lat", "lng", "sourceUrl", "sourceFetchedAt"}
PHOTO_DERIVED_FIELDS = {"coverPhotoUrl", "lastPhotoBusinessDate"}


def load_records(path):
    """Validate the whole input before any API request; never remap or reacquire."""
    rows = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(rows, list) or not rows:
        raise ValueError("Input must be a non-empty JSON array")
    seen = set()
    for index, row in enumerate(rows, 1):
        if not isinstance(row, dict) or set(row) != PAYLOAD_FIELDS:
            raise ValueError(f"Record {index}: expected the seven cleaned API fields")
        for field, maximum in (("permitNo", 128), ("address", 512), ("community", 128)):
            value = row[field]
            if not isinstance(value, str) or not value.strip() or value != value.strip() or len(value.encode("utf-16-le")) // 2 > maximum:
                raise ValueError(f"Record {index}: invalid {field}")
        if row["permitNo"] in seen:
            raise ValueError(f"Record {index}: duplicate permitNo")
        seen.add(row["permitNo"])
        for field, maximum in (("lat", 90), ("lng", 180)):
            value = row[field]
            try:
                if isinstance(value, bool) or not isinstance(value, (int, float)):
                    raise ValueError("Coordinates must be JSON numbers")
                number = Decimal(str(value))
                if not number.is_finite() or not -maximum <= number <= maximum or number.as_tuple().exponent < -7:
                    raise ValueError("Coordinate range/precision")
            except (InvalidOperation, ValueError) as exc:
                raise ValueError(f"Record {index}: invalid {field}") from exc
        source = row["sourceUrl"]
        if not isinstance(source, str) or not source or len(source) > 2048 or any(c.isspace() for c in source):
            raise ValueError(f"Record {index}: invalid sourceUrl")
        url = urlsplit(source)
        if url.scheme != "https" or url.hostname != "data.austintexas.gov" or url.username is not None or url.password is not None:
            raise ValueError(f"Record {index}: expected official Austin sourceUrl")
        fetched = row["sourceFetchedAt"]
        if not isinstance(fetched, str) or not fetched.endswith("Z"):
            raise ValueError(f"Record {index}: expected UTC sourceFetchedAt")
        instant = datetime.fromisoformat(fetched.replace("Z", "+00:00"))
        if not 1000 <= instant.year <= 9999 or instant > datetime.now(timezone.utc):
            raise ValueError(f"Record {index}: invalid sourceFetchedAt")
    return rows


class HouseApiClient:
    def __init__(self, base_url, username="austin-import", opener=None):
        parsed = urlsplit(base_url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username is not None or parsed.password is not None or parsed.path not in ("", "/") or parsed.query or parsed.fragment:
            raise ValueError("base-url must be an HTTP(S) origin without credentials")
        username = username.strip()
        if not username or len(username) > 128 or any(ord(c) < 32 or ord(c) > 126 for c in username):
            raise ValueError("username must be 1..128 printable ASCII characters")
        self.base_url = base_url.rstrip("/")
        self.username = username
        self.opener = opener if opener is not None else build_opener(NoRedirect()).open

    def request(self, method, payload=None):
        body = None if payload is None else json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")
        request = Request(self.base_url + "/api/houses", data=body, method=method,
                          headers={"X-User": self.username, "X-Role": "ADMIN",
                                   "Accept": "application/json", "Content-Type": "application/json"})
        try:
            with self.opener(request, timeout=30) as response:
                return response.status, json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            status = exc.code
            exc.close()
            raise RuntimeError(f"{method} /api/houses returned HTTP {status}") from exc
        # No automatic POST retry: after a timeout, rerun safely using permitNo.


def index_houses(client):
    status, rows = client.request("GET")
    if status != 200 or not isinstance(rows, list):
        raise ValueError("Unexpected house list response")
    result = {}
    ids = set()
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get("id"), int) or row["id"] <= 0 or not isinstance(row.get("permitNo"), str):
            raise ValueError("Invalid house list entry")
        if row["permitNo"] in result or row["id"] in ids:
            raise ValueError("Duplicate permit or ID in house list")
        result[row["permitNo"]] = row
        ids.add(row["id"])
    return result


def payload_differences(payload, response):
    differences = []
    for key, expected in payload.items():
        actual = response.get(key)
        if key in ("lat", "lng"):
            equal = isinstance(actual, (int, float)) and not isinstance(actual, bool) and Decimal(str(actual)) == Decimal(str(expected))
        elif key == "sourceFetchedAt":
            try:
                equal = datetime.fromisoformat(actual.replace("Z", "+00:00")) == datetime.fromisoformat(expected.replace("Z", "+00:00"))
            except (AttributeError, TypeError, ValueError):
                equal = False
        else:
            equal = actual == expected
        if not equal:
            differences.append(key)
    return differences


def same_house_response(left, right):
    """POST omits current photo values; retain every other response field."""
    return isinstance(right, dict) and (
        {k: v for k, v in left.items() if k not in PHOTO_DERIVED_FIELDS}
        == {k: v for k, v in right.items() if k not in PHOTO_DERIVED_FIELDS})


def import_records(client, rows):
    before = index_houses(client)
    results, failures = [], []
    created = existing = 0
    for row in rows:
        try:
            status, response = client.request("POST", row)
            if status not in (200, 201) or not isinstance(response, dict) or not isinstance(response.get("id"), int) or response["id"] <= 0:
                raise ValueError("Unexpected create response")
            fields = payload_differences(row, response)
            if fields:
                raise ValueError("Stored fields differ from input: " + ",".join(fields))
            original = before.get(row["permitNo"])
            if original is not None and (status != 200 or not same_house_response(response, original)):
                raise ValueError("Existing record was not preserved")
            if status == 201 and (response.get("stage") != "LAND_CLEARING" or response.get("sourceType") != "PUBLIC_DATA"):
                raise ValueError("Unexpected new house stage/sourceType")
            created += status == 201
            existing += status == 200
            results.append({"status": status, "house": response})
        except (OSError, ValueError, RuntimeError) as exc:
            failures.append({"permitNo": row["permitNo"], "message": str(exc)})
            break  # Preserve successful work; stop rather than issue more writes after an error.

    after = index_houses(client)
    missing, differences = [], []
    for row in rows:
        house = after.get(row["permitNo"])
        if house is None:
            missing.append(row["permitNo"])
        else:
            fields = payload_differences(row, house)
            if fields:
                differences.append({"permitNo": row["permitNo"], "fields": fields})
    changed = [permit for permit, house in before.items() if after.get(permit) != house]
    inconsistent_responses = [r["house"]["permitNo"] for r in results
                              if not same_house_response(r["house"], after.get(r["house"]["permitNo"]))]
    verification = {"matched": len(rows) - len(missing) - len(differences), "missing": missing,
                    "differences": differences, "preexistingChanged": changed,
                    "postResponseDifferences": inconsistent_responses,
                    "totalBefore": len(before), "totalAfter": len(after),
                    "growthMatchesCreated": len(after) - len(before) == created}
    passed = not failures and not missing and not differences and not changed and not inconsistent_responses and verification["growthMatchesCreated"]
    return {"completedAt": utc_now(), "baseUrl": client.base_url, "inputCount": len(rows),
            "created": created, "existing": existing, "failed": len(failures),
            "unattempted": len(rows) - len(results) - len(failures), "failures": failures,
            "verification": verification, "passed": passed, "responses": results}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=ROOT / "data/local/austin-houses.json")
    parser.add_argument("--base-url", default="http://127.0.0.1:8081")
    parser.add_argument("--username", default="austin-import")
    parser.add_argument("--report", type=Path, default=ROOT / "data/local/austin-import-report.json")
    args = parser.parse_args()
    if not args.report.resolve().is_relative_to((ROOT / "data/local").resolve()) or args.report.resolve() == args.input.resolve():
        parser.error("report must be under data/local/ and must not overwrite the input")
    try:
        rows = load_records(args.input)
        result = import_records(HouseApiClient(args.base_url, args.username), rows)
        write_json(args.report, result)
        print(json.dumps({k: v for k, v in result.items() if k != "responses"}, ensure_ascii=False, indent=2))
        if not result["passed"]:
            parser.exit(1, "Import/verification failed; inspect the local report before rerunning.\n")
    except (OSError, ValueError, RuntimeError) as exc:
        parser.exit(1, f"Import stopped: {exc}\n")


if __name__ == "__main__":
    main()
