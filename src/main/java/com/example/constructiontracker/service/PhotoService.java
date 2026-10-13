package com.example.constructiontracker.service;

import com.example.constructiontracker.domain.PhotoFile;
import com.example.constructiontracker.domain.PhotoMetadata;
import com.example.constructiontracker.domain.UserIdentity;
import com.example.constructiontracker.exception.BusinessException;
import com.example.constructiontracker.mapper.HouseMapper;
import com.example.constructiontracker.mapper.PhotoMapper;
import org.springframework.core.io.Resource;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.dao.RecoverableDataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;

import javax.imageio.ImageIO;
import javax.imageio.stream.MemoryCacheImageInputStream;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.file.NoSuchFileException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.Locale;

@Service
public class PhotoService {
    public static final int MAX_FILE_BYTES = 10_000_000;
    private static final ZoneId BUSINESS_ZONE = ZoneId.of("America/Chicago");
    private final HouseMapper houses;
    private final PhotoMapper photos;
    private final AuthorizationService authorization;
    private final LocalPhotoStorage storage;
    private final Clock clock;

    public PhotoService(HouseMapper houses, PhotoMapper photos, AuthorizationService authorization,
                        LocalPhotoStorage storage, Clock clock) {
        this.houses = houses;
        this.photos = photos;
        this.authorization = authorization;
        this.storage = storage;
        this.clock = clock;
    }

    public UploadResult upload(Long houseId, MultipartFile file, UserIdentity identity) {
        requirePositive(houseId);
        var house = houses.findById(houseId);
        if (house == null) throw error(HttpStatus.NOT_FOUND, "NOT_FOUND", "房屋不存在");
        authorization.requireCanManageHouse(identity, house.community());
        if (identity.username() == null || identity.username().isBlank() || identity.username().length() > 128) {
            throw error(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "用户名必须为1到128个字符");
        }
        if (file == null) throw error(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", "缺少file上传字段");
        byte[] content;
        try (var input = file.getInputStream()) {
            content = input.readNBytes(MAX_FILE_BYTES + 1);
        } catch (IOException ex) {
            throw failure("读取上传文件失败", ex);
        }
        if (content.length > MAX_FILE_BYTES) throw error(HttpStatus.PAYLOAD_TOO_LARGE, "PAYLOAD_TOO_LARGE", "单张照片不能超过10 MB");
        String contentType = detectContentType(content);
        byte[] hash = sha256(content);
        var existing = photos.findByHash(houseId, hash);
        if (existing != null) return new UploadResult(existing, false);

        var instant = clock.instant().truncatedTo(ChronoUnit.MICROS);
        var utc = LocalDateTime.ofInstant(instant, ZoneOffset.UTC);
        // 6.1 has not parsed EXIF/GPS. These are explicit upload-time fallbacks,
        // not claims that the original bytes lack metadata; original bytes are retained.
        var photo = new PhotoMetadata(null, houseId, house.stage(), "UNKNOWN", utc, "UPLOAD",
                instant.atZone(BUSINESS_ZONE).toLocalDate(), utc, identity.username(),
                originalName(file.getOriginalFilename()), contentType, (long) content.length, null, null, null);
        String key;
        try { key = storage.save(content, contentType); }
        catch (IOException ex) { throw failure("照片文件保存失败", ex); }

        // One autocommit INSERT: after a unique-key collision the next SELECT
        // sees the committed original. Never delete the file after a successful INSERT.
        try {
            photos.insert(photo, hash, key);
        } catch (RuntimeException ex) {
            // A broken database connection may have lost the commit acknowledgement.
            // Keep this file rather than risk deleting bytes referenced by a committed row.
            if (ex instanceof DataAccessResourceFailureException || ex instanceof RecoverableDataAccessException) {
                throw failure("数据库写入结果未确认，请恢复连接后重试", ex);
            }
            try { storage.delete(key); }
            catch (IOException cleanup) { ex.addSuppressed(cleanup); throw failure("清理未入库照片失败", ex); }
            if (ex instanceof DuplicateKeyException) {
                existing = photos.findByHash(houseId, hash);
                if (existing != null) return new UploadResult(existing, false);
            }
            throw ex;
        }
        var saved = photos.findByHash(houseId, hash);
        if (saved == null) throw failure("照片入库后读取失败", new IllegalStateException("Inserted photo was not found"));
        return new UploadResult(saved, true);
    }

    /** Authenticated roles may read; SQL scopes the photo to the path's house. */
    public Download file(Long houseId, Long photoId) {
        requirePositive(houseId);
        requirePositive(photoId);
        PhotoFile file = photos.findFile(houseId, photoId);
        if (file == null) throw error(HttpStatus.NOT_FOUND, "NOT_FOUND", "照片不存在");
        try { return new Download(file, storage.read(file.storageKey())); }
        catch (NoSuchFileException ex) { throw error(HttpStatus.NOT_FOUND, "NOT_FOUND", "照片文件不存在"); }
        catch (IOException ex) { throw failure("照片文件读取失败", ex); }
    }

    private String detectContentType(byte[] content) {
        if (content.length == 0) throw invalidImage();
        try (var input = new MemoryCacheImageInputStream(new ByteArrayInputStream(content))) {
            var readers = ImageIO.getImageReaders(input);
            if (!readers.hasNext()) throw invalidImage();
            var reader = readers.next();
            try {
                String type = switch (reader.getFormatName().toLowerCase(Locale.ROOT)) {
                    case "jpeg", "jpg" -> "image/jpeg";
                    case "png" -> "image/png";
                    case "webp" -> "image/webp";
                    default -> throw invalidImage();
                };
                if (type.equals("image/jpeg") && (content.length < 2 || content[content.length - 2] != (byte) 0xff || content[content.length - 1] != (byte) 0xd9)) throw invalidImage();
                if (type.equals("image/png") && (content.length < 12 || !java.util.Arrays.equals(java.util.Arrays.copyOfRange(content, content.length - 12, content.length), java.util.HexFormat.of().parseHex("0000000049454e44ae426082")))) throw invalidImage();
                if (type.equals("image/webp")) {
                    if (content.length < 12) throw invalidImage();
                    long declared = Integer.toUnsignedLong(java.nio.ByteBuffer.wrap(content, 4, 4).order(java.nio.ByteOrder.LITTLE_ENDIAN).getInt());
                    if (declared + 8 != content.length) throw invalidImage();
                }
                reader.setInput(input, false, true);
                boolean[] warned = {false};
                reader.addIIOReadWarningListener((source, warning) -> warned[0] = true);
                int frames = reader.getNumImages(true);
                if (frames < 1) throw invalidImage();
                for (int frame = 0; frame < frames; frame++) {
                    int width = reader.getWidth(frame), height = reader.getHeight(frame);
                    if (width < 1 || height < 1) throw invalidImage();
                    // Validate compressed pixels with bounded destination memory;
                    // no arbitrary extra file dimensions/business limit is introduced.
                    int step = Math.max(1, (int) (((long) Math.max(width, height) + 1023) / 1024));
                    var param = reader.getDefaultReadParam();
                    param.setSourceSubsampling(step, step, 0, 0);
                    if (reader.read(frame, param) == null || warned[0]) throw invalidImage();
                }
                return type;
            } finally { reader.dispose(); }
        } catch (BusinessException ex) { throw ex; }
        catch (IOException | RuntimeException ex) { throw invalidImage(); }
    }

    private byte[] sha256(byte[] content) {
        try { return MessageDigest.getInstance("SHA-256").digest(content); }
        catch (NoSuchAlgorithmException ex) { throw new IllegalStateException(ex); }
    }

    private String originalName(String name) {
        if (name == null) return null;
        String base = StringUtils.getFilename(name.replace('\\', '/'));
        return base == null || base.isBlank() || base.length() > 255 ? null : base;
    }

    private void requirePositive(Long id) {
        if (id == null || id <= 0) throw error(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", "ID必须为正整数");
    }

    private BusinessException invalidImage() {
        return error(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "UNSUPPORTED_MEDIA_TYPE", "只接受内容有效的JPEG、PNG或WebP照片");
    }

    private BusinessException error(HttpStatus status, String code, String message) {
        return new BusinessException(status, code, message);
    }

    private BusinessException failure(String message, Exception cause) {
        var error = error(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_SERVER_ERROR", message);
        error.initCause(cause);
        return error;
    }

    public record UploadResult(PhotoMetadata photo, boolean created) { }
    public record Download(PhotoFile file, Resource resource) { }
}
