package com.example.constructiontracker.service;

import com.example.constructiontracker.domain.UserIdentity;
import com.example.constructiontracker.domain.UserRole;
import com.example.constructiontracker.exception.AuthenticationException;
import com.example.constructiontracker.exception.BusinessException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

/** 集中、无状态的角色与社区授权；调用方提供已认证身份，不解析请求头或查询数据库。 */
@Service
public class AuthorizationService {

    /** 仅允许 ADMIN 执行管理员操作。 */
    public void requireAdmin(UserIdentity identity) {
        if (requireAuthenticatedRole(identity) != UserRole.ADMIN) {
            throw forbidden();
        }
    }

    /**
     * ADMIN 可以管理所有社区；SITE_MANAGER 只能管理与其身份社区严格一致的房屋。
     * identity 应从 RequestIdentity 获取；houseCommunity 必须由业务 Service 从目标房屋的
     * 数据库记录读取，不能使用客户端参数作为授权依据。本组件不修改或规范化社区名称。
     */
    public void requireCanManageHouse(UserIdentity identity, String houseCommunity) {
        UserRole role = requireAuthenticatedRole(identity);
        if (role == UserRole.ADMIN) {
            return;
        }
        if (role == UserRole.SITE_MANAGER
                && identity.community() != null && !identity.community().isBlank()
                && houseCommunity != null && !houseCommunity.isBlank()
                && identity.community().equals(houseCommunity)) {
            return;
        }
        throw forbidden();
    }

    private UserRole requireAuthenticatedRole(UserIdentity identity) {
        if (identity == null || identity.role() == null) {
            throw new AuthenticationException("请求中缺少已认证的用户身份");
        }
        return identity.role();
    }

    private BusinessException forbidden() {
        return new BusinessException(HttpStatus.FORBIDDEN, "FORBIDDEN", "没有操作权限");
    }
}
