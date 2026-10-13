"""Offline tests: no network, application API, or database access."""

import io
import json
from pathlib import Path
import tempfile
import unittest
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit

from scripts.fetch_austin_permits import (
    BASE_URL, ENDPOINT, PublicDataClient, RejectedRecord, clean_record, collect, write_json,
)


FETCHED_AT = "2026-10-13T02:00:00.123456Z"
ROW = {"permit_number": "2026-132169 BP", "original_address1": "3303 THOUSAND OAKS CV",
       "original_city": "AUSTIN", "original_state": "TX", "original_zip": "78746",
       "latitude": "30.26689099", "longitude": "-97.80675239", "council_district": "8",
       "issue_date": "2026-10-09T00:00:00.000", "permittype": "BP",
       "permit_class_mapped": "Residential", "permit_class": "R- 101 Single Family Houses",
       "work_class": "New", "status_current": "Active"}


class Response(io.BytesIO):
    def __init__(self, url, body):
        super().__init__(body.encode())
        self.url = url

    def geturl(self):
        return self.url


class FakeClock:
    def __init__(self):
        self.value = 0
        self.waits = []

    def now(self):
        return self.value

    def sleep(self, seconds):
        self.waits.append(seconds)
        self.value += seconds


class CleaningTests(unittest.TestCase):
    def test_mapping_precision_and_source(self):
        house = clean_record(ROW, FETCHED_AT)
        self.assertEqual(house["permitNo"], ROW["permit_number"])
        self.assertEqual(house["address"], "3303 THOUSAND OAKS CV, AUSTIN, TX, 78746")
        self.assertEqual(house["community"], "Austin Council District 8")
        self.assertEqual(house["lat"], 30.266891)
        self.assertEqual(house["lng"], -97.8067524)
        self.assertEqual(house["sourceFetchedAt"], FETCHED_AT)
        self.assertEqual(parse_qs(urlsplit(house["sourceUrl"]).query)["$where"],
                         ["permit_number='2026-132169 BP'"])
        self.assertNotIn("stage", house)
        self.assertEqual(set(house), {"permitNo", "address", "community", "lat", "lng",
                                      "sourceUrl", "sourceFetchedAt"})

    def test_trim_and_do_not_change_case_or_suffix(self):
        row = {**ROW, "permit_number": " 2026-132169 BP ", "original_address1": " Road ",
               "original_city": " Austin "}
        house = clean_record(row, FETCHED_AT)
        self.assertEqual(house["permitNo"], "2026-132169 BP")
        self.assertTrue(house["address"].startswith("Road, Austin,"))

    def test_coordinate_exclusions(self):
        for key, value, reason in [("latitude", None, "missing_coordinate"),
                                   ("longitude", " ", "missing_coordinate"),
                                   ("latitude", "NaN", "invalid_coordinate"),
                                   ("longitude", "Infinity", "invalid_coordinate"),
                                   ("latitude", "90.00000001", "invalid_coordinate"),
                                   ("longitude", "-180.1", "invalid_coordinate"),
                                   ("latitude", "broken", "invalid_coordinate"),
                                   ("latitude", True, "invalid_coordinate")]:
            with self.subTest(key=key, value=value):
                with self.assertRaisesRegex(RejectedRecord, "^" + reason + "$"):
                    clean_record({**ROW, key: value}, FETCHED_AT)

    def test_coordinate_boundaries_and_half_up(self):
        house = clean_record({**ROW, "latitude": "90", "longitude": "-180"}, FETCHED_AT)
        self.assertEqual((house["lat"], house["lng"]), (90, -180))
        house = clean_record({**ROW, "latitude": "30.12345675", "longitude": "-97.12345675"}, FETCHED_AT)
        self.assertEqual((house["lat"], house["lng"]), (30.1234568, -97.1234568))

    def test_invalid_identifiers_and_addresses(self):
        for key, value in [("permit_number", None), ("permit_number", " "),
                           ("permit_number", "x" * 129), ("original_address1", " "),
                           ("original_address1", "x" * 513), ("original_address1", "x" * 510)]:
            with self.subTest(key=key, length=len(value) if isinstance(value, str) else None):
                with self.assertRaises(RejectedRecord):
                    clean_record({**ROW, key: value}, FETCHED_AT)

    def test_invalid_district(self):
        for value in [None, "", "0", "11", "1.5", "NaN", True]:
            with self.subTest(value=value):
                with self.assertRaisesRegex(RejectedRecord, "invalid_council_district"):
                    clean_record({**ROW, "council_district": value}, FETCHED_AT)

    def test_scope_and_issue_date(self):
        for key, value in [("status_current", "Final"), ("work_class", "Remodel"),
                           ("permittype", "EP"), ("permit_class", "R- 329 Res Structures Other Than Bldg"),
                           ("issue_date", "2024-12-31T00:00:00")]:
            with self.subTest(key=key):
                with self.assertRaisesRegex(RejectedRecord, "outside_selected_scope"):
                    clean_record({**ROW, key: value}, FETCHED_AT)
        with self.assertRaisesRegex(RejectedRecord, "invalid_issue_date"):
            clean_record({**ROW, "issue_date": "broken"}, FETCHED_AT)

    def test_invalid_record_shape(self):
        with self.assertRaisesRegex(RejectedRecord, "invalid_record"):
            clean_record([], FETCHED_AT)

    def test_source_query_escapes_literal(self):
        house = clean_record({**ROW, "permit_number": "PERMIT'ONE BP"}, FETCHED_AT)
        self.assertEqual(parse_qs(urlsplit(house["sourceUrl"]).query)["$where"],
                         ["permit_number='PERMIT''ONE BP'"])


class CollectionTests(unittest.TestCase):
    def test_pagination_exclusions_dedup_and_repeatability(self):
        class Client:
            def check_robots(self):
                return {"effectiveDelaySeconds": 2}

            def get(self, url):
                params = parse_qs(urlsplit(url).query)
                self_outer.assertEqual(params["$order"], ["issue_date DESC,permit_number ASC"])
                pages = [[ROW, {**ROW, "permit_number": "MISSING BP", "latitude": None}],
                         [ROW, {**ROW, "permit_number": "SECOND BP"}]]
                return json.dumps(pages[int(params["$offset"][0]) // 2]), FETCHED_AT

        self_outer = self
        houses, report = collect(Client(), target=2, page_size=2)
        again, _ = collect(Client(), target=2, page_size=2)
        self.assertEqual(houses, again)
        self.assertEqual(len(houses), 2)
        self.assertEqual(report["acquired"], 4)
        self.assertEqual(report["validUnique"], 2)
        self.assertEqual(report["excluded"], 2)
        self.assertEqual(report["exclusionReasons"], {"missing_coordinate": 1, "duplicate_permit_number": 1})
        self.assertEqual(report["imported"], 0)

    def test_counts_valid_rows_beyond_target(self):
        class Client:
            def check_robots(self):
                return {}

            def get(self, url):
                return json.dumps([ROW, {**ROW, "permit_number": "SECOND BP"}]), FETCHED_AT

        houses, report = collect(Client(), target=1, page_size=2)
        self.assertEqual(len(houses), 1)
        self.assertEqual(report["validNotSelected"], 1)

    def test_insufficient_data_is_not_published(self):
        class Client:
            def check_robots(self):
                return {}

            def get(self, url):
                return json.dumps([ROW]), FETCHED_AT

        with self.assertRaisesRegex(RuntimeError, "Previous output is preserved"):
            collect(Client(), target=2, page_size=2)

    def test_atomic_replace_does_not_append(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "houses.json"
            write_json(path, [ROW, ROW])
            write_json(path, [ROW])
            self.assertEqual(json.loads(path.read_text()), [ROW])
            self.assertEqual(list(Path(directory).iterdir()), [path])


class RequestRulesTests(unittest.TestCase):
    def test_robots_and_serial_minimum_delay(self):
        clock = FakeClock()
        starts = []

        def opener(request, timeout):
            starts.append(clock.now())
            self.assertEqual(timeout, 30)
            body = "User-agent: *\nCrawl-delay: 3\nDisallow: /api/odata/\n" if request.full_url.endswith("robots.txt") else "[]"
            return Response(request.full_url, body)

        client = PublicDataClient(opener=opener, clock=clock.now, sleeper=clock.sleep)
        policy = client.check_robots()
        client.get(ENDPOINT)
        client.get(ENDPOINT)
        self.assertEqual(policy["effectiveDelaySeconds"], 3)
        self.assertEqual(starts, [0, 3, 6])

    def test_forbidden_api_stops_after_robots(self):
        calls = []

        def opener(request, timeout):
            calls.append(request.full_url)
            return Response(request.full_url, "User-agent: *\nDisallow: /resource/\n")

        client = PublicDataClient(opener=opener)
        with self.assertRaisesRegex(RuntimeError, "forbids"):
            client.check_robots()
        self.assertEqual(calls, [BASE_URL + "/robots.txt"])

    def test_unrecognized_robots_fails_closed(self):
        client = PublicDataClient(opener=lambda request, timeout: Response(request.full_url, "<html>error</html>"))
        with self.assertRaisesRegex(RuntimeError, "Unrecognized robots"):
            client.check_robots()

    def test_429_honors_retry_after(self):
        clock = FakeClock()
        starts = []

        def opener(request, timeout):
            starts.append(clock.now())
            if len(starts) == 1:
                raise HTTPError(request.full_url, 429, "Rate limited", {"Retry-After": "5"}, None)
            return Response(request.full_url, "[]")

        client = PublicDataClient(opener=opener, clock=clock.now, sleeper=clock.sleep)
        self.assertEqual(client.get(ENDPOINT)[0], "[]")
        self.assertEqual(starts, [0, 5])

    def test_retry_budget_is_finite(self):
        clock = FakeClock()
        calls = []

        def opener(request, timeout):
            calls.append(request.full_url)
            raise HTTPError(request.full_url, 503, "Unavailable", {}, None)

        client = PublicDataClient(opener=opener, clock=clock.now, sleeper=clock.sleep)
        with self.assertRaises(HTTPError):
            client.get(ENDPOINT)
        self.assertEqual(len(calls), 4)

    def test_redirect_http_status_is_not_retried(self):
        calls = []

        def opener(request, timeout):
            calls.append(request.full_url)
            raise HTTPError(request.full_url, 302, "Redirect", {"Location": BASE_URL + "/login"}, None)

        with self.assertRaises(HTTPError):
            PublicDataClient(opener=opener).get(ENDPOINT)
        self.assertEqual(calls, [ENDPOINT])

    def test_redirect_is_not_followed_with_further_queries(self):
        client = PublicDataClient(opener=lambda request, timeout: Response(BASE_URL + "/login", ""))
        with self.assertRaisesRegex(RuntimeError, "Unexpected redirect"):
            client.get(ENDPOINT)


if __name__ == "__main__":
    unittest.main()
