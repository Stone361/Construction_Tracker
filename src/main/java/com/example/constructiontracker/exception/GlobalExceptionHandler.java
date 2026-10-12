package com.example.constructiontracker.exception;

import jakarta.validation.ConstraintViolationException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;

/** 统一处理业务异常及 Spring MVC 请求错误，同时保留 HTTP 状态和必要响应头。 */
@RestControllerAdvice
public class GlobalExceptionHandler extends ResponseEntityExceptionHandler {

    @ExceptionHandler(AuthenticationException.class)
    public ResponseEntity<ApiErrorResponse> handleAuthenticationException(AuthenticationException ex) {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .contentType(MediaType.APPLICATION_JSON)
                .body(new ApiErrorResponse("UNAUTHORIZED", ex.getMessage()));
    }

    @ExceptionHandler(BusinessException.class)
    public ResponseEntity<ApiErrorResponse> handleBusinessException(BusinessException ex) {
        if (ex.getStatus().is5xxServerError()) {
            logger.error("业务服务异常", ex);
        }
        return ResponseEntity.status(ex.getStatus())
                .contentType(MediaType.APPLICATION_JSON)
                .body(new ApiErrorResponse(ex.getCode(), ex.getMessage()));
    }

    @ExceptionHandler(ConstraintViolationException.class)
    public ResponseEntity<ApiErrorResponse> handleConstraintViolation(ConstraintViolationException ex) {
        return ResponseEntity.badRequest()
                .contentType(MediaType.APPLICATION_JSON)
                .body(new ApiErrorResponse("VALIDATION_FAILED", "请求参数校验失败"));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiErrorResponse> handleUnexpectedException(Exception ex) {
        logger.error("未处理的服务器异常", ex);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .contentType(MediaType.APPLICATION_JSON)
                .body(standardError(HttpStatus.INTERNAL_SERVER_ERROR));
    }

    @Override
    protected ResponseEntity<Object> handleExceptionInternal(
            Exception ex, Object body, HttpHeaders headers, HttpStatusCode status, WebRequest request) {
        ApiErrorResponse error = standardError(status);
        if (ex instanceof MethodArgumentNotValidException validationException) {
            String message = validationException.getBindingResult().getFieldErrors().stream()
                    .findFirst()
                    .map(fieldError -> fieldError.getField() + ": "
                            + (fieldError.getDefaultMessage() == null
                                    ? "参数不合法" : fieldError.getDefaultMessage()))
                    .orElse("请求参数校验失败");
            error = new ApiErrorResponse("VALIDATION_FAILED", message);
        } else if (ex instanceof HandlerMethodValidationException && status.is4xxClientError()) {
            error = new ApiErrorResponse("VALIDATION_FAILED", "请求参数校验失败");
        }
        if (status.is5xxServerError()) {
            logger.error("Spring MVC 请求处理异常", ex);
        }
        HttpHeaders responseHeaders = new HttpHeaders();
        responseHeaders.putAll(headers);
        responseHeaders.setContentType(MediaType.APPLICATION_JSON);
        return super.handleExceptionInternal(ex, error, responseHeaders, status, request);
    }

    private ApiErrorResponse standardError(HttpStatusCode status) {
        return switch (status.value()) {
            case 400 -> new ApiErrorResponse("INVALID_REQUEST", "请求参数或 JSON 格式不正确");
            case 401 -> new ApiErrorResponse("UNAUTHORIZED", "请提供有效的登录身份");
            case 403 -> new ApiErrorResponse("FORBIDDEN", "没有操作权限");
            case 404 -> new ApiErrorResponse("NOT_FOUND", "请求的资源不存在");
            case 405 -> new ApiErrorResponse("METHOD_NOT_ALLOWED", "该接口不支持此请求方法");
            case 406 -> new ApiErrorResponse("NOT_ACCEPTABLE", "该接口无法提供请求的响应格式");
            case 409 -> new ApiErrorResponse("CONFLICT", "数据状态冲突，请刷新后重试");
            case 413 -> new ApiErrorResponse("PAYLOAD_TOO_LARGE", "上传文件或请求内容过大");
            case 415 -> new ApiErrorResponse("UNSUPPORTED_MEDIA_TYPE", "不支持该内容类型");
            case 422 -> new ApiErrorResponse("BUSINESS_RULE_VIOLATION", "请求不满足业务条件");
            case 500 -> new ApiErrorResponse("INTERNAL_SERVER_ERROR", "服务器内部错误，请稍后重试");
            case 503 -> new ApiErrorResponse("SERVICE_UNAVAILABLE", "服务暂时不可用，请稍后重试");
            default -> new ApiErrorResponse("HTTP_ERROR", "请求处理失败");
        };
    }
}
