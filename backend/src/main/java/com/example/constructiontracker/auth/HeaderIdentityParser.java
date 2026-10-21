package com.example.constructiontracker.auth;

import com.example.constructiontracker.domain.UserIdentity;
import com.example.constructiontracker.domain.UserRole;
import com.example.constructiontracker.exception.AuthenticationException;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Component;

/** 独立、无状态的身份解析组件；只有被显式调用时才检查请求头。 */
@Component
public class HeaderIdentityParser {

    public static final String USER_HEADER = "X-User";
    public static final String ROLE_HEADER = "X-Role";
    public static final String COMMUNITY_HEADER = "X-Community";

    public UserIdentity parse(HttpServletRequest request) {
        if (request == null) {
            throw new AuthenticationException("缺少身份请求");
        }

        String username = requireText(request.getHeader(USER_HEADER), USER_HEADER);
        UserRole role = parseRole(request.getHeader(ROLE_HEADER));
        String community = optionalCommunity(request.getHeader(COMMUNITY_HEADER));

        if (role == UserRole.SITE_MANAGER && community == null) {
            throw new AuthenticationException("SITE_MANAGER 必须提供 X-Community");
        }

        return new UserIdentity(username, role, community);
    }

    private UserRole parseRole(String value) {
        String role = requireText(value, ROLE_HEADER);
        try {
            return UserRole.valueOf(role);
        } catch (IllegalArgumentException ex) {
            throw new AuthenticationException("X-Role 必须是 ADMIN、SITE_MANAGER 或 VIEWER");
        }
    }

    private String optionalCommunity(String value) {
        if (value == null || value.isEmpty()) {
            return null;
        }
        // 缺失/空字符串可以表示未提供社区；提供了仅含空白的字段则是非法身份。
        return requireText(value, COMMUNITY_HEADER);
    }

    private String requireText(String value, String header) {
        if (value == null || value.isBlank()) {
            throw new AuthenticationException(header + " 不能为空或仅包含空白");
        }
        return value.strip();
    }
}
