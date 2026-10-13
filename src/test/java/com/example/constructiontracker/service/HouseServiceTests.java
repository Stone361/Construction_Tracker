package com.example.constructiontracker.service;

import com.example.constructiontracker.domain.ConstructionStage;
import com.example.constructiontracker.domain.House;
import com.example.constructiontracker.domain.HouseSourceType;
import com.example.constructiontracker.domain.PhotoMetadata;
import com.example.constructiontracker.domain.UserIdentity;
import com.example.constructiontracker.domain.UserRole;
import com.example.constructiontracker.dto.CreateHouseRequest;
import com.example.constructiontracker.exception.AuthenticationException;
import com.example.constructiontracker.exception.BusinessException;
import com.example.constructiontracker.mapper.HouseMapper;
import com.example.constructiontracker.mapper.PhotoMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.NullSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class HouseServiceTests {
    private static final UserIdentity ADMIN = new UserIdentity("alice", UserRole.ADMIN, null);
    private static final CreateHouseRequest REQUEST = new CreateHouseRequest(" permit-1 ", " Test address ",
            " North Austin ", null, null, null, null);
    private HouseMapper mapper;
    private HouseService service;

    @BeforeEach
    void setUp() {
        mapper = mock(HouseMapper.class);
        service = serviceAt("2026-01-01T05:59:59.123456789Z");
    }

    @ParameterizedTest
    @NullSource
    @ValueSource(longs = {0, -1})
    void invalidDetailIdFailsBeforeDatabaseAccess(Long id) {
        assertThatThrownBy(() -> service.detail(id)).isInstanceOfSatisfying(BusinessException.class, error -> {
            assertThat(error.getStatus()).isEqualTo(HttpStatus.BAD_REQUEST);
            assertThat(error.getCode()).isEqualTo("INVALID_REQUEST");
        });
        verifyNoInteractions(mapper);
    }

    @Test
    void missingHouseIs404WithoutQueryingPhotos() {
        assertThatThrownBy(() -> service.detail(42L)).isInstanceOfSatisfying(BusinessException.class, error -> {
            assertThat(error.getStatus()).isEqualTo(HttpStatus.NOT_FOUND);
            assertThat(error.getCode()).isEqualTo("NOT_FOUND");
        });
        verify(mapper).findById(42L);
        verifyNoMoreInteractions(mapper);
    }

    @Test
    void detailKeepsCompleteHouseInformationAndUtcPhotoMetadata() {
        House house = savedHouse();
        var time = LocalDateTime.parse("2026-01-01T05:59:59.123456");
        var photo = new PhotoMetadata(7L, 42L, ConstructionStage.FRAMING, "UNKNOWN", time, "EXIF",
                LocalDate.of(2025, 12, 31), time, "uploader", "original.jpg", "image/jpeg", 100L,
                null, null, null);
        when(mapper.findById(42L)).thenReturn(house);
        when(mapper.findPhotosByHouseId(42L)).thenReturn(List.of(photo));
        var detail = service.detail(42L);
        assertThat(detail.id()).isEqualTo(house.id());
        assertThat(detail.coverPhotoId()).isEqualTo(7L);
        assertThat(detail.createdBy()).isEqualTo(house.createdBy());
        assertThat(detail.updatedAt()).isEqualTo(house.updatedAt().toInstant(ZoneOffset.UTC));
        assertThat(detail.photos()).hasSize(1);
        assertThat(detail.photos().getFirst().takenAt()).isEqualTo(Instant.parse("2026-01-01T05:59:59.123456Z"));
        assertThat(detail.photos().getFirst().businessDate()).isEqualTo(LocalDate.of(2025, 12, 31));
        assertThat(detail.photos().getFirst().uploadedAt()).isEqualTo(detail.photos().getFirst().takenAt());
        var calls = inOrder(mapper);
        calls.verify(mapper).findById(42L);
        calls.verify(mapper).findPhotosByHouseId(42L);
        calls.verifyNoMoreInteractions();
    }

    @ParameterizedTest
    @CsvSource({
            "2026-01-01T05:59:59.123456789Z,2025-12-31",
            "2026-01-01T06:00:00Z,2026-01-01",
            "2026-07-01T04:59:59Z,2026-06-30",
            "2026-07-01T05:00:00Z,2026-07-01",
            "2026-03-08T08:00:00Z,2026-03-08"
    })
    void createsInitialStageWithUtcTimeAndChicagoBusinessDay(String instant, String date) {
        House saved = savedHouse();
        when(mapper.findByPermitNo("permit-1")).thenReturn(null, saved);
        var result = serviceAt(instant).create(REQUEST, ADMIN);
        var captor = ArgumentCaptor.forClass(House.class);
        verify(mapper).insert(captor.capture());
        House inserted = captor.getValue();
        assertThat(inserted.permitNo()).isEqualTo("permit-1");
        assertThat(inserted.address()).isEqualTo("Test address");
        assertThat(inserted.community()).isEqualTo("North Austin");
        assertThat(inserted.stage()).isEqualTo(ConstructionStage.LAND_CLEARING);
        assertThat(inserted.createdBusinessDate()).isEqualTo(LocalDate.parse(date));
        assertThat(inserted.createdAt()).isEqualTo(LocalDateTime.ofInstant(
                Instant.parse(instant).truncatedTo(java.time.temporal.ChronoUnit.MICROS), ZoneOffset.UTC));
        assertThat(inserted.updatedAt()).isEqualTo(inserted.createdAt());
        assertThat(inserted.createdBy()).isEqualTo("alice");
        assertThat(inserted.sourceType()).isEqualTo(HouseSourceType.MANUAL);
        assertThat(inserted.lat()).isNull();
        assertThat(inserted.lng()).isNull();
        assertThat(result.created()).isTrue();
        assertThat(result.house()).isSameAs(saved);
    }

    @Test
    void existingPermitReturnsOriginalRecordWithoutWriting() {
        House saved = savedHouse();
        when(mapper.findByPermitNo("permit-1")).thenReturn(saved);
        var result = service.create(REQUEST, ADMIN);
        assertThat(result.created()).isFalse();
        assertThat(result.house()).isSameAs(saved);
        verify(mapper, never()).insert(any());
    }

    @Test
    void concurrentUniqueKeyConflictReturnsWinningRecord() {
        House saved = savedHouse();
        when(mapper.findByPermitNo("permit-1")).thenReturn(null, saved);
        when(mapper.insert(any())).thenThrow(new DuplicateKeyException("duplicate permit"));
        var result = service.create(REQUEST, ADMIN);
        assertThat(result.created()).isFalse();
        assertThat(result.house()).isSameAs(saved);
    }

    @Test
    void doesNotHideDuplicateKeyWhenNoMatchingPermitExists() {
        var failure = new DuplicateKeyException("unrelated unique constraint");
        when(mapper.insert(any())).thenThrow(failure);
        assertThatThrownBy(() -> service.create(REQUEST, ADMIN)).isSameAs(failure);
    }

    @Test
    void doesNotTreatOtherDatabaseErrorsAsDuplicatePermits() {
        var failure = new DataIntegrityViolationException("check violation");
        when(mapper.insert(any())).thenThrow(failure);
        assertThatThrownBy(() -> service.create(REQUEST, ADMIN)).isSameAs(failure);
    }

    @ParameterizedTest
    @EnumSource(value = UserRole.class, names = {"SITE_MANAGER", "VIEWER"})
    void nonAdminsCannotCreateOrRetrieveDuplicateViaPost(UserRole role) {
        assertThatThrownBy(() -> service.create(REQUEST, new UserIdentity("bob", role, "North Austin")))
                .isInstanceOfSatisfying(BusinessException.class, error -> {
                    assertThat(error.getStatus()).isEqualTo(HttpStatus.FORBIDDEN);
                    assertThat(error.getCode()).isEqualTo("FORBIDDEN");
                });
        verifyNoInteractions(mapper);
    }

    @Test
    void missingIdentityIsUnauthorized() {
        assertThatThrownBy(() -> service.create(REQUEST, null)).isInstanceOf(AuthenticationException.class);
        verifyNoInteractions(mapper);
    }

    @Test
    void oversizedUsernameFailsBeforeDatabaseWrite() {
        assertThatThrownBy(() -> service.create(REQUEST, new UserIdentity("a".repeat(129), UserRole.ADMIN, null)))
                .isInstanceOfSatisfying(BusinessException.class,
                        error -> assertThat(error.getStatus()).isEqualTo(HttpStatus.BAD_REQUEST));
        verifyNoInteractions(mapper);
    }

    @Test
    void publicDataRetainsSourceAndFetchedUtcTime() {
        var request = new CreateHouseRequest("permit-1", "Address", "North Austin", null, null,
                " https://example.org/permits/1 ", Instant.parse("2025-12-31T22:00:00.123456789Z"));
        when(mapper.findByPermitNo("permit-1")).thenReturn(null, savedHouse());
        service.create(request, ADMIN);
        var captor = ArgumentCaptor.forClass(House.class);
        verify(mapper).insert(captor.capture());
        assertThat(captor.getValue().sourceType()).isEqualTo(HouseSourceType.PUBLIC_DATA);
        assertThat(captor.getValue().sourceUrl()).isEqualTo("https://example.org/permits/1");
        assertThat(captor.getValue().sourceFetchedAt()).isEqualTo(LocalDateTime.parse("2025-12-31T22:00:00.123456"));
    }

    private HouseService serviceAt(String instant) {
        return new HouseService(mapper, mock(PhotoMapper.class), new AuthorizationService(),
                Clock.fixed(Instant.parse(instant), ZoneOffset.UTC));
    }

    private House savedHouse() {
        return new House(42L, "permit-1", "Original address", "Original community", null, null,
                ConstructionStage.FRAMING, 7L, HouseSourceType.MANUAL, null, null,
                LocalDateTime.parse("2025-12-01T12:00:00"), LocalDate.of(2025, 12, 1),
                "original-admin", LocalDateTime.parse("2025-12-02T12:00:00"));
    }
}
