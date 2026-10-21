package com.example.constructiontracker.dto;

import com.example.constructiontracker.domain.ConstructionStage;
import com.example.constructiontracker.domain.House;
import com.example.constructiontracker.domain.HouseListRow;
import com.example.constructiontracker.domain.HouseSourceType;
import com.fasterxml.jackson.annotation.JsonInclude;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;

/** 创建与列表响应；列表补充封面 URL 和聚合后的最后照片业务日。 */
public record HouseResponse(
        Long id, String permitNo, String address, String community,
        BigDecimal lat, BigDecimal lng, ConstructionStage stage,
        HouseSourceType sourceType, String sourceUrl, Instant sourceFetchedAt,
        Instant createdAt, LocalDate createdBusinessDate,
        @JsonInclude(JsonInclude.Include.ALWAYS) String coverPhotoUrl,
        @JsonInclude(JsonInclude.Include.ALWAYS) LocalDate lastPhotoBusinessDate) {

    public static HouseResponse from(House house) {
        return from(house, null, null);
    }

    public static HouseResponse from(HouseListRow row) {
        House house = row.house();
        String coverUrl = house.coverPhotoId() == null ? null
                : "/api/houses/" + house.id() + "/photos/" + house.coverPhotoId() + "/file";
        return from(house, coverUrl, row.lastPhotoBusinessDate());
    }

    private static HouseResponse from(House house, String coverUrl, LocalDate lastPhotoBusinessDate) {
        return new HouseResponse(house.id(), house.permitNo(), house.address(), house.community(),
                house.lat(), house.lng(), house.stage(), house.sourceType(), house.sourceUrl(),
                house.sourceFetchedAt() == null ? null : house.sourceFetchedAt().toInstant(ZoneOffset.UTC),
                house.createdAt().toInstant(ZoneOffset.UTC), house.createdBusinessDate(), coverUrl, lastPhotoBusinessDate);
    }
}
