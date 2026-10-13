"""Importer tests use an in-memory HTTP substitute, never a database."""

from copy import deepcopy
import io
import json
from pathlib import Path
import tempfile
import unittest
from urllib.error import HTTPError

from scripts.import_austin_houses import HouseApiClient, import_records, load_records


ROW = {"permitNo": "2026-132169 BP", "address": "3303 THOUSAND OAKS CV, AUSTIN, TX, 78746",
       "community": "Austin Council District 8", "lat": 30.266891, "lng": -97.8067524,
       "sourceUrl": "https://data.austintexas.gov/resource/3syk-w9eu.json?permit=example",
       "sourceFetchedAt": "2026-10-13T01:59:41.528202Z"}


def house(row, identifier=1):
    return {**row, "id": identifier, "stage": "LAND_CLEARING", "sourceType": "PUBLIC_DATA",
            "createdAt": "2026-10-13T02:00:00Z", "createdBusinessDate": "2026-10-12",
            "coverPhotoUrl": None, "lastPhotoBusinessDate": None}


class FakeApi:
    base_url = "http://127.0.0.1:8081"

    def __init__(self, initial=()):
        self.houses = {r["permitNo"]: deepcopy(r) for r in initial}
        self.posts = []

    def request(self, method, payload=None):
        if method == "GET":
            return 200, deepcopy(list(self.houses.values()))
        self.posts.append(deepcopy(payload))
        if payload["permitNo"] in self.houses:
            return 200, deepcopy(self.houses[payload["permitNo"]])
        self.houses[payload["permitNo"]] = house(payload, len(self.houses) + 1)
        return 201, deepcopy(self.houses[payload["permitNo"]])


class ImportTests(unittest.TestCase):
    def test_first_and_second_import_preserve_all_fields_and_ids(self):
        rows = [ROW, {**ROW, "permitNo": "2026-129377 BP"}]
        client = FakeApi()
        first = import_records(client, rows)
        baseline = deepcopy(client.houses)
        second = import_records(client, rows)
        self.assertEqual((first["created"], first["existing"], first["failed"]), (2, 0, 0))
        self.assertEqual((second["created"], second["existing"], second["failed"]), (0, 2, 0))
        self.assertEqual(second["verification"]["totalBefore"], second["verification"]["totalAfter"])
        self.assertEqual(client.houses, baseline)
        self.assertTrue(first["passed"] and second["passed"])
        self.assertEqual(rows[0], ROW)
        self.assertEqual(client.posts, rows + rows)

    def test_existing_stage_and_unrelated_house_are_preserved(self):
        existing = {**house(ROW), "stage": "FRAMING"}
        unrelated = house({**ROW, "permitNo": "UNRELATED"}, 2)
        client = FakeApi([existing, unrelated])
        report = import_records(client, [ROW])
        self.assertTrue(report["passed"])
        self.assertEqual(report["existing"], 1)
        self.assertEqual(client.houses[ROW["permitNo"]], existing)
        self.assertEqual(client.houses["UNRELATED"], unrelated)

    def test_existing_conflict_is_reported_without_overwriting(self):
        existing = {**house(ROW), "address": "Original address"}
        client = FakeApi([existing])
        result = import_records(client, [ROW])
        self.assertFalse(result["passed"])
        self.assertEqual(result["failed"], 1)
        self.assertEqual(client.houses[ROW["permitNo"]], existing)

    def test_failure_stops_remaining_posts(self):
        class Unauthorized(FakeApi):
            def request(self, method, payload=None):
                if method == "POST":
                    self.posts.append(payload)
                    raise RuntimeError("HTTP 403")
                return super().request(method, payload)

        client = Unauthorized()
        result = import_records(client, [ROW, {**ROW, "permitNo": "SECOND"}])
        self.assertEqual(result["failed"], 1)
        self.assertEqual(result["unattempted"], 1)
        self.assertEqual(len(client.posts), 1)
        self.assertFalse(result["passed"])

    def test_query_detects_post_response_disagreement(self):
        class ChangedAfterPost(FakeApi):
            def request(self, method, payload=None):
                result = super().request(method, payload)
                if method == "POST":
                    self.houses[payload["permitNo"]]["address"] = "Changed"
                return result

        result = import_records(ChangedAfterPost(), [ROW])
        self.assertFalse(result["passed"])
        self.assertEqual(result["verification"]["matched"], 0)
        self.assertEqual(result["verification"]["postResponseDifferences"], [ROW["permitNo"]])


class InputTests(unittest.TestCase):
    def load(self, rows):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "houses.json"
            path.write_text(json.dumps(rows), encoding="utf-8")
            return load_records(path)

    def test_valid_input_is_not_transformed(self):
        self.assertEqual(self.load([ROW]), [ROW])

    def test_rejects_duplicates_and_extra_fields_before_requests(self):
        for rows in [[ROW, ROW], [{**ROW, "stage": "FRAMING"}], [], [{k: v for k, v in ROW.items() if k != "sourceUrl"}]]:
            with self.subTest(rows=rows):
                with self.assertRaises(ValueError):
                    self.load(rows)

    def test_rejects_bad_payload_values(self):
        for key, value in [("address", " "), ("permitNo", "x" * 129), ("community", " x "),
                           ("lat", 90.1), ("lng", -180.1), ("lat", 30.12345678),
                           ("lat", None), ("lat", True), ("sourceFetchedAt", "2026-01-01"),
                           ("sourceUrl", "https://user:pass@data.austintexas.gov/record")]:
            with self.subTest(key=key, value=value):
                with self.assertRaises(ValueError):
                    self.load([{**ROW, key: value}])


class HttpTests(unittest.TestCase):
    def test_headers_method_payload_and_utf8(self):
        captured = []

        class Response(io.BytesIO):
            status = 201

        def opener(request, timeout):
            captured.append(request)
            self.assertEqual(timeout, 30)
            return Response(json.dumps(house(ROW)).encode())

        client = HouseApiClient("http://127.0.0.1:8081/", " reviewer ", opener)
        self.assertEqual(client.request("POST", ROW)[0], 201)
        request = captured[0]
        self.assertEqual(request.get_method(), "POST")
        self.assertEqual(request.full_url, "http://127.0.0.1:8081/api/houses")
        self.assertEqual(request.get_header("X-role"), "ADMIN")
        self.assertEqual(request.get_header("X-user"), "reviewer")
        self.assertEqual(json.loads(request.data), ROW)

    def test_http_error_does_not_automatically_retry(self):
        calls = []

        def opener(request, timeout):
            calls.append(request)
            raise HTTPError(request.full_url, 401, "Unauthorized", {}, None)

        client = HouseApiClient("http://127.0.0.1:8081", opener=opener)
        with self.assertRaisesRegex(RuntimeError, "HTTP 401"):
            client.request("POST", ROW)
        self.assertEqual(len(calls), 1)

    def test_origin_and_header_injection_rejected(self):
        for url, username in [("file:///tmp/api", "user"), ("http://user:pass@localhost", "user"),
                              ("http://localhost/api", "user"), ("http://localhost", "user\r\nX-Role:ADMIN")]:
            with self.subTest(url=url, username=username):
                with self.assertRaises(ValueError):
                    HouseApiClient(url, username)


if __name__ == "__main__":
    unittest.main()
