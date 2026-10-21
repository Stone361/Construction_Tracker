package com.example.constructiontracker.exception;

import java.util.Objects;
import org.springframework.http.HttpStatus;

/** 业务服务抛出的异常；message 应当是可以公开给调用者的提示。 */
public class BusinessException extends RuntimeException {

    private final HttpStatus status;
    private final String code;

    public BusinessException(HttpStatus status, String code, String message) {
        super(requireText(message, "message"));
        this.status = Objects.requireNonNull(status, "status");
        if (!status.isError()) {
            throw new IllegalArgumentException("BusinessException requires an error HTTP status");
        }
        this.code = requireText(code, "code");
    }

    public HttpStatus getStatus() {
        return status;
    }

    public String getCode() {
        return code;
    }

    private static String requireText(String value, String name) {
        Objects.requireNonNull(value, name);
        if (value.isBlank()) {
            throw new IllegalArgumentException(name + " must not be blank");
        }
        return value;
    }
}
