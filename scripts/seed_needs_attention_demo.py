#!/usr/bin/env python3
"""Seed three isolated, historical Needs Attention houses in the local Demo DB.

Run from any directory: python3 scripts/seed_needs_attention_demo.py --apply
Without --apply this only checks the fixture and database. Existing houses are
never updated. The generated PNGs are intentionally simple Demo site photos.
"""

import argparse
import hashlib
from pathlib import Path
import struct
import subprocess
import sys
import uuid
import zlib


ROOT = Path(__file__).resolve().parents[1]
PHOTO_DIR = ROOT / "data/local/photos"
CREATED_AT = "2026-09-15 12:00:00.000000"  # UTC; Chicago business day is Sep 15.
SEED_USER = "demo-needs-attention"
DEMO_COMMUNITY = "Demo Community 2"
HOUSES = (
    ("DEMO003", "Demo Address 3", "LAND_CLEARING", "30.2831000", "-97.7035000", (20, 125, 89)),
    ("DEMO004", "Demo Address 4", "FOUNDATION", "30.2305000", "-97.7815000", (196, 143, 67)),
    ("DEMO005", "Demo Address 5", "FRAMING", "30.3405000", "-97.7000000", (72, 113, 170)),
)
# Keep the existing photo storage keys stable when the public Demo permits change.
PHOTO_SEED_IDS = {
    "DEMO003": "DEMO-ATTENTION-LAND-2026",
    "DEMO004": "DEMO-ATTENTION-FOUNDATION-2026",
    "DEMO005": "DEMO-ATTENTION-FRAMING-2026",
}
STAGES = ("LAND_CLEARING", "FOUNDATION", "FRAMING")
PHOTO_DATES = ("2026-09-16", "2026-09-18", "2026-09-20")
CHANGE_DATES = ("2026-09-17", "2026-09-19")


def sql_string(value):
    return "'" + value.replace("'", "''") + "'"


def mysql(sql):
    command = ["docker", "compose", "exec", "-T", "mysql", "sh", "-c",
               'MYSQL_PWD="$MYSQL_PASSWORD" exec mysql --protocol=TCP --host=127.0.0.1 '
               '--user="$MYSQL_USER" --database="$MYSQL_DATABASE" --batch --skip-column-names']
    result = subprocess.run(command, cwd=ROOT, input=sql, text=True, capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or "MySQL command failed")
    return result.stdout.rstrip("\n")


def snapshot(exclude_ids=()):
    where = "" if not exclude_ids else " WHERE id NOT IN (" + ",".join(map(str, exclude_ids)) + ")"
    photo_where = "" if not exclude_ids else " WHERE house_id NOT IN (" + ",".join(map(str, exclude_ids)) + ")"
    queries = (
        "SELECT * FROM house" + where + " ORDER BY id;",
        "SELECT id,house_id,stage,HEX(content_hash),storage_key,original_filename,content_type,file_size,taken_at,taken_at_source,business_date,uploaded_at,uploaded_by,gps_lat,gps_lng,distance_m,location_status FROM photo" + photo_where + " ORDER BY id;",
        "SELECT * FROM stage_history" + photo_where + " ORDER BY id;",
    )
    return hashlib.sha256("\n--table--\n".join(mysql(query) for query in queries).encode()).hexdigest()


def png_bytes(color):
    def chunk(kind, payload):
        return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload) & 0xffffffff)

    pixels = b"".join(b"\x00" + bytes(color) * 8 for _ in range(8))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 8, 8, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(pixels)) + chunk(b"IEND", b""))


def photo_fixture(permit, stage, color):
    key = str(uuid.uuid5(uuid.NAMESPACE_URL, f"construction-tracker/{PHOTO_SEED_IDS[permit]}/{stage}")) + ".png"
    data = png_bytes(color)
    return key, data, hashlib.sha256(data).hexdigest()


def fixtures():
    for permit, address, stage, lat, lng, color in HOUSES:
        for index, photo_stage in enumerate(STAGES[:STAGES.index(stage) + 1]):
            tint = tuple(min(255, value + index * 12) for value in color)
            yield permit, address, stage, lat, lng, photo_stage, PHOTO_DATES[index], photo_fixture(permit, photo_stage, tint)


def existing_rows():
    permits = ",".join(sql_string(row[0]) for row in HOUSES)
    output = mysql(f"SELECT id,permit_no,address,community,stage,lat,lng,created_at,created_business_date,created_by FROM house WHERE permit_no IN ({permits}) ORDER BY permit_no;")
    return [line.split("\t") for line in output.splitlines()] if output else []


def verify_existing(rows):
    if len(rows) != len(HOUSES):
        raise RuntimeError("Only some Demo permits exist; refusing to change a partial fixture")
    by_permit = {row[1]: row for row in rows}
    for permit, address, stage, lat, lng, color in HOUSES:
        row = by_permit.get(permit)
        if row is None or row[2:] != [address, DEMO_COMMUNITY, stage, lat, lng,
                                      CREATED_AT, "2026-09-15", SEED_USER]:
            raise RuntimeError(f"Existing Demo permit differs from fixture: {permit}")
        house_id = int(row[0])
        expected_photos = []
        expected_history = []
        for index, photo_stage in enumerate(STAGES[:STAGES.index(stage) + 1]):
            tint = tuple(min(255, value + index * 12) for value in color)
            key, _, digest = photo_fixture(permit, photo_stage, tint)
            date = PHOTO_DATES[index]
            expected_photos.append(f"{photo_stage}\t{digest.upper()}\t{key}\t{date}\t{date} 12:00:00.000000")
            if index < STAGES.index(stage):
                expected_history.append(f"{photo_stage}\t{STAGES[index + 1]}\t{CHANGE_DATES[index]} 12:00:00.000000")
        actual_photos = mysql(f"SELECT stage,HEX(content_hash),storage_key,business_date,uploaded_at FROM photo WHERE house_id={house_id} ORDER BY uploaded_at;").splitlines()
        actual_history = mysql(f"SELECT from_stage,to_stage,changed_at FROM stage_history WHERE house_id={house_id} ORDER BY changed_at;").splitlines()
        if actual_photos != expected_photos or actual_history != expected_history:
            raise RuntimeError(f"Incomplete Demo photos/history for {permit}")
    for *_, (key, content, _) in fixtures():
        path = PHOTO_DIR / key
        if path.is_symlink() or not path.is_file() or path.read_bytes() != content:
            raise RuntimeError(f"Demo photo file is missing or changed: {key}")


def seed_sql():
    statements = ["START TRANSACTION;"]
    for number, (permit, address, stage, lat, lng, color) in enumerate(HOUSES, 1):
        last_date = PHOTO_DATES[STAGES.index(stage)]
        statements.append(
            "INSERT INTO house (permit_no,address,community,lat,lng,stage,cover_photo_id,source_type,source_url,source_fetched_at,created_at,created_business_date,created_by,updated_at) VALUES "
            f"({sql_string(permit)},{sql_string(address)},{sql_string(DEMO_COMMUNITY)},{lat},{lng},{sql_string(stage)},NULL,'MANUAL',NULL,NULL,{sql_string(CREATED_AT)},'2026-09-15',{sql_string(SEED_USER)},'{last_date} 12:00:00.000000');"
        )
        statements.append(f"SET @demo_house_{number} = LAST_INSERT_ID();")
        for index, photo_stage in enumerate(STAGES[:STAGES.index(stage) + 1]):
            tint = tuple(min(255, value + index * 12) for value in color)
            key, data, digest = photo_fixture(permit, photo_stage, tint)
            date = PHOTO_DATES[index]
            statements.append(
                "INSERT INTO photo (house_id,stage,content_hash,storage_key,original_filename,content_type,file_size,taken_at,taken_at_source,business_date,uploaded_at,uploaded_by,gps_lat,gps_lng,distance_m,location_status) VALUES "
                f"(@demo_house_{number},{sql_string(photo_stage)},UNHEX('{digest}'),{sql_string(key)},'demo-attention.png','image/png',{len(data)},'{date} 12:00:00.000000','UPLOAD','{date}','{date} 12:00:00.000000',{sql_string(SEED_USER)},NULL,NULL,NULL,'UNKNOWN');"
            )
            if index < STAGES.index(stage):
                changed = CHANGE_DATES[index]
                statements.append(
                    "INSERT INTO stage_history (house_id,from_stage,to_stage,changed_by,changed_at) VALUES "
                    f"(@demo_house_{number},{sql_string(photo_stage)},{sql_string(STAGES[index + 1])},{sql_string(SEED_USER)},'{changed} 12:00:00.000000');"
                )
    statements.append("COMMIT;")
    return "\n".join(statements)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Insert the three Demo houses when absent")
    args = parser.parse_args()
    if not PHOTO_DIR.is_dir() or PHOTO_DIR.is_symlink():
        raise RuntimeError("Expected existing, non-symlink local photo directory")
    rows = existing_rows()
    if rows:
        verify_existing(rows)
        print("Fixture already present and complete; no writes performed.")
        return
    if not args.apply:
        print("Three Demo houses are absent. Run with --apply to insert them.")
        return
    before = snapshot()
    for *_, (key, content, _) in fixtures():
        path = PHOTO_DIR / key
        if path.exists():
            if path.read_bytes() != content:
                raise RuntimeError(f"Refusing to overwrite existing file: {key}")
        else:
            with path.open("xb") as output:
                output.write(content)
    mysql(seed_sql())
    rows = existing_rows()
    verify_existing(rows)
    ids = [int(row[0]) for row in rows]
    if snapshot(ids) != before:
        raise RuntimeError("Pre-existing house, photo, or stage data changed during seeding")
    for row in rows:
        print(f"{row[0]}\t{row[1]}\t{row[4]}\t{row[2]}")


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        sys.exit(f"Demo seed stopped: {error}")
