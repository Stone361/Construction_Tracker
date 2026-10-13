package com.example.constructiontracker.controller;

import com.example.constructiontracker.PhotoTestFiles;
import com.example.constructiontracker.service.PhotoService;
import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.http.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.jdbc.Sql;
import org.springframework.util.LinkedMultiValueMap;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Comparator;

import static org.assertj.core.api.Assertions.*;

/** Real HTTP multipart limits + production Controller/Service/MyBatis + owned temp files. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {"spring.datasource.url=jdbc:h2:mem:photo_upload_test;MODE=MySQL;DB_CLOSE_DELAY=-1",
                "debug=false", "logging.level.root=INFO"})
@ActiveProfiles("test")
@Import(PhotoUploadIntegrationTests.Time.class)
@Sql("/photo-upload-h2.sql")
class PhotoUploadIntegrationTests {
    private static final Path ROOT = temporaryDirectory();
    private static final Path STORAGE = ROOT.resolve("photos");
    @Autowired private TestRestTemplate rest;
    @Autowired private JdbcTemplate jdbc;

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("photos.storage-directory", () -> STORAGE.toString());
    }

    @TestConfiguration
    static class Time {
        @Bean @Primary Clock fixedPhotoClock() {
            return Clock.fixed(Instant.parse("2026-07-01T04:59:59.123456789Z"), ZoneOffset.UTC);
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"jpeg", "png", "webp"})
    void uploadStoresRealTypeAndBytesAndReturnsReadableUrl(String type) throws Exception {
        byte[] bytes = PhotoTestFiles.image(type);
        var result = upload(1, bytes, "../../outside.exe", "text/plain", "ADMIN", null);
        assertThat(result.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        JsonNode body = result.getBody();
        assertThat(body).isNotNull();
        assertThat(body.path("contentType").asText()).isEqualTo("image/" + type);
        assertThat(body.path("stage").asText()).isEqualTo("FOUNDATION");
        assertThat(body.path("locationStatus").asText()).isEqualTo("UNKNOWN");
        assertThat(body.path("takenAtSource").asText()).isEqualTo("UPLOAD");
        assertThat(body.path("takenAt").asText()).isEqualTo("2026-07-01T04:59:59.123456Z");
        assertThat(body.path("businessDate").asText()).isEqualTo("2026-06-30");
        assertThat(body.has("storageKey")).isFalse();
        assertThat(body.has("contentHash")).isFalse();
        var stored = jdbc.queryForMap("SELECT storage_key, content_hash, file_size, original_filename FROM photo WHERE id=?", body.path("id").asLong());
        String key = (String) stored.get("storage_key");
        assertThat(key).matches("[0-9a-f-]{36}\\.(jpg|png|webp)");
        assertThat(stored.get("original_filename")).isEqualTo("outside.exe");
        assertThat((byte[]) stored.get("content_hash")).isEqualTo(MessageDigest.getInstance("SHA-256").digest(bytes));
        assertThat(Files.readAllBytes(STORAGE.resolve(key))).isEqualTo(bytes);
        assertThat(ROOT.resolve("outside.exe")).doesNotExist();
        var downloaded = rest.exchange(body.path("url").asText(), HttpMethod.GET,
                new HttpEntity<>(headers("VIEWER", null)), byte[].class);
        assertThat(downloaded.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(downloaded.getHeaders().getContentType()).isEqualTo(MediaType.parseMediaType("image/" + type));
        assertThat(downloaded.getHeaders().getFirst("X-Content-Type-Options")).isEqualTo("nosniff");
        assertThat(downloaded.getBody()).isEqualTo(bytes);
        var detail = rest.exchange("/api/houses/1", HttpMethod.GET, new HttpEntity<>(headers("VIEWER", null)), JsonNode.class);
        assertThat(detail.getBody().path("photos").size()).isEqualTo(1);
        assertThat(detail.getBody().path("photos").get(0).path("url").asText()).isEqualTo(body.path("url").asText());
        assertThat(rest.getForEntity(body.path("url").asText(), JsonNode.class).getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        var wrongHouse = rest.exchange("/api/houses/2/photos/" + body.path("id").asLong() + "/file", HttpMethod.GET,
                new HttpEntity<>(headers("VIEWER", null)), JsonNode.class);
        assertThat(wrongHouse.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    }

    @Test
    void duplicateIs200AndSameBytesForAnotherHouseAreIndependent() throws Exception {
        byte[] bytes = PhotoTestFiles.image("png");
        var first = upload(1, bytes, "a.png", "image/png", "ADMIN", null);
        var repeat = upload(1, bytes, "b.jpg", "image/jpeg", "ADMIN", null);
        var other = upload(2, bytes, "a.png", "image/png", "ADMIN", null);
        assertThat(first.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(repeat.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(repeat.getBody()).isEqualTo(first.getBody());
        assertThat(other.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(other.getBody().path("id")).isNotEqualTo(first.getBody().path("id"));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM photo", Integer.class)).isEqualTo(2);
        try (var files = Files.list(STORAGE)) { assertThat(files.count()).isEqualTo(2); }
    }

    @Test
    void exactTenMillionBytePhotoIsAllowedByRealMultipartServer() throws Exception {
        var response = upload(1, PhotoTestFiles.pngOfSize(PhotoService.MAX_FILE_BYTES), "limit.png", "image/png", "ADMIN", null);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(response.getBody().path("fileSize").asLong()).isEqualTo(PhotoService.MAX_FILE_BYTES);
        assertThat(jdbc.queryForObject("SELECT file_size FROM photo", Long.class)).isEqualTo(PhotoService.MAX_FILE_BYTES);
    }

    @Test
    void oneByteOverLimitIs413AtRealMultipartBoundaryWithoutWrites() throws Exception {
        for (int size : new int[]{PhotoService.MAX_FILE_BYTES + 1, 11_000_001}) {
            var response = upload(1, PhotoTestFiles.pngOfSize(size), "large.png", "image/png", "ADMIN", null);
            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.PAYLOAD_TOO_LARGE);
            assertThat(response.getBody().path("code").asText()).isEqualTo("PAYLOAD_TOO_LARGE");
            assertNoWrites();
        }
    }

    @Test
    void authenticationAndCommunityPermissionAreEnforced() throws Exception {
        byte[] bytes = PhotoTestFiles.image("png");
        assertThat(upload(1, bytes, "x.png", "image/png", null, null).getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(upload(1, bytes, "x.png", "image/png", "VIEWER", null).getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(upload(1, bytes, "x.png", "image/png", "SITE_MANAGER", "South").getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertNoWrites();
        assertThat(upload(1, bytes, "x.png", "image/png", "SITE_MANAGER", "North").getStatusCode()).isEqualTo(HttpStatus.CREATED);
    }

    @Test
    void invalidContentMissingHouseAndInvalidIdHaveStableErrors() throws Exception {
        assertThat(upload(1, "fake".getBytes(), "valid.png", "image/png", "ADMIN", null).getStatusCode()).isEqualTo(HttpStatus.UNSUPPORTED_MEDIA_TYPE);
        assertThat(upload(999, PhotoTestFiles.image("png"), "x.png", "image/png", "ADMIN", null).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(upload(0, PhotoTestFiles.image("png"), "x.png", "image/png", "ADMIN", null).getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertNoWrites();
    }

    @Test
    void missingFilePartIs400() {
        var headers = headers("ADMIN", null);
        headers.setContentType(MediaType.MULTIPART_FORM_DATA);
        var response = rest.postForEntity("/api/houses/1/photos", new HttpEntity<>(new LinkedMultiValueMap<>(), headers), JsonNode.class);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertNoWrites();
    }

    @Test
    void fileWriteFailureIsSafe500AndDoesNotCreateDatabaseRow() throws Exception {
        Files.write(STORAGE, new byte[]{1});
        var response = upload(1, PhotoTestFiles.image("png"), "x.png", "image/png", "ADMIN", null);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.INTERNAL_SERVER_ERROR);
        assertThat(response.getBody().toString()).doesNotContain(ROOT.toString()).doesNotContain("stackTrace");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM photo", Integer.class)).isZero();
    }

    private ResponseEntity<JsonNode> upload(long houseId, byte[] bytes, String filename, String mime, String role, String community) {
        var partHeaders = new HttpHeaders();
        partHeaders.setContentDisposition(ContentDisposition.formData().name("file").filename(filename).build());
        partHeaders.setContentType(MediaType.parseMediaType(mime));
        var parts = new LinkedMultiValueMap<String, Object>();
        parts.add("file", new HttpEntity<>(bytes, partHeaders));
        var headers = headers(role, community);
        headers.setContentType(MediaType.MULTIPART_FORM_DATA);
        return rest.postForEntity("/api/houses/" + houseId + "/photos", new HttpEntity<>(parts, headers), JsonNode.class);
    }

    private HttpHeaders headers(String role, String community) {
        var headers = new HttpHeaders();
        if (role != null) { headers.set("X-User", "photo-test"); headers.set("X-Role", role); }
        if (community != null) headers.set("X-Community", community);
        return headers;
    }

    private void assertNoWrites() {
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM photo", Integer.class)).isZero();
        assertThat(Files.exists(STORAGE)).isFalse();
    }

    @AfterEach
    void removeOwnedTestFiles() throws IOException { remove(STORAGE); }

    @AfterAll
    static void cleanup() throws IOException { remove(ROOT); }

    private static void remove(Path path) throws IOException {
        if (Files.exists(path)) {
            try (var paths = Files.walk(path)) {
                for (Path item : paths.sorted(Comparator.reverseOrder()).toList()) Files.delete(item);
            }
        }
    }

    private static Path temporaryDirectory() {
        try { return Files.createTempDirectory("construction-tracker-photo-test-"); }
        catch (IOException ex) { throw new java.io.UncheckedIOException(ex); }
    }
}
