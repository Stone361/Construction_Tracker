# Construction Tracker（在建房屋地图）

## 1. 项目简介

面向美国中部在建社区的后端服务，通过房屋位置、施工照片和阶段历史追踪建设进度。支持地图范围查询、照片上传与封面设置、施工阶段推进，以及指定时点的进度汇总。

技术栈：Java 21、Spring Boot 3.5.16、MyBatis Spring Boot Starter 3.0.5、MySQL 8.4.11、Flyway。照片原始文件存本地，业务数据与审计记录存 MySQL。本仓库不包含前端实现。

## 2. 快速开始

### 步骤 1：准备环境

- **JDK 21**：确保终端使用该版本。
- **Docker Desktop / Docker Compose v2**：Compose 需支持 `--wait`。Docker Desktop 必须已启动且未暂停，仅安装不够；Linux 也可使用已运行的 Docker Engine。
- **Git、curl**：用于克隆仓库和发送验证请求。
- 无需单独安装 Maven，项目使用 Maven Wrapper；首次下载 Maven、依赖和 MySQL 镜像需要联网。

以下命令适用于 macOS、Linux 或 Windows 的 Git Bash。先检查工具：

```bash
java -version
git --version
curl --version
docker info
docker compose version
```

预期：Java 显示版本 21；其他工具正常显示信息，`docker info` 能连接 Docker 服务。确保本机 **3306、8080** 端口可用。

### 步骤 2：克隆项目

```bash
git clone https://github.com/Stone361/Construction_Tracker.git
cd Construction_Tracker
```

预期：进入包含 `pom.xml`、`mvnw` 和 `docker-compose.yml` 的项目目录。后续命令均在此目录执行。

### 步骤 3：配置环境变量

```bash
cp .env.example .env
```

用文本编辑器打开 `.env`，将 `CHANGE_ME_APP_PASSWORD` 和 `CHANGE_ME_ROOT_PASSWORD` 替换为自行设置的两个不同密码。建议使用不带引号的随机十六进制字符串，避免特殊字符在不同配置解析方式下产生歧义。

| 配置项 | 用途 |
| --- | --- |
| `DB_URL` | 应用连接地址；默认连接本机 3306 端口的 `construction_tracker` 数据库 |
| `DB_USERNAME` | 应用数据库账号，默认 `construction_tracker` |
| `DB_PASSWORD` | 应用数据库密码 |
| `MYSQL_ROOT_PASSWORD` | MySQL 管理员密码；真实 MySQL 集成测试需要使用 |

预期：两个密码占位符均已替换，其余配置首次运行保持默认即可。应用和 Docker Compose 会读取 `.env`，同名环境变量可覆盖文件中的值。**不要提交 `.env`**，仓库已将其忽略。

### 步骤 4：启动 MySQL

```bash
docker compose up -d --wait
docker compose ps
```

预期：启动命令成功结束，`mysql` 服务状态包含 **healthy**。首次启动会在空数据卷中创建数据库和应用账号，端口只映射到 `127.0.0.1:3306`。

### 步骤 5：运行测试

```bash
./mvnw test
```

完整测试默认包含真实 MySQL 集成测试，必须先完成上一步。预期：测试通过，末尾显示 **BUILD SUCCESS**；当前完整测试共有 396 项。测试在随机命名的独立数据库中执行，不向应用业务库写入测试数据。

### 步骤 6：启动 Spring Boot

```bash
./mvnw spring-boot:run
```

预期：日志显示应用启动完成，默认监听 **8080**。首次启动会自动执行 Flyway V1 迁移，创建业务表，无需手动建表。

此命令会持续占用当前终端。**保持终端打开**，在下一步使用第二个终端验证服务。

### 步骤 7：验证服务

打开第二个终端，先验证健康检查（无需身份请求头）：

```bash
curl -i http://127.0.0.1:8080/actuator/health
```

预期：返回 **HTTP 200**，响应体为 `{"status":"UP"}`。

再验证最简单的业务接口：

```bash
curl -i http://127.0.0.1:8080/api/houses \
  -H 'X-User: reviewer' \
  -H 'X-Role: VIEWER'
```

预期：返回 **HTTP 200**，表示接口可访问。全新数据库尚未导入业务数据时，返回 `[]` 是正常现象。全新克隆不会自动包含此前导入的 200 条数据，这不影响启动或测试；数据导入是第 6 节的可选操作。

### 步骤 8：停止项目

在运行 Spring Boot 的终端按 **Ctrl+C**，然后在项目目录停止 MySQL：

```bash
docker compose stop
```

预期：应用退出，MySQL 容器停止，数据仍保留在命名卷 `mysql-data`。再次使用步骤 4 的启动命令即可恢复数据库。**不要随意执行 `docker compose down -v`，它会删除 Compose 管理的数据卷。**

## 3. 常见问题

### Docker Desktop 已安装，但命令无法连接 Docker

启动或恢复 Docker Desktop，等待引擎就绪，再执行 `docker info` 和步骤 4。暂停状态下也无法正常启动数据库。

### 3306 或 8080 端口被占用

先停止占用端口的服务，再按默认流程启动。仓库的 [Compose 配置](./docker-compose.yml)固定映射本机 3306，修改 `DB_URL` 不会改变 Docker 端口映射。

如果自行将数据库映射到本机 **3308**，需分别配置应用和测试地址。在 `.env` 中将 `DB_URL` 改为：

```dotenv
DB_URL=jdbc:mysql://localhost:3308/construction_tracker?connectionTimeZone=UTC
```

测试使用 JVM 系统属性 `mysql.test.address`：

```bash
./mvnw test -Dmysql.test.address=127.0.0.1:3308
```

**仅修改 `DB_URL` 不会改变集成测试默认连接的 3306 端口。** 3308 只是非默认端口示例，首次运行无需配置。

### 修改 `.env` 后密码仍不匹配

MySQL 的初始化密码只在空数据卷首次启动时生效，已有数据卷不会自动更新密码。核对创建该数据卷时使用的凭据；需要更换密码时，应在数据库中修改对应账号，再同步 `.env`。不要通过删除需要保留的数据卷解决密码问题。

### MySQL 集成测试无法连接数据库

确认 `docker compose ps` 显示 healthy、`.env` 中 `MYSQL_ROOT_PASSWORD` 与数据库实际 root 密码一致，并在项目根目录运行测试。非默认端口需传入 `mysql.test.address`；已导出的同名密码环境变量也会覆盖 `.env`。应用账号 `DB_PASSWORD` 不能替代 root 密码。

## 4. 自动化测试与验证记录

| 范围 | 用例数 | 覆盖内容 |
| --- | ---: | --- |
| 单元、MockMvc、H2 及随机端口 HTTP 测试 | 357 | 身份与权限、接口及错误响应、图片内容/大小、EXIF/GPS、时区与故障补偿 |
| `MySqlMigrationTests` | 8 | 真实 V1 迁移、唯一键/外键/CHECK、历史汇总与日期边界 |
| `MySqlHouseCreationTests` | 31 | 真实 SQL、幂等、照片并发、封面与列表联动、阶段竞争/回滚、汇总一致快照 |

[pom.xml](./pom.xml) 默认启用 `mysql.integration=true`。MySQL 不可用或凭据错误时完整测试会失败，不会自动降级到 H2 或静默跳过。两组 MySQL 测试从环境变量或 `.env` 读取 root 密码，各自创建 `construction_tracker_test_<随机值>` 数据库，仅清理本次成功创建的测试库。普通框架测试使用 [H2 测试配置](./src/test/resources/application-test.yml)。

**2026-10-14 手动验证记录**：从 GitHub 全新克隆，使用独立 Docker Compose 项目启动 MySQL 8.4.11，新数据库映射到本机 3308。依次执行：

```bash
./mvnw clean test -Dmysql.test.address=127.0.0.1:3308
./mvnw test -Dmysql.test.address=127.0.0.1:3308
```

两次结果均为：

```text
Tests run: 396, Failures: 0, Errors: 0, Skipped: 0
BUILD SUCCESS
```

随后 Spring Boot 在 **8082** 端口成功启动，Flyway 自动执行 V1。全新业务库创建了 `house`、`photo`、`stage_history` 和 `flyway_schema_history`；迁移记录为 `version=1`、`success=1`。HTTP 验证结果：

- `GET http://127.0.0.1:8082/actuator/health`：HTTP 200，`{"status":"UP"}`。
- 携带 `X-User: reviewer` 和 `X-Role: VIEWER` 请求 `GET http://127.0.0.1:8082/api/houses`：HTTP 200，`[]`，符合全新业务库无数据的预期。

该全新克隆验证目录的 `git status --short` 仅显示未跟踪的 `compose.manual.yml`，此文件仅用于本地验证，不应提交。

开发时可单独运行 MySQL 测试，或显式跳过它们（跳过不能作为完整验收结果）：

```bash
./mvnw test -Dtest=MySqlMigrationTests,MySqlHouseCreationTests
./mvnw test -Dmysql.integration=false
```

数据脚本另有 34 项 Python 测试（采集 20、导入 14），覆盖首次/重复导入、带照片重跑、字段冲突、清洗和请求策略。使用离线模拟请求，不实际采集或导入；安装 Python 3.9+ 后可运行：

```bash
python3 -B -W error::ResourceWarning -m unittest discover -s scripts/tests -v
```

预期：34 项通过，末尾显示 `OK`。Java 测试报告位于 `target/surefire-reports/`。

## 5. API 与身份权限

基础地址：`http://127.0.0.1:8080`。除照片上传和文件下载外，请求与响应使用 JSON。

所有 `/api/**` 请求必须携带非空 `X-User` 和合法 `X-Role`；`SITE_MANAGER` 还必须携带非空 `X-Community`。身份字段去除首尾空白，角色和社区区分大小写。身份缺失或非法返回 401，权限不足返回 403。

| 角色 | 读取权限 | 写入权限 |
| --- | --- | --- |
| `ADMIN` | 全部社区 | 创建房屋，上传照片、设置封面、推进所有社区的房屋 |
| `SITE_MANAGER` | 全部社区 | 仅上传照片、设置封面、推进所属社区房屋；不能创建房屋 |
| `VIEWER` | 全部社区 | 无 |

| 方法与路径 | 请求及行为 | HTTP 状态 |
| --- | --- | --- |
| `POST /api/houses` | `permitNo,address,community,lat,lng`；重复许可证返回原记录，不覆盖 | 新建 201，重复 200 |
| `GET /api/houses` | 可选 `minLat,maxLat,minLng,maxLng,stage`；按 ID 升序，无结果 `[]` | 200 |
| `GET /api/houses/{id}` | 房屋详情与 `photos`；照片按拍摄时间、ID 升序 | 200，不存在 404 |
| `POST /api/houses/{id}/photos` | Multipart 字段 `file`；依据实际图片内容识别格式并去重 | 新建 201，重复 200，超限 413，类型无效 415 |
| `GET /api/houses/{id}/photos/{photoId}/file` | 下载原始文件，检查照片归属，返回实际 Content-Type 和 `nosniff` | 200，不存在 404 |
| `PUT /api/houses/{id}/cover` | `{"photoId":...}`；重复设置正常返回 | 200，照片不存在或归属错误 422 |
| `POST /api/houses/{id}/advance` | `{"fromStage":"LAND_CLEARING","toStage":"FOUNDATION"}` | 200，当前阶段冲突 409，非下一阶段或无合格照片 422 |
| `GET /api/summary` | 可选 `asOf`（UTC ISO-8601，`Z` 或 `+00:00`）；返回 `stageCounts,staleHouseIds` | 200，非法时间 400 |

- 创建字段长度上限：许可证 128、地址 512、社区 128。纬度范围 [-90,90]、经度 [-180,180]，最多 7 位小数；坐标可同时省略或为 null，不能只缺一个。可选 `sourceUrl`（HTTP(S) URL）与 `sourceFetchedAt`（UTC 获取时间）必须同时提供。
- 列表支持单边界，缺省边界取全球范围；兼容 `bbox=minLng,minLat,maxLng,maxLat`，不能与独立坐标参数混用。范围包含边界，有范围时排除空坐标，无范围时保留；非法或反向范围、非法阶段返回 400。
- 列表包含 `id,permitNo,address,community,lat,lng,stage,coverPhotoUrl,lastPhotoBusinessDate`；两个照片派生字段无数据时为 null。照片响应含 `id,locationStatus,takenAt,businessDate,url` 等元数据，无照片时详情中的 `photos` 为 `[]`。
- 封面及照片 URL 也需要身份头；无请求头的 `<img>` 请求会返回 401。
- 错误统一为 `{"code":"...","message":"..."}`，不返回堆栈。非法参数、JSON 或非正整数 ID 返回 400，目标房屋不存在返回 404，服务器故障返回 500。

## 6. Austin 真实数据（可选）

数据来源：[Austin 官方 Issued Construction Permits](https://data.austintexas.gov/Building-and-Development/Issued-Construction-Permits/3syk-w9eu/about_data)，数据集 `3syk-w9eu`。使用前核对[使用条款](https://data.austintexas.gov/stories/s/ranj-cccq)。

[采集脚本](./scripts/fetch_austin_permits.py)筛选 2025 年以来发证的 `BP`、`Residential`、`R- 101 Single Family Houses`、`New`、`Active` 许可，按发证日降序、许可证号升序分页。每次检查 robots，串行请求间隔至少 2 秒，遵循更长限速；对 429 和临时服务错误有限重试并退避。

许可证号映射为 `permitNo`，地址由街道/城市/州/邮编组成；Council District 1–10 映射为 `Austin Council District N` 社区分组，**不代表真实小区名称**。`Active` 也不代表实际施工阶段，导入时统一从 `LAND_CLEARING` 开始。每条保留官方记录 `sourceUrl` 和实际 UTC 获取时间 `sourceFetchedAt`。

清洗时去重，排除无效文本、行政区及缺失/非法/越界坐标，记录排除原因；坐标保留 7 位小数，不填零、不猜测、不额外地理编码。API 本身仍允许成对空坐标。

安装 **Python 3.9+**（仅使用标准库），保持 Spring Boot 运行，在项目根目录的第二个终端执行：

```bash
python3 -B scripts/fetch_austin_permits.py
python3 -B scripts/import_austin_houses.py --base-url http://127.0.0.1:8080 --report data/local/austin-import-first.json
python3 -B scripts/import_austin_houses.py --base-url http://127.0.0.1:8080 --report data/local/austin-import-second.json
```

预期：采集得到至少 200 条有效唯一记录，完整数据和统计报告写入 `data/local/`，同时更新[仓库中的 20 条样本](./data/samples/austin-houses.json)。对空业务库，首次导入应显示新建记录；同一文件再次导入应显示已存在、无失败，报告中 `passed` 为 true。**必须指定 `--base-url`**：脚本默认端口是 8081，应用默认端口是 8080。

已有 `data/local/austin-houses.json` 时无需重新采集。重复导入应使用同一文件；重新采集会刷新获取时间，可能与已入库来源信息冲突。

[导入脚本](./scripts/import_austin_houses.py)先校验全部输入，仅通过 ADMIN 身份的 GET/POST `/api/houses` 导入及核对，不直接连接数据库、不自动重试 POST；核对七个导入字段、ID 和业务状态，失败返回非零退出码。

此前已实际导入并验证 200 条数据：首次 200 新建、0 已存在、0 失败；同一输入再次导入为 0 新建、200 已存在、0 失败，ID 和原记录保持不变。这是既有验证记录，不表示新环境已导入数据。仓库仅附样本，完整数据不随克隆提供；公开数据会变化，未来采集结果可能不同。

## 7. 核心设计要点

- **数据与权限**：`house` 保存房屋、阶段及来源，`photo` 保存文件和 EXIF 元数据，`stage_history` 保存阶段变更、操作人与 UTC 时间。SQL 集中在 [MyBatis XML](./src/main/resources/mapper/)；唯一键、外键和 CHECK 约束兜底，封面外键保证照片归属。身份由 MVC 拦截器解析，Service 根据数据库中的社区统一授权。
- **幂等与并发**：许可证全局唯一；照片按 `(house_id, SHA-256)` 去重。唯一键冲突后返回原记录，不覆盖元数据，其他数据库错误不会伪装成重复。不同照片使用 UUID 文件名并禁止覆盖。
- **阶段推进**：`LAND_CLEARING → FOUNDATION → FRAMING → MEP → INTERIOR → CO_READY`，每次仅前进一步。需要当前房屋、当前阶段的非 SUSPECT 照片（UNKNOWN 可用）；条件 UPDATE 检查 `fromStage`，阶段和审计记录在同一事务中提交或回滚。
- **图片与时间**：实际解码 JPEG/PNG/WebP，不信任扩展名或声明的 Content-Type，单文件上限为 10,000,000 字节。保留原始字节；有效 EXIF 时间优先，有偏移转 UTC，无偏移按 `America/Chicago`；DST 缺口回退上传时间，重叠选第一次，非法/缺失时间也回退上传时间。UTC 时间存 `DATETIME(6)`，业务日期单独保存。
- **定位与汇总**：GPS 按保存的 7 位精度计算 Haversine 距离，≤200 米为 VERIFIED，>200 米为 SUSPECT，缺少有效 GPS 或房屋坐标为 UNKNOWN。列表一次 SQL 聚合，详情固定两次查询；历史汇总使用只读 REPEATABLE_READ 一致快照，按创建/上传时间和阶段历史还原状态，排除未来照片业务日，日差 >14 才视为陈旧，无照片从创建业务日起算，六阶段计数补零。
- **迁移与文件一致性**：Flyway 自动迁移和校验，禁用 clean/自动 baseline。照片先保存文件再入库；明确失败时补偿清理本次文件，已识别的提交结果不明或插入后读取失败时保留文件，避免误删。默认照片目录为 `./data/local/photos`，可通过 `PHOTO_STORAGE_DIRECTORY` 指定可写目录；完整配置见 [application.yml](./src/main/resources/application.yml)。

## 8. 已知限制

- 身份通过请求头模拟，未实现真实登录、Spring Security、JWT 或 Session，不适合作为生产认证方案。
- 本地文件与 MySQL 无跨资源原子提交；崩溃、提交不明或补偿失败可能留下孤立/残缺文件，尚无自动恢复清理。提交不明场景使用异常注入验证，未实际切断网络或穷举驱动异常。
- EXIF 可被修改，VERIFIED 仅表示文件提供的 GPS 满足距离规则，不能证明真实拍摄地点。历史照片不自动补解析，重复上传不覆盖原元数据；1 MiB EXIF 解析预算不等于总内存上限。
- 上传记录使用请求读取到的房屋阶段；与阶段推进交错时，照片可能保留推进前阶段。
- `.env`、`data/local/` 和构建产物不随仓库交付；真实密码、原始照片和本地日志不应提交。验证记录仅对应记录中的运行，后续代码修改需重新测试。
