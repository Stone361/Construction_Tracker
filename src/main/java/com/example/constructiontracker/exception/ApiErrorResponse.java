package com.example.constructiontracker.exception;

/** 所有接口错误使用的统一响应格式。 */
public record ApiErrorResponse(String code, String message) {
}
