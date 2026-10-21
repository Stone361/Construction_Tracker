package com.example.constructiontracker.service;

import com.example.constructiontracker.PhotoTestFiles;
import com.example.constructiontracker.PhotoTestFiles.Gps;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;

import java.time.Instant;
import java.time.ZoneId;
import java.util.Arrays;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

class PhotoExifParserTests {
    private static final Instant UPLOADED = Instant.parse("2026-07-01T04:59:59.123456Z");
    private final PhotoExifParser parser = new PhotoExifParser();

    @ParameterizedTest
    @MethodSource("times")
    void resolvesOriginalTimeStrictly(String date, String offset, String subsecond, String expected) throws Exception {
        var result = parser.parse(PhotoTestFiles.withExif("jpeg", PhotoTestFiles.exif(date, offset, subsecond, null)),
                "image/jpeg", UPLOADED);
        assertThat(result.takenAt()).isEqualTo(expected == null ? UPLOADED : Instant.parse(expected));
        assertThat(result.takenAtSource()).isEqualTo(expected == null ? "UPLOAD" : "EXIF");
    }

    static Stream<Arguments> times() {
        return Stream.of(
                Arguments.of("2026:07:01 00:30:00", "-05:00", null, "2026-07-01T05:30:00Z"),
                Arguments.of("2026:07:01 00:30:00", "+09:00", null, "2026-06-30T15:30:00Z"),
                Arguments.of("2026:07:01 00:30:00", null, null, "2026-07-01T05:30:00Z"),
                Arguments.of("2026:01:01 00:30:00", null, null, "2026-01-01T06:30:00Z"),
                Arguments.of("2026:07:01 00:30:00", "-05:00", "123456789", "2026-07-01T05:30:00.123456Z"),
                Arguments.of("2026:07:01 00:30:00", null, "7", "2026-07-01T05:30:00.700Z"),
                Arguments.of("2026:07:01 00:30:00", null, "bad", "2026-07-01T05:30:00Z"),
                Arguments.of("2026:11:01 01:30:00", null, null, "2026-11-01T06:30:00Z"),
                Arguments.of("2026:03:08 02:30:00", null, null, null),
                Arguments.of(null, null, null, null),
                Arguments.of("2026:02:30 12:00:00", null, null, null),
                Arguments.of("2026:07:01 00:30:00", "+25:00", null, null),
                Arguments.of("2026:07:01 00:30:00", "", null, null),
                Arguments.of("2026:07:01 00:30:00", "UTC", null, null),
                Arguments.of("2026:07:01 00:30:00", "x".repeat(100), null, null),
                Arguments.of("0999:12:31 00:00:00", "+00:00", null, null),
                Arguments.of("1000:01:01 00:00:00", "+00:00", null, null),
                Arguments.of("9999:12:31 23:59:59", "-05:00", null, null));
    }

    @ParameterizedTest
    @ValueSource(strings = {"jpeg", "png", "webp"})
    void readsRealExifInAllSupportedContainers(String format) throws Exception {
        var gps = new Gps("N", dms(30, 15, 123456789, 10000000), "W", dms(97, 44, 36, 1));
        var result = parser.parse(PhotoTestFiles.withExif(format,
                PhotoTestFiles.exif("2026:07:01 00:30:00", "+09:00", "123456", gps)), "image/" + format, UPLOADED);
        assertThat(result.takenAt()).isEqualTo(Instant.parse("2026-06-30T15:30:00.123456Z"));
        assertThat(result.takenAt().atZone(ZoneId.of("America/Chicago")).toLocalDate()).hasToString("2026-06-30");
        assertThat(result.gpsLat()).isEqualByComparingTo("30.2534294");
        assertThat(result.gpsLng()).isEqualByComparingTo("-97.7433333");
        assertThat(parser.parse(PhotoTestFiles.image(format), "image/" + format, UPLOADED).takenAtSource()).isEqualTo("UPLOAD");
    }

    @ParameterizedTest
    @MethodSource("gpsCases")
    void validatesGpsIndependently(Gps gps, String lat, String lng) throws Exception {
        var result = parser.parse(PhotoTestFiles.withExif("png",
                PhotoTestFiles.exif("bad date", null, null, gps)), "image/png", UPLOADED);
        assertThat(result.takenAtSource()).isEqualTo("UPLOAD");
        if (lat == null) {
            assertThat(result.gpsLat()).isNull(); assertThat(result.gpsLng()).isNull();
        } else {
            assertThat(result.gpsLat()).isEqualByComparingTo(lat);
            assertThat(result.gpsLng()).isEqualByComparingTo(lng);
            assertThat(result.gpsLat().scale()).isEqualTo(7);
        }
    }

    static Stream<Arguments> gpsCases() {
        return Stream.of(
                Arguments.of(new Gps("S", dms(30, 0, 0, 1), "E", dms(97, 0, 0, 1)), "-30", "97"),
                Arguments.of(new Gps("N", dms(0, 0, 0, 1), "E", dms(0, 0, 0, 1)), "0", "0"),
                Arguments.of(new Gps("N", dms(91, 0, 0, 1), "E", dms(97, 0, 0, 1)), null, null),
                Arguments.of(new Gps("N", dms(30, 60, 0, 1), "E", dms(97, 0, 0, 1)), null, null),
                Arguments.of(new Gps("N", dms(30, 0, 0, 0), "E", dms(97, 0, 0, 1)), null, null),
                Arguments.of(new Gps("X", dms(30, 0, 0, 1), "E", dms(97, 0, 0, 1)), null, null),
                Arguments.of(new Gps("N", dms(30, 0, 0, 1), null, dms(97, 0, 0, 1)), null, null),
                Arguments.of(new Gps("N", dms(30, 0, 0, 1), "E", null), null, null));
    }

    @Test
    void badGpsDoesNotDiscardValidTime() throws Exception {
        var gps = new Gps("N", dms(30, 0, 0, 0), "E", dms(97, 0, 0, 1));
        var result = parser.parse(PhotoTestFiles.withExif("webp",
                PhotoTestFiles.exif("2026:07:01 00:30:00", "+00:00", null, gps)), "image/webp", UPLOADED);
        assertThat(result.takenAtSource()).isEqualTo("EXIF");
        assertThat(result.gpsLat()).isNull(); assertThat(result.gpsLng()).isNull();
    }

    @ParameterizedTest
    @ValueSource(strings = {"png", "webp"})
    void damagedAndOverBudgetExifFallBackWithoutChangingImageBytes(String format) throws Exception {
        byte[] valid = PhotoTestFiles.exif("2026:07:01 00:30:00", null, null, null);
        for (byte[] exif : new byte[][]{new byte[]{'I', 'I', 42}, Arrays.copyOf(valid, PhotoExifParser.EXIF_BUDGET_BYTES + 1)}) {
            byte[] image = PhotoTestFiles.withExif(format, exif), original = image.clone();
            var result = parser.parse(image, "image/" + format, UPLOADED);
            assertThat(result.takenAtSource()).isEqualTo("UPLOAD");
            assertThat(result.takenAt()).isEqualTo(UPLOADED);
            assertThat(result.gpsLat()).isNull();
            assertThat(image).isEqualTo(original);
        }
    }

    private static long[][] dms(long degrees, long minutes, long seconds, long denominator) {
        return new long[][]{{degrees, 1}, {minutes, 1}, {seconds, denominator}};
    }
}
