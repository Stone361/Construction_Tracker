-- MySQL 8.4 / InnoDB. Only Flyway runs this migration; never recreate data volumes.
-- All DATETIME(6) values are UTC by application convention. Business dates use
-- America/Chicago in Java, including daylight-saving transitions.
CREATE TABLE house (
    id BIGINT NOT NULL AUTO_INCREMENT,
    permit_no VARCHAR(128) NOT NULL,
    address VARCHAR(512) NOT NULL,
    community VARCHAR(128) NOT NULL,
    lat DECIMAL(10,7) NULL,
    lng DECIMAL(10,7) NULL,
    stage VARCHAR(20) NOT NULL DEFAULT 'LAND_CLEARING',
    cover_photo_id BIGINT NULL,
    source_type VARCHAR(16) NOT NULL DEFAULT 'MANUAL',
    source_url TEXT NULL,
    source_fetched_at DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL,
    created_business_date DATE NOT NULL,
    created_by VARCHAR(128) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    CONSTRAINT pk_house PRIMARY KEY (id),
    CONSTRAINT uk_house_permit_no UNIQUE (permit_no),
    KEY idx_house_cover (id, cover_photo_id),
    KEY idx_house_bounds (lat, lng),
    KEY idx_house_stage (stage),
    CONSTRAINT ck_house_permit_no CHECK (CHAR_LENGTH(TRIM(permit_no)) > 0),
    CONSTRAINT ck_house_address CHECK (CHAR_LENGTH(TRIM(address)) > 0),
    CONSTRAINT ck_house_community CHECK (CHAR_LENGTH(TRIM(community)) > 0),
    CONSTRAINT ck_house_coordinates CHECK (
        (lat IS NULL AND lng IS NULL) OR
        (lat IS NOT NULL AND lng IS NOT NULL AND lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180)
    ),
    CONSTRAINT ck_house_stage CHECK (stage IN (
        'LAND_CLEARING', 'FOUNDATION', 'FRAMING', 'MEP', 'INTERIOR', 'CO_READY'
    )),
    CONSTRAINT ck_house_source CHECK (
        (source_type = 'MANUAL' AND source_url IS NULL AND source_fetched_at IS NULL) OR
        (source_type = 'PUBLIC_DATA' AND source_url IS NOT NULL
            AND CHAR_LENGTH(TRIM(source_url)) > 0 AND source_fetched_at IS NOT NULL)
    ),
    CONSTRAINT ck_house_created_by CHECK (CHAR_LENGTH(TRIM(created_by)) > 0),
    CONSTRAINT ck_house_updated_at CHECK (updated_at >= created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE photo (
    id BIGINT NOT NULL AUTO_INCREMENT,
    house_id BIGINT NOT NULL,
    stage VARCHAR(20) NOT NULL,
    content_hash BINARY(32) NOT NULL,
    storage_key VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    original_filename VARCHAR(255) NULL,
    content_type VARCHAR(32) NOT NULL,
    file_size BIGINT NOT NULL,
    taken_at DATETIME(6) NOT NULL,
    taken_at_source VARCHAR(16) NOT NULL,
    business_date DATE NOT NULL,
    uploaded_at DATETIME(6) NOT NULL,
    uploaded_by VARCHAR(128) NOT NULL,
    gps_lat DECIMAL(10,7) NULL,
    gps_lng DECIMAL(10,7) NULL,
    distance_m DOUBLE NULL,
    location_status VARCHAR(16) NOT NULL,
    CONSTRAINT pk_photo PRIMARY KEY (id),
    CONSTRAINT uk_photo_house_hash UNIQUE (house_id, content_hash),
    CONSTRAINT uk_photo_storage_key UNIQUE (storage_key),
    CONSTRAINT uk_photo_house_id UNIQUE (house_id, id),
    KEY idx_photo_house_taken (house_id, taken_at, id),
    KEY idx_photo_house_stage_status (house_id, stage, location_status),
    KEY idx_photo_house_uploaded (house_id, uploaded_at, business_date),
    CONSTRAINT fk_photo_house FOREIGN KEY (house_id) REFERENCES house (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_photo_stage CHECK (stage IN (
        'LAND_CLEARING', 'FOUNDATION', 'FRAMING', 'MEP', 'INTERIOR', 'CO_READY'
    )),
    CONSTRAINT ck_photo_storage_key CHECK (CHAR_LENGTH(TRIM(storage_key)) > 0),
    CONSTRAINT ck_photo_content_type CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
    -- Exact byte limit: 10 decimal MB, inclusive. The assignment does not specify MiB.
    CONSTRAINT ck_photo_file_size CHECK (file_size > 0 AND file_size <= 10000000),
    CONSTRAINT ck_photo_taken_at_source CHECK (
        taken_at_source = 'EXIF' OR (taken_at_source = 'UPLOAD' AND taken_at = uploaded_at)
    ),
    CONSTRAINT ck_photo_uploaded_by CHECK (CHAR_LENGTH(TRIM(uploaded_by)) > 0),
    CONSTRAINT ck_photo_gps CHECK (
        (gps_lat IS NULL AND gps_lng IS NULL) OR
        (gps_lat IS NOT NULL AND gps_lng IS NOT NULL
            AND gps_lat BETWEEN -90 AND 90 AND gps_lng BETWEEN -180 AND 180)
    ),
    -- GPS may exist while the house coordinates are unknown: retain GPS but use
    -- UNKNOWN with no distance. Cross-table facts are checked in the service.
    CONSTRAINT ck_photo_location CHECK (
        (location_status = 'UNKNOWN' AND distance_m IS NULL) OR
        (location_status = 'VERIFIED' AND gps_lat IS NOT NULL AND gps_lng IS NOT NULL
            AND distance_m IS NOT NULL AND distance_m >= 0 AND distance_m <= 200) OR
        (location_status = 'SUSPECT' AND gps_lat IS NOT NULL AND gps_lng IS NOT NULL
            AND distance_m IS NOT NULL AND distance_m > 200)
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE stage_history (
    id BIGINT NOT NULL AUTO_INCREMENT,
    house_id BIGINT NOT NULL,
    from_stage VARCHAR(20) NOT NULL,
    to_stage VARCHAR(20) NOT NULL,
    changed_by VARCHAR(128) NOT NULL,
    changed_at DATETIME(6) NOT NULL,
    CONSTRAINT pk_stage_history PRIMARY KEY (id),
    CONSTRAINT uk_stage_history_house_from UNIQUE (house_id, from_stage),
    KEY idx_stage_history_house_time (house_id, changed_at, id),
    CONSTRAINT fk_stage_history_house FOREIGN KEY (house_id) REFERENCES house (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_stage_history_transition CHECK (
        (from_stage = 'LAND_CLEARING' AND to_stage = 'FOUNDATION') OR
        (from_stage = 'FOUNDATION' AND to_stage = 'FRAMING') OR
        (from_stage = 'FRAMING' AND to_stage = 'MEP') OR
        (from_stage = 'MEP' AND to_stage = 'INTERIOR') OR
        (from_stage = 'INTERIOR' AND to_stage = 'CO_READY')
    ),
    CONSTRAINT ck_stage_history_changed_by CHECK (CHAR_LENGTH(TRIM(changed_by)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

-- Composite FK enforces both photo existence and ownership. Nullable cover is
-- intentional. Do not use SET NULL: it would also target the house primary key.
ALTER TABLE house ADD CONSTRAINT fk_house_cover
    FOREIGN KEY (id, cover_photo_id) REFERENCES photo (house_id, id)
    ON DELETE RESTRICT ON UPDATE RESTRICT;
