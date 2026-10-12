package com.example.constructiontracker.auth;

import com.example.constructiontracker.domain.UserIdentity;
import com.example.constructiontracker.domain.UserRole;
import com.example.constructiontracker.exception.AuthenticationException;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class RequestIdentityTests {

    @Test
    void returnsIdentityStoredByInterceptor() {
        var request = new MockHttpServletRequest();
        var identity = new UserIdentity("alice", UserRole.ADMIN, null);
        request.setAttribute(RequestIdentity.ATTRIBUTE_NAME, identity);

        assertThat(RequestIdentity.get(request)).isSameAs(identity);
    }

    @Test
    void headersAloneDoNotReplaceAuthenticatedRequestAttribute() {
        var request = new MockHttpServletRequest();
        request.addHeader("X-User", "alice");
        request.addHeader("X-Role", "ADMIN");

        assertThatThrownBy(() -> RequestIdentity.get(request))
                .isInstanceOf(AuthenticationException.class)
                .hasMessage("请求中缺少已认证的用户身份");
    }

    @Test
    void wrongAttributeTypeIsNotAcceptedAsIdentity() {
        var request = new MockHttpServletRequest();
        request.setAttribute(RequestIdentity.ATTRIBUTE_NAME, "alice");

        assertThatThrownBy(() -> RequestIdentity.get(request)).isInstanceOf(AuthenticationException.class);
    }
}
