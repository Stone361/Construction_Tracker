package com.example.constructiontracker.domain;

/** 请求头 X-Role 支持的身份角色；具体操作权限由后续授权组件判断。 */
public enum UserRole {
    ADMIN,
    SITE_MANAGER,
    VIEWER
}
