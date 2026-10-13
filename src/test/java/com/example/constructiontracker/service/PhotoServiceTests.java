package com.example.constructiontracker.service;

import com.example.constructiontracker.PhotoTestFiles;
import com.example.constructiontracker.domain.*;
import com.example.constructiontracker.exception.BusinessException;
import com.example.constructiontracker.exception.GlobalExceptionHandler;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.slf4j.LoggerFactory;
import com.example.constructiontracker.mapper.HouseMapper;
import com.example.constructiontracker.mapper.PhotoMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.junit.jupiter.params.provider.CsvSource;
import org.mockito.ArgumentCaptor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockMultipartFile;

import java.io.IOException;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.Arrays;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class PhotoServiceTests {
    private final HouseMapper houses = mock(HouseMapper.class);
    private final PhotoMapper photos = mock(PhotoMapper.class);
    private final LocalPhotoStorage storage = mock(LocalPhotoStorage.class);
    private final UserIdentity admin = new UserIdentity("alice", UserRole.ADMIN, null);
    private final Clock clock = Clock.fixed(Instant.parse("2026-07-01T04:59:59.123456789Z"), ZoneOffset.UTC);
    private final PhotoService service = new PhotoService(houses, photos, new AuthorizationService(), storage, clock, new PhotoExifParser());

    @BeforeEach
    void houseExists() throws Exception {
        var time = LocalDateTime.parse("2026-01-01T00:00:00");
        when(houses.findById(1L)).thenReturn(new House(1L, "P", "Address", "North", null, null,
                ConstructionStage.FOUNDATION, null, HouseSourceType.MANUAL, null, null, time,
                time.toLocalDate(), "alice", time));
        when(storage.save(any(), any())).thenReturn("owned-key");
    }

    @ParameterizedTest
    @ValueSource(strings = {"jpeg", "png", "webp"})
    void decodesActualContentAndUsesTruthfulUploadFallbacks(String type) throws Exception {
        byte[] content = PhotoTestFiles.image(type);
        when(photos.findByHash(eq(1L), any())).thenReturn(null, metadata());
        var result = service.upload(1L, new MockMultipartFile("file", "../../evil.exe", "text/plain", content), admin);
        assertThat(result.created()).isTrue();
        var photo = ArgumentCaptor.forClass(PhotoMetadata.class);
        var hash = ArgumentCaptor.forClass(byte[].class);
        verify(photos).insert(photo.capture(), hash.capture(), eq("owned-key"));
        assertThat(hash.getValue()).isEqualTo(java.security.MessageDigest.getInstance("SHA-256").digest(content));
        assertThat(photo.getValue().contentType()).isEqualTo("image/" + type);
        assertThat(photo.getValue().originalFilename()).isEqualTo("evil.exe");
        assertThat(photo.getValue().stage()).isEqualTo(ConstructionStage.FOUNDATION);
        assertThat(photo.getValue().takenAtSource()).isEqualTo("UPLOAD");
        assertThat(photo.getValue().takenAt()).isEqualTo(photo.getValue().uploadedAt());
        assertThat(photo.getValue().uploadedAt().toInstant(ZoneOffset.UTC)).isEqualTo(Instant.parse("2026-07-01T04:59:59.123456Z"));
        assertThat(photo.getValue().businessDate()).isEqualTo(LocalDate.of(2026, 6, 30));
        assertThat(photo.getValue().locationStatus()).isEqualTo("UNKNOWN");
        assertThat(photo.getValue().gpsLat()).isNull();
        assertThat(photo.getValue().gpsLng()).isNull();
        assertThat(photo.getValue().distanceM()).isNull();
        verify(storage).save(content, "image/" + type);
    }

    @ParameterizedTest
    @CsvSource({"0, VERIFIED", "199.999999, VERIFIED", "200, VERIFIED", "200.000001, SUSPECT"})
    void classifiesUnroundedDistanceAtInclusiveBoundary(double distance, String expected) {
        assertThat(PhotoService.locationStatus(distance)).isEqualTo(expected);
    }

    @ParameterizedTest
    @CsvSource({"0.0017986, VERIFIED", "0.0017987, SUSPECT", "0.001798649, VERIFIED"})
    void uploadCalculatesDistanceFromStoredPrecisionGps(String latitude, String expected) throws Exception {
        var current = houses.findById(1L);
        when(houses.findById(1L)).thenReturn(new House(current.id(), current.permitNo(), current.address(), current.community(),
                BigDecimal.ZERO, BigDecimal.ZERO, current.stage(), null, current.sourceType(), null, null,
                current.createdAt(), current.createdBusinessDate(), current.createdBy(), current.updatedAt()));
        long seconds = new BigDecimal(latitude).multiply(BigDecimal.valueOf(3600))
                .multiply(BigDecimal.valueOf(100_000_000)).longValueExact();
        var gps = new PhotoTestFiles.Gps("N", new long[][]{{0, 1}, {0, 1}, {seconds, 100_000_000}},
                "E", new long[][]{{0, 1}, {0, 1}, {0, 1}});
        byte[] content = PhotoTestFiles.withExif("png", PhotoTestFiles.exif("2026:07:01 00:30:00", "+09:00", null, gps));
        when(photos.findByHash(eq(1L), any())).thenReturn(null, metadata());
        service.upload(1L, new MockMultipartFile("file", "x.png", "image/png", content), admin);
        var captured = ArgumentCaptor.forClass(PhotoMetadata.class);
        verify(photos).insert(captured.capture(), any(), any());
        var photo = captured.getValue();
        assertThat(photo.gpsLat()).isEqualByComparingTo(new BigDecimal(latitude).setScale(7, java.math.RoundingMode.HALF_UP));
        assertThat(photo.locationStatus()).isEqualTo(expected);
        assertThat(photo.distanceM()).isEqualTo(PhotoService.distanceMeters(BigDecimal.ZERO, BigDecimal.ZERO, photo.gpsLat(), photo.gpsLng()));
        assertThat(photo.uploadedAt()).isEqualTo(LocalDateTime.parse("2026-07-01T04:59:59.123456"));
        assertThat(photo.takenAt()).isEqualTo(LocalDateTime.parse("2026-06-30T15:30:00"));
        assertThat(photo.businessDate()).isEqualTo(LocalDate.of(2026, 6, 30));
    }

    @Test
    void missingHouseCoordinatesRetainValidGpsWithoutDistance() throws Exception {
        var gps = new PhotoTestFiles.Gps("N", new long[][]{{0, 1}, {0, 1}, {0, 1}},
                "E", new long[][]{{0, 1}, {0, 1}, {0, 1}});
        byte[] content = PhotoTestFiles.withExif("png", PhotoTestFiles.exif("invalid", null, null, gps));
        when(photos.findByHash(eq(1L), any())).thenReturn(null, metadata());
        service.upload(1L, new MockMultipartFile("file", "x.png", "image/png", content), admin);
        var captured = ArgumentCaptor.forClass(PhotoMetadata.class);
        verify(photos).insert(captured.capture(), any(), any());
        assertThat(captured.getValue().gpsLat()).isEqualByComparingTo("0");
        assertThat(captured.getValue().gpsLng()).isEqualByComparingTo("0");
        assertThat(captured.getValue().locationStatus()).isEqualTo("UNKNOWN");
        assertThat(captured.getValue().distanceM()).isNull();
        assertThat(captured.getValue().takenAtSource()).isEqualTo("UPLOAD");
    }

    @Test
    void rejectsFakeAndTruncatedContentWithoutFileOrDatabaseWrites() throws Exception {
        byte[] png = PhotoTestFiles.image("png");
        byte[] webp = PhotoTestFiles.image("webp");
        byte[] corruptPng = png.clone();
        for (int i = 0; i < corruptPng.length - 4; i++) {
            if (corruptPng[i] == 'I' && corruptPng[i + 1] == 'D' && corruptPng[i + 2] == 'A' && corruptPng[i + 3] == 'T') {
                corruptPng[i + 4] = 0; // Keep signature, dimensions and IEND; corrupt the compressed pixels.
                break;
            }
        }
        for (byte[] invalid : new byte[][]{new byte[0], "not an image".getBytes(), PhotoTestFiles.image("gif"),
                Arrays.copyOf(png, 20), Arrays.copyOf(webp, 16), corruptPng}) {
            assertThatThrownBy(() -> service.upload(1L, new MockMultipartFile("file", "real.png", "image/png", invalid), admin))
                    .isInstanceOfSatisfying(BusinessException.class, ex -> assertThat(ex.getStatus()).isEqualTo(HttpStatus.UNSUPPORTED_MEDIA_TYPE));
        }
        verifyNoInteractions(photos);
        verify(storage, never()).save(any(), any());
    }

    @Test
    void rejectsOverLimitByActualBytes() throws Exception {
        var file = new MockMultipartFile("file", "large.png", "image/png", new byte[PhotoService.MAX_FILE_BYTES + 1]);
        assertThatThrownBy(() -> service.upload(1L, file, admin))
                .isInstanceOfSatisfying(BusinessException.class, ex -> assertThat(ex.getStatus()).isEqualTo(HttpStatus.PAYLOAD_TOO_LARGE));
        verifyNoInteractions(photos);
        verify(storage, never()).save(any(), any());
    }

    @Test
    void authorizationUsesDatabaseCommunityAndRunsBeforeFileProcessing() throws Exception {
        for (var identity : new UserIdentity[]{new UserIdentity("bob", UserRole.VIEWER, null),
                new UserIdentity("bob", UserRole.SITE_MANAGER, "South")}) {
            assertThatThrownBy(() -> service.upload(1L, null, identity))
                    .isInstanceOfSatisfying(BusinessException.class, ex -> assertThat(ex.getStatus()).isEqualTo(HttpStatus.FORBIDDEN));
        }
        verifyNoInteractions(photos);
        verify(storage, never()).save(any(), any());
    }

    @Test
    void nonexistentAndInvalidHouseDoNotWrite() throws Exception {
        assertThatThrownBy(() -> service.upload(999L, null, admin))
                .isInstanceOfSatisfying(BusinessException.class, ex -> assertThat(ex.getStatus()).isEqualTo(HttpStatus.NOT_FOUND));
        assertThatThrownBy(() -> service.upload(0L, null, admin))
                .isInstanceOfSatisfying(BusinessException.class, ex -> assertThat(ex.getStatus()).isEqualTo(HttpStatus.BAD_REQUEST));
        verifyNoInteractions(photos);
        verify(storage, never()).save(any(), any());
    }

    @Test
    void duplicateReturnsOriginalWithoutSavingAnotherFile() throws Exception {
        when(photos.findByHash(eq(1L), any())).thenReturn(metadata());
        var result = service.upload(1L, file(), admin);
        assertThat(result.created()).isFalse();
        assertThat(result.photo()).isEqualTo(metadata());
        verify(photos, never()).insert(any(), any(), any());
        verify(storage, never()).save(any(), any());
    }

    @Test
    void fileWriteFailureDoesNotInsertMetadata() throws Exception {
        when(storage.save(any(), any())).thenThrow(new IOException("private path"));
        assertThatThrownBy(() -> service.upload(1L, file(), admin))
                .isInstanceOfSatisfying(BusinessException.class, ex -> {
                    assertThat(ex.getStatus()).isEqualTo(HttpStatus.INTERNAL_SERVER_ERROR);
                    assertThat(ex.getMessage()).doesNotContain("private path");
                });
        verify(photos, never()).insert(any(), any(), any());
    }

    @Test
    void databaseInsertFailureDeletesOnlyNewFile() throws Exception {
        when(photos.insert(any(), any(), any())).thenThrow(new DataIntegrityViolationException("database failure"));
        assertThatThrownBy(() -> service.upload(1L, file(), admin)).isInstanceOf(DataIntegrityViolationException.class);
        verify(storage).delete("owned-key");
    }

    @Test
    void compensationFailureKeepsOriginalAndSuppressedExceptionInServerLog() throws Exception {
        var database = new DataIntegrityViolationException("private database detail");
        var cleanup = new IOException("private cleanup path");
        when(photos.insert(any(), any(), any())).thenThrow(database);
        doThrow(cleanup).when(storage).delete("owned-key");
        var error = catchThrowableOfType(() -> service.upload(1L, file(), admin), BusinessException.class);
        assertThat(error.getStatus()).isEqualTo(HttpStatus.INTERNAL_SERVER_ERROR);
        assertThat(error.getCause()).isSameAs(database);
        assertThat(database.getSuppressed()).containsExactly(cleanup);
        verify(storage).delete("owned-key");
        verify(photos, times(1)).findByHash(eq(1L), any());
        var logger = (ch.qos.logback.classic.Logger) LoggerFactory.getLogger(GlobalExceptionHandler.class);
        var events = new ListAppender<ILoggingEvent>();
        events.start(); logger.addAppender(events);
        try {
            var response = new GlobalExceptionHandler().handleBusinessException(error);
            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.INTERNAL_SERVER_ERROR);
            assertThat(response.getBody().message()).isEqualTo("清理未入库照片失败");
            assertThat(response.getBody().message()).doesNotContain("private");
            assertThat(events.list).hasSize(1);
            var logged = events.list.getFirst().getThrowableProxy();
            assertThat(logged.getCause().getMessage()).isEqualTo(database.getMessage());
            assertThat(logged.getCause().getSuppressed()).hasSize(1);
            assertThat(logged.getCause().getSuppressed()[0].getMessage()).isEqualTo(cleanup.getMessage());
        } finally { logger.detachAppender(events); events.stop(); }
    }

    @Test
    void databaseConnectionFailureKeepsFileWhenCommitOutcomeIsUnknown() throws Exception {
        when(photos.insert(any(), any(), any())).thenThrow(new DataAccessResourceFailureException("connection lost"));
        assertThatThrownBy(() -> service.upload(1L, file(), admin))
                .isInstanceOfSatisfying(BusinessException.class, ex -> assertThat(ex.getStatus()).isEqualTo(HttpStatus.INTERNAL_SERVER_ERROR));
        verify(storage, never()).delete(any());
    }

    @Test
    void uniqueCollisionCleansCandidateAndReadsExistingFromNewQuery() throws Exception {
        when(photos.findByHash(eq(1L), any())).thenReturn(null, metadata());
        when(photos.insert(any(), any(), any())).thenThrow(new DuplicateKeyException("duplicate"));
        var result = service.upload(1L, file(), admin);
        assertThat(result.created()).isFalse();
        assertThat(result.photo()).isEqualTo(metadata());
        verify(storage).delete("owned-key");
    }

    @Test
    void readFailureAfterCommittedInsertNeverDeletesStoredFile() throws Exception {
        when(photos.findByHash(eq(1L), any())).thenReturn(null).thenThrow(new DataIntegrityViolationException("read failure"));
        assertThatThrownBy(() -> service.upload(1L, file(), admin)).isInstanceOf(DataIntegrityViolationException.class);
        verify(photos).insert(any(), any(), eq("owned-key"));
        verify(storage, never()).delete(any());
    }

    private MockMultipartFile file() throws IOException {
        return new MockMultipartFile("file", "photo.png", "image/png", PhotoTestFiles.image("png"));
    }

    private PhotoMetadata metadata() {
        var time = LocalDateTime.parse("2026-07-01T04:59:59.123456");
        return new PhotoMetadata(7L, 1L, ConstructionStage.FOUNDATION, "UNKNOWN", time, "UPLOAD",
                LocalDate.of(2026, 6, 30), time, "alice", "photo.png", "image/png", 100L, null, null, null);
    }
}
