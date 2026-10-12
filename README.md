# Construction Tracker（在建房屋地图）

## 1. 项目目标

实现一个面向美国中部地区在建社区的后端服务：管理在建房屋、施工阶段和现场照片，并为既有 Leaflet + OpenStreetMap 地图页面提供约定的 JSON 接口。

前端地图页面由题目提供，本项目只实现后端、数据库、照片本地存储、数据导入脚本和自动化测试。

## 2. 交付与运行约束

- 技术栈：JDK 21、Spring Boot 3.x、MyBatis（SQL 必须写在 XML）、MySQL 8。
- 项目根目录提供 `docker-compose.yml`，用于一条命令启动 MySQL。
- 应用使用 `./mvnw spring-boot:run` 启动，监听 `8080` 端口。
- 照片原始文件保存到可配置的本地目录，照片元数据保存到 MySQL。
- `./mvnw test` 必须能够一次跑通自动化测试；README 需明确测试依赖的是 Testcontainers 还是 compose 中的 MySQL。
- 使用自己的 Git 仓库，不出现公司相关信息。
- 至少 8 次有意义的小步提交；提交信息清晰，不改写已经推送的历史。
- AI 对话记录导出到 `docs/ai-log/`。
- 最终需要能够解释每次提交的代码和设计决定。

### 本地开发（已初始化）

当前工程使用 **Java 21 + Spring Boot 3.5.16 + MyBatis Starter 3.0.5**，已包含 Spring Web、Validation、Actuator、MySQL JDBC 驱动和测试依赖。Maven Wrapper 会自动下载 Maven，无需单独安装 Maven 或 Spring Boot CLI；首次运行需要联网下载构建工具和依赖。

在项目根目录执行（启动数据库前先按下节准备 `.env`）：

```bash
./mvnw test                 # 使用测试专用 H2，验证启动、健康检查及 MyBatis XML SQL
docker compose up -d       # 启动 MySQL 8.4.11
./mvnw spring-boot:run      # 读取本地 .env，默认端口 8080
```

### MySQL 与 Docker

正常运行使用 Docker Desktop 自带的 Docker Engine 和 Compose。先启动 Docker Desktop，等待引擎就绪，再运行项目命令。新机器首次使用时，复制 [.env.example](./.env.example) 为 `.env`，将 `CHANGE_ME_APP_PASSWORD` 和 `CHANGE_ME_ROOT_PASSWORD` 分别替换为两个不同的随机密码；建议使用不带引号的随机十六进制字符串。已有 `.env` 时保留原文件，不覆盖已有数据库凭据：

```bash
cp -n .env.example .env     # 仅首次配置；不会覆盖已有 .env
# 在本地编辑 .env，替换两个 CHANGE_ME_* 占位符后再启动数据库
```

`DB_USERNAME`、`DB_PASSWORD` 对应应用账号，`MYSQL_ROOT_PASSWORD` 对应 root；Spring Boot 使用应用账号。`.env.example` 仅提供占位符，实际 `.env` 被 Git 忽略，不应提交或将密码写入命令行。

[docker-compose.yml](./docker-compose.yml) 使用官方 `mysql:8.4.11` 镜像，首次启动自动创建 `construction_tracker` 数据库和同名应用用户。服务仅向本机开放 `127.0.0.1:3306`，数据库字符集为 `utf8mb4`，时区为 UTC，数据保存在命名卷 `mysql-data`。

```bash
docker compose up -d --wait # 启动并等待数据库健康检查成功
docker compose ps          # 查看服务状态
./mvnw spring-boot:run
```

连接配置位于 [application.yml](./src/main/resources/application.yml)，应用从项目根目录的 `.env` 自动加载 `DB_URL`、`DB_USERNAME` 和 `DB_PASSWORD`，也可用同名环境变量覆盖。`.env` 不提交到版本库；其中的值使用不带引号的格式，生成的随机密码为十六进制字符串。

使用容器内的 MySQL 客户端，无需额外安装本机客户端：

```bash
docker compose exec mysql mysql -u construction_tracker -p construction_tracker
# 在密码提示处输入 .env 中的 DB_PASSWORD
```

使用 `docker compose stop` 暂停数据库，`docker compose start` 恢复；`docker compose down` 删除容器但保留数据卷。不要执行 `docker compose down -v`，除非确实要删除数据库数据。初始化环境变量只在空数据卷首次启动时创建数据库和用户；修改 `.env` 密码不会自动修改已有数据库账号密码。

启动并成功连接数据库后，在另一个终端检查：

```bash
curl http://localhost:8080/actuator/health
# 预期：{"status":"UP"}
```

按 `Ctrl+C` 停止应用。也可执行 `./mvnw package` 生成可执行 JAR，再运行 `java -jar target/construction-tracker-0.0.1-SNAPSHOT.jar`。

健康检查现在包含数据库状态；MySQL 未启动、数据库不存在或账号配置错误时，可能返回 HTTP 503 和 `{"status":"DOWN"}`。

### 第二阶段：Flyway 与业务表

已接入 `flyway-core` 和 `flyway-mysql`，版本由 Spring Boot 管理。执行 `./mvnw spring-boot:run` 时，Flyway 自动运行 [V1 建表迁移](./src/main/resources/db/migration/V1__create_construction_tracker_tables.sql)，创建业务表和 `flyway_schema_history`。成功的 V1 记录应为 `version = '1'`、`success = 1`。再次启动只校验已执行迁移；后续结构变化新增 V2/V3，不修改已执行的 V1。

| 表 | 用途与关键约束 |
| --- | --- |
| `house` | 房屋、社区、当前阶段、封面、公开数据来源与获取时间；`permit_no` 全局唯一，坐标只能同时为空或同时有效 |
| `photo` | 照片文件元数据、上传时阶段、UTC 时间、美国中部业务日和定位状态；`house_id + content_hash`（SHA-256）唯一，复合外键保证封面属于当前房屋 |
| `stage_history` | 成功推进的操作人、UTC 时刻及前后阶段；只允许相邻阶段推进，同一房屋的起始阶段唯一 |

表使用 InnoDB；主键、唯一键、外键和 CHECK 约束通过 V1 建立。缺坐标记录可以保留，后续地图范围查询排除空坐标；无法计算照片距离时使用 `UNKNOWN`。`DATETIME(6)` 约定存 UTC，连接池会话固定 `+00:00`，业务日按 `America/Chicago` 计算。文件大小采用十进制 10 MB，即不超过 **10,000,000 字节**；HTTP 内容识别与上传接口仍待实现。

Flyway 已禁用 `clean` 和自动 `baseline`，启用迁移校验，关闭 Spring 的 `schema.sql`/`data.sql` 初始化。保留现有 Docker 数据卷，不挂载另一套首启 SQL；发现未纳管的非空库时停止迁移，先核对已有结构。当前本机正式库已成功执行 V1，三张业务表已创建。

### 数据库测试与只读验证

```bash
./mvnw test
# 默认：129 项测试，122 项通过，7 项 MySQL 集成测试跳过；框架测试使用 H2 / MVC

docker compose up -d --wait
./mvnw -Dmysql.integration=true -Dtest=MySqlMigrationTests test
# 可选：7 项 MySQL 集成测试使用 compose 中的 MySQL，不使用 Testcontainers
```

MySQL 集成测试从本地 `.env` 或环境变量读取 `MYSQL_ROOT_PASSWORD`，创建随机命名的 `construction_tracker_test_<随机值>` 隔离库，执行真实 V1。测试覆盖重复迁移保留数据、许可证唯一、照片去重、封面归属、坐标与大小约束、相邻推进，以及历史汇总和时区边界；结束时只清理本次创建的测试库，不操作正式库。该组测试此前已通过；默认测试命令不连接 MySQL，也不能替代这组集成测试。

历史汇总的 SQL 验证见 [DatabaseSummaryVerification.xml](./src/test/resources/mapper/DatabaseSummaryVerification.xml)：只纳入 `created_at <= asOf` 的房屋，用查询时点之前最后一次阶段历史还原阶段；照片按 `uploaded_at <= asOf` 决定可见性，以 `MAX(business_date)` 计算最后照片日期并排除未来业务日。没有照片时从创建业务日起算，日差大于14才算陈旧。该 XML 仅用于测试，汇总 API 尚未实现。

应用启动后检查健康状态及数据库结构：

```bash
curl http://localhost:8080/actuator/health
docker compose exec mysql mysql --protocol=TCP -h 127.0.0.1 -u construction_tracker -p construction_tracker
# 在提示处输入实际 .env 中的 DB_PASSWORD；然后在 MySQL 客户端执行以下只读 SQL
```

```sql
SHOW TABLES;
SHOW CREATE TABLE house;
SHOW CREATE TABLE photo;
SHOW CREATE TABLE stage_history;
SELECT version, script, success FROM flyway_schema_history ORDER BY installed_rank;
```

### MyBatis 使用约定

- Mapper 接口放在 `com.example.constructiontracker` 的子包中，并标注 `@Mapper`，由 Starter 自动扫描。
- SQL 统一写在 [src/main/resources/mapper/](./src/main/resources/mapper/) 下的 XML 中；已配置 `classpath*:mapper/**/*.xml` 和下划线转驼峰映射。不要使用 `@Select`、`@Insert` 等注解编写 SQL。
- XML 的 `namespace` 必须是 Mapper 接口全限定名，语句 `id` 与方法名一致，参数使用 `#{参数名}` 绑定。
- 可参考测试中的 [Mapper 接口](./src/test/java/com/example/constructiontracker/mapper/MyBatisSmokeMapper.java) 和 [XML 映射](./src/test/resources/mapper/MyBatisSmokeMapper.xml)。这些示例仅参与测试，不会打包到应用。

当前已完成 Spring Boot 基础工程、MyBatis 接入、MySQL Compose 配置和 Flyway V1 建表，业务接口尚未实现。默认框架测试启用 `test` profile，使用 H2 内存数据库及随机 HTTP 端口；MySQL 专用约束和迁移通过上面的隔离库集成测试验证。后续业务实现还需补充 HTTP 接口、权限和并发测试。

### 基础目录结构

Java 主代码统一放在 `com.example.constructiontracker` 包下，各层职责如下：

| 目录 | 职责 |
| --- | --- |
| [controller](./src/main/java/com/example/constructiontracker/controller/) | 接收 HTTP 请求、校验输入、调用业务服务 |
| [service](./src/main/java/com/example/constructiontracker/service/) | 处理业务规则、权限和事务 |
| [mapper](./src/main/java/com/example/constructiontracker/mapper/) | 定义数据库访问接口，使用 `@Mapper` |
| [domain](./src/main/java/com/example/constructiontracker/domain/) | 保存业务模型和枚举 |
| [dto](./src/main/java/com/example/constructiontracker/dto/) | 定义接口请求与响应对象 |
| [config](./src/main/java/com/example/constructiontracker/config/) | 注册配置和公共组件 |
| [exception](./src/main/java/com/example/constructiontracker/exception/) | 放置业务异常、统一错误响应及全局异常处理器 |
| [src/main/resources/mapper](./src/main/resources/mapper/) | 保存 MyBatis XML，所有 SQL 写在这里 |
| [src/test](./src/test/) | 保存测试代码和测试配置 |

调用顺序为 Controller → Service → Mapper；Mapper 接口关联 XML SQL。各 Java 分层目录通过 `package-info.java` 保留并说明职责。已建立目录和职责说明，并实现统一错误响应及数据库表；Java 业务模型和业务接口仍待实现。

### 统一错误响应（已实现）

接口错误统一返回 JSON `{"code":"...","message":"..."}`，同时保留对应的 HTTP 状态码：

- [ApiErrorResponse](./src/main/java/com/example/constructiontracker/exception/ApiErrorResponse.java)：定义响应的 `code` 和 `message` 两个字段。
- [BusinessException](./src/main/java/com/example/constructiontracker/exception/BusinessException.java)：供业务服务指定错误状态码、业务错误码和可以公开给用户的提示。
- [GlobalExceptionHandler](./src/main/java/com/example/constructiontracker/exception/GlobalExceptionHandler.java)：统一处理业务异常、参数校验、JSON 解析、404、405、413、415 等 Spring MVC 错误，并保留 `Allow` 等必要响应头。

后续 Service 可这样报告阶段冲突：

```java
throw new BusinessException(HttpStatus.CONFLICT, "STAGE_CONFLICT", "房屋阶段已更新，请刷新后重试");
```

调用者会收到 HTTP 409 和 `{"code":"STAGE_CONFLICT","message":"房屋阶段已更新，请刷新后重试"}`。未知服务器异常统一返回 HTTP 500 和通用提示，详细异常仅写入服务端日志。

[错误响应测试](./src/test/java/com/example/constructiontracker/exception/GlobalExceptionHandlerTests.java) 使用 MVC 测试验证状态码、JSON 格式、校验消息和响应头，不需要数据库。上传超限测试验证异常到 HTTP 413 的映射；实际文件类型与 10 MB 边界校验仍在照片上传步骤中实现。当前已接入请求头认证异常的401映射，角色与社区授权复用业务异常返回403；阶段推进等业务规则仍待实现。

### 第三阶段：请求头认证与角色社区授权

已实现 UserRole、不可变 UserIdentity、HeaderIdentityParser、AuthenticationInterceptor、WebMvcConfig、RequestIdentity 和 AuthorizationService。MVC 拦截器只覆盖 `/api/**`，认证成功后将身份存入请求 attribute，不使用 ThreadLocal、Session 或 Spring Security；`/actuator/health` 不需要身份。Controller 后续可通过 `RequestIdentity.get(request)` 获取身份，再传给业务 Service。

`requireAdmin` 仅允许 ADMIN；`requireCanManageHouse` 允许 ADMIN 管理所有社区、SITE_MANAGER 管理严格同名社区，拒绝 VIEWER 和现场负责人对空目标社区的操作。社区判断区分大小写，不模糊匹配。目标房屋社区必须由未来业务 Service 从数据库读取，不能使用客户端参数。

第三阶段验收的默认测试为129项（122通过、0失败、7项默认跳过），另行运行的7项 MySQL 隔离测试全部通过。在8081启动当前版本进行真实 HTTP 验证：无身份健康接口200，无身份 `/api/houses` 为401，合法 ADMIN 为404，非法角色为401。404不是认证成功的单独证据，认证成功及身份传递同时由 MockMvc 断言验证。正式房屋 API 尚未开发，没有为验收新增生产接口。

验收记录与真实 AI 错误说明见 [第三阶段 AI 使用摘要](./docs/ai-log/2026-10-12-stage-3.md)，请求、响应体及关键响应头见 [HTTP 验收 JSON](./docs/verification/2026-10-12-stage-3-http.json)。用户已授权在提交前检查和测试通过后提交第三阶段；该授权不代表已完成正式人工代码审查，摘要不替代完整 AI 对话导出。

## 3. 数据获取与导入

**当前尚未获取或导入不少于200条真实公开数据**，数据获取脚本和导入接口也尚未实现；数据库测试中的数据仅为测试夹具，不计入真实数据交付。

### 数据要求

- 从公开网站获取不少于 200 条真实的在建项目或建筑许可数据。
- 优先选择 Austin、Dallas、Chicago 等城市的开放数据门户，具体来源可自行决定。
- 遵守数据网站的使用条款和 robots 规则，并限制请求频率。
- 每条导入记录保存来源 URL 和获取时间。
- 原始大文件不提交到仓库，只提交数据获取脚本和不超过 50 条的样例数据。

### 导入规则

- 导入脚本必须可重复执行。
- 以许可证号 `permitNo` 作为唯一标识，重复导入不能产生重复房屋。
- 缺少坐标或无法解析坐标的记录必须有明确策略，例如跳过并记录原因，或进入待人工修正列表；策略写入 README。
- 导入房屋必须调用本服务的 `POST /api/houses`，不能直接写数据库。
- 建议记录原始字段到导入日志，便于追溯和排查异常。

## 4. 核心业务模型

### 施工阶段

施工阶段按以下顺序推进，新建房屋默认为 `LAND_CLEARING`：

```text
LAND_CLEARING → FOUNDATION → FRAMING → MEP → INTERIOR → CO_READY
```

只能前进一个阶段，不能跳级，不能回退。

### 权限模型

通过请求头模拟登录身份：

- `X-User`：调用者标识。
- `X-Role`：`ADMIN`、`SITE_MANAGER` 或 `VIEWER`。
- `X-Community`：现场负责人所属社区。

权限规则：

- `ADMIN`：可以创建房屋，可以操作所有社区。
- `SITE_MANAGER`：只能上传照片、修改封面、推进自己所属社区的房屋。
- `VIEWER`：只读，可以查看全部房屋。
- 缺少身份请求头返回 `401`；身份存在但权限不足返回 `403`。

### 照片规则

- 一栋房屋可以有多张照片，新照片不能覆盖旧照片。
- 只接受 JPEG、PNG、WebP；单张最大 10 MB，恰好 10 MB 允许。
- 文件类型必须根据文件内容判断，不能只相信扩展名或客户端声明的 MIME 类型。
- 同一栋房屋上传内容完全相同的照片视为重复提交：不新增记录，返回已有照片。
- 原始文件名不可信，不能直接拼接为存储路径；应使用服务端生成的安全文件名。
- 读取 EXIF 拍摄时间和 GPS：
  - 距房屋坐标不超过 200 米：`VERIFIED`。
  - 超过 200 米：`SUSPECT`。
  - 没有 GPS：`UNKNOWN`。
- EXIF 时间无时区时，按 `America/Chicago` 的本地时间解释。
- 保存 UTC 时间戳，同时单独保存按美国中部时区计算的业务日 `businessDate`。
- 没有 EXIF 拍摄时间时，使用上传时刻换算到美国中部时区后的日期作为 `businessDate`。

### 阶段推进条件

- 请求必须携带调用者看到的当前阶段 `fromStage` 和目标阶段 `toStage`。
- `fromStage` 与数据库当前阶段不一致时返回 `409`。
- `toStage` 不是下一阶段，或当前阶段没有至少一张状态不是 `SUSPECT` 的照片时返回 `422`。
- 成功推进时记录操作人和操作时间。

### 汇总规则

- 返回各阶段房屋数量。
- 返回“超过 14 天没有新照片”的房屋 ID 列表。
- 天数按美国中部时区的业务日计算。
- 没有任何照片的房屋，从创建业务日起算。

## 5. 接口契约

所有请求和响应使用 JSON，照片上传接口例外使用 `multipart/form-data`。错误格式统一为：

```json
{"code":"...","message":"..."}
```

测试主要检查 HTTP 状态码，但实现仍应返回可读错误信息。

| 方法 | 路径 | 主要要求 | 成功状态 |
| --- | --- | --- | --- |
| `POST` | `/api/houses` | 仅 `ADMIN`；字段：`permitNo`、`address`、`community`、`lat`、`lng` | 新建 `201`；`permitNo` 已存在返回 `200` 和已有记录 |
| `GET` | `/api/houses` | 支持 `minLat`、`maxLat`、`minLng`、`maxLng`、`stage` 筛选；列表查询不能逐栋查库 | `200` |
| `GET` | `/api/houses/{id}` | 返回详情和按拍摄时间排序的 `photos` 数组 | `200` |
| `POST` | `/api/houses/{id}/photos` | 字段名为 `file`；校验真实类型、大小、EXIF 和内容去重 | 新照片 `201`；重复照片 `200`；类型错误 `415`；超限 `413` |
| `PUT` | `/api/houses/{id}/cover` | 请求体 `{"photoId":...}`；照片不属于该房屋返回 `422` | `200` |
| `POST` | `/api/houses/{id}/advance` | 请求体 `fromStage`、`toStage`；校验乐观并发、顺序和合格照片 | 成功 `200`；阶段冲突 `409`；业务条件不满足 `422` |
| `GET` | `/api/summary` | 返回 `stageCounts`、`staleHouseIds`；可选 `asOf`（UTC ISO-8601） | `200` |

`GET /api/houses` 每项至少包含：`id`、`permitNo`、`address`、`community`、`lat`、`lng`、`stage`、`coverPhotoUrl`、`lastPhotoBusinessDate`。

照片上传响应至少包含：`id`、`locationStatus`、`takenAt`、`businessDate`、`url`。

## 6. 推荐实现步骤

1. **初始化项目**：建立 Spring Boot、Maven Wrapper、配置文件、MyBatis XML 映射、统一错误响应和基础目录结构。
2. **搭建数据库**：设计房屋、照片、阶段推进记录等表；为 `permitNo`、房屋 ID、照片内容哈希和查询筛选字段建立必要索引；增加 `docker-compose.yml`。
3. **实现身份与权限**：统一解析 `X-User`、`X-Role`、`X-Community`，在服务层或授权组件中集中执行鉴权，避免把权限散落在 Controller。
4. **实现房屋接口**：完成创建、重复许可证幂等处理、详情查询和地图范围/阶段筛选；列表查询使用批量关联或聚合，禁止 N+1 查询。
5. **实现数据导入**：编写限速获取脚本、字段清洗和坐标策略；通过 HTTP 调用 `POST /api/houses` 导入不少于 200 条数据；提交少量样例而非原始大文件。
6. **实现照片上传**：按内容识别格式和大小，生成安全存储名，计算内容哈希，处理 EXIF 时间/GPS，计算距离和业务日，并以房屋 ID + 内容哈希保证去重。
7. **实现封面与详情**：校验照片归属，保证封面只能指向当前房屋的照片；详情按拍摄时间排序并返回照片 URL。
8. **实现阶段推进**：校验 `fromStage`、`toStage`、合格照片和权限；使用事务及数据库条件更新/锁，保证同一次推进只能成功一次。
9. **实现汇总**：按业务日和 `asOf` 计算阶段数量、最后照片日期及超过 14 天未更新的房屋。
10. **补齐并发与边界测试**：覆盖重复许可证、重复照片、并发上传、并发推进、权限、EXIF、时区、200 米边界、10 MB 边界、错误状态码和 N+1 风险。
11. **完善交付文档**：写明启动方式、测试方式、数据来源、坐标处理、并发/去重/权限/时区设计、取舍、未完成项和至少两个 AI 不良建议及修正过程。
12. **分阶段提交**：至少形成 8 次有意义提交，并在最终提交前执行 `./mvnw test`、检查敏感信息、确认 `docs/ai-log/` 和仓库内容符合提交要求。

## 7. 并发、去重与关键设计备忘

- **照片并发上传**：内容哈希由服务端计算；数据库建立房屋范围内的唯一约束（例如 `house_id + content_hash`），重复插入时捕获唯一键冲突并查询返回已有记录。文件写入应使用临时文件和安全命名，避免并发覆盖。
- **阶段并发推进**：事务内根据房屋 ID 锁定或执行带当前阶段条件的更新，例如只允许 `stage = fromStage` 的单次更新；影响行数为 0 时返回 `409`。
- **权限位置**：Controller 负责接收请求，服务层统一执行角色、社区和资源归属判断，数据库查询也要注意不能通过接口绕过权限。
- **时区处理**：数据库时间戳统一 UTC；业务日用 `America/Chicago` 单独计算和存储；`asOf` 先解析为 UTC，再换算业务日。
- **地图查询**：范围筛选在 SQL 层完成，封面和最后照片日期通过批量查询、聚合或合理 JOIN 一次性得到，避免逐栋查询。

## 8. 验收清单

- [ ] `docker compose up -d` 可启动 MySQL，应用可连接。
- [ ] `./mvnw spring-boot:run` 可在 8080 启动。
- [x] `./mvnw test` 一次通过，测试运行方式已记录。
- [ ] 至少 200 条真实公开数据可重复导入，且通过 `POST /api/houses`。
- [ ] 缺失坐标、重复许可证、重复照片均有测试和明确行为。
- [ ] 六个阶段只能按顺序单步推进，阶段推进具备并发保护。
- [ ] JPEG/PNG/WebP、10 MB、真实文件类型和 EXIF 规则均已覆盖。
- [ ] `VERIFIED`、`SUSPECT`、`UNKNOWN`、时区和业务日规则正确。
- [x] `ADMIN`、`SITE_MANAGER`、`VIEWER`、`401`、`403` 已测试。
- [ ] 地图列表没有 N+1 查询。
- [ ] 提交记录不少于 8 次，AI 日志和数据脚本已提交，未提交原始大文件。
- [ ] README 已写明并发、去重、权限、时区、取舍、未完成项和 AI 修正案例。

## 9. 未完成项记录

如果时间不足，优先保证已完成功能可运行且有测试，并在此处明确记录：

| 项目 | 当前状态 | 后续处理 |
| --- | --- | --- |
| 真实数据与导入脚本 | 尚未导入200条真实记录 | 后续通过 POST /api/houses 导入，保存来源和获取时间 |
| 请求头认证与角色社区授权 | 组件和自动化验收完成，人工审查待确认 | 后续业务 Service 从数据库读取资源所属社区后调用授权组件 |
| 房屋、照片等业务模型与接口 | 尚未实现 | 后续按推荐步骤实现 |
| 照片、阶段推进与汇总 API | 只有数据库约束及 SQL 验证 | 后续补齐文件处理、事务、HTTP 与并发测试 |
| AI 日志与最终交付说明 | 已有第三阶段脱敏摘要 | 完整对话导出及至少两个真实 AI 不良建议和修正案例仍待整理 |

## 10. 题面来源

本 README 根据项目内的[上机题_在建房屋地图_题面.md](./上机题_在建房屋地图_题面.md)整理。若实现过程中发现 README 与题面冲突，以题面和接口约定为准，并在提交说明中记录调整原因。
