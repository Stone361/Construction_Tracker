package com.example.constructiontracker.dto;

import com.example.constructiontracker.domain.ConstructionStage;
import com.example.constructiontracker.domain.PhotoMetadata;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;

/** 上传和详情共用照片响应；内部存储键和内容哈希不向客户端暴露。 */
public record PhotoResponse(
        Long id, Long houseId, ConstructionStage stage, String locationStatus,
        Instant takenAt, String takenAtSource, LocalDate businessDate,
        Instant uploadedAt, String uploadedBy, String originalFilename,
        String contentType, Long fileSize, BigDecimal gpsLat, BigDecimal gpsLng, Double distanceM,
        String url) {

    public static PhotoResponse from(PhotoMetadata photo) {
        return new PhotoResponse(photo.id(), photo.houseId(), photo.stage(), photo.locationStatus(),
                photo.takenAt().toInstant(ZoneOffset.UTC), photo.takenAtSource(), photo.businessDate(),
                photo.uploadedAt().toInstant(ZoneOffset.UTC), photo.uploadedBy(), photo.originalFilename(),
                photo.contentType(), photo.fileSize(), photo.gpsLat(), photo.gpsLng(), photo.distanceM(),
                "/api/houses/" + photo.houseId() + "/photos/" + photo.id() + "/file");
    }
}
