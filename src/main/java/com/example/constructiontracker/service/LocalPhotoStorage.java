package com.example.constructiontracker.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.UUID;

/** 一个具体本地存储组件；只接受服务端生成的文件名，不使用原始上传名拼路径。 */
@Component
public class LocalPhotoStorage {
    private final Path directory;

    public LocalPhotoStorage(@Value("${photos.storage-directory}") String directory) {
        this.directory = Path.of(directory).toAbsolutePath().normalize();
    }

    public String save(byte[] content, String contentType) throws IOException {
        String suffix = switch (contentType) {
            case "image/jpeg" -> ".jpg";
            case "image/png" -> ".png";
            case "image/webp" -> ".webp";
            default -> throw new IllegalArgumentException("Unsupported stored image type");
        };
        Files.createDirectories(directory);
        if (Files.isSymbolicLink(directory)) throw new IOException("Storage directory is a symbolic link");
        String key = UUID.randomUUID() + suffix;
        Path target = resolve(key);
        boolean created = false;
        try (var output = Files.newOutputStream(target, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)) {
            created = true;
            output.write(content);
        } catch (IOException ex) {
            if (created) {
                try { Files.deleteIfExists(target); }
                catch (IOException cleanup) { ex.addSuppressed(cleanup); }
            }
            throw ex;
        }
        return key;
    }

    public void delete(String key) throws IOException {
        Files.deleteIfExists(resolve(key));
    }

    public Resource read(String key) throws IOException {
        Path target = resolve(key);
        if (Files.isSymbolicLink(directory) || !Files.isRegularFile(target, LinkOption.NOFOLLOW_LINKS)) {
            throw new java.nio.file.NoSuchFileException("Stored photo is missing");
        }
        return new FileSystemResource(target);
    }

    private Path resolve(String key) throws IOException {
        if (key == null || !key.matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(jpg|png|webp)")) {
            throw new IOException("Invalid server storage key");
        }
        Path target = directory.resolve(key).normalize();
        if (!target.getParent().equals(directory)) throw new IOException("Storage path escapes directory");
        return target;
    }
}
