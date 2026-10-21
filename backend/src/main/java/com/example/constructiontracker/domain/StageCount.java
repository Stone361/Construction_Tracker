package com.example.constructiontracker.domain;

/** 汇总 SQL 的阶段计数结果。 */
public record StageCount(ConstructionStage stage, Long count) {
}
