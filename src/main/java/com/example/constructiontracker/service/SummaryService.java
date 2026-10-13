package com.example.constructiontracker.service;

import com.example.constructiontracker.domain.ConstructionStage;
import com.example.constructiontracker.dto.SummaryResponse;
import com.example.constructiontracker.exception.BusinessException;
import com.example.constructiontracker.mapper.SummaryMapper;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.DateTimeException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.EnumMap;

@Service
public class SummaryService {
    private static final ZoneId BUSINESS_ZONE = ZoneId.of("America/Chicago");
    private final SummaryMapper mapper;
    private final Clock clock;

    public SummaryService(SummaryMapper mapper, Clock clock) {
        this.mapper = mapper;
        this.clock = clock;
    }

    /** 两次非锁定查询共用一个只读快照，不能各自使用不同的当前时间。 */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public SummaryResponse summary(String asOf) {
        LocalDateTime utc;
        LocalDate businessDate;
        try {
            Instant instant;
            if (asOf == null) {
                instant = clock.instant();
            } else {
                if (asOf.isBlank() || asOf.length() > 64) throw invalidAsOf();
                OffsetDateTime parsed = OffsetDateTime.parse(asOf.strip(), DateTimeFormatter.ISO_OFFSET_DATE_TIME);
                if (!parsed.getOffset().equals(ZoneOffset.UTC)) throw invalidAsOf();
                instant = parsed.toInstant();
            }
            instant = instant.truncatedTo(ChronoUnit.MICROS);
            utc = LocalDateTime.ofInstant(instant, ZoneOffset.UTC);
            businessDate = instant.atZone(BUSINESS_ZONE).toLocalDate();
            if (utc.getYear() < 1000 || utc.getYear() > 9999
                    || businessDate.getYear() < 1000 || businessDate.getYear() > 9999) {
                throw invalidAsOf();
            }
        } catch (DateTimeException ex) {
            throw invalidAsOf();
        }

        var counts = new EnumMap<ConstructionStage, Long>(ConstructionStage.class);
        for (ConstructionStage stage : ConstructionStage.values()) counts.put(stage, 0L);
        for (var row : mapper.stageCounts(utc, businessDate)) counts.put(row.stage(), row.count());
        return new SummaryResponse(counts, mapper.staleHouseIds(utc, businessDate));
    }

    private static BusinessException invalidAsOf() {
        return new BusinessException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST",
                "asOf 必须为有效的 ISO-8601 UTC 时间（Z 或 +00:00），且 UTC 与 Chicago 日期年份须为1000到9999");
    }
}
