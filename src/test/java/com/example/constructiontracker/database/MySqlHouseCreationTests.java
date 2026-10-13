package com.example.constructiontracker.database;

import com.example.constructiontracker.domain.House;
import com.example.constructiontracker.domain.HouseListRow;
import com.example.constructiontracker.domain.PhotoMetadata;
import com.example.constructiontracker.domain.ConstructionStage;
import com.example.constructiontracker.domain.HouseSourceType;
import com.example.constructiontracker.domain.UserIdentity;
import com.example.constructiontracker.domain.UserRole;
import com.example.constructiontracker.dto.CreateHouseRequest;
import com.example.constructiontracker.dto.HouseListQuery;
import com.example.constructiontracker.dto.PhotoResponse;
import com.example.constructiontracker.exception.BusinessException;
import com.example.constructiontracker.exception.GlobalExceptionHandler;
import com.example.constructiontracker.controller.PhotoController;
import com.example.constructiontracker.controller.HouseController;
import com.example.constructiontracker.auth.AuthenticationInterceptor;
import com.example.constructiontracker.auth.HeaderIdentityParser;
import com.example.constructiontracker.domain.PhotoFile;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpStatus;
import com.example.constructiontracker.mapper.HouseMapper;
import com.example.constructiontracker.service.AuthorizationService;
import com.example.constructiontracker.service.HouseService;
import com.example.constructiontracker.PhotoTestFiles;
import com.example.constructiontracker.mapper.PhotoMapper;
import com.example.constructiontracker.service.PhotoService;
import com.example.constructiontracker.service.PhotoExifParser;
import com.example.constructiontracker.service.LocalPhotoStorage;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.junit.jupiter.api.io.TempDir;
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
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.mybatis.spring.SqlSessionTemplate;
import org.mybatis.spring.transaction.SpringManagedTransactionFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.transaction.annotation.AnnotationTransactionAttributeSource;
import org.springframework.transaction.interceptor.TransactionInterceptor;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.http.MediaType;

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
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;
import java.util.HexFormat;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.any;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

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
    private static PhotoMapper photos;
    private static DataSourceTransactionManager transactionManager;
    @TempDir static Path photoDirectory;
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
        // Bound JDBC waits as well as barriers/futures; only this isolated test datasource is affected.
        var connectionProperties = new Properties();
        connectionProperties.setProperty("connectTimeout", "5000");
        connectionProperties.setProperty("socketTimeout", "15000");
        connectionProperties.setProperty("sessionVariables", "innodb_lock_wait_timeout=5");
        source.setConnectionProperties(connectionProperties);
        transactionManager = new DataSourceTransactionManager(source);
        jdbc = new JdbcTemplate(source);
        var configuration = new Configuration(new Environment("house-mysql-test", new SpringManagedTransactionFactory(), source));
        configuration.addInterceptor(QUERY_COUNTER);
        try (var input = MySqlHouseCreationTests.class.getResourceAsStream("/mapper/HouseMapper.xml")) {
            new XMLMapperBuilder(input, configuration, "HouseMapper.xml", configuration.getSqlFragments()).parse();
        }
        try (var input = MySqlHouseCreationTests.class.getResourceAsStream("/mapper/PhotoMapper.xml")) {
            new XMLMapperBuilder(input, configuration, "PhotoMapper.xml", configuration.getSqlFragments()).parse();
        }
        var session = new SqlSessionTemplate(new SqlSessionFactoryBuilder().build(configuration));
        mapper = session.getMapper(HouseMapper.class);
        photos = session.getMapper(PhotoMapper.class);
        service = new HouseService(mapper, photos, new AuthorizationService(), CLOCK);
    }

    @AfterAll
    static void removeOnlyOwnedTestDatabase() throws Exception {
        if (admin != null) {
            try (Connection connection = admin; var statement = connection.createStatement()) {
                if (databaseCreated) statement.execute("DROP DATABASE " + DATABASE);
            }
        }
    }

    @ParameterizedTest
    @ValueSource(ints = {2, 5})
    @Timeout(45)
    void concurrentIdenticalPhotosReturnOne201AndRemaining200(int requests) throws Exception {
        var house = service.create(request("mysql-photo-same-" + requests, null, null), ADMIN).house();
        Path directory = Files.createDirectory(photoDirectory.resolve("same-" + requests));
        byte[] content = PhotoTestFiles.withExif("png",
                PhotoTestFiles.exif("2026:06:30 12:00:00", "-05:00", "123456", null));
        var inputs = new ArrayList<byte[]>();
        for (int i = 0; i < requests; i++) inputs.add(content);
        var conflicts = new AtomicInteger();
        var responses = concurrentUploads(photoMvc(racingPhotos(requests, conflicts), directory), house.id(), inputs);
        assertThat(responses).extracting(MockHttpServletResponse::getStatus)
                .containsOnly(201, 200).filteredOn(status -> status == 201).hasSize(1);
        assertThat(conflicts.get()).isEqualTo(requests - 1); // Actual MySQL exceptions, not a simulated race.
        var json = new ObjectMapper();
        var original = json.readTree(responses.getFirst().getContentAsString());
        for (var response : responses) {
            assertThat(response.getContentType()).startsWith("application/json");
            assertThat(json.readTree(response.getContentAsString())).isEqualTo(original);
        }
        assertThat(jdbc.queryForObject("SELECT id FROM photo WHERE house_id=?", Long.class, house.id()))
                .isEqualTo(original.path("id").asLong());
        assertStoredFiles(house.id(), directory, List.of(content));
    }

    @Test
    @Timeout(45)
    void concurrentDifferentPhotosAllReturn201AndKeepTheirOwnBytes() throws Exception {
        var house = service.create(request("mysql-photo-different", null, null), ADMIN).house();
        Path directory = Files.createDirectory(photoDirectory.resolve("different"));
        var inputs = new ArrayList<byte[]>();
        String[] formats = {"jpeg", "png", "webp"};
        for (int i = 0; i < 5; i++) {
            inputs.add(PhotoTestFiles.withExif(formats[i % formats.length],
                    PhotoTestFiles.exif("2026:06:0" + (i + 1) + " 12:00:00", "-05:00", null, null)));
        }
        var conflicts = new AtomicInteger();
        var responses = concurrentUploads(photoMvc(racingPhotos(inputs.size(), conflicts), directory), house.id(), inputs);
        assertThat(responses).extracting(MockHttpServletResponse::getStatus).containsOnly(201);
        assertThat(conflicts.get()).isZero();
        var json = new ObjectMapper();
        var ids = new ArrayList<Long>();
        for (int i = 0; i < inputs.size(); i++) {
            long id = json.readTree(responses.get(i).getContentAsString()).path("id").asLong();
            ids.add(id);
            String key = jdbc.queryForObject("SELECT storage_key FROM photo WHERE id=? AND house_id=?", String.class, id, house.id());
            assertThat(Files.readAllBytes(directory.resolve(key))).isEqualTo(inputs.get(i));
        }
        assertThat(ids).doesNotHaveDuplicates();
        assertStoredFiles(house.id(), directory, inputs);
    }

    @ParameterizedTest
    @ValueSource(strings = {"CHECK", "STORAGE_KEY"})
    @Timeout(30)
    void nonPhotoDuplicateDatabaseErrorsRemain500AndPreserveExistingFiles(String failure) throws Exception {
        var house = service.create(request("mysql-photo-error-" + failure, null, null), ADMIN).house();
        Path directory = Files.createDirectory(photoDirectory.resolve("error-" + failure));
        byte[] original = PhotoTestFiles.image("png"), candidate = PhotoTestFiles.image("webp");
        var uploads = new PhotoService(mapper, photos, new AuthorizationService(),
                new LocalPhotoStorage(directory.toString()), CLOCK, new PhotoExifParser());
        var saved = uploads.upload(house.id(), new MockMultipartFile("file", "original.png", "image/png", original), ADMIN).photo();
        String originalKey = jdbc.queryForObject("SELECT storage_key FROM photo WHERE id=?", String.class, saved.id());
        var errorCode = new AtomicInteger();
        var reads = new AtomicInteger();
        PhotoMapper failing = new PhotoMapper() {
            public PhotoMetadata findByHash(Long id, byte[] hash) { reads.incrementAndGet(); return photos.findByHash(id, hash); }
            public PhotoFile findFile(Long id, Long photo) { return photos.findFile(id, photo); }
            public boolean hasEligiblePhoto(Long id, ConstructionStage stage) { return photos.hasEligiblePhoto(id, stage); }
            public int insert(PhotoMetadata p, byte[] hash, String key) {
                try {
                    if (failure.equals("STORAGE_KEY")) return photos.insert(p, hash, originalKey);
                    var invalid = new PhotoMetadata(p.id(), p.houseId(), p.stage(), p.locationStatus(),
                            p.takenAt(), p.takenAtSource(), p.businessDate(), p.uploadedAt(), p.uploadedBy(),
                            p.originalFilename(), p.contentType(), 0L, p.gpsLat(), p.gpsLng(), p.distanceM());
                    return photos.insert(invalid, hash, key);
                } catch (DataAccessException ex) {
                    var cause = org.springframework.core.NestedExceptionUtils.getMostSpecificCause(ex);
                    if (cause instanceof java.sql.SQLException sql) errorCode.set(sql.getErrorCode());
                    throw ex;
                }
            }
        };
        var response = photoMvc(failing, directory).perform(multipart("/api/houses/{id}/photos", house.id())
                .file(new MockMultipartFile("file", "candidate.webp", "image/webp", candidate))
                .header("X-User", ADMIN.username()).header("X-Role", "ADMIN")).andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(500);
        assertThat(new ObjectMapper().readTree(response.getContentAsString()).path("code").asText()).isEqualTo("INTERNAL_SERVER_ERROR");
        assertThat(errorCode.get()).isEqualTo(failure.equals("CHECK") ? 3819 : 1062);
        assertThat(reads.get()).isEqualTo(failure.equals("CHECK") ? 1 : 2);
        assertThat(photos.findByHash(house.id(), java.security.MessageDigest.getInstance("SHA-256").digest(original))).isEqualTo(saved);
        assertStoredFiles(house.id(), directory, List.of(original));
    }

    @ParameterizedTest
    @ValueSource(strings = {"ACK_RESOURCE", "ACK_RECOVERABLE", "READ_AFTER_INSERT"})
    @Timeout(30)
    void committedPhotoSurvivesInjectedInsertOrReadFailure(String failure) throws Exception {
        var house = service.create(request("mysql-photo-uncertain-" + failure, null, null), ADMIN).house();
        Path directory = Files.createDirectory(photoDirectory.resolve("uncertain-" + failure));
        byte[] content = PhotoTestFiles.withExif("png",
                PhotoTestFiles.exif("2026:06:30 12:00:00", "-05:00", "123456", null));
        var reads = new AtomicInteger();
        PhotoMapper uncertain = new PhotoMapper() {
            public PhotoMetadata findByHash(Long id, byte[] hash) {
                if (reads.incrementAndGet() == 2 && failure.equals("READ_AFTER_INSERT")) {
                    throw new org.springframework.dao.DataAccessResourceFailureException("injected post-insert read failure");
                }
                return photos.findByHash(id, hash);
            }
            public int insert(PhotoMetadata photo, byte[] hash, String key) {
                int inserted = photos.insert(photo, hash, key); // Real autocommit INSERT finishes first.
                if (failure.equals("ACK_RESOURCE")) {
                    throw new org.springframework.dao.DataAccessResourceFailureException("injected lost acknowledgement");
                }
                if (failure.equals("ACK_RECOVERABLE")) {
                    throw new org.springframework.dao.RecoverableDataAccessException("injected lost acknowledgement");
                }
                return inserted;
            }
            public PhotoFile findFile(Long id, Long photo) { return photos.findFile(id, photo); }
            public boolean hasEligiblePhoto(Long id, ConstructionStage stage) { return photos.hasEligiblePhoto(id, stage); }
        };
        var response = photoMvc(uncertain, directory).perform(multipart("/api/houses/{id}/photos", house.id())
                .file(new MockMultipartFile("file", "original.png", "image/png", content))
                .header("X-User", ADMIN.username()).header("X-Role", "ADMIN")).andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(500);
        assertThat(response.getContentAsString()).doesNotContain("injected").doesNotContain(directory.toString());
        byte[] hash = java.security.MessageDigest.getInstance("SHA-256").digest(content);
        var committed = photos.findByHash(house.id(), hash);
        assertThat(committed).isNotNull();
        assertStoredFiles(house.id(), directory, List.of(content));
        var retry = photoMvc(photos, directory).perform(multipart("/api/houses/{id}/photos", house.id())
                .file(new MockMultipartFile("file", "retry.png", "image/png", content))
                .header("X-User", ADMIN.username()).header("X-Role", "ADMIN")).andReturn().getResponse();
        assertThat(retry.getStatus()).isEqualTo(200);
        assertThat(new ObjectMapper().readTree(retry.getContentAsString()).path("id").asLong()).isEqualTo(committed.id());
        assertThat(photos.findByHash(house.id(), hash)).isEqualTo(committed);
        assertStoredFiles(house.id(), directory, List.of(content));
    }

    private static MockMvc photoMvc(PhotoMapper photoMapper, Path directory) {
        var uploads = new PhotoService(mapper, photoMapper, new AuthorizationService(),
                new LocalPhotoStorage(directory.toString()), CLOCK, new PhotoExifParser());
        return MockMvcBuilders.standaloneSetup(new PhotoController(uploads))
                .addInterceptors(new AuthenticationInterceptor(new HeaderIdentityParser()))
                .setControllerAdvice(new GlobalExceptionHandler()).build();
    }

    private static PhotoMapper racingPhotos(int requests, AtomicInteger conflicts) {
        var reads = new AtomicInteger();
        var queried = new CyclicBarrier(requests);
        var filesWritten = new CyclicBarrier(requests);
        return new PhotoMapper() {
            public PhotoMetadata findByHash(Long id, byte[] hash) {
                PhotoMetadata result = photos.findByHash(id, hash);
                if (reads.incrementAndGet() <= requests) {
                    assertThat(result).isNull();
                    await(queried); // All initial real SELECTs have finished before any caller continues.
                }
                return result;
            }
            public int insert(PhotoMetadata photo, byte[] hash, String key) {
                await(filesWritten); // Every candidate file is complete before inserts compete.
                try { return photos.insert(photo, hash, key); }
                catch (DuplicateKeyException ex) { conflicts.incrementAndGet(); throw ex; }
            }
            public PhotoFile findFile(Long id, Long photo) { return photos.findFile(id, photo); }
            public boolean hasEligiblePhoto(Long id, ConstructionStage stage) { return photos.hasEligiblePhoto(id, stage); }
        };
    }

    private static void await(CyclicBarrier barrier) {
        try { barrier.await(10, TimeUnit.SECONDS); }
        catch (Exception ex) { throw new IllegalStateException("Photo concurrency barrier failed", ex); }
    }

    private static List<MockHttpServletResponse> concurrentUploads(MockMvc mvc, Long house, List<byte[]> inputs) throws Exception {
        var executor = Executors.newFixedThreadPool(inputs.size());
        try {
            var pending = new ArrayList<Future<MockHttpServletResponse>>();
            for (byte[] input : inputs) {
                pending.add(executor.submit(() -> mvc.perform(multipart("/api/houses/{id}/photos", house)
                        .file(new MockMultipartFile("file", "concurrent.image", "application/octet-stream", input))
                        .header("X-User", ADMIN.username()).header("X-Role", "ADMIN")).andReturn().getResponse()));
            }
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(30);
            var results = new ArrayList<MockHttpServletResponse>();
            for (var future : pending) results.add(future.get(Math.max(1, deadline - System.nanoTime()), TimeUnit.NANOSECONDS));
            return results;
        } finally {
            executor.shutdownNow();
            assertThat(executor.awaitTermination(5, TimeUnit.SECONDS)).as("Upload workers stop within timeout").isTrue();
        }
    }

    private static void assertStoredFiles(Long house, Path directory, List<byte[]> expected) throws Exception {
        Map<String, byte[]> byHash = new HashMap<>();
        for (byte[] input : expected) byHash.put(HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(input)), input);
        var rows = jdbc.queryForList("SELECT storage_key, content_hash, file_size FROM photo WHERE house_id=?", house);
        assertThat(rows).hasSize(byHash.size());
        var keys = new ArrayList<String>();
        for (var row : rows) {
            String hash = HexFormat.of().formatHex((byte[]) row.get("content_hash"));
            assertThat(byHash).containsKey(hash);
            byte[] input = byHash.get(hash);
            String key = (String) row.get("storage_key"); keys.add(key);
            assertThat(Files.readAllBytes(directory.resolve(key))).isEqualTo(input);
            assertThat(((Number) row.get("file_size")).longValue()).isEqualTo(input.length);
        }
        assertThat(keys).doesNotHaveDuplicates();
        try (var files = Files.list(directory)) {
            assertThat(files.map(path -> path.getFileName().toString()).toList()).containsExactlyInAnyOrderElementsOf(keys);
        }
    }

    @Test
    void photoUploadUsesRealV1HashOwnershipAndTruthfulFallbacks() throws Exception {
        var house = service.create(request("mysql-photo-upload", null, null), ADMIN).house();
        byte[] bytes = PhotoTestFiles.image("webp");
        var storage = new LocalPhotoStorage(photoDirectory.toString());
        var uploads = new PhotoService(mapper, photos, new AuthorizationService(), storage, CLOCK, new PhotoExifParser());
        var file = new MockMultipartFile("file", "../../unsafe.exe", "text/plain", bytes);
        var first = uploads.upload(house.id(), file, ADMIN);
        var second = uploads.upload(house.id(), file, ADMIN);
        assertThat(first.created()).isTrue();
        assertThat(second.created()).isFalse();
        assertThat(second.photo()).isEqualTo(first.photo());
        assertThat(first.photo().contentType()).isEqualTo("image/webp");
        assertThat(first.photo().takenAtSource()).isEqualTo("UPLOAD");
        assertThat(first.photo().takenAt()).isEqualTo(first.photo().uploadedAt());
        assertThat(first.photo().businessDate()).isEqualTo(LocalDate.of(2026, 6, 30));
        assertThat(first.photo().locationStatus()).isEqualTo("UNKNOWN");
        assertThat(first.photo().gpsLat()).isNull();
        assertThat(first.photo().stage()).isEqualTo(house.stage());
        var stored = jdbc.queryForMap("SELECT storage_key, content_hash FROM photo WHERE id=?", first.photo().id());
        assertThat((byte[]) stored.get("content_hash")).isEqualTo(java.security.MessageDigest.getInstance("SHA-256").digest(bytes));
        assertThat(Files.readAllBytes(photoDirectory.resolve((String) stored.get("storage_key")))).isEqualTo(bytes);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM photo WHERE house_id=?", Integer.class, house.id())).isEqualTo(1);
        try (var stream = uploads.file(house.id(), first.photo().id()).resource().getInputStream()) {
            assertThat(stream.readAllBytes()).isEqualTo(bytes);
        }
        assertThatThrownBy(() -> uploads.file(house.id() + 10000, first.photo().id()))
                .isInstanceOfSatisfying(BusinessException.class, ex -> assertThat(ex.getStatus()).isEqualTo(HttpStatus.NOT_FOUND));
    }

    @Test
    void photoFailedInsertCompensatesNewFileWithoutTouchingCommittedFiles() throws Exception {
        var house = service.create(request("mysql-photo-failure", null, null), ADMIN).house();
        var failing = mock(PhotoMapper.class, org.mockito.AdditionalAnswers.delegatesTo(photos));
        doAnswer(call -> {
            PhotoMetadata p = call.getArgument(0);
            // Force a real MySQL CHECK failure, not a synthetic mapper exception.
            var invalid = new PhotoMetadata(p.id(), p.houseId(), p.stage(), p.locationStatus(),
                    p.takenAt(), p.takenAtSource(), p.businessDate(), p.uploadedAt(), p.uploadedBy(),
                    p.originalFilename(), p.contentType(), 0L, p.gpsLat(), p.gpsLng(), p.distanceM());
            return photos.insert(invalid, call.getArgument(1), call.getArgument(2));
        }).when(failing).insert(any(), any(), any());
        var storage = new LocalPhotoStorage(photoDirectory.toString());
        var uploads = new PhotoService(mapper, failing, new AuthorizationService(), storage, CLOCK, new PhotoExifParser());
        long before;
        try (var files = Files.list(photoDirectory)) { before = files.count(); }
        var file = new MockMultipartFile("file", "x.png", "image/png", PhotoTestFiles.image("png"));
        assertThatThrownBy(() -> uploads.upload(house.id(), file, ADMIN))
                .isInstanceOf(DataAccessException.class)
                .satisfies(ex -> {
                    Throwable cause = org.springframework.core.NestedExceptionUtils.getMostSpecificCause(ex);
                    assertThat(cause).isInstanceOf(java.sql.SQLException.class);
                    assertThat(((java.sql.SQLException) cause).getErrorCode()).isEqualTo(3819);
                });
        try (var files = Files.list(photoDirectory)) { assertThat(files.count()).isEqualTo(before); }
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM photo WHERE house_id=?", Integer.class, house.id())).isZero();
    }

    @ParameterizedTest
    @CsvSource({"jpeg, 30, -97, VERIFIED", "png, 30.1, -97, SUSPECT", "webp, , , UNKNOWN"})
    void photoExifUsesRealV1TimeGpsAndLocationConstraints(String format, String lat, String lng, String status) throws Exception {
        var house = service.create(new CreateHouseRequest("mysql-photo-exif-" + format, "Address", "North",
                lat == null ? null : new BigDecimal(lat), lng == null ? null : new BigDecimal(lng), null, null), ADMIN).house();
        var gps = new PhotoTestFiles.Gps("N", new long[][]{{30, 1}, {0, 1}, {0, 1}},
                "W", new long[][]{{97, 1}, {0, 1}, {0, 1}});
        byte[] bytes = PhotoTestFiles.withExif(format,
                PhotoTestFiles.exif("2026:07:01 00:30:00", "+09:00", "123456789", gps));
        var uploads = new PhotoService(mapper, photos, new AuthorizationService(),
                new LocalPhotoStorage(photoDirectory.toString()), CLOCK, new PhotoExifParser());
        var result = uploads.upload(house.id(), new MockMultipartFile("file", "original." + format, "image/" + format, bytes), ADMIN);
        assertThat(result.created()).isTrue();
        assertThat(result.photo().takenAt()).isEqualTo(LocalDateTime.parse("2026-06-30T15:30:00.123456"));
        assertThat(result.photo().uploadedAt()).isEqualTo(LocalDateTime.parse("2026-07-01T04:59:59.123456"));
        assertThat(result.photo().takenAtSource()).isEqualTo("EXIF");
        assertThat(result.photo().businessDate()).isEqualTo(LocalDate.of(2026, 6, 30));
        assertThat(result.photo().gpsLat()).isEqualByComparingTo("30");
        assertThat(result.photo().gpsLng()).isEqualByComparingTo("-97");
        assertThat(result.photo().locationStatus()).isEqualTo(status);
        if (status.equals("VERIFIED")) assertThat(result.photo().distanceM()).isZero();
        else if (status.equals("SUSPECT")) assertThat(result.photo().distanceM()).isGreaterThan(200);
        else assertThat(result.photo().distanceM()).isNull();
        String key = jdbc.queryForObject("SELECT storage_key FROM photo WHERE id=?", String.class, result.photo().id());
        assertThat(Files.readAllBytes(photoDirectory.resolve(key))).isEqualTo(bytes);
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
            public List<HouseListRow> findAll(HouseListQuery query) { return mapper.findAll(query); }

            @Override
            public int updateCover(Long id, Long photoId, LocalDateTime updatedAt) {
                return mapper.updateCover(id, photoId, updatedAt);
            }

            @Override
            public int advanceStage(Long id, ConstructionStage from, ConstructionStage to, LocalDateTime updatedAt) {
                return mapper.advanceStage(id, from, to, updatedAt);
            }

            @Override
            public int insertStageHistory(Long id, ConstructionStage from, ConstructionStage to,
                                          String changedBy, LocalDateTime changedAt) {
                return mapper.insertStageHistory(id, from, to, changedBy, changedAt);
            }

            @Override
            public House findById(Long id) { return mapper.findById(id); }

            @Override
            public List<PhotoMetadata> findPhotosByHouseId(Long houseId) { return mapper.findPhotosByHouseId(houseId); }
        };
        var racingService = new HouseService(racingMapper, photos, new AuthorizationService(), CLOCK);
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

    @Test
    void advanceCommitsStageAndAuditThroughSpringTransactionProxy() throws Exception {
        House house = service.create(request("mysql-stage-success", null, null), ADMIN).house();
        long photo = detailPhoto(house.id(), "2026-06-30T12:00:00Z", "2026-06-30", false);
        var response = advanceRequest(stageMvc(transactionalService(mapper)), house.id(),
                "stage-manager", "SITE_MANAGER", "North Austin");
        assertThat(response.getStatus()).isEqualTo(200);
        var body = new ObjectMapper().readTree(response.getContentAsString());
        assertThat(body.path("stage").asText()).isEqualTo("FOUNDATION");
        assertThat(body.path("photos").get(0).path("stage").asText()).isEqualTo("LAND_CLEARING");
        assertThat(mapper.findById(house.id()).stage()).isEqualTo(ConstructionStage.FOUNDATION);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM stage_history WHERE house_id=?", Integer.class, house.id())).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT from_stage FROM stage_history WHERE house_id=?", String.class, house.id())).isEqualTo("LAND_CLEARING");
        assertThat(jdbc.queryForObject("SELECT to_stage FROM stage_history WHERE house_id=?", String.class, house.id())).isEqualTo("FOUNDATION");
        assertThat(jdbc.queryForObject("SELECT changed_by FROM stage_history WHERE house_id=?", String.class, house.id())).isEqualTo("stage-manager");
        assertThat(jdbc.queryForObject("SELECT changed_at FROM stage_history WHERE house_id=?", LocalDateTime.class, house.id()))
                .isEqualTo(LocalDateTime.parse("2026-07-01T04:59:59.123456"));
        assertThat(jdbc.queryForObject("SELECT stage FROM photo WHERE id=?", String.class, photo)).isEqualTo("LAND_CLEARING");
        assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isFalse();
    }

    @ParameterizedTest
    @CsvSource({"NONE,false", "SUSPECT,false", "OTHER_HOUSE,false", "OTHER_STAGE,false",
            "UNKNOWN,true", "VERIFIED,true"})
    void advancePhotoQualificationUsesRealHouseStageAndStatusSql(String scenario, boolean eligible) throws Exception {
        var house = service.create(new CreateHouseRequest("mysql-stage-photo-" + scenario, "Test address", "North Austin",
                new BigDecimal("30"), new BigDecimal("-97"), null, null), ADMIN).house();
        if (!scenario.equals("NONE")) {
            long owner = scenario.equals("OTHER_HOUSE")
                    ? service.create(request("mysql-stage-other-photo-owner", null, null), ADMIN).house().id() : house.id();
            long photo = detailPhoto(owner, "2026-06-30T12:00:00Z", "2026-06-30",
                    scenario.equals("VERIFIED") || scenario.equals("SUSPECT"));
            if (scenario.equals("SUSPECT")) {
                jdbc.update("UPDATE photo SET location_status='SUSPECT', distance_m=201 WHERE id=?", photo);
            } else if (scenario.equals("OTHER_STAGE")) {
                jdbc.update("UPDATE photo SET stage='FOUNDATION' WHERE id=?", photo);
            }
        }
        assertThat(photos.hasEligiblePhoto(house.id(), ConstructionStage.LAND_CLEARING)).isEqualTo(eligible);
        var response = advanceRequest(stageMvc(transactionalService(mapper)), house.id(), "stage-admin", "ADMIN", null);
        assertThat(response.getStatus()).isEqualTo(eligible ? 200 : 422);
        if (!eligible) {
            assertThat(new ObjectMapper().readTree(response.getContentAsString()).path("code").asText()).isEqualTo("BUSINESS_RULE_VIOLATION");
        }
        assertThat(mapper.findById(house.id()).stage()).isEqualTo(eligible ? ConstructionStage.FOUNDATION : ConstructionStage.LAND_CLEARING);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM stage_history WHERE house_id=?", Integer.class, house.id())).isEqualTo(eligible ? 1 : 0);
    }

    @Test
    @Timeout(45)
    void simultaneousAdvanceRequestsCommitOnceAndReturn200And409() throws Exception {
        House house = service.create(request("mysql-stage-race", null, null), ADMIN).house();
        detailPhoto(house.id(), "2026-06-30T12:00:00Z", "2026-06-30", false);
        var barrier = new CyclicBarrier(2);
        var successfulUpdates = new AtomicInteger();
        var rejectedUpdates = new AtomicInteger();
        HouseMapper racing = spy(mapper);
        doAnswer(invocation -> {
            assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isTrue();
            // Both requests completed stage validation and the real eligibility SELECT before either UPDATE.
            await(barrier);
            int updated = mapper.advanceStage(invocation.getArgument(0), invocation.getArgument(1),
                    invocation.getArgument(2), invocation.getArgument(3));
            if (updated == 1) successfulUpdates.incrementAndGet();
            else rejectedUpdates.incrementAndGet();
            return updated;
        }).when(racing).advanceStage(any(), any(), any(), any());
        MockMvc mvc = stageMvc(transactionalService(racing));
        var executor = Executors.newFixedThreadPool(2);
        var futures = new ArrayList<Future<MockHttpServletResponse>>();
        var responses = new ArrayList<MockHttpServletResponse>();
        try {
            for (int i = 0; i < 2; i++) {
                String username = "stage-racer-" + i;
                futures.add(executor.submit(() -> advanceRequest(mvc, house.id(), username, "ADMIN", null)));
            }
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(30);
            for (var future : futures) responses.add(future.get(Math.max(1, deadline - System.nanoTime()), TimeUnit.NANOSECONDS));
        } finally {
            for (var future : futures) future.cancel(true);
            executor.shutdownNow();
            assertThat(executor.awaitTermination(5, TimeUnit.SECONDS)).as("Stage workers stop within timeout").isTrue();
        }
        assertThat(responses).extracting(MockHttpServletResponse::getStatus).containsExactlyInAnyOrder(200, 409);
        assertThat(successfulUpdates.get()).isEqualTo(1);
        assertThat(rejectedUpdates.get()).isEqualTo(1);
        for (int i = 0; i < responses.size(); i++) {
            var response = responses.get(i);
            var body = new ObjectMapper().readTree(response.getContentAsString());
            if (response.getStatus() == 409) assertThat(body.path("code").asText()).isEqualTo("CONFLICT");
            else {
                assertThat(body.path("stage").asText()).isEqualTo("FOUNDATION");
                assertThat(jdbc.queryForObject("SELECT changed_by FROM stage_history WHERE house_id=?", String.class, house.id()))
                        .isEqualTo("stage-racer-" + i);
            }
        }
        assertThat(mapper.findById(house.id()).stage()).isEqualTo(ConstructionStage.FOUNDATION);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM stage_history WHERE house_id=?", Integer.class, house.id())).isEqualTo(1);
    }

    @Test
    @Timeout(30)
    void realAuditCheckFailureRollsBackStageAndTimestamp() throws Exception {
        House house = service.create(request("mysql-stage-audit-failure", null, null), ADMIN).house();
        long photo = detailPhoto(house.id(), "2026-06-30T12:00:00Z", "2026-06-30", false);
        var errorCode = new AtomicInteger();
        HouseMapper failing = spy(mapper);
        doAnswer(invocation -> {
            assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isTrue();
            House pending = mapper.findById(house.id());
            assertThat(pending.stage()).isEqualTo(ConstructionStage.FOUNDATION);
            assertThat(pending.updatedAt()).isEqualTo(house.updatedAt().plusSeconds(1));
            try {
                // A real MySQL CHECK failure occurs after the real stage UPDATE in the same transaction.
                return mapper.insertStageHistory(invocation.getArgument(0), invocation.getArgument(1),
                        invocation.getArgument(2), "", invocation.getArgument(4));
            } catch (DataAccessException ex) {
                var cause = org.springframework.core.NestedExceptionUtils.getMostSpecificCause(ex);
                if (cause instanceof java.sql.SQLException sql) errorCode.set(sql.getErrorCode());
                throw ex;
            }
        }).when(failing).insertStageHistory(any(), any(), any(), any(), any());
        var response = advanceRequest(stageMvc(transactionalService(failing,
                Clock.offset(CLOCK, java.time.Duration.ofSeconds(1)))), house.id(), "stage-admin", "ADMIN", null);
        assertThat(response.getStatus()).isEqualTo(500);
        assertThat(new ObjectMapper().readTree(response.getContentAsString()).path("code").asText()).isEqualTo("INTERNAL_SERVER_ERROR");
        assertThat(errorCode.get()).isEqualTo(3819);
        assertThat(mapper.findById(house.id())).isEqualTo(house);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM stage_history WHERE house_id=?", Integer.class, house.id())).isZero();
        assertThat(jdbc.queryForObject("SELECT stage FROM photo WHERE id=?", String.class, photo)).isEqualTo("LAND_CLEARING");
        assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isFalse();
    }

    private static HouseService transactionalService(HouseMapper houseMapper) {
        return transactionalService(houseMapper, CLOCK);
    }

    private static HouseService transactionalService(HouseMapper houseMapper, Clock clock) {
        var interceptor = new TransactionInterceptor();
        interceptor.setTransactionManager(transactionManager);
        interceptor.setTransactionAttributeSource(new AnnotationTransactionAttributeSource());
        interceptor.afterPropertiesSet();
        var factory = new ProxyFactory(new HouseService(houseMapper, photos, new AuthorizationService(), clock));
        factory.setProxyTargetClass(true);
        factory.addAdvice(interceptor);
        return (HouseService) factory.getProxy();
    }

    private static MockMvc stageMvc(HouseService houseService) {
        return MockMvcBuilders.standaloneSetup(new HouseController(houseService))
                .addInterceptors(new AuthenticationInterceptor(new HeaderIdentityParser()))
                .setControllerAdvice(new GlobalExceptionHandler()).build();
    }

    private static MockHttpServletResponse advanceRequest(MockMvc mvc, long houseId, String username,
                                                         String role, String community) throws Exception {
        var request = post("/api/houses/{id}/advance", houseId).header("X-User", username).header("X-Role", role)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"fromStage\":\"LAND_CLEARING\",\"toStage\":\"FOUNDATION\"}");
        if (community != null) request.header("X-Community", community);
        return mvc.perform(request).andReturn().getResponse();
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
