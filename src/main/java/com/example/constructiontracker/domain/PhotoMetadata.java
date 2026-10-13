package com.example.constructiontracker.domain;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;

/** 照片只读元数据；时间约定为 UTC，不向接口暴露存储键或内容哈希。 */
public record PhotoMetadata(
        Long id, Long houseId, ConstructionStage stage, String locationStatus,
        LocalDateTime takenAt, String takenAtSource, LocalDate businessDate,
        LocalDateTime uploadedAt, String uploadedBy, String originalFilename,
        String contentType, Long fileSize, BigDecimal gpsLat, BigDecimal gpsLng, Double distanceM) {
}
