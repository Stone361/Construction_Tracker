package com.example.constructiontracker.dto;

import com.example.constructiontracker.domain.ConstructionStage;
import com.example.constructiontracker.domain.House;
import com.example.constructiontracker.domain.HouseSourceType;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;

/** 独立详情响应：完整房屋字段和照片数组，不改变创建/列表响应。 */
public record HouseDetailResponse(
        Long id, String permitNo, String address, String community,
        BigDecimal lat, BigDecimal lng, ConstructionStage stage, Long coverPhotoId,
        HouseSourceType sourceType, String sourceUrl, Instant sourceFetchedAt,
        Instant createdAt, LocalDate createdBusinessDate, String createdBy,
        Instant updatedAt, List<PhotoResponse> photos) {

    public HouseDetailResponse {
        photos = List.copyOf(photos);
    }

    public static HouseDetailResponse from(House house, List<PhotoResponse> photos) {
        HouseResponse basic = HouseResponse.from(house);
        return new HouseDetailResponse(basic.id(), basic.permitNo(), basic.address(), basic.community(),
                basic.lat(), basic.lng(), basic.stage(), house.coverPhotoId(), basic.sourceType(),
                basic.sourceUrl(), basic.sourceFetchedAt(), basic.createdAt(), basic.createdBusinessDate(),
                house.createdBy(), house.updatedAt().toInstant(ZoneOffset.UTC), photos);
    }
}
