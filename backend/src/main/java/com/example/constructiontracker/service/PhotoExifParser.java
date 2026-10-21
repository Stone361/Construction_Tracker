package com.example.constructiontracker.service;

import com.drew.imaging.jpeg.JpegSegmentReader;
import com.drew.imaging.jpeg.JpegSegmentType;
import com.drew.imaging.png.PngChunkReader;
import com.drew.imaging.png.PngChunkType;
import com.drew.imaging.riff.RiffHandler;
import com.drew.imaging.riff.RiffReader;
import com.drew.imaging.tiff.TiffReader;
import com.drew.lang.ByteArrayReader;
import com.drew.lang.RandomAccessReader;
import com.drew.lang.Rational;
import com.drew.lang.SequentialByteArrayReader;
import com.drew.metadata.Metadata;
import com.drew.metadata.exif.ExifIFD0Directory;
import com.drew.metadata.exif.ExifReader;
import com.drew.metadata.exif.ExifSubIFDDirectory;
import com.drew.metadata.exif.ExifTiffHandler;
import com.drew.metadata.exif.GpsDirectory;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.math.BigDecimal;
import java.math.MathContext;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.format.ResolverStyle;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/** Reads only capture time and GPS; malformed optional metadata never rejects an image. */
@Component
public class PhotoExifParser {
    static final int EXIF_BUDGET_BYTES = 1 << 20;
    private static final ZoneId CHICAGO = ZoneId.of("America/Chicago");
    private static final DateTimeFormatter EXIF_TIME = DateTimeFormatter
            .ofPattern("uuuu:MM:dd HH:mm:ss", Locale.ROOT).withResolverStyle(ResolverStyle.STRICT);

    public Result parse(byte[] content, String contentType, Instant uploadedAt) {
        Metadata metadata = readMetadata(content, contentType);
        Instant takenAt = captureTime(metadata.getFirstDirectoryOfType(ExifSubIFDDirectory.class));
        BigDecimal lat = null, lng = null;
        try {
            var gps = metadata.getFirstDirectoryOfType(GpsDirectory.class);
            if (gps != null) {
                lat = coordinate(gps.getRationalArray(GpsDirectory.TAG_LATITUDE),
                        gps.getString(GpsDirectory.TAG_LATITUDE_REF), "N", "S", 90);
                lng = coordinate(gps.getRationalArray(GpsDirectory.TAG_LONGITUDE),
                        gps.getString(GpsDirectory.TAG_LONGITUDE_REF), "E", "W", 180);
            }
        } catch (RuntimeException ex) { lat = null; lng = null; }
        if (lat == null || lng == null) { lat = null; lng = null; }
        return new Result(takenAt == null ? uploadedAt : takenAt,
                takenAt == null ? "UPLOAD" : "EXIF", lat, lng);
    }

    private Metadata readMetadata(byte[] content, String type) {
        var metadata = new Metadata();
        var input = new BudgetReader(content);
        try {
            switch (type) {
                case "image/jpeg" -> {
                    var segments = JpegSegmentReader.readSegments(input, List.of(JpegSegmentType.APP1));
                    for (byte[] bytes : segments.getSegments(JpegSegmentType.APP1)) {
                        if (ExifReader.startsWithJpegExifPreamble(bytes)) {
                            readExif(bytes, metadata);
                            break;
                        }
                    }
                }
                case "image/png" -> {
                    for (var chunk : new PngChunkReader().extract(input, Set.of(PngChunkType.eXIf))) {
                        readExif(chunk.getBytes(), metadata);
                        break;
                    }
                }
                case "image/webp" -> new RiffReader().processRiff(input, new RiffHandler() {
                    private boolean found;
                    public boolean shouldAcceptRiffIdentifier(String id) { return "WEBP".equals(id); }
                    public boolean shouldAcceptChunk(String id) { return !found && "EXIF".equals(id); }
                    public boolean shouldAcceptList(String id) { return false; }
                    public void processChunk(String id, byte[] bytes) {
                        if ("EXIF".equals(id) && !found) { found = true; readExif(bytes, metadata); }
                    }
                    public void addError(String error) { /* Optional metadata may be damaged. */ }
                });
                default -> { }
            }
        } catch (Exception ex) { /* Container/metadata errors degrade to any independently readable tags. */ }
        return input.exceeded ? new Metadata() : metadata;
    }

    private void readExif(byte[] bytes, Metadata metadata) {
        int offset = ExifReader.startsWithJpegExifPreamble(bytes) ? 6 : 0;
        try {
            new TiffReader().processTiff(new ByteArrayReader(bytes), new CaptureTags(metadata, offset), offset);
        } catch (Exception ex) { /* Keep a valid time even if GPS is corrupt, and vice versa. */ }
    }

    private Instant captureTime(ExifSubIFDDirectory exif) {
        if (exif == null) return null;
        try {
            String value = exif.getString(ExifSubIFDDirectory.TAG_DATETIME_ORIGINAL);
            if (value == null) return null;
            var local = LocalDateTime.parse(value.strip(), EXIF_TIME);
            String subsecond = exif.getString(ExifSubIFDDirectory.TAG_SUBSECOND_TIME_ORIGINAL);
            if (subsecond != null && subsecond.strip().matches("[0-9]{1,64}")) {
                String digits = subsecond.strip();
                int micros = Integer.parseInt((digits + "000000").substring(0, 6));
                local = local.withNano(micros * 1000);
            }
            Instant instant;
            if (exif.containsTag(ExifSubIFDDirectory.TAG_TIME_ZONE_ORIGINAL)) {
                String offset = exif.getString(ExifSubIFDDirectory.TAG_TIME_ZONE_ORIGINAL);
                if (offset == null || !offset.strip().matches("[+-][0-9]{2}:[0-9]{2}")) return null;
                instant = local.toInstant(ZoneOffset.of(offset.strip()));
            } else {
                var offsets = CHICAGO.getRules().getValidOffsets(local);
                if (offsets.isEmpty()) return null; // DST gap: never silently move the camera's time.
                instant = local.toInstant(offsets.getFirst()); // DST overlap: first occurrence.
            }
            int year = instant.atOffset(ZoneOffset.UTC).getYear();
            int businessYear = instant.atZone(CHICAGO).getYear();
            return year < 1000 || year > 9999 || businessYear < 1000 || businessYear > 9999
                    ? null : instant.truncatedTo(ChronoUnit.MICROS);
        } catch (RuntimeException ex) { return null; }
    }

    private BigDecimal coordinate(Rational[] dms, String ref, String positive, String negative, int limit) {
        if (dms == null || dms.length != 3 || ref == null) return null;
        ref = ref.strip();
        if (!ref.equals(positive) && !ref.equals(negative)) return null;
        BigDecimal[] parts = new BigDecimal[3];
        for (int i = 0; i < 3; i++) {
            if (dms[i] == null || dms[i].getDenominator() <= 0 || dms[i].getNumerator() < 0) return null;
            parts[i] = BigDecimal.valueOf(dms[i].getNumerator())
                    .divide(BigDecimal.valueOf(dms[i].getDenominator()), MathContext.DECIMAL128);
        }
        if (parts[1].compareTo(BigDecimal.valueOf(60)) >= 0 || parts[2].compareTo(BigDecimal.valueOf(60)) >= 0) return null;
        BigDecimal value = parts[0].add(parts[1].divide(BigDecimal.valueOf(60), MathContext.DECIMAL128))
                .add(parts[2].divide(BigDecimal.valueOf(3600), MathContext.DECIMAL128));
        if (!Double.isFinite(value.doubleValue()) || value.compareTo(BigDecimal.valueOf(limit)) > 0) return null;
        if (ref.equals(negative)) value = value.negate();
        return value.setScale(7, RoundingMode.HALF_UP);
    }

    /** Bound copied segment/chunk bytes (including small headers) before allocation, not total image size. */
    private static class BudgetReader extends SequentialByteArrayReader {
        private int remaining = EXIF_BUDGET_BYTES;
        private boolean exceeded;
        BudgetReader(byte[] bytes) { super(bytes); }
        @Override public byte[] getBytes(int count) throws IOException {
            if (count < 0 || count > remaining) {
                exceeded = true;
                throw new IOException("EXIF read budget exceeded");
            }
            remaining -= count;
            return super.getBytes(count);
        }
    }

    /** Use the library TIFF walker, limited to IFD0 -> original-time/GPS; no thumbnails or makernotes. */
    private static class CaptureTags extends ExifTiffHandler {
        CaptureTags(Metadata metadata, int offset) { super(metadata, null, offset); }
        @Override public boolean tryEnterSubIfd(int tag) {
            if (!(_currentDirectory instanceof ExifIFD0Directory)) return false;
            if (tag == ExifIFD0Directory.TAG_EXIF_SUB_IFD_OFFSET
                    && _metadata.getFirstDirectoryOfType(ExifSubIFDDirectory.class) == null) return super.tryEnterSubIfd(tag);
            if (tag == ExifIFD0Directory.TAG_GPS_INFO_OFFSET
                    && _metadata.getFirstDirectoryOfType(GpsDirectory.class) == null) return super.tryEnterSubIfd(tag);
            return false;
        }
        @Override public boolean hasFollowerIfd() { return false; }
        @Override public boolean customProcessTag(int tagOffset, Set<Integer> visited, int headerOffset,
                                                 RandomAccessReader reader, int tag, int byteCount) {
            if (_currentDirectory instanceof ExifSubIFDDirectory) {
                if (tag == ExifSubIFDDirectory.TAG_DATETIME_ORIGINAL
                        || tag == ExifSubIFDDirectory.TAG_TIME_ZONE_ORIGINAL) {
                    _currentDirectory.setString(tag, ""); // Replaced by a valid value; invalid present tags remain present.
                }
                return byteCount > 64 || !(tag == ExifSubIFDDirectory.TAG_DATETIME_ORIGINAL
                        || tag == ExifSubIFDDirectory.TAG_TIME_ZONE_ORIGINAL
                        || tag == ExifSubIFDDirectory.TAG_SUBSECOND_TIME_ORIGINAL);
            }
            if (_currentDirectory instanceof GpsDirectory) {
                return byteCount > 24 || !(tag == GpsDirectory.TAG_LATITUDE || tag == GpsDirectory.TAG_LATITUDE_REF
                        || tag == GpsDirectory.TAG_LONGITUDE || tag == GpsDirectory.TAG_LONGITUDE_REF);
            }
            return true;
        }
    }

    public record Result(Instant takenAt, String takenAtSource, BigDecimal gpsLat, BigDecimal gpsLng) { }
}
