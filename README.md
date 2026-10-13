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
# 默认：246 项测试，232 项通过，14 项 MySQL 集成测试跳过；框架测试使用 H2 / MVC

docker compose up -d --wait
./mvnw -Dmysql.integration=true -Dtest=MySqlMigrationTests test
# 可选：7 项 MySQL 集成测试使用 compose 中的 MySQL，不使用 Testcontainers

./mvnw -Dmysql.integration=true -Dtest=MySqlMigrationTests,MySqlHouseCreationTests test
# 7项迁移测试 + 3项创建测试 + 2项列表测试 + 2项详情测试，均使用随机命名的隔离库
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

当前已完成 Spring Boot 基础工程、MyBatis 接入、MySQL Compose 配置、Flyway V1 建表、身份授权及房屋创建、列表和详情接口。默认框架测试启用 `test` profile，使用 H2 内存数据库及随机 HTTP 端口；MySQL 专用约束和迁移通过上面的隔离库集成测试验证。照片上传、文件访问及后续业务接口仍待实现。

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

调用顺序为 Controller → Service → Mapper；Mapper 接口关联 XML SQL。各 Java 分层目录通过 `package-info.java` 保留并说明职责。已实现统一错误响应、身份授权、数据库表及房屋创建所需模型和接口。

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

### 第四阶段：房屋接口（按小步骤实现）

| 步骤 | 范围 | 状态 |
| --- | --- | --- |
| 4.1 | 房屋模型、创建接口、许可证幂等与创建权限 | 已验收，本次回归通过 |
| 4.2 | 地图列表、独立坐标/bbox/阶段筛选、一次 SQL 查询 | 已手工验证，本次回归通过 |
| 4.3 | 房屋详情、按拍摄时间排序的照片元数据 | 已完成，4.4手工验收通过 |
| 4.4 | 房屋接口集成验收与提交准备 | PASS，列表响应字段补齐及回归通过 |

4.1提供 `POST /api/houses`，复用请求头认证及 `AuthorizationService.requireAdmin`。仅 ADMIN 可以创建；新记录返回201，重复 `permitNo` 返回200及原记录，不覆盖其地址、社区、阶段、来源或创建时间。许可证、地址和社区去除首尾空白并校验非空和数据库字段长度，不转换大小写。

`lat`、`lng` 可以同时省略或为 null；只缺一个、越界或超过7位小数返回400。缺坐标房屋保留在数据库，后续地图范围查询将排除无坐标记录。新房屋固定为 `LAND_CLEARING`，创建者来自已认证身份，不使用客户端传入的阶段或创建者。

来源扩展字段 `sourceUrl`、`sourceFetchedAt` 必须同时提供或同时省略。省略时记为 MANUAL；提供时记为 PUBLIC_DATA，保留 URL 与获取时间。URL 只接受不含账号凭据的 HTTP/HTTPS 地址，最多2048字符；获取时间使用 ISO-8601，转换为 UTC，年份须在1000到9999之间以适配现有数据库字段。后续公开数据导入必须提供这两个字段。

示例请求（现有五字段契约仍兼容）：

```json
{
  "permitNo": "EXAMPLE-PERMIT-001",
  "address": "Example address",
  "community": "North Austin",
  "lat": 30.2672000,
  "lng": -97.7431000
}
```

创建时间由可注入的 UTC Clock 生成，按 DATETIME(6) 截断为微秒；`createdBusinessDate` 使用 `America/Chicago`，响应时间带 `Z`。MyBatis 的 INSERT 和查询均写在 [HouseMapper.xml](./src/main/resources/mapper/HouseMapper.xml)，参数绑定使用 `#{}`。许可证唯一键兜底并发：捕获 `DuplicateKeyException` 后查询并返回已提交的原记录，其他数据库错误不伪装成重复。创建只执行一个 INSERT，不添加包含早期查询的 REPEATABLE READ 事务，避免冲突后仍读取旧快照。

默认新增47项服务/MVC/H2测试全部通过；另有3项真实 MySQL 创建测试默认跳过，单独运行时已通过，其中并发测试强制两个请求先读到许可证不存在，再竞争插入。原有7项 MySQL 迁移测试也已复跑通过。测试库与正式库隔离，未向正式库写入验收数据。实现和验证摘要见 [4.1 AI 使用记录](./docs/ai-log/2026-10-12-stage-4.1.md)。

4.2提供 `GET /api/houses`，返回按 ID 升序排列的 JSON 数组，无匹配记录为 `[]`。不传参数查询全部房屋；支持原题的可选独立参数 `minLat`、`maxLat`、`minLng`、`maxLng`，也兼容 `bbox=minLng,minLat,maxLng,maxLat`。任一坐标形式均可与 `stage=ConstructionStage枚举名` 组合。ADMIN、SITE_MANAGER、VIEWER 均可读取全部社区；请求头认证失败仍返回401，不按 `X-Community` 限制读取。

bbox 使用四个逗号分隔的常规十进制数，允许首尾空白，拒绝 NaN、Infinity 和指数记法；单个坐标最多32字符，整个 bbox 最多256字符。经度在[-180,180]、纬度在[-90,90]，最小值不得超过最大值；相等可表示单点或边界线，范围包含边界。传入空/空白参数、格式错误、坐标越界、颠倒范围或非法 stage 返回400及 `{"code":"INVALID_REQUEST","message":"..."}`；stage 区分大小写，允许首尾空白，使用已有 ConstructionStage 枚举。

独立坐标参数使用相同数值校验，可只提供部分边界：未提供的 minLat/maxLat/minLng/maxLng 分别取 -90/90/-180/180。转换为同一 HouseListQuery 后复用原 SQL，未重构查询或创建流程。提供任一坐标范围参数时排除空坐标；坐标参数全部省略时保留空坐标。bbox 与任一独立坐标参数同时出现返回400，避免冲突被静默忽略。

过滤全部在 [HouseMapper.xml](./src/main/resources/mapper/HouseMapper.xml) 的 `findAll` 中完成：动态 WHERE 使用经纬度 BETWEEN 和阶段等值条件，`#{}` 绑定参数，`ORDER BY id ASC` 排序。带坐标范围时明确排除空坐标；无坐标范围时保留空坐标。Service 只调用一次 Mapper，Java 只转换响应对象，不筛选数据。MySQL 集成测试使用查询计数器验证一次列表调用只执行一次 Mapper 查询。

请求示例：

```bash
curl -G 'http://localhost:8080/api/houses' \
  -H 'X-User: reviewer' -H 'X-Role: VIEWER' \
  --data-urlencode 'minLat=29' --data-urlencode 'maxLat=31' \
  --data-urlencode 'minLng=-98' --data-urlencode 'maxLng=-96' \
  --data-urlencode 'stage=LAND_CLEARING'
```

本阶段复用4.1的 HouseResponse，未新增照片查询或照片功能。原题要求列表包含 `id`、`permitNo`、`address`、`community`、`lat`、`lng`、`stage`、`coverPhotoUrl`、`lastPhotoBusinessDate`；这些键已全部提供，后两项在4.4补齐，目前固定返回 null，真实照片数据联动留到第6、7步完成。详情接口、上传、封面设置、阶段推进和统计均未在4.2开发。

4.2首次新增31项 MVC 用例、2项真实 MySQL 列表用例；独立参数兼容补充14项 MVC 用例，并扩展原 MySQL 用例验证两种参数形式结果一致、独立参数与 stage 组合和单边界过滤。复用现有测试配置和随机隔离库，不增加依赖或修改 V1。`./mvnw test` 为226项（214通过、0失败/错误、12项默认跳过）；现有 MySQL 集成命令的12项测试也全部通过。首次4.2测试结果保留在 [4.2 AI 使用摘要](./docs/ai-log/2026-10-12-stage-4.2.md)。

4.3提供 `GET /api/houses/{id}`，沿用拦截器认证，ADMIN、SITE_MANAGER、VIEWER 均可跨社区读取，未认证返回401。ID 必须能转换为正的64位整数；非数值、小数、溢出、零或负数返回400，合法 ID 不存在返回404。错误复用现有 JSON 结构。

详情使用独立 [HouseDetailResponse](./src/main/java/com/example/constructiontracker/dto/HouseDetailResponse.java)，返回平铺的全部房屋基本字段（包括来源、获取时间、创建者、创建业务日、更新时间和已有 coverPhotoId）以及 `photos` 数组；创建和列表共用 HouseResponse，4.4仅补充两个可空照片字段，保留原有字段及状态码。无照片为 `[]`。照片包含 ID、房屋 ID、上传时阶段、定位状态、拍摄/上传时间、拍摄时间来源、业务日、上传者、原始文件名、类型、大小及 GPS/距离元数据；不返回内部存储键或内容哈希。时间戳转换为带 `Z` 的 UTC，业务日保留数据库日期。

详情采用固定两次 SQL：HouseMapper 的 `findById` 按主键查询房屋，存在后 `findPhotosByHouseId` 按 house_id 一次读取全部关联照片，使用 `ORDER BY taken_at ASC, id ASC` 保证拍摄时间升序和同时间下的稳定顺序。不存在的房屋只执行第一次查询；不逐张查询或在 Java 排序，无 N+1。所有 SQL 写在现有 HouseMapper.xml，参数使用 `#{}` 绑定，复用现有 house resultMap。

```bash
curl 'http://localhost:8080/api/houses/1' -H 'X-User: reviewer' -H 'X-Role: VIEWER'
```

照片只读取现有 photo 表元数据，不实现上传、EXIF 解析、文件服务、封面设置或阶段推进。PhotoResponse 的文件 URL，以及列表 coverPhotoUrl/lastPhotoBusinessDate 的真实数据联动，仍待后续照片步骤补齐；两个列表字段当前返回 null，不生成尚不可访问的占位 URL。

新增5项 Service 单元测试、13项 MVC 用例及2项真实 MySQL 详情用例，复用已有隔离库与查询计数器。`./mvnw test` 为246项（232通过、0失败/错误、14项默认跳过）；单独 MySQL 集成测试14项全部通过，包含原有迁移、创建、列表及新增详情验证。覆盖无照片、404、非法ID、三种角色跨社区读取、UTC、照片归属、排序及固定查询次数。记录见 [4.3 AI 使用摘要](./docs/ai-log/2026-10-13-stage-4.3.md)。

4.4已完成原题对照验收，用户确认手工验收通过。唯一阻塞项为列表缺少两个照片字段，已在 HouseResponse 中最小补齐，并用字段级 Jackson 配置保证 null 键仍序列化。非空列表 MockMvc 测试和真实 HTTP 响应均验证 `coverPhotoUrl: null`、`lastPhotoBusinessDate: null`；完整回归仍为246项（232通过、14项默认跳过、0失败/错误）。第4阶段结论为 PASS；null 占位不代表原题照片联动最终完成，后续仍须补齐。记录见 [4.4 AI 使用与验收记录](./docs/ai-log/2026-10-13-stage-4.4.md)。

## 3. 数据获取与导入

**5.1已获取并清洗200条真实公开建筑许可，5.2已通过API导入并验证重复运行幂等**。仅通过 `POST /api/houses` 导入，不直接写数据库；数据库测试夹具不计入真实数据交付。

### 5.1 Austin 数据获取与清洗（已完成，采集阶段不导入）

数据源为 City of Austin / Austin Development Services 的 [Issued Construction Permits](https://data.austintexas.gov/Building-and-Development/Issued-Construction-Permits/3syk-w9eu/about_data)，数据集 ID `3syk-w9eu`。[使用条款](https://data.austintexas.gov/stories/s/ranj-cccq)允许使用公开数据，须注明来源，不进行个人重新识别或联系。脚本只获取必要的许可、地址和坐标字段，不获取申请人或承包商联系方式。

用户已确认首批筛选：`permittype=BP`、`permit_class_mapped=Residential`、`permit_class=R- 101 Single Family Houses`、`work_class=New`、`status_current=Active`、`issue_date >= 2025-01-01`。按发证日降序、完整许可证号升序稳定分页，清洗后选取200条许可证唯一、坐标有效的记录。Active只是许可证状态，不证明实际施工进度；输出不含 stage，后续由创建接口使用默认 LAND_CLEARING。

使用 Python 3 标准库，无额外依赖；在项目根目录执行：

```bash
python3 scripts/fetch_austin_permits.py
python3 -m unittest discover -s scripts/tests -v
```

脚本每次先读取并检查 [robots.txt](https://data.austintexas.gov/robots.txt)，无法获取、无法识别或不允许API路径时停止。当前 Crawl-delay 为1秒，脚本串行请求至少间隔2秒；若 robots 要求更长间隔则采用更长值。429及暂时性502/503/504最多重试3次，按 Retry-After 和退避等待，服务器要求超过60秒等待时停止，留待之后重跑，不提前重试。

字段映射：`permit_number` → permitNo（完整保留BP后缀和大小写）；`original_address1`及城市/州/邮编 → address；`council_district` → `Austin Council District N`（N为1—10）。community采用用户确认的行政区分组，不声称是实际小区名。经纬度先校验有效数值和全球范围，再以十进制 ROUND_HALF_UP 四舍五入至7位小数。每条记录的 sourceUrl 是按完整许可证号定位原记录的官方API URL，sourceFetchedAt 是该页成功获取后的实际 UTC 时间，不使用发证日代替。

本批只选坐标有效记录：缺任一坐标、无法解析、非有限数或越界的记录排除并统计原因；空许可证、空/超长地址、非法行政区、范围外记录及重复许可证也排除。不填零、不猜坐标、不做额外地理编码。此策略只用于首批采集，现有房屋API仍允许 lat/lng 同时为 null。

完整清洗结果位于 `data/local/austin-houses.json`，统计及最多20条排除示例位于 `data/local/austin-collection-report.json`，整个目录由 Git 忽略。仓库只保留 [20条真实样本](./data/samples/austin-houses.json)，通过 `--sample-size` 可调整但不得超过50条；不保存完整原始数据。`--limit` 默认200且不能小于200，`--page-size` 默认200，`--delay` 默认2秒。

每次从首批数据重新采集，在许可证号范围内去重，成功后按文件原子替换输出，不追加；数据不足200条或采集失败时不发布新的结果。重复采集会刷新获取时间，官方数据更新时记录内容也可能变化。重复API导入的幂等验收属于5.2，本步骤不调用本服务或数据库。

本次采集6页共1200条：有效唯一211条，排除989条（全部为缺失坐标），选取200条，另外11条有效记录未选入；仓库样本20条。离线清洗及请求规则测试全部通过，过程见 [5.1 AI 使用记录](./docs/ai-log/2026-10-13-stage-5.1.md)。

### 5.2 Austin API导入与幂等验证（已完成）

[导入脚本](./scripts/import_austin_houses.py)使用现有 `data/local/austin-houses.json`，不会重新采集。输入全部校验通过后才发起请求；只使用本服务的 GET/POST `/api/houses`，不连接数据库。请求头固定 `X-Role: ADMIN`，`X-User` 默认 `austin-import`，ADMIN无需 X-Community。保留原始地址、坐标、community、sourceUrl和实际获取时间，不传入stage或创建者。

启动本项目后，在项目根目录执行；下面命令假设应用位于8081：

```bash
python3 -B scripts/import_austin_houses.py --base-url http://127.0.0.1:8081 --report data/local/austin-import-first.json
python3 -B scripts/import_austin_houses.py --base-url http://127.0.0.1:8081 --report data/local/austin-import-second.json
python3 -B -W error::ResourceWarning -m unittest discover -s scripts/tests -v
```

脚本串行导入，新建201、已存在200分别计数。每次先读取列表，导入后再次读取列表，逐条核对200条输入字段、POST响应、ID和已有记录的完整列表响应；已有数据与输入冲突时报告失败，不覆盖。请求失败时停止剩余写入，返回非零退出码并记录未尝试数量；不自动重试POST，处理问题后可用同一输入重跑，服务端permitNo唯一约束保证幂等。使用 `--username` 可调整ADMIN用户名；不需要或读取数据库密码。

本次应用在未占用8081启动，禁用本次Flyway执行。首次200条全部201（新建200、已存在0、失败0），正式库列表从3条增至203条；第二次全部200（新建0、已存在200、失败0），仍为203条。两次200条完整POST响应一致，包括ID、来源及创建时间；列表查询确认全部输入字段一致，原有3条列表记录未变化。另用VIEWER查询列表及5条详情，验证可读取、创建者为austin-import、updatedAt等于createdAt、photos为空。

Python脚本测试31项全部通过（5.1原有20项，5.2新增11项），覆盖首次/重复导入、已有阶段与无关记录保留、冲突、失败停止、查询不一致、输入校验及ADMIN请求头。未修改Java业务代码或运行数据库迁移，真实400次POST与查询验收通过。用户已确认第5阶段手工验收通过。完整导入报告及响应只保存在Git忽略的 `data/local/`，不新增仓库真实样本。过程见 [5.2 AI使用与验证记录](./docs/ai-log/2026-10-13-stage-5.2.md)。

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
| `GET` | `/api/houses` | 支持 `minLat`、`maxLat`、`minLng`、`maxLng`、`stage`；兼容 bbox，一次 SQL 查询，按 ID 升序 | `200` |
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

### 2026-10-13 开发与交付计划补充

本日计划是上述实现步骤的执行优先级补充，不代表功能已经完成。正式提交截止时间为 **2026-10-14 11:00（Asia/Shanghai）**。今日推进时段为 **08:00–12:00、15:00–20:00**；这两个时段内也必须预留代码测试验收、文档整理及技术面试准备时间，不全部用于新增功能。**最迟今日20:00停止新增业务功能**，之后以测试、交付整理和代码理解为主。

| 顺序 | 对应步骤 | 目标性质 | 执行范围与验收重点 |
| --- | --- | --- | --- |
| 第一阶段 | 4.4 房屋接口集成验收 | 必须优先完成 | 对照原题检查现有创建、列表、详情 API，核对权限、数据库操作、许可证幂等、异常状态码和自动化测试；优先修复实际发现的问题，明确通过项、失败项及后续待完成项。未完成4.4验收前，不进入后续开发 |
| 第二阶段 | 第5步：真实数据获取与导入 | 必做目标 | 获取并通过 POST /api/houses 导入不少于200条真实建筑许可或在建项目记录，保存来源 URL 和获取时间；明确缺失/无法解析坐标策略，处理重复许可证，验证脚本重复运行不新增重复房屋；完成对应测试和验收 |
| 第三阶段 | 第6步：照片上传 | 必做目标 | 完整实现原题的内容识别、大小、安全存储、去重、EXIF、定位、时区、并发和状态码要求，覆盖正常流程、异常及边界，完成自动化测试和验收 |
| 第四阶段 | 第7步：封面与详情完善 | 仅时间允许时进行 | 在前述必做目标完成且测试、文档、面试准备时间有保障后，实现封面设置及照片归属校验，完善现有详情和地图封面展示，并完成必要测试 |

真实数据必须来自符合使用条款的公开数据源，获取前核对使用规则和 robots 规则，按要求限速。导入只能调用服务的 POST /api/houses，不能直接写数据库；测试夹具不计入200条真实数据。仓库只提交获取/导入脚本和不超过50条样例，不提交大型原始数据文件。

照片上传必须完整覆盖以下要求，不能只完成正常流程：

- Multipart 上传，字段名为 file；依据文件内容识别 JPEG、PNG、WebP，不只相信扩展名或客户端 MIME。
- 单张最大10 MB，沿用现有十进制口径10,000,000字节，恰好上限允许；真实文件大小与 HTTP 上传边界均需验证。
- 使用可配置本地目录和服务端安全文件名，不拼接不可信原始文件名；新照片不覆盖旧照片。
- 服务端计算 SHA-256，同一房屋相同内容返回已有照片；并发上传不能丢失或新增重复记录。
- 提取 EXIF 拍摄时间和 GPS；距离不超过200米为 VERIFIED，超过为 SUSPECT，没有定位或无法计算距离时为 UNKNOWN，覆盖200米边界。
- 无时区 EXIF 按 America/Chicago 解释；缺失拍摄时间使用上传时刻计算业务日；UTC时间戳与 businessDate 分别保存，覆盖时区和夏令时边界。
- 沿用角色与社区授权：ADMIN可操作所有社区，SITE_MANAGER仅可上传自己社区的房屋，VIEWER禁止修改；目标房屋社区从数据库读取。
- 新照片201、内容重复200、类型错误415、超限413，认证失败401、权限不足403；响应提供原题要求的照片 ID、定位状态、拍摄时间、业务日和可访问 URL，完成对应自动化及真实数据库验证。

**本日暂不开发第8步施工阶段推进、第9步汇总统计及超过14天未更新照片判断**。这些仍属于原题最终要求，按本日范围保留为未完成项，不在 README 中声称已经实现。

开发沿用现有 Java 21、Spring Boot 3、MyBatis XML、MySQL 和项目分层，不引入无关框架、额外功能或不必要重构。重要架构选择、需求歧义或较大范围修改须先说明方案与取舍，等待用户确认。时间不足时优先保证已完成模块正确且有测试，如实记录剩余工作，不通过省略异常、并发或边界规则来宣称完整，也不延后20:00的新增功能停止时间。

测试验收贯穿每个模块。交付整理包括 README 中真实的完成状态与取舍、运行和测试说明、数据来源、AI完整对话及实际技术讨论/问题/修正记录，不编造人工纠错案例。Git保持小步、有意义的提交，遵守原题至少8次提交要求，不改写已有历史；实际提交按后续明确指令执行。技术面试准备重点为代码调用链、权限位置、幂等和并发、时间与业务日、文件存储安全，以及每次提交的设计决定。

计划同步时仅记录计划，后续已按明确授权完成4.4验收及最小修复，第4阶段为 PASS；第5步已完成采集、清洗和API导入验证。照片业务及后续开发等待新的明确指令。

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
- [x] 地图列表没有 N+1 查询。
- [ ] 提交记录不少于 8 次，AI 日志和数据脚本已提交，未提交原始大文件。
- [ ] README 已写明并发、去重、权限、时区、取舍、未完成项和 AI 修正案例。

## 9. 未完成项记录

如果时间不足，优先保证已完成功能可运行且有测试，并在此处明确记录：

| 项目 | 当前状态 | 后续处理 |
| --- | --- | --- |
| 真实数据与导入脚本 | 200条真实许可已通过API导入，重复导入及第5阶段手工验收通过 | 仓库保留20条真实样本，完整结果和报告不进入Git |
| 请求头认证与角色社区授权 | 组件和自动化验收完成，人工审查待确认 | 后续业务 Service 从数据库读取资源所属社区后调用授权组件 |
| 房屋创建接口 | 第4阶段验收通过 | 保留201/200幂等及 ADMIN 创建权限 |
| 房屋列表 | 第4阶段验收通过，两个照片字段存在且为 null | coverPhotoUrl、lastPhotoBusinessDate 的真实数据联动待第6、7步补齐 |
| 房屋详情 | 第4阶段验收通过，已返回房屋信息与照片元数据 | 文件访问 URL 待照片存储步骤补齐 |
| 照片、阶段推进与汇总 API | 只有数据库约束及 SQL 验证 | 后续补齐文件处理、事务、HTTP 与并发测试 |
| AI 日志与最终交付说明 | 已有第三阶段、4.1—4.4及5.1—5.2脱敏摘要 | 完整对话导出及至少两个真实 AI 不良建议和修正案例仍待整理 |

## 10. 题面来源

本 README 根据项目内的[上机题_在建房屋地图_题面.md](./上机题_在建房屋地图_题面.md)整理。若实现过程中发现 README 与题面冲突，以题面和接口约定为准，并在提交说明中记录调整原因。
