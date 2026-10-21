package com.example.constructiontracker.exception;

/** 认证失败，由全局异常处理器转换为 HTTP 401 和统一 JSON 错误响应。 */
public class AuthenticationException extends RuntimeException {

    public AuthenticationException(String message) {
        super(message);
    }
}
