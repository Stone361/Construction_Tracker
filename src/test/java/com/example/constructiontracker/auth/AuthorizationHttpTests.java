package com.example.constructiontracker.auth;

import com.example.constructiontracker.config.WebMvcConfig;
import com.example.constructiontracker.domain.UserRole;
import com.example.constructiontracker.exception.GlobalExceptionHandler;
import com.example.constructiontracker.service.AuthorizationService;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.context.TestComponent;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

import static org.hamcrest.Matchers.aMapWithSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** MVC 切片测试：真实认证与授权组件，无数据库，Controller 仅用于测试。 */
@WebMvcTest(AuthorizationHttpTests.AuthorizationTestController.class)
@Import({AuthorizationHttpTests.AuthorizationTestController.class, WebMvcConfig.class,
        HeaderIdentityParser.class, AuthenticationInterceptor.class,
        AuthorizationService.class, GlobalExceptionHandler.class})
class AuthorizationHttpTests {

    private static final String ADMIN_PATH = "/api/authorization-test/admin";
    private static final String MANAGE_PATH = "/api/authorization-test/manage";

    @Autowired
    private MockMvc mockMvc;

    @Test
    void adminPassesAdminAuthorization() throws Exception {
        mockMvc.perform(get(ADMIN_PATH).header("X-User", "alice").header("X-Role", "ADMIN"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.result").value("allowed"));
    }

    @ParameterizedTest
    @EnumSource(value = UserRole.class, names = {"SITE_MANAGER", "VIEWER"})
    void authenticatedNonAdminsReceive403Json(UserRole role) throws Exception {
        expectForbidden(mockMvc.perform(get(ADMIN_PATH).header("X-User", "bob")
                .header("X-Role", role.name()).header("X-Community", "North Austin")));
    }

    @Test
    void adminCanManageHouseInAnyCommunity() throws Exception {
        mockMvc.perform(get(MANAGE_PATH).header("X-User", "alice").header("X-Role", "ADMIN")
                        .header("X-Community", "South Austin"))
                .andExpect(status().isOk());
    }

    @Test
    void siteManagerPassesForServerSideHouseCommunity() throws Exception {
        mockMvc.perform(get(MANAGE_PATH).header("X-User", "bob").header("X-Role", "SITE_MANAGER")
                        .header("X-Community", "North Austin"))
                .andExpect(status().isOk());
    }

    @ParameterizedTest
    @ValueSource(strings = {"South Austin", "north Austin"})
    void siteManagerFromDifferentCommunityReceives403Json(String community) throws Exception {
        expectForbidden(mockMvc.perform(get(MANAGE_PATH).header("X-User", "bob")
                .header("X-Role", "SITE_MANAGER").header("X-Community", community)));
    }

    @Test
    void viewerReceives403WhenManagingHouse() throws Exception {
        expectForbidden(mockMvc.perform(get(MANAGE_PATH).header("X-User", "carol").header("X-Role", "VIEWER")));
    }

    @Test
    void clientParametersCannotReplaceServerSideHouseCommunity() throws Exception {
        expectForbidden(mockMvc.perform(get(MANAGE_PATH).header("X-User", "bob")
                .header("X-Role", "SITE_MANAGER").header("X-Community", "South Austin")
                .param("houseCommunity", "South Austin").param("community", "South Austin")));
    }

    @ParameterizedTest
    @ValueSource(strings = {ADMIN_PATH, MANAGE_PATH})
    void missingAuthenticationStillReceives401BeforeAuthorization(String path) throws Exception {
        expectError(mockMvc.perform(get(path)), 401, "UNAUTHORIZED", "X-User 不能为空或仅包含空白");
    }

    @Test
    void invalidRoleStillReceives401RatherThan403() throws Exception {
        expectError(mockMvc.perform(get(ADMIN_PATH).header("X-User", "alice").header("X-Role", "OWNER")),
                401, "UNAUTHORIZED", "X-Role 必须是 ADMIN、SITE_MANAGER 或 VIEWER");
    }

    @Test
    void siteManagerMissingCommunityStillReceives401() throws Exception {
        expectError(mockMvc.perform(get(MANAGE_PATH).header("X-User", "bob").header("X-Role", "SITE_MANAGER")),
                401, "UNAUTHORIZED", "SITE_MANAGER 必须提供 X-Community");
    }

    private ResultActions expectForbidden(ResultActions result) throws Exception {
        return expectError(result, 403, "FORBIDDEN", "没有操作权限");
    }

    private ResultActions expectError(ResultActions result, int httpStatus, String code, String message) throws Exception {
        return result.andExpect(status().is(httpStatus))
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$", aMapWithSize(2)))
                .andExpect(jsonPath("$.code").value(code))
                .andExpect(jsonPath("$.message").value(message));
    }

    @TestComponent
    @RestController
    static class AuthorizationTestController {

        // 服务端夹具代替未来从数据库读取的房屋社区；不会取客户端请求参数。
        private static final String HOUSE_COMMUNITY = "North Austin";
        private final AuthorizationService authorization;

        AuthorizationTestController(AuthorizationService authorization) {
            this.authorization = authorization;
        }

        @GetMapping(ADMIN_PATH)
        Map<String, String> admin(HttpServletRequest request) {
            authorization.requireAdmin(RequestIdentity.get(request));
            return Map.of("result", "allowed");
        }

        @GetMapping(MANAGE_PATH)
        Map<String, String> manage(HttpServletRequest request) {
            authorization.requireCanManageHouse(RequestIdentity.get(request), HOUSE_COMMUNITY);
            return Map.of("result", "allowed");
        }
    }
}
