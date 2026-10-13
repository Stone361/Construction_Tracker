package com.example.constructiontracker.database;

import com.example.constructiontracker.domain.ConstructionStage;
import com.example.constructiontracker.mapper.SummaryMapper;
import com.example.constructiontracker.service.SummaryService;
import org.apache.ibatis.builder.xml.XMLMapperBuilder;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.Configuration;
import org.apache.ibatis.session.SqlSession;
import org.apache.ibatis.session.SqlSessionFactoryBuilder;
import org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;

import java.io.InputStream;
import java.io.Reader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.time.Instant;
import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.Properties;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Real MySQL verification in a disposable, uniquely named database, never the application database. */
@EnabledIfSystemProperty(named = "mysql.integration", matches = "true")
class MySqlMigrationTests {
    private static final String DATABASE = "construction_tracker_test_" + UUID.randomUUID().toString().replace("-", "");
    private static String databaseUrl;
    private static String rootPassword;
    private static Connection admin;
    private static boolean databaseCreated;
    private static Flyway flyway;
    private Connection connection;
    private JdbcTemplate jdbc;
    private SqlSession session;
    private SummaryService summary;

    @BeforeAll
    static void migrateDisposableDatabase() throws Exception {
        Properties local = new Properties();
        if (Files.isRegularFile(Path.of(".env"))) {
            try (Reader reader = Files.newBufferedReader(Path.of(".env"), StandardCharsets.UTF_8)) {
                local.load(reader);
            }
        }
        rootPassword = System.getenv().getOrDefault("MYSQL_ROOT_PASSWORD", local.getProperty("MYSQL_ROOT_PASSWORD", ""));
        if (rootPassword.isBlank()) {
            throw new IllegalStateException("MySQL verification requires MYSQL_ROOT_PASSWORD in the environment or .env");
        }
        String address = System.getProperty("mysql.test.address", "127.0.0.1:3306");
        String options = "?connectionTimeZone=UTC&forceConnectionTimeZoneToSession=true";
        admin = DriverManager.getConnection("jdbc:mysql://" + address + "/" + options, "root", rootPassword);
        try (var statement = admin.createStatement()) {
            // Identifier is generated above, not taken from user input. No IF NOT EXISTS:
            // cleanup is allowed only when this run actually created the database.
            statement.execute("CREATE DATABASE " + DATABASE + " CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs");
            databaseCreated = true;
        }
        databaseUrl = "jdbc:mysql://" + address + "/" + DATABASE + options;
        flyway = Flyway.configure().dataSource(databaseUrl, "root", rootPassword)
                .locations("classpath:db/migration").cleanDisabled(true)
                .baselineOnMigrate(false).validateOnMigrate(true).load();
        assertThat(flyway.migrate().migrationsExecuted).isEqualTo(1);
    }

    @AfterAll
    static void removeOnlyDatabaseCreatedByThisRun() throws Exception {
        if (admin != null) {
            Connection adminConnection = admin;
            try (adminConnection; var statement = adminConnection.createStatement()) {
                if (databaseCreated) {
                    statement.execute("DROP DATABASE " + DATABASE);
                }
            }
        }
    }

    @BeforeEach
    void beginFixtureTransaction() throws Exception {
        connection = DriverManager.getConnection(databaseUrl, "root", rootPassword);
        connection.setAutoCommit(false);
        var source = new SingleConnectionDataSource(connection, true);
        jdbc = new JdbcTemplate(source);
        Configuration configuration = new Configuration(new Environment("mysql-verification", new JdbcTransactionFactory(), source));
        try (InputStream input = getClass().getResourceAsStream("/mapper/SummaryMapper.xml")) {
            new XMLMapperBuilder(input, configuration, "SummaryMapper.xml", configuration.getSqlFragments()).parse();
        }
        session = new SqlSessionFactoryBuilder().build(configuration).openSession(connection);
        // Historical fixtures are uncommitted on this shared connection; real Spring transaction isolation is verified separately.
        summary = new SummaryService(session.getMapper(SummaryMapper.class),
                Clock.fixed(Instant.parse("2026-01-20T18:00:00Z"), ZoneOffset.UTC));
    }

    @AfterEach
    void rollBackFixtures() throws Exception {
        try {
            if (connection != null && !connection.isClosed()) {
                connection.rollback();
            }
        } finally {
            if (session != null) session.close();
            if (connection != null && !connection.isClosed()) connection.close();
        }
    }

    @Test
    void migrationIsRepeatableWithoutChangingExistingRows() {
        long id = house("preserved", "2026-01-01 12:00:00", "2026-01-01", null, null);
        // Commit only in the disposable test database, so a separate Flyway connection can see it.
        jdbc.update("UPDATE house SET address = 'Preserved address' WHERE id = ?", id);
        session.commit(true);
        assertThat(flyway.migrate().migrationsExecuted).isZero();
        flyway.validate();
        assertThat(jdbc.queryForObject("SELECT address FROM house WHERE id = ?", String.class, id))
                .isEqualTo("Preserved address");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM flyway_schema_history WHERE version = '1' AND success = 1", Integer.class))
                .isEqualTo(1);
        assertThatThrownBy(flyway::clean).hasMessageContaining("cleanDisabled");
    }

    @Test
    void coordinatesCanBeMissingOnlyAsAPairAndPermitsAreUnique() {
        long id = house("coordinate-policy", "2026-01-01 12:00:00", "2026-01-01", null, null);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM house WHERE id = ? AND lat IS NULL AND lng IS NULL", Integer.class, id))
                .isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM house WHERE id = ? AND lat BETWEEN 20 AND 50 AND lng BETWEEN -130 AND -60", Integer.class, id))
                .isZero();
        checkViolation(() -> jdbc.update("UPDATE house SET lat = 30 WHERE id = ?", id), "ck_house_coordinates");
        checkViolation(() -> jdbc.update("UPDATE house SET lat = 91, lng = 0 WHERE id = ?", id), "ck_house_coordinates");
        assertThatThrownBy(() -> house("coordinate-policy", "2026-01-01 12:00:00", "2026-01-01", null, null))
                .isInstanceOf(DataIntegrityViolationException.class);
        checkViolation(() -> jdbc.update("UPDATE house SET source_type = 'PUBLIC_DATA' WHERE id = ?", id), "ck_house_source");
        jdbc.update("UPDATE house SET source_type = 'PUBLIC_DATA', source_url = 'https://example.org/permit/1', source_fetched_at = '2025-12-31 12:00:00' WHERE id = ?", id);
    }

    @Test
    void photosDeduplicatePerHouseAndCoverMustBelongToTheHouse() {
        long first = house("first", "2026-01-01 12:00:00", "2026-01-01", 30.0, -97.0);
        long second = house("second", "2026-01-01 12:00:00", "2026-01-01", null, null);
        long photo = photo(first, "same bytes", "2026-01-02 12:00:00", "2026-01-02", "2026-01-02 12:00:00", 10000000);
        assertThatThrownBy(() -> photo(first, "same bytes", "2026-01-03 12:00:00", "2026-01-03", "2026-01-03 12:00:00", 100))
                .isInstanceOf(DataIntegrityViolationException.class);
        photo(second, "same bytes", "2026-01-02 12:00:00", "2026-01-02", "2026-01-02 12:00:00", 100);
        jdbc.update("UPDATE house SET cover_photo_id = ? WHERE id = ?", photo, first);
        assertThatThrownBy(() -> jdbc.update("UPDATE house SET cover_photo_id = ? WHERE id = ?", photo, second))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("DELETE FROM photo WHERE id = ?", photo))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void photoByteLimitAndLocationBoundariesAreEnforced() {
        long house = house("boundaries", "2026-01-01 12:00:00", "2026-01-01", null, null);
        long photo = photo(house, "boundary", "2026-01-02 12:00:00", "2026-01-02", "2026-01-02 12:00:00", 10000000);
        checkViolation(() -> jdbc.update("UPDATE photo SET file_size = 10000001 WHERE id = ?", photo), "ck_photo_file_size");
        jdbc.update("UPDATE photo SET gps_lat = 30, gps_lng = -97 WHERE id = ?", photo);
        // House has no coordinates: GPS is retained with UNKNOWN and NULL distance.
        jdbc.update("UPDATE photo SET location_status = 'VERIFIED', distance_m = 200 WHERE id = ?", photo);
        checkViolation(() -> jdbc.update("UPDATE photo SET distance_m = 200.001 WHERE id = ?", photo), "ck_photo_location");
        jdbc.update("UPDATE photo SET location_status = 'SUSPECT', distance_m = 200.001 WHERE id = ?", photo);
        checkViolation(() -> jdbc.update("UPDATE photo SET distance_m = 200 WHERE id = ?", photo), "ck_photo_location");
        checkViolation(() -> jdbc.update("UPDATE photo SET content_type = 'image/gif' WHERE id = ?", photo), "ck_photo_content_type");
    }

    @Test
    void stageHistoryAllowsOnlyOneAdjacentTransitionAndRetainsPhotoStage() {
        long house = house("history", "2026-01-01 12:00:00", "2026-01-01", null, null);
        long photo = photo(house, "evidence", "2026-01-02 12:00:00", "2026-01-02", "2026-01-02 12:00:00", 100);
        history(house, "LAND_CLEARING", "FOUNDATION", "2026-01-03 12:00:00");
        assertThatThrownBy(() -> history(house, "LAND_CLEARING", "FOUNDATION", "2026-01-03 12:00:01"))
                .isInstanceOf(DataIntegrityViolationException.class);
        checkViolation(() -> history(house, "FOUNDATION", "MEP", "2026-01-04 12:00:00"), "ck_stage_history_transition");
        jdbc.update("UPDATE house SET stage = 'FOUNDATION' WHERE id = ?", house);
        assertThat(jdbc.queryForObject("SELECT stage FROM photo WHERE id = ?", String.class, photo)).isEqualTo("LAND_CLEARING");
    }

    @Test
    void historicalSummaryExcludesFutureCreationUploadAndTransitions() {
        long existing = house("past", "2026-01-01 12:00:00", "2026-01-01", null, null);
        long future = house("future", "2026-01-20 18:00:01", "2026-01-20", null, null);
        long fourteenDays = house("fourteen", "2026-01-06 12:00:00", "2026-01-06", null, null);
        long fifteenDays = house("fifteen", "2026-01-05 12:00:00", "2026-01-05", null, null);
        house("created-at-cutoff", "2026-01-20 18:00:00", "2026-01-20", null, null);
        long photoMaximum = house("photo-maximum", "2026-01-01 12:00:00", "2026-01-01", 30.0, -97.0);
        history(existing, "LAND_CLEARING", "FOUNDATION", "2026-01-10 12:00:00");
        history(existing, "FOUNDATION", "FRAMING", "2026-01-20 18:00:00");
        history(existing, "FRAMING", "MEP", "2026-01-20 18:00:01");
        jdbc.update("UPDATE house SET stage = 'MEP' WHERE id = ?", existing);
        photo(existing, "old", "2026-01-02 12:00:00", "2026-01-02", "2026-01-03 12:00:00", 100);
        photo(existing, "late-upload", "2026-01-19 12:00:00", "2026-01-19", "2026-01-21 12:00:00", 100);
        photo(existing, "future-exif", "2026-02-01 12:00:00", "2026-02-01", "2026-01-19 12:00:00", 100);
        long suspect = photo(photoMaximum, "fourteen-day-photo", "2026-01-06 12:00:00", "2026-01-06", "2026-01-07 12:00:00", 100);
        jdbc.update("UPDATE photo SET location_status='SUSPECT', gps_lat=30.002, gps_lng=-97, distance_m=201 WHERE id=?", suspect);
        photo(photoMaximum, "later-upload-older-photo", "2026-01-05 12:00:00", "2026-01-05", "2026-01-19 12:00:00", 100);
        var result = summary.summary("2026-01-20T18:00:00Z");
        assertThat(result.stageCounts()).hasSize(6);
        assertThat(result.stageCounts().get(ConstructionStage.FRAMING)).isEqualTo(1);
        assertThat(result.stageCounts().get(ConstructionStage.MEP)).isZero();
        assertThat(result.stageCounts().values().stream().mapToLong(Long::longValue).sum())
                .isEqualTo(jdbc.queryForObject("SELECT COUNT(*) FROM house WHERE created_at <= ?", Long.class,
                        LocalDateTime.parse("2026-01-20T18:00:00")));
        assertThat(result.staleHouseIds()).contains(existing, fifteenDays).doesNotContain(future, fourteenDays, photoMaximum);
        assertThat(result.staleHouseIds()).isSorted().doesNotHaveDuplicates();
        // Earlier snapshot must return FOUNDATION, rather than house.stage (MEP).
        result = summary.summary("2026-01-20T17:59:59Z");
        assertThat(result.stageCounts().get(ConstructionStage.FOUNDATION)).isEqualTo(1);
        assertThat(result.stageCounts().get(ConstructionStage.FRAMING)).isZero();
        // Exactly at upload time it becomes visible, using its earlier EXIF business day.
        photo(fourteenDays, "at-cutoff", "2026-01-20 12:00:00", "2026-01-20", "2026-01-21 12:00:00", 100);
        session.clearCache();
        result = summary.summary("2026-01-21T12:00:00Z");
        assertThat(result.staleHouseIds()).doesNotContain(existing, fourteenDays);
    }

    @Test
    void chicagoBusinessDayUsesLocalMidnightAndDaylightSaving() {
        long house = house("timezone", "2026-03-01 12:00:00", "2026-03-01", null, null);
        long winter = house("winter-timezone", "2026-01-01 12:00:00", "2026-01-01", null, null);
        assertThat(summary.summary("2026-03-16T04:59:59Z").staleHouseIds()).doesNotContain(house);
        assertThat(summary.summary("2026-03-16T05:00:00Z").staleHouseIds()).contains(house);
        assertThat(summary.summary("2026-01-16T05:59:59Z").staleHouseIds()).doesNotContain(winter);
        assertThat(summary.summary("2026-01-16T06:00:00Z").staleHouseIds()).contains(winter);
    }

    @Test
    void emptyHistoricalSnapshotHasSixZeroStagesAndNoStaleIds() {
        var result = summary.summary("2020-01-01T12:00:00Z");
        assertThat(result.stageCounts()).hasSize(6);
        assertThat(result.stageCounts().values()).containsOnly(0L);
        assertThat(result.staleHouseIds()).isEmpty();
    }

    private long house(String permit, String created, String day, Double lat, Double lng) {
        jdbc.update("""
                INSERT INTO house (permit_no, address, community, lat, lng, created_at, created_business_date, created_by, updated_at)
                VALUES (?, 'Test address', 'Test community', ?, ?, ?, ?, 'test-admin', ?)
                """, permit, lat, lng, created, day, created);
        return jdbc.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
    }

    private long photo(long house, String content, String taken, String day, String uploaded, long bytes) {
        jdbc.update("""
                INSERT INTO photo (house_id, stage, content_hash, storage_key, content_type, file_size,
                    taken_at, taken_at_source, business_date, uploaded_at, uploaded_by, location_status)
                VALUES (?, 'LAND_CLEARING', UNHEX(SHA2(?, 256)), ?, 'image/jpeg', ?, ?, 'EXIF', ?, ?, 'test-uploader', 'UNKNOWN')
                """, house, content, UUID.randomUUID() + ".jpg", bytes, taken, day, uploaded);
        return jdbc.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
    }

    private void history(long house, String from, String to, String changed) {
        jdbc.update("INSERT INTO stage_history (house_id, from_stage, to_stage, changed_by, changed_at) VALUES (?, ?, ?, 'test-manager', ?)",
                house, from, to, changed);
    }

    private void checkViolation(Runnable statement, String constraint) {
        // MySQL CHECK uses HY000 / 3819; Spring does not translate it to
        // DataIntegrityViolationException. Verify the actual vendor error.
        assertThatThrownBy(statement::run).rootCause().isInstanceOfSatisfying(SQLException.class, error -> {
            assertThat(error.getErrorCode()).isEqualTo(3819);
            assertThat(error.getMessage()).contains(constraint);
        });
    }
}
