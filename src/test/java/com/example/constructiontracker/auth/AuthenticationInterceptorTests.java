package com.example.constructiontracker.auth;

import com.example.constructiontracker.domain.UserIdentity;
import com.example.constructiontracker.domain.UserRole;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestComponent;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.aMapWithSize;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 使用实际 MVC 注册和全局异常处理，测试 Controller 仅存在于测试 classpath。 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import(AuthenticationInterceptorTests.IdentityTestController.class)
class AuthenticationInterceptorTests {

    private static final String IDENTITY_PATH = "/api/auth-test/identity";

    @Autowired
    private MockMvc mockMvc;

    @Test
    void missingUsernameReturns401() throws Exception {
        expectUnauthorized(mockMvc.perform(get(IDENTITY_PATH).header("X-Role", "ADMIN")),
                "X-User 不能为空或仅包含空白");
    }

    @ParameterizedTest
    @ValueSource(strings = {"", " ", "\t"})
    void emptyOrBlankUsernameReturns401(String username) throws Exception {
        expectUnauthorized(mockMvc.perform(get(IDENTITY_PATH)
                        .header("X-User", username).header("X-Role", "ADMIN")),
                "X-User 不能为空或仅包含空白");
    }

    @Test
    void missingRoleReturns401() throws Exception {
        expectUnauthorized(mockMvc.perform(get(IDENTITY_PATH).header("X-User", "alice")),
                "X-Role 不能为空或仅包含空白");
    }

    @ParameterizedTest
    @ValueSource(strings = {"OWNER", "admin", "ADMIN,VIEWER"})
    void invalidRoleReturns401(String role) throws Exception {
        expectUnauthorized(mockMvc.perform(get(IDENTITY_PATH)
                        .header("X-User", "alice").header("X-Role", role)),
                "X-Role 必须是 ADMIN、SITE_MANAGER 或 VIEWER");
    }

    @Test
    void siteManagerWithoutCommunityReturns401() throws Exception {
        expectUnauthorized(mockMvc.perform(get(IDENTITY_PATH)
                        .header("X-User", "bob").header("X-Role", "SITE_MANAGER")),
                "SITE_MANAGER 必须提供 X-Community");
    }

    @Test
    void siteManagerWithBlankCommunityReturns401() throws Exception {
        expectUnauthorized(mockMvc.perform(get(IDENTITY_PATH)
                        .header("X-User", "bob").header("X-Role", "SITE_MANAGER").header("X-Community", " ")),
                "X-Community 不能为空或仅包含空白");
    }

    @ParameterizedTest
    @EnumSource(UserRole.class)
    void validRolesPassAndExposeIdentityToController(UserRole role) throws Exception {
        String community = role == UserRole.SITE_MANAGER ? "North Austin" : null;
        var builder = get(IDENTITY_PATH).header("X-User", "alice").header("X-Role", role.name());
        if (community != null) {
            builder.header("X-Community", community);
        }

        var result = mockMvc.perform(builder)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.username").value("alice"))
                .andExpect(jsonPath("$.role").value(role.name()))
                .andExpect(jsonPath("$.community").value(community))
                .andExpect(request().attribute(RequestIdentity.ATTRIBUTE_NAME,
                        new UserIdentity("alice", role, community)))
                .andReturn();
        assertThat(result.getRequest().getSession(false)).isNull();
    }

    @Test
    void controllerReadsNormalizedIdentity() throws Exception {
        mockMvc.perform(get(IDENTITY_PATH)
                        .header("X-User", " Alice Smith ").header("X-Role", " SITE_MANAGER ")
                        .header("X-Community", " North Austin "))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.username").value("Alice Smith"))
                .andExpect(jsonPath("$.community").value("North Austin"))
                .andExpect(request().attribute(RequestIdentity.ATTRIBUTE_NAME,
                        new UserIdentity("Alice Smith", UserRole.SITE_MANAGER, "North Austin")));
    }

    @Test
    void authenticationDoesNotApplyOperationPermissions() throws Exception {
        mockMvc.perform(post(IDENTITY_PATH).header("X-User", "carol").header("X-Role", "VIEWER"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.role").value("VIEWER"));
    }

    @Test
    void identityIsIsolatedBetweenRequests() throws Exception {
        mockMvc.perform(get(IDENTITY_PATH)
                        .header("X-User", "bob").header("X-Role", "SITE_MANAGER").header("X-Community", "North Austin"))
                .andExpect(status().isOk());
        mockMvc.perform(get(IDENTITY_PATH).header("X-User", "carol").header("X-Role", "VIEWER"))
                .andExpect(status().isOk())
                .andExpect(request().attribute(RequestIdentity.ATTRIBUTE_NAME,
                        new UserIdentity("carol", UserRole.VIEWER, null)))
                .andExpect(jsonPath("$.community").value((Object) null));
    }

    @Test
    void actualActuatorHealthWorksWithoutHeaders() throws Exception {
        mockMvc.perform(get("/actuator/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("UP"))
                .andExpect(request().attribute(RequestIdentity.ATTRIBUTE_NAME, nullValue()));
    }

    @ParameterizedTest
    @ValueSource(strings = {"/public/auth-test", "/api-other/auth-test"})
    void nonApiPathsDoNotTriggerAuthentication(String path) throws Exception {
        mockMvc.perform(get(path))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.authenticated").value(false))
                .andExpect(request().attribute(RequestIdentity.ATTRIBUTE_NAME, nullValue()));
    }

    @Test
    void invalidHeadersAreIgnoredOutsideApiPaths() throws Exception {
        mockMvc.perform(get("/public/auth-test").header("X-Role", "INVALID"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.authenticated").value(false));
    }

    private ResultActions expectUnauthorized(ResultActions result, String message) throws Exception {
        return result.andExpect(status().isUnauthorized())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$", aMapWithSize(2)))
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"))
                .andExpect(jsonPath("$.message").value(message))
                .andExpect(request().attribute(RequestIdentity.ATTRIBUTE_NAME, nullValue()));
    }

    @TestComponent
    @RestController
    static class IdentityTestController {

        @RequestMapping(path = IDENTITY_PATH, method = {RequestMethod.GET, RequestMethod.POST})
        UserIdentity identity(HttpServletRequest request) {
            return RequestIdentity.get(request);
        }

        @GetMapping({"/public/auth-test", "/api-other/auth-test"})
        Map<String, Boolean> publicEndpoint(HttpServletRequest request) {
            return Map.of("authenticated", request.getAttribute(RequestIdentity.ATTRIBUTE_NAME) != null);
        }
    }
}
