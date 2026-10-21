package com.example.constructiontracker.auth;

import com.example.constructiontracker.domain.UserIdentity;
import com.example.constructiontracker.domain.UserRole;
import com.example.constructiontracker.exception.AuthenticationException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.mock.web.MockHttpServletRequest;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 纯单元测试，不启动 Spring、不连接数据库，也不处理 HTTP 响应。 */
class HeaderIdentityParserTests {

    private final HeaderIdentityParser parser = new HeaderIdentityParser();

    @Test
    void acceptsAdminWithoutCommunity() {
        assertThat(parser.parse(request("alice", "ADMIN", null)))
                .isEqualTo(new UserIdentity("alice", UserRole.ADMIN, null));
    }

    @Test
    void acceptsSiteManagerWithCommunity() {
        assertThat(parser.parse(request("bob", "SITE_MANAGER", "North Austin")))
                .isEqualTo(new UserIdentity("bob", UserRole.SITE_MANAGER, "North Austin"));
    }

    @Test
    void acceptsViewerWithoutCommunity() {
        assertThat(parser.parse(request("carol", "VIEWER", null)))
                .isEqualTo(new UserIdentity("carol", UserRole.VIEWER, null));
    }

    @ParameterizedTest
    @EnumSource(value = UserRole.class, names = {"ADMIN", "VIEWER"})
    void normalizesEmptyOptionalCommunityToNull(UserRole role) {
        assertThat(parser.parse(request("alice", role.name(), "")).community()).isNull();
    }

    @ParameterizedTest
    @EnumSource(value = UserRole.class, names = {"ADMIN", "VIEWER"})
    void preservesProvidedOptionalCommunity(UserRole role) {
        assertThat(parser.parse(request("alice", role.name(), " North Austin ")).community())
                .isEqualTo("North Austin");
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {" ", "\t", " \t ", "\u2003"})
    void rejectsMissingEmptyOrBlankUsername(String username) {
        assertThatThrownBy(() -> parser.parse(request(username, "ADMIN", null)))
                .isInstanceOf(AuthenticationException.class)
                .hasMessageContaining("X-User");
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {" ", "\t", "OWNER", "admin", "SITE_MANAGER,ADMIN", "ADMIN,VIEWER"})
    void rejectsMissingEmptyBlankOrUnsupportedRole(String role) {
        assertThatThrownBy(() -> parser.parse(request("alice", role, null)))
                .isInstanceOf(AuthenticationException.class)
                .hasMessageContaining("X-Role");
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {" ", "\t", "\u2003"})
    void rejectsMissingEmptyOrBlankSiteManagerCommunity(String community) {
        assertThatThrownBy(() -> parser.parse(request("bob", "SITE_MANAGER", community)))
                .isInstanceOf(AuthenticationException.class)
                .hasMessageContaining("X-Community");
    }

    @ParameterizedTest
    @EnumSource(value = UserRole.class, names = {"ADMIN", "VIEWER"})
    void rejectsWhitespaceOnlyCommunityEvenWhenOptional(UserRole role) {
        assertThatThrownBy(() -> parser.parse(request("alice", role.name(), " \t ")))
                .isInstanceOf(AuthenticationException.class)
                .hasMessageContaining("X-Community");
    }

    @Test
    void stripsLeadingAndTrailingWhitespaceButPreservesInternalSpaces() {
        assertThat(parser.parse(request("\t Alice Smith \u2003", "SITE_MANAGER", "\u2003 North Austin \t")))
                .isEqualTo(new UserIdentity("Alice Smith", UserRole.SITE_MANAGER, "North Austin"));
    }

    @Test
    void acceptsRoleWithSurroundingWhitespace() {
        assertThat(parser.parse(request("alice", " ADMIN ", null)).role()).isEqualTo(UserRole.ADMIN);
    }

    @Test
    void readsHeaderNamesCaseInsensitively() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("x-user", "alice");
        request.addHeader("x-role", "SITE_MANAGER");
        request.addHeader("x-community", "North Austin");

        assertThat(parser.parse(request))
                .isEqualTo(new UserIdentity("alice", UserRole.SITE_MANAGER, "North Austin"));
    }

    @Test
    void rejectsMissingRequestWithAuthenticationException() {
        assertThatThrownBy(() -> parser.parse(null)).isInstanceOf(AuthenticationException.class);
    }

    private MockHttpServletRequest request(String username, String role, String community) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        if (username != null) {
            request.addHeader(HeaderIdentityParser.USER_HEADER, username);
        }
        if (role != null) {
            request.addHeader(HeaderIdentityParser.ROLE_HEADER, role);
        }
        if (community != null) {
            request.addHeader(HeaderIdentityParser.COMMUNITY_HEADER, community);
        }
        return request;
    }
}
