package com.example.constructiontracker.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;

public record SetCoverRequest(
        @NotNull(message = "照片 ID 不能为空")
        @Positive(message = "照片 ID 必须为正整数") Long photoId) {
}
