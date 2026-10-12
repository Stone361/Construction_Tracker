package com.example.constructiontracker.domain;

/**
 * 身份解析后的不可变用户信息。
 * username 和 community 已去除首尾空白；非现场负责人的 community 可以为 null。
 */
public record UserIdentity(String username, UserRole role, String community) {
}
