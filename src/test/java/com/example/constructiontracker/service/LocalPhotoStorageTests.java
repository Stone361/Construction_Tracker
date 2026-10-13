package com.example.constructiontracker.service;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.io.FilterOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.OpenOption;
import java.nio.file.Path;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class LocalPhotoStorageTests {
    @TempDir Path directory;

    @Test
    void serverNamesNeverOverwriteAndBytesArePreserved() throws Exception {
        var storage = new LocalPhotoStorage(directory.toString());
        byte[] content = {1, 2, 3};
        String first = storage.save(content, "image/png");
        String second = storage.save(content, "image/png");
        assertThat(first).matches("[0-9a-f-]{36}\\.png").isNotEqualTo(second);
        assertThat(Files.readAllBytes(directory.resolve(first))).isEqualTo(content);
        assertThat(storage.read(first).getInputStream()).satisfies(input -> {
            try (input) { assertThat(input.readAllBytes()).isEqualTo(content); }
            catch (java.io.IOException ex) { throw new java.io.UncheckedIOException(ex); }
        });
        storage.delete(second);
        assertThat(directory.resolve(first)).exists();
        assertThat(directory.resolve(second)).doesNotExist();
    }

    @ParameterizedTest
    @ValueSource(strings = {"WRITE", "CLOSE", "WRITE_AND_CLEANUP"})
    void failedWriteOrCloseCleansOnlyOwnedFileAndKeepsCleanupFailure(String failure) throws Exception {
        var storage = new LocalPhotoStorage(directory.toString());
        byte[] content = {1, 2, 3, 4};
        String original = storage.save(content, "image/png");
        var candidate = new AtomicReference<Path>();
        var primary = new IOException("injected " + failure);
        var cleanup = new IOException("injected cleanup failure");
        // Real CREATE_NEW stream and real bytes; only the failure point is injected.
        try (var filesystem = mockStatic(Files.class, CALLS_REAL_METHODS)) {
            filesystem.when(() -> Files.newOutputStream(any(Path.class), any(OpenOption[].class))).thenAnswer(call -> {
                OutputStream output = (OutputStream) call.callRealMethod();
                candidate.set(call.getArgument(0));
                return new FilterOutputStream(output) {
                    @Override public void write(byte[] bytes, int offset, int length) throws IOException {
                        if (failure.equals("CLOSE")) out.write(bytes, offset, length);
                        else { out.write(bytes, offset, Math.min(2, length)); throw primary; }
                    }
                    @Override public void close() throws IOException {
                        out.close();
                        if (failure.equals("CLOSE")) throw primary;
                    }
                };
            });
            if (failure.equals("WRITE_AND_CLEANUP")) {
                filesystem.when(() -> Files.deleteIfExists(any(Path.class))).thenThrow(cleanup);
            }
            assertThatThrownBy(() -> storage.save(content, "image/png")).isSameAs(primary);
        }
        assertThat(candidate.get()).isNotNull().isNotEqualTo(directory.resolve(original));
        assertThat(Files.readAllBytes(directory.resolve(original))).isEqualTo(content);
        if (failure.equals("WRITE_AND_CLEANUP")) {
            assertThat(primary.getSuppressed()).containsExactly(cleanup);
            assertThat(Files.readAllBytes(candidate.get())).isEqualTo(new byte[]{1, 2});
        } else {
            assertThat(primary.getSuppressed()).isEmpty();
            assertThat(candidate.get()).doesNotExist();
        }
        try (var files = Files.list(directory)) {
            assertThat(files.count()).isEqualTo(failure.equals("WRITE_AND_CLEANUP") ? 2 : 1);
        }
    }

    @Test
    void refusesTraversalAndFileSymlink() throws Exception {
        var storage = new LocalPhotoStorage(directory.toString());
        Path outside = directory.resolve("outside.png");
        Files.write(outside, new byte[]{1});
        assertThatThrownBy(() -> storage.read("../outside.png")).isInstanceOf(java.io.IOException.class);
        assertThatThrownBy(() -> storage.delete(outside.toAbsolutePath().toString())).isInstanceOf(java.io.IOException.class);
        Path link = directory.resolve("11111111-1111-1111-1111-111111111111.png");
        Files.createSymbolicLink(link, outside);
        assertThatThrownBy(() -> storage.read(link.getFileName().toString())).isInstanceOf(java.nio.file.NoSuchFileException.class);
        assertThat(outside).exists();
    }

    @Test
    void unusableRootAndRootSymlinkCannotWrite() throws Exception {
        Path file = Files.write(directory.resolve("not-a-directory"), new byte[]{1});
        assertThatThrownBy(() -> new LocalPhotoStorage(file.toString()).save(new byte[]{1}, "image/png"))
                .isInstanceOf(java.io.IOException.class);
        Path link = directory.resolve("linked-root");
        Files.createSymbolicLink(link, directory);
        assertThatThrownBy(() -> new LocalPhotoStorage(link.toString()).save(new byte[]{1}, "image/png"))
                .isInstanceOf(java.io.IOException.class);
    }
}
