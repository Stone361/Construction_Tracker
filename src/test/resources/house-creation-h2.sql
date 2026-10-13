-- H2 fixture only: exercises production MyBatis XML, not a substitute for MySQL V1 verification.
CREATE TABLE IF NOT EXISTS house (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    permit_no VARCHAR(128) NOT NULL UNIQUE,
    address VARCHAR(512) NOT NULL,
    community VARCHAR(128) NOT NULL,
    lat DECIMAL(10,7), lng DECIMAL(10,7),
    stage VARCHAR(20) NOT NULL,
    cover_photo_id BIGINT,
    source_type VARCHAR(16) NOT NULL,
    source_url CLOB,
    source_fetched_at TIMESTAMP(6),
    created_at TIMESTAMP(6) NOT NULL,
    created_business_date DATE NOT NULL,
    created_by VARCHAR(128) NOT NULL,
    updated_at TIMESTAMP(6) NOT NULL,
    CHECK ((lat IS NULL AND lng IS NULL) OR
           (lat IS NOT NULL AND lng IS NOT NULL AND lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180))
);
DELETE FROM house;
