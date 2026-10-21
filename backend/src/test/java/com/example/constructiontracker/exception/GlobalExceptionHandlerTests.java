package com.example.constructiontracker.exception;

import com.example.constructiontracker.auth.AuthenticationInterceptor;
import com.example.constructiontracker.auth.HeaderIdentityParser;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.server.ResponseStatusException;

import static org.hamcrest.Matchers.aMapWithSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(GlobalExceptionHandlerTests.ErrorTestController.class)
@Import({GlobalExceptionHandler.class, GlobalExceptionHandlerTests.ErrorTestController.class,
        AuthenticationInterceptor.class, HeaderIdentityParser.class})
class GlobalExceptionHandlerTests {

    @Autowired
    private MockMvc mockMvc;

    @ParameterizedTest
    @ValueSource(ints = {401, 403, 404, 409, 422})
    void businessErrorsKeepTheirStatusAndReadableMessage(int httpStatus) throws Exception {
        expectError(mockMvc.perform(get("/test/errors/business/{status}", httpStatus)),
                httpStatus, "BUSINESS_RULE_FAILED", "业务规则不满足");
    }

    @Test
    void invalidBodyReturnsFieldValidationMessage() throws Exception {
        expectError(mockMvc.perform(post("/test/errors/body")
                        .contentType(MediaType.APPLICATION_JSON).content("{\"address\":\"\"}")),
                400, "VALIDATION_FAILED", "address: 地址不能为空");
    }

    @Test
    void malformedJsonReturnsBadRequest() throws Exception {
        expectError(mockMvc.perform(post("/test/errors/body")
                        .contentType(MediaType.APPLICATION_JSON).content("{broken-json")),
                400, "INVALID_REQUEST", "请求参数或 JSON 格式不正确");
    }

    @Test
    void invalidPathParameterReturnsBadRequest() throws Exception {
        expectError(mockMvc.perform(get("/test/errors/business/not-a-number")),
                400, "INVALID_REQUEST", "请求参数或 JSON 格式不正确");
    }

    @Test
    void missingQueryParameterReturnsBadRequest() throws Exception {
        expectError(mockMvc.perform(get("/test/errors/query")),
                400, "INVALID_REQUEST", "请求参数或 JSON 格式不正确");
    }

    @Test
    void invalidQueryParameterReturnsValidationFailure() throws Exception {
        expectError(mockMvc.perform(get("/test/errors/query").param("count", "0")),
                400, "VALIDATION_FAILED", "请求参数校验失败");
    }

    @Test
    void unsupportedMethodKeepsAllowHeader() throws Exception {
        expectError(mockMvc.perform(get("/test/errors/body")),
                405, "METHOD_NOT_ALLOWED", "该接口不支持此请求方法")
                .andExpect(header().string(HttpHeaders.ALLOW, "POST"));
    }

    @Test
    void unsupportedContentTypeReturns415() throws Exception {
        expectError(mockMvc.perform(post("/test/errors/body")
                        .contentType(MediaType.TEXT_PLAIN).content("address")),
                415, "UNSUPPORTED_MEDIA_TYPE", "不支持该内容类型");
    }

    @Test
    void unsupportedResponseFormatStillReturnsJsonError() throws Exception {
        expectError(mockMvc.perform(get("/test/errors/query")
                        .param("count", "1").accept(MediaType.APPLICATION_XML)),
                406, "NOT_ACCEPTABLE", "该接口无法提供请求的响应格式");
    }

    @Test
    void oversizedUploadExceptionReturns413() throws Exception {
        expectError(mockMvc.perform(get("/test/errors/upload")),
                413, "PAYLOAD_TOO_LARGE", "上传文件或请求内容过大");
    }

    @Test
    void unknownRouteReturns404() throws Exception {
        expectError(mockMvc.perform(get("/missing-route")),
                404, "NOT_FOUND", "请求的资源不存在");
    }

    @Test
    void frameworkStatusExceptionIsNotChangedTo500() throws Exception {
        expectError(mockMvc.perform(get("/test/errors/conflict")),
                409, "CONFLICT", "数据状态冲突，请刷新后重试");
    }

    @Test
    void unexpectedErrorReturns500WithoutInternalExceptionDetails() throws Exception {
        expectError(mockMvc.perform(get("/test/errors/unexpected")),
                500, "INTERNAL_SERVER_ERROR", "服务器内部错误，请稍后重试");
    }

    private ResultActions expectError(ResultActions result, int httpStatus, String code, String message)
            throws Exception {
        return result.andExpect(status().is(httpStatus))
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$", aMapWithSize(2)))
                .andExpect(jsonPath("$.code").value(code))
                .andExpect(jsonPath("$.message").value(message));
    }

    // 仅在 MVC 测试中加载，不会打包到应用或开放真实接口。
    @RestController
    @RequestMapping("/test/errors")
    static class ErrorTestController {

        @GetMapping("/business/{status}")
        void business(@PathVariable int status) {
            throw new BusinessException(HttpStatus.valueOf(status),
                    "BUSINESS_RULE_FAILED", "业务规则不满足");
        }

        @PostMapping(value = "/body", consumes = MediaType.APPLICATION_JSON_VALUE)
        void body(@Valid @RequestBody ExampleRequest request) {
        }

        @GetMapping(value = "/query", produces = MediaType.APPLICATION_JSON_VALUE)
        ExampleRequest query(@RequestParam @Min(1) int count) {
            return new ExampleRequest("测试地址");
        }

        @GetMapping("/upload")
        void upload() {
            throw new MaxUploadSizeExceededException(10 * 1024 * 1024);
        }

        @GetMapping("/conflict")
        void conflict() {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "private diagnostic");
        }

        @GetMapping("/unexpected")
        void unexpected() {
            throw new IllegalStateException("private diagnostic");
        }
    }

    record ExampleRequest(@NotBlank(message = "地址不能为空") String address) {
    }
}
