package com.example.constructiontracker.service;

import com.example.constructiontracker.domain.UserIdentity;
import com.example.constructiontracker.domain.UserRole;
import com.example.constructiontracker.exception.AuthenticationException;
import com.example.constructiontracker.exception.BusinessException;
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.HttpStatus;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 纯单元测试，不启动 Spring 或数据库。 */
class AuthorizationServiceTests {

    private final AuthorizationService authorization = new AuthorizationService();

    @Test
    void adminCanPerformAdminOperations() {
        assertThatCode(() -> authorization.requireAdmin(new UserIdentity("alice", UserRole.ADMIN, null)))
                .doesNotThrowAnyException();
    }

    @ParameterizedTest
    @EnumSource(value = UserRole.class, names = {"SITE_MANAGER", "VIEWER"})
    void nonAdminsCannotPerformAdminOperations(UserRole role) {
        expectForbidden(() -> authorization.requireAdmin(new UserIdentity("bob", role, "North Austin")));
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {"North Austin", "South Austin", " ", "\t"})
    void adminCanManageAnyCommunityIncludingUnknownCommunity(String houseCommunity) {
        // 管理员自身社区不限制目标社区；房屋存在性和数据有效性留给业务层处理。
        var admin = new UserIdentity("alice", UserRole.ADMIN, "Admin community");
        assertThatCode(() -> authorization.requireCanManageHouse(admin, houseCommunity))
                .doesNotThrowAnyException();
    }

    @Test
    void siteManagerCanManageOwnCommunity() {
        var manager = new UserIdentity("bob", UserRole.SITE_MANAGER, "North Austin");
        assertThatCode(() -> authorization.requireCanManageHouse(manager, "North Austin"))
                .doesNotThrowAnyException();
    }

    @ParameterizedTest
    @ValueSource(strings = {"South Austin", "north Austin", "NORTH AUSTIN", " North Austin", "North Austin ", "North  Austin"})
    void siteManagerCannotManageDifferentOrLooselyMatchingCommunity(String houseCommunity) {
        var manager = new UserIdentity("bob", UserRole.SITE_MANAGER, "North Austin");
        expectForbidden(() -> authorization.requireCanManageHouse(manager, houseCommunity));
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {"North Austin", "South Austin", " ", "\t"})
    void viewerCannotManageAnyCommunityEvenWhenNamesMatch(String houseCommunity) {
        var viewer = new UserIdentity("carol", UserRole.VIEWER, "North Austin");
        expectForbidden(() -> authorization.requireCanManageHouse(viewer, houseCommunity));
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {" ", "\t", "\u2003"})
    void siteManagerCannotManageMissingOrBlankTargetCommunity(String houseCommunity) {
        var manager = new UserIdentity("bob", UserRole.SITE_MANAGER, "North Austin");
        expectForbidden(() -> authorization.requireCanManageHouse(manager, houseCommunity));
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {" ", "\t", "\u2003"})
    void invalidSiteManagerCommunityDoesNotGrantAccessEvenWhenTargetMatches(String community) {
        // 正常 Header 解析不会产生这种身份；直接构造时也不能凭两个空值放行。
        var manager = new UserIdentity("bob", UserRole.SITE_MANAGER, community);
        expectForbidden(() -> authorization.requireCanManageHouse(manager, community));
    }

    @Test
    void missingIdentityForAdminOperationIsAnAuthenticationFailure() {
        assertThatThrownBy(() -> authorization.requireAdmin(null))
                .isInstanceOf(AuthenticationException.class);
    }

    @Test
    void missingIdentityForHouseManagementIsAnAuthenticationFailure() {
        assertThatThrownBy(() -> authorization.requireCanManageHouse(null, "North Austin"))
                .isInstanceOf(AuthenticationException.class);
    }

    @Test
    void missingRoleIsAnAuthenticationFailureRatherThanAnInternalError() {
        var identity = new UserIdentity("alice", null, null);
        assertThatThrownBy(() -> authorization.requireAdmin(identity))
                .isInstanceOf(AuthenticationException.class);
        assertThatThrownBy(() -> authorization.requireCanManageHouse(identity, "North Austin"))
                .isInstanceOf(AuthenticationException.class);
    }

    private void expectForbidden(ThrowingCallable operation) {
        assertThatThrownBy(operation).isInstanceOfSatisfying(BusinessException.class, error -> {
            assertThat(error.getStatus()).isEqualTo(HttpStatus.FORBIDDEN);
            assertThat(error.getCode()).isEqualTo("FORBIDDEN");
            assertThat(error.getMessage()).isEqualTo("没有操作权限");
        });
    }
}
