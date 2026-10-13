package com.example.constructiontracker.mapper;

import com.example.constructiontracker.domain.ConstructionStage;
import com.example.constructiontracker.domain.HouseSourceType;
import com.example.constructiontracker.domain.UserIdentity;
import com.example.constructiontracker.domain.UserRole;
import com.example.constructiontracker.dto.CreateHouseRequest;
import com.example.constructiontracker.service.HouseService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.jdbc.Sql;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/** 专用 H2 库，加载生产 Mapper XML 和实际 Spring Service；不使用正式数据源。 */
@SpringBootTest(properties = "spring.datasource.url=jdbc:h2:mem:house_creation_test;MODE=MySQL;DB_CLOSE_DELAY=-1")
@ActiveProfiles("test")
@Sql("/house-creation-h2.sql")
class HousePersistenceTests {
    private static final UserIdentity ADMIN = new UserIdentity("alice", UserRole.ADMIN, null);
    @Autowired private HouseService service;
    @Autowired private HouseMapper mapper;
    @Autowired private JdbcTemplate jdbc;

    @Test
    void insertsAndMapsMissingCoordinatesAndInitialStage() {
        var result = service.create(request("no-coordinates"), ADMIN);
        assertThat(result.created()).isTrue();
        assertThat(result.house().id()).isPositive();
        assertThat(result.house().lat()).isNull();
        assertThat(result.house().lng()).isNull();
        assertThat(result.house().stage()).isEqualTo(ConstructionStage.LAND_CLEARING);
        assertThat(result.house().sourceType()).isEqualTo(HouseSourceType.MANUAL);
        assertThat(result.house().coverPhotoId()).isNull();
        assertThat(result.house().createdBy()).isEqualTo("alice");
        assertThat(result.house().updatedAt()).isEqualTo(result.house().createdAt());
    }

    @Test
    void roundTripsCoordinatesAndPublicSourceMetadata() {
        var input = new CreateHouseRequest("public-1", "Address", "North Austin",
                new BigDecimal("90.0000000"), new BigDecimal("-180.0000000"),
                "https://example.org/permits/1", Instant.parse("2026-01-01T05:59:59.123456Z"));
        var house = service.create(input, ADMIN).house();
        assertThat(house.lat()).isEqualByComparingTo("90");
        assertThat(house.lng()).isEqualByComparingTo("-180");
        assertThat(house.sourceType()).isEqualTo(HouseSourceType.PUBLIC_DATA);
        assertThat(house.sourceUrl()).isEqualTo(input.sourceUrl());
        assertThat(house.sourceFetchedAt().toInstant(java.time.ZoneOffset.UTC)).isEqualTo(input.sourceFetchedAt());
    }

    @Test
    void repeatedPermitKeepsAllOriginalFields() {
        var original = service.create(request("repeat"), ADMIN);
        var changed = new CreateHouseRequest(" repeat ", "Changed address", "Changed community",
                new BigDecimal("30"), new BigDecimal("-97"), null, null);
        var repeated = service.create(changed, new UserIdentity("other-admin", UserRole.ADMIN, null));
        assertThat(repeated.created()).isFalse();
        assertThat(repeated.house()).isEqualTo(original.house());
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM house", Integer.class)).isEqualTo(1);
    }

    @Test
    void bindsPermitAsDataAndPreservesCase() {
        String permit = "P' OR '1'='1";
        var saved = service.create(request(permit), ADMIN).house();
        service.create(request("CASE-PERMIT"), ADMIN);
        service.create(request("case-permit"), ADMIN);
        assertThat(mapper.findByPermitNo(permit)).isEqualTo(saved);
        assertThat(mapper.findByPermitNo("absent")).isNull();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM house", Integer.class)).isEqualTo(3);
    }

    @Test
    void concurrentRequestsCreateExactlyOneRecord() throws Exception {
        var gate = new CountDownLatch(1);
        try (var executor = Executors.newFixedThreadPool(8)) {
            var futures = new ArrayList<Future<HouseService.CreationResult>>();
            for (int i = 0; i < 8; i++) {
                futures.add(executor.submit(() -> {
                    assertThat(gate.await(10, TimeUnit.SECONDS)).isTrue();
                    return service.create(request("concurrent"), ADMIN);
                }));
            }
            gate.countDown();
            var results = new ArrayList<HouseService.CreationResult>();
            for (var future : futures) results.add(future.get(15, TimeUnit.SECONDS));
            assertThat(results.stream().filter(HouseService.CreationResult::created).count()).isEqualTo(1);
            assertThat(results.stream().map(result -> result.house().id()).distinct().count()).isEqualTo(1);
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM house", Integer.class)).isEqualTo(1);
        }
    }

    private CreateHouseRequest request(String permit) {
        return new CreateHouseRequest(permit, "Address", "North Austin", null, null, null, null);
    }
}
