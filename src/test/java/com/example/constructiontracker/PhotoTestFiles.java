package com.example.constructiontracker;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.util.Arrays;
import java.util.Base64;
import java.util.zip.CRC32;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/** Small generated image fixtures; the WebP is a generated 2x2 lossless image. */
public final class PhotoTestFiles {
    private PhotoTestFiles() { }

    public static byte[] image(String format) throws IOException {
        if (format.equals("webp")) return Base64.getDecoder().decode("UklGRh4AAABXRUJQVlA4TBEAAAAvAUAAAAdQqHoUr/+BiOh/AAA=");
        var image = new BufferedImage(2, 2, BufferedImage.TYPE_INT_RGB);
        image.setRGB(0, 0, 0x1e5078);
        try (var output = new ByteArrayOutputStream()) {
            if (!ImageIO.write(image, format, output)) throw new IOException("Missing test image writer");
            return output.toByteArray();
        }
    }

    /** Actual little-endian TIFF IFD0 -> Exif/GPS bytes; tags may be deliberately invalid. */
    public static byte[] exif(String date, String offset, String subsecond, Gps gps) {
        var timeTags = new ArrayList<Tag>();
        if (date != null) timeTags.add(ascii(0x9003, date));
        if (offset != null) timeTags.add(ascii(0x9011, offset));
        if (subsecond != null) timeTags.add(ascii(0x9291, subsecond));
        var gpsTags = new ArrayList<Tag>();
        if (gps != null) {
            if (gps.latitudeRef() != null) gpsTags.add(ascii(1, gps.latitudeRef()));
            if (gps.latitude() != null) gpsTags.add(rationals(2, gps.latitude()));
            if (gps.longitudeRef() != null) gpsTags.add(ascii(3, gps.longitudeRef()));
            if (gps.longitude() != null) gpsTags.add(rationals(4, gps.longitude()));
        }
        int timeOffset = 38, gpsOffset = timeOffset + 6 + timeTags.size() * 12;
        int dataOffset = gpsOffset + 6 + gpsTags.size() * 12;
        int length = dataOffset;
        for (Tag tag : timeTags) if (tag.bytes().length > 4) length += tag.bytes().length;
        for (Tag tag : gpsTags) if (tag.bytes().length > 4) length += tag.bytes().length;
        var data = ByteBuffer.allocate(length).order(ByteOrder.LITTLE_ENDIAN);
        data.put((byte) 'I').put((byte) 'I').putShort((short) 42).putInt(8);
        writeIfd(data, 8, List.of(pointer(0x8769, timeOffset), pointer(0x8825, gpsOffset)), dataOffset);
        dataOffset = writeIfd(data, timeOffset, timeTags, dataOffset);
        writeIfd(data, gpsOffset, gpsTags, dataOffset);
        return data.array();
    }

    public static byte[] withExif(String format, byte[] exif) throws IOException {
        byte[] image = image(format);
        try (var output = new ByteArrayOutputStream(); var data = new DataOutputStream(output)) {
            switch (format) {
                case "jpeg" -> {
                    if (exif.length > 65527) throw new IllegalArgumentException("JPEG APP1 is too large");
                    data.write(image, 0, 2);
                    data.writeShort(0xffe1);
                    data.writeShort(exif.length + 8);
                    data.write(new byte[]{'E', 'x', 'i', 'f', 0, 0});
                    data.write(exif);
                    data.write(image, 2, image.length - 2);
                }
                case "png" -> {
                    data.write(image, 0, image.length - 12);
                    byte[] type = {'e', 'X', 'I', 'f'};
                    var crc = new CRC32(); crc.update(type); crc.update(exif);
                    data.writeInt(exif.length); data.write(type); data.write(exif); data.writeInt((int) crc.getValue());
                    data.write(image, image.length - 12, 12);
                }
                case "webp" -> {
                    int padded = exif.length + (exif.length & 1);
                    data.writeBytes("RIFF");
                    data.writeInt(Integer.reverseBytes(image.length - 8 + 18 + 8 + padded));
                    data.writeBytes("WEBPVP8X"); data.writeInt(Integer.reverseBytes(10));
                    data.write(new byte[]{8, 0, 0, 0, 1, 0, 0, 1, 0, 0}); // EXIF flag, 2x2 canvas.
                    data.write(image, 12, image.length - 12);
                    data.writeBytes("EXIF"); data.writeInt(Integer.reverseBytes(exif.length)); data.write(exif);
                    if ((exif.length & 1) != 0) data.writeByte(0);
                }
                default -> throw new IllegalArgumentException("Unsupported EXIF fixture format");
            }
            return output.toByteArray();
        }
    }

    private static int writeIfd(ByteBuffer data, int offset, List<Tag> tags, int nextData) {
        data.position(offset); data.putShort((short) tags.size());
        for (Tag tag : tags) {
            data.putShort((short) tag.id()).putShort((short) tag.format()).putInt(tag.count());
            if (tag.bytes().length <= 4) {
                data.put(tag.bytes());
                for (int i = tag.bytes().length; i < 4; i++) data.put((byte) 0);
            } else {
                data.putInt(nextData);
                System.arraycopy(tag.bytes(), 0, data.array(), nextData, tag.bytes().length);
                nextData += tag.bytes().length;
            }
        }
        data.putInt(0);
        return nextData;
    }

    private static Tag ascii(int id, String value) {
        byte[] bytes = (value + "\0").getBytes(StandardCharsets.US_ASCII);
        return new Tag(id, 2, bytes.length, bytes);
    }
    private static Tag pointer(int id, int value) {
        return new Tag(id, 4, 1, ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putInt(value).array());
    }
    private static Tag rationals(int id, long[][] values) {
        var bytes = ByteBuffer.allocate(values.length * 8).order(ByteOrder.LITTLE_ENDIAN);
        for (long[] value : values) bytes.putInt((int) value[0]).putInt((int) value[1]);
        return new Tag(id, 5, values.length, bytes.array());
    }
    private record Tag(int id, int format, int count, byte[] bytes) { }
    public record Gps(String latitudeRef, long[][] latitude, String longitudeRef, long[][] longitude) { }

    /** A valid ancillary PNG chunk provides exact byte-limit fixtures without a huge bitmap. */
    public static byte[] pngOfSize(int size) throws IOException {
        byte[] png = image("png");
        int paddingLength = size - png.length - 12;
        if (paddingLength < 0) throw new IllegalArgumentException("PNG size is too small");
        byte[] type = {'r', 'a', 'N', 'd'};
        byte[] padding = new byte[paddingLength];
        var crc = new CRC32();
        crc.update(type);
        crc.update(padding);
        try (var output = new ByteArrayOutputStream(size); var data = new DataOutputStream(output)) {
            data.write(png, 0, png.length - 12);
            data.writeInt(paddingLength);
            data.write(type);
            data.write(padding);
            data.writeInt((int) crc.getValue());
            data.write(Arrays.copyOfRange(png, png.length - 12, png.length));
            return output.toByteArray();
        }
    }
}
