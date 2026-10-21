package com.example.constructiontracker.dto;

import com.example.constructiontracker.domain.ConstructionStage;
import jakarta.validation.constraints.NotNull;

public record AdvanceHouseRequest(
        @NotNull(message = "原阶段不能为空") ConstructionStage fromStage,
        @NotNull(message = "目标阶段不能为空") ConstructionStage toStage) {
}
