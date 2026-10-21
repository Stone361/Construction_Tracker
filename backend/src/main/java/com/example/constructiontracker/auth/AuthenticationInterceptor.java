package com.example.constructiontracker.auth;

import com.example.constructiontracker.domain.UserIdentity;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

/** 对注册路径执行身份认证，不判断角色是否具有具体操作权限。 */
@Component
public class AuthenticationInterceptor implements HandlerInterceptor {

    private final HeaderIdentityParser identityParser;

    public AuthenticationInterceptor(HeaderIdentityParser identityParser) {
        this.identityParser = identityParser;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        UserIdentity identity = identityParser.parse(request);
        request.setAttribute(RequestIdentity.ATTRIBUTE_NAME, identity);
        return true;
    }
}
