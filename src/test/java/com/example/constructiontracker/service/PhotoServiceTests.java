package com.example.constructiontracker.service;

import com.example.constructiontracker.PhotoTestFiles;
import com.example.constructiontracker.domain.*;
import com.example.constructiontracker.exception.BusinessException;
import com.example.constructiontracker.mapper.HouseMapper;
import com.example.constructiontracker.mapper.PhotoMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockMultipartFile;

import java.io.IOException;
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
    private final PhotoService service = new PhotoService(houses, photos, new AuthorizationService(), storage, clock);

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
