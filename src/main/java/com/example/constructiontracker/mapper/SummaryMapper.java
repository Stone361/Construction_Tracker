package com.example.constructiontracker.mapper;

import com.example.constructiontracker.domain.StageCount;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

@Mapper
public interface SummaryMapper {
    List<StageCount> stageCounts(@Param("asOfUtc") LocalDateTime asOfUtc,
                                @Param("asOfBusinessDate") LocalDate asOfBusinessDate);

    List<Long> staleHouseIds(@Param("asOfUtc") LocalDateTime asOfUtc,
                             @Param("asOfBusinessDate") LocalDate asOfBusinessDate);
}
