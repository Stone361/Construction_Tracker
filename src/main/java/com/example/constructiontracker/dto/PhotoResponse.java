package com.example.constructiontracker.dto;

import com.example.constructiontracker.domain.ConstructionStage;
import com.example.constructiontracker.domain.PhotoMetadata;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;

/** 详情中的照片元数据；文件访问 URL 随后续照片存储功能实现。 */
public record PhotoResponse(
        Long id, Long houseId, ConstructionStage stage, String locationStatus,
        Instant takenAt, String takenAtSource, LocalDate businessDate,
        Instant uploadedAt, String uploadedBy, String originalFilename,
        String contentType, Long fileSize, BigDecimal gpsLat, BigDecimal gpsLng, Double distanceM) {

    public static PhotoResponse from(PhotoMetadata photo) {
        return new PhotoResponse(photo.id(), photo.houseId(), photo.stage(), photo.locationStatus(),
                photo.takenAt().toInstant(ZoneOffset.UTC), photo.takenAtSource(), photo.businessDate(),
                photo.uploadedAt().toInstant(ZoneOffset.UTC), photo.uploadedBy(), photo.originalFilename(),
                photo.contentType(), photo.fileSize(), photo.gpsLat(), photo.gpsLng(), photo.distanceM());
    }
}
