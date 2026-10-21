package com.example.constructiontracker.dto;

import com.example.constructiontracker.domain.ConstructionStage;

import java.util.Collections;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;

public record SummaryResponse(Map<ConstructionStage, Long> stageCounts, List<Long> staleHouseIds) {
    public SummaryResponse {
        var counts = new EnumMap<ConstructionStage, Long>(ConstructionStage.class);
        counts.putAll(stageCounts);
        stageCounts = Collections.unmodifiableMap(counts);
        staleHouseIds = List.copyOf(staleHouseIds);
    }
}
