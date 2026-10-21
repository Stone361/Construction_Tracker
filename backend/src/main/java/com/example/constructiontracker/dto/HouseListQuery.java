package com.example.constructiontracker.dto;

import com.example.constructiontracker.domain.ConstructionStage;
import com.example.constructiontracker.exception.BusinessException;
import org.springframework.http.HttpStatus;

import java.math.BigDecimal;
import java.util.regex.Pattern;

/** 地图查询参数；缺省坐标全为 null，所有过滤条件直接传给数据库。 */
public record HouseListQuery(
        BigDecimal minLng, BigDecimal minLat, BigDecimal maxLng, BigDecimal maxLat,
        ConstructionStage stage) {
    private static final Pattern DECIMAL = Pattern.compile("[+-]?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)");

    public HouseListQuery {
        if (minLng != null || minLat != null || maxLng != null || maxLat != null) {
            if (!inRange(minLng, 180) || !inRange(maxLng, 180)
                    || !inRange(minLat, 90) || !inRange(maxLat, 90)
                    || minLng.compareTo(maxLng) > 0 || minLat.compareTo(maxLat) > 0) {
                throw invalidBbox();
            }
        }
    }

    public static HouseListQuery parse(String bbox, String stage) {
        ConstructionStage parsedStage = null;
        if (stage != null) {
            try {
                parsedStage = ConstructionStage.valueOf(stage.strip());
            } catch (IllegalArgumentException ex) {
                throw new BusinessException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", "stage 必须为有效的施工阶段");
            }
        }
        if (bbox == null) {
            return new HouseListQuery(null, null, null, null, parsedStage);
        }
        if (bbox.length() > 256) {
            throw invalidBbox();
        }
        String[] coordinates = bbox.split(",", -1);
        if (coordinates.length != 4) {
            throw invalidBbox();
        }
        return new HouseListQuery(decimal(coordinates[0]), decimal(coordinates[1]),
                decimal(coordinates[2]), decimal(coordinates[3]), parsedStage);
    }

    /** 原题独立参数转换为同一范围条件；未提供的边界使用坐标合法极值。 */
    public static HouseListQuery parse(String bbox, String stage,
                                       String minLat, String maxLat, String minLng, String maxLng) {
        boolean hasCoordinates = minLat != null || maxLat != null || minLng != null || maxLng != null;
        if (!hasCoordinates) {
            return parse(bbox, stage);
        }
        if (bbox != null) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST",
                    "bbox 与独立坐标参数不能同时使用");
        }
        String bounds = String.join(",", minLng == null ? "-180" : minLng, minLat == null ? "-90" : minLat,
                maxLng == null ? "180" : maxLng, maxLat == null ? "90" : maxLat);
        return parse(bounds, stage);
    }

    private static BigDecimal decimal(String value) {
        String coordinate = value.strip();
        // 常规十进制坐标；限制长度并拒绝 NaN/Infinity 及极端指数，避免驱动绑定异常。
        if (coordinate.length() > 32 || !DECIMAL.matcher(coordinate).matches()) {
            throw invalidBbox();
        }
        return new BigDecimal(coordinate);
    }

    private static boolean inRange(BigDecimal value, int maximum) {
        return value != null && value.compareTo(BigDecimal.valueOf(-maximum)) >= 0
                && value.compareTo(BigDecimal.valueOf(maximum)) <= 0;
    }

    private static BusinessException invalidBbox() {
        return new BusinessException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST",
                "bbox 必须为 minLng,minLat,maxLng,maxLat，坐标须在有效范围且最小值不大于最大值");
    }
}
