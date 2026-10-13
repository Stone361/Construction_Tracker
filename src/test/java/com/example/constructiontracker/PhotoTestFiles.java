package com.example.constructiontracker;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.util.Arrays;
import java.util.Base64;
import java.util.zip.CRC32;

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
