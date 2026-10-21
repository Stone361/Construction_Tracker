package com.example.constructiontracker.dto;

import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;
import java.net.URI;
import java.time.DateTimeException;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;

/** 来源字段是可选扩展；公开数据导入必须同时提供 URL 与获取时间。 */
public record CreateHouseRequest(
        @NotBlank @Size(max = 128) String permitNo,
        @NotBlank @Size(max = 512) String address,
        @NotBlank @Size(max = 128) String community,
        @DecimalMin("-90") @DecimalMax("90") @Digits(integer = 3, fraction = 7) BigDecimal lat,
        @DecimalMin("-180") @DecimalMax("180") @Digits(integer = 3, fraction = 7) BigDecimal lng,
        @Size(max = 2048) String sourceUrl,
        Instant sourceFetchedAt) {

    public CreateHouseRequest {
        permitNo = strip(permitNo);
        address = strip(address);
        community = strip(community);
        sourceUrl = strip(sourceUrl);
    }

    @AssertTrue(message = "lat 和 lng 必须同时提供或同时为空")
    public boolean isCoordinatePairValid() {
        return (lat == null) == (lng == null);
    }

    @AssertTrue(message = "来源 URL 和获取时间必须同时提供，URL 须为 HTTP/HTTPS 地址，UTC 年份须为1000到9999")
    public boolean isSourceMetadataValid() {
        if (sourceUrl == null && sourceFetchedAt == null) {
            return true;
        }
        if (sourceUrl == null || sourceUrl.isBlank() || sourceFetchedAt == null) {
            return false;
        }
        try {
            URI uri = URI.create(sourceUrl);
            int year = LocalDateTime.ofInstant(sourceFetchedAt, ZoneOffset.UTC).getYear();
            return ("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme()))
                    && uri.getHost() != null && uri.getUserInfo() == null && year >= 1000 && year <= 9999;
        } catch (IllegalArgumentException | DateTimeException ex) {
            return false;
        }
    }

    private static String strip(String value) {
        return value == null ? null : value.strip();
    }
}
