package com.example.constructiontracker.auth;

import com.example.constructiontracker.domain.UserIdentity;
import com.example.constructiontracker.exception.AuthenticationException;
import jakarta.servlet.http.HttpServletRequest;

/** 从当前请求读取已认证身份；Controller 可将该身份作为参数传递给 Service。 */
public final class RequestIdentity {

    public static final String ATTRIBUTE_NAME = UserIdentity.class.getName();

    private RequestIdentity() {
    }

    public static UserIdentity get(HttpServletRequest request) {
        if (request != null && request.getAttribute(ATTRIBUTE_NAME) instanceof UserIdentity identity) {
            return identity;
        }
        throw new AuthenticationException("请求中缺少已认证的用户身份");
    }
}
