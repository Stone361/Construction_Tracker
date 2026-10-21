package com.example.constructiontracker.domain;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;

/** 数据库房屋记录。所有 LocalDateTime 均表示 UTC，不使用 JVM 默认时区。 */
public record House(
        Long id, String permitNo, String address, String community,
        BigDecimal lat, BigDecimal lng, ConstructionStage stage, Long coverPhotoId,
        HouseSourceType sourceType, String sourceUrl, LocalDateTime sourceFetchedAt,
        LocalDateTime createdAt, LocalDate createdBusinessDate, String createdBy,
        LocalDateTime updatedAt) {
}
