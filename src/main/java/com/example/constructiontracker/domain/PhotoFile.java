package com.example.constructiontracker.domain;

/** 仅供文件读取使用，存储键不作为接口JSON字段。 */
public record PhotoFile(String storageKey, String contentType, Long fileSize) {
}
