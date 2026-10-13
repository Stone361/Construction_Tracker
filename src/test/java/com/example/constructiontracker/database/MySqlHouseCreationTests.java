package com.example.constructiontracker.database;

import com.example.constructiontracker.domain.House;
import com.example.constructiontracker.domain.PhotoMetadata;
import com.example.constructiontracker.domain.ConstructionStage;
import com.example.constructiontracker.domain.HouseSourceType;
import com.example.constructiontracker.domain.UserIdentity;
import com.example.constructiontracker.domain.UserRole;
import com.example.constructiontracker.dto.CreateHouseRequest;
import com.example.constructiontracker.dto.HouseListQuery;
import com.example.constructiontracker.dto.PhotoResponse;
import com.example.constructiontracker.exception.BusinessException;
import org.springframework.http.HttpStatus;
import com.example.constructiontracker.mapper.HouseMapper;
import com.example.constructiontracker.service.AuthorizationService;
import com.example.constructiontracker.service.HouseService;
import org.apache.ibatis.builder.xml.XMLMapperBuilder;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.Configuration;
import org.apache.ibatis.session.SqlSessionFactoryBuilder;
import org.apache.ibatis.executor.Executor;
import org.apache.ibatis.mapping.MappedStatement;
import org.apache.ibatis.plugin.Interceptor;
import org.apache.ibatis.plugin.Intercepts;
import org.apache.ibatis.plugin.Invocation;
import org.apache.ibatis.plugin.Signature;
import org.apache.ibatis.session.ResultHandler;
import org.apache.ibatis.session.RowBounds;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.mybatis.spring.SqlSessionTemplate;
import org.mybatis.spring.transaction.SpringManagedTransactionFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import java.io.Reader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.Properties;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 与现有 MySQL 验证一致：仅在本次新建的随机测试库执行 V1，绝不连接正式库写数据。 */
@EnabledIfSystemProperty(named = "mysql.integration", matches = "true")
class MySqlHouseCreationTests {
    private static final String DATABASE = "construction_tracker_test_" + UUID.randomUUID().toString().replace("-", "");
    private static final UserIdentity ADMIN = new UserIdentity("mysql-test-admin", UserRole.ADMIN, null);
    private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-07-01T04:59:59.123456789Z"), ZoneOffset.UTC);
    private static Connection admin;
    private static boolean databaseCreated;
    private static HouseMapper mapper;
    private static JdbcTemplate jdbc;
    private static HouseService service;
    private static final QueryCounter QUERY_COUNTER = new QueryCounter();

    @BeforeAll
    static void createIsolatedDatabase() throws Exception {
        Properties local = new Properties();
        if (Files.isRegularFile(Path.of(".env"))) {
            try (Reader reader = Files.newBufferedReader(Path.of(".env"), StandardCharsets.UTF_8)) {
                local.load(reader);
            }
        }
        String password = System.getenv().getOrDefault("MYSQL_ROOT_PASSWORD", local.getProperty("MYSQL_ROOT_PASSWORD", ""));
        if (password.isBlank()) throw new IllegalStateException("MySQL verification requires MYSQL_ROOT_PASSWORD");
        String base = "jdbc:mysql://" + System.getProperty("mysql.test.address", "127.0.0.1:3306") + "/";
        String options = "?connectionTimeZone=UTC&forceConnectionTimeZoneToSession=true";
        admin = DriverManager.getConnection(base + options, "root", password);
        try (var statement = admin.createStatement()) {
            statement.execute("CREATE DATABASE " + DATABASE + " CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs");
            databaseCreated = true;
        }
        String url = base + DATABASE + options;
        assertThat(Flyway.configure().dataSource(url, "root", password).locations("classpath:db/migration")
                .cleanDisabled(true).baselineOnMigrate(false).load().migrate().migrationsExecuted).isEqualTo(1);
        var source = new DriverManagerDataSource(url, "root", password);
        jdbc = new JdbcTemplate(source);
        var configuration = new Configuration(new Environment("house-mysql-test", new SpringManagedTransactionFactory(), source));
        configuration.addInterceptor(QUERY_COUNTER);
        try (var input = MySqlHouseCreationTests.class.getResourceAsStream("/mapper/HouseMapper.xml")) {
            new XMLMapperBuilder(input, configuration, "HouseMapper.xml", configuration.getSqlFragments()).parse();
        }
        mapper = new SqlSessionTemplate(new SqlSessionFactoryBuilder().build(configuration)).getMapper(HouseMapper.class);
        service = new HouseService(mapper, new AuthorizationService(), CLOCK);
    }

    @AfterAll
    static void removeOnlyOwnedTestDatabase() throws Exception {
        if (admin != null) {
            try (Connection connection = admin; var statement = connection.createStatement()) {
                if (databaseCreated) statement.execute("DROP DATABASE " + DATABASE);
            }
        }
    }

    @Test
    void createsUtcAndChicagoDatesAndPreservesDuplicateRecord() {
        var first = service.create(request("mysql-repeat", null, null), ADMIN);
        var second = service.create(new CreateHouseRequest(" mysql-repeat ", "Changed", "Changed",
                null, null, null, null), ADMIN);
        assertThat(first.created()).isTrue();
        assertThat(second.created()).isFalse();
        assertThat(second.house()).isEqualTo(first.house());
        assertThat(first.house().createdBusinessDate()).isEqualTo(LocalDate.of(2026, 6, 30));
        assertThat(first.house().createdAt().toInstant(ZoneOffset.UTC)).isEqualTo(Instant.parse("2026-07-01T04:59:59.123456Z"));
        assertThat(first.house().lat()).isNull();
    }

    @Test
    void retainsPublicSourceMetadata() {
        Instant fetched = Instant.parse("2026-06-30T10:00:00.123456Z");
        var saved = service.create(request("mysql-source", "https://example.org/permits/source", fetched), ADMIN).house();
        assertThat(saved.sourceType()).isEqualTo(HouseSourceType.PUBLIC_DATA);
        assertThat(saved.sourceFetchedAt().toInstant(ZoneOffset.UTC)).isEqualTo(fetched);
        assertThat(saved.sourceUrl()).isEqualTo("https://example.org/permits/source");
        var detail = service.detail(saved.id());
        assertThat(detail.sourceUrl()).isEqualTo(saved.sourceUrl());
        assertThat(detail.sourceFetchedAt()).isEqualTo(fetched);
    }

    @Test
    void simultaneousMissingPermitReadsResolveUniqueConflictWithoutOverwrite() throws Exception {
        var barrier = new CyclicBarrier(2);
        var reads = new AtomicInteger();
        HouseMapper racingMapper = new HouseMapper() {
            @Override
            public House findByPermitNo(String permit) {
                House found = mapper.findByPermitNo(permit);
                if (reads.incrementAndGet() <= 2) {
                    try { barrier.await(10, TimeUnit.SECONDS); }
                    catch (Exception ex) { throw new IllegalStateException(ex); }
                    assertThat(found).isNull();
                }
                return found;
            }

            @Override
            public int insert(House house) { return mapper.insert(house); }

            @Override
            public List<House> findAll(HouseListQuery query) { return mapper.findAll(query); }

            @Override
            public House findById(Long id) { return mapper.findById(id); }

            @Override
            public List<PhotoMetadata> findPhotosByHouseId(Long houseId) { return mapper.findPhotosByHouseId(houseId); }
        };
        var racingService = new HouseService(racingMapper, new AuthorizationService(), CLOCK);
        try (var executor = Executors.newFixedThreadPool(2)) {
            var first = executor.submit(() -> racingService.create(request("mysql-race", null, null), ADMIN));
            var second = executor.submit(() -> racingService.create(request("mysql-race", null, null), ADMIN));
            var left = first.get(20, TimeUnit.SECONDS);
            var right = second.get(20, TimeUnit.SECONDS);
            assertThat(left.created()).isNotEqualTo(right.created());
            assertThat(left.house()).isEqualTo(right.house());
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM house WHERE permit_no = ?", Integer.class, "mysql-race")).isEqualTo(1);
        }
    }

    @Test
    void listsAllCommunitiesIncludingNullCoordinatesInOneOrderedQuery() {
        House first = service.create(new CreateHouseRequest("mysql-list-all-first", "Address", "North Austin",
                null, null, null, null), ADMIN).house();
        House second = service.create(new CreateHouseRequest("mysql-list-all-second", "Address", "South Austin",
                new BigDecimal("30"), new BigDecimal("-97"), null, null), ADMIN).house();
        int before = QUERY_COUNTER.count.get();
        List<House> rows = service.list(HouseListQuery.parse(null, null));
        assertThat(QUERY_COUNTER.count.get() - before).isEqualTo(1);
        assertThat(rows).contains(first, second);
        assertThat(rows.stream().map(House::id).toList())
                .isEqualTo(jdbc.queryForList("SELECT id FROM house ORDER BY id ASC", Long.class));
    }

    @Test
    void mysqlFiltersBboxStageCombinationBoundariesAndNoMatches() {
        House inside = listFixture("mysql-list-inside", "30", "-97", ConstructionStage.LAND_CLEARING);
        House boundary = listFixture("mysql-list-boundary", "31", "-96", ConstructionStage.FRAMING);
        House outside = listFixture("mysql-list-outside", "33", "-93", ConstructionStage.FRAMING);
        House noCoordinates = listFixture("mysql-list-no-coordinates", null, null, ConstructionStage.FRAMING);
        House southwest = listFixture("mysql-list-southwest", "29", "-98", ConstructionStage.LAND_CLEARING);

        // Creation tests may add other LAND_CLEARING rows; assertions on bounded/FRAMING queries are exact.
        assertThat(service.list(HouseListQuery.parse("-98,29,-96,31", null)))
                .extracting(House::id).contains(inside.id(), boundary.id(), southwest.id())
                .doesNotContain(outside.id(), noCoordinates.id());
        assertThat(service.list(HouseListQuery.parse(null, "FRAMING")))
                .extracting(House::id).containsExactly(boundary.id(), outside.id(), noCoordinates.id());
        assertThat(service.list(HouseListQuery.parse("-98,29,-96,31", "FRAMING")))
                .extracting(House::id).containsExactly(boundary.id());
        assertThat(service.list(HouseListQuery.parse(null, null, "29", "31", "-98", "-96")))
                .isEqualTo(service.list(HouseListQuery.parse("-98,29,-96,31", null)));
        assertThat(service.list(HouseListQuery.parse(null, "FRAMING", "29", "31", "-98", "-96")))
                .extracting(House::id).containsExactly(boundary.id());
        assertThat(service.list(HouseListQuery.parse(null, "FRAMING", "32", null, null, null)))
                .extracting(House::id).containsExactly(outside.id());
        assertThat(service.list(HouseListQuery.parse("-96,31,-96,31", null)))
                .extracting(House::id).containsExactly(boundary.id());
        assertThat(service.list(HouseListQuery.parse("-180,-90,180,90", null)))
                .extracting(House::id).contains(inside.id(), boundary.id(), outside.id(), southwest.id())
                .doesNotContain(noCoordinates.id());
        assertThat(service.list(HouseListQuery.parse("100,60,101,61", null))).isEmpty();
        assertThat(service.list(HouseListQuery.parse(null, "CO_READY"))).isEmpty();
    }

    private House listFixture(String permit, String lat, String lng, ConstructionStage stage) {
        House house = service.create(new CreateHouseRequest(permit, "Address", "North Austin",
                lat == null ? null : new BigDecimal(lat), lng == null ? null : new BigDecimal(lng), null, null), ADMIN).house();
        // Only an isolated test fixture is advanced; no stage-advance business API is implemented.
        jdbc.update("UPDATE house SET stage = ? WHERE id = ?", stage.name(), house.id());
        return mapper.findByPermitNo(permit);
    }

    @Test
    void detailsWithNoPhotosAndMissingHousesUseBoundedQueries() {
        House house = service.create(request("mysql-detail-empty", null, null), ADMIN).house();
        int before = QUERY_COUNTER.count.get();
        var detail = service.detail(house.id());
        assertThat(QUERY_COUNTER.count.get() - before).isEqualTo(2);
        assertThat(detail.photos()).isEmpty();
        assertThat(detail.id()).isEqualTo(house.id());
        assertThat(detail.lat()).isNull();
        before = QUERY_COUNTER.count.get();
        assertThatThrownBy(() -> service.detail(Long.MAX_VALUE)).isInstanceOfSatisfying(BusinessException.class,
                error -> assertThat(error.getStatus()).isEqualTo(HttpStatus.NOT_FOUND));
        assertThat(QUERY_COUNTER.count.get() - before).isEqualTo(1);
    }

    @Test
    void detailFiltersPhotoOwnershipSortsTakenTimeAndMapsMetadataInTwoQueries() {
        House target = service.create(new CreateHouseRequest("mysql-detail-target", "Detail address", "North Austin",
                new BigDecimal("30"), new BigDecimal("-97"), null, null), ADMIN).house();
        House other = service.create(request("mysql-detail-other", null, null), ADMIN).house();
        long newer = detailPhoto(target.id(), "2026-07-02T05:00:00Z", "2026-07-02", false);
        long older = detailPhoto(target.id(), "2026-07-02T04:59:59.123456Z", "2026-07-01", false);
        long sameTime = detailPhoto(target.id(), "2026-07-02T04:59:59.123456Z", "2026-07-01", true);
        long unrelated = detailPhoto(other.id(), "2026-07-01T05:00:00Z", "2026-07-01", false);
        // Existing cover metadata is a fixture only; no cover business endpoint is implemented.
        jdbc.update("UPDATE house SET cover_photo_id = ?, updated_at = ? WHERE id = ?", older,
                LocalDateTime.parse("2026-07-03T12:00:00"), target.id());
        int before = QUERY_COUNTER.count.get();
        var detail = service.detail(target.id());
        assertThat(QUERY_COUNTER.count.get() - before).isEqualTo(2);
        assertThat(detail.coverPhotoId()).isEqualTo(older);
        assertThat(detail.updatedAt()).isEqualTo(Instant.parse("2026-07-03T12:00:00Z"));
        assertThat(detail.createdBy()).isEqualTo(ADMIN.username());
        assertThat(detail.photos()).extracting(PhotoResponse::id).containsExactly(older, sameTime, newer)
                .doesNotContain(unrelated);
        assertThat(detail.photos()).allSatisfy(photo -> {
            assertThat(photo.houseId()).isEqualTo(target.id());
            assertThat(photo.uploadedAt()).isEqualTo(Instant.parse("2026-07-03T12:00:00Z"));
            assertThat(photo.fileSize()).isEqualTo(100L);
        });
        assertThat(detail.photos().getFirst().takenAt()).isEqualTo(Instant.parse("2026-07-02T04:59:59.123456Z"));
        assertThat(detail.photos().getFirst().businessDate()).isEqualTo(LocalDate.of(2026, 7, 1));
        PhotoResponse located = detail.photos().get(1);
        assertThat(located.locationStatus()).isEqualTo("VERIFIED");
        assertThat(located.gpsLat()).isEqualByComparingTo("30.001");
        assertThat(located.gpsLng()).isEqualByComparingTo("-97");
        assertThat(located.distanceM()).isEqualTo(200.0);
    }

    private long detailPhoto(long houseId, String taken, String businessDate, boolean located) {
        String key = UUID.randomUUID() + ".jpg";
        jdbc.update("""
                INSERT INTO photo (house_id, stage, content_hash, storage_key, original_filename,
                    content_type, file_size, taken_at, taken_at_source, business_date, uploaded_at,
                    uploaded_by, gps_lat, gps_lng, distance_m, location_status)
                VALUES (?, 'LAND_CLEARING', UNHEX(SHA2(?, 256)), ?, 'original.jpg', 'image/jpeg', 100,
                    ?, 'EXIF', ?, ?, 'test-uploader', ?, ?, ?, ?)
                """, houseId, key, key, LocalDateTime.ofInstant(Instant.parse(taken), ZoneOffset.UTC),
                LocalDate.parse(businessDate), LocalDateTime.parse("2026-07-03T12:00:00"),
                located ? new BigDecimal("30.001") : null, located ? new BigDecimal("-97") : null,
                located ? 200.0 : null, located ? "VERIFIED" : "UNKNOWN");
        return jdbc.queryForObject("SELECT id FROM photo WHERE storage_key = ?", Long.class, key);
    }

    @Intercepts(@Signature(type = Executor.class, method = "query",
            args = {MappedStatement.class, Object.class, RowBounds.class, ResultHandler.class}))
    private static class QueryCounter implements Interceptor {
        private final AtomicInteger count = new AtomicInteger();

        @Override
        public Object intercept(Invocation invocation) throws Throwable {
            count.incrementAndGet();
            return invocation.proceed();
        }
    }

    private static CreateHouseRequest request(String permit, String url, Instant fetched) {
        return new CreateHouseRequest(permit, "Test address", "North Austin", null, null, url, fetched);
    }
}
