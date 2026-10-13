-- H2 fixture only; actual V1 and production SQL are also exercised on isolated MySQL.
CREATE TABLE IF NOT EXISTS house (
    id BIGINT AUTO_INCREMENT PRIMARY KEY, permit_no VARCHAR(128) NOT NULL UNIQUE,
    address VARCHAR(512) NOT NULL, community VARCHAR(128) NOT NULL,
    lat DECIMAL(10,7), lng DECIMAL(10,7), stage VARCHAR(20) NOT NULL,
    cover_photo_id BIGINT, source_type VARCHAR(16) NOT NULL, source_url CLOB,
    source_fetched_at TIMESTAMP(6), created_at TIMESTAMP(6) NOT NULL,
    created_business_date DATE NOT NULL, created_by VARCHAR(128) NOT NULL,
    updated_at TIMESTAMP(6) NOT NULL
);
CREATE TABLE IF NOT EXISTS photo (
    id BIGINT AUTO_INCREMENT PRIMARY KEY, house_id BIGINT NOT NULL REFERENCES house(id),
    stage VARCHAR(20) NOT NULL, content_hash BINARY(32) NOT NULL,
    storage_key VARCHAR(255) NOT NULL UNIQUE, original_filename VARCHAR(255),
    content_type VARCHAR(32) NOT NULL, file_size BIGINT NOT NULL,
    taken_at TIMESTAMP(6) NOT NULL, taken_at_source VARCHAR(16) NOT NULL,
    business_date DATE NOT NULL, uploaded_at TIMESTAMP(6) NOT NULL, uploaded_by VARCHAR(128) NOT NULL,
    gps_lat DECIMAL(10,7), gps_lng DECIMAL(10,7), distance_m DOUBLE, location_status VARCHAR(16) NOT NULL,
    UNIQUE (house_id, content_hash), CHECK (file_size > 0 AND file_size <= 10000000),
    CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
    CHECK (taken_at_source = 'EXIF' OR (taken_at_source = 'UPLOAD' AND taken_at = uploaded_at))
);
DELETE FROM photo;
DELETE FROM house;
INSERT INTO house (id, permit_no, address, community, stage, source_type, created_at,
                   created_business_date, created_by, updated_at)
VALUES (1, 'PHOTO-HOUSE-1', 'Address', 'North', 'FOUNDATION', 'MANUAL', '2026-01-01 00:00:00',
        '2025-12-31', 'fixture', '2026-01-01 00:00:00'),
       (2, 'PHOTO-HOUSE-2', 'Address', 'South', 'LAND_CLEARING', 'MANUAL', '2026-01-01 00:00:00',
        '2025-12-31', 'fixture', '2026-01-01 00:00:00');
