# Construction Tracker（在建房屋地图）

## 1. 项目简介

面向美国中部在建社区的后端服务，提供房屋地图查询、照片上传与封面、施工阶段推进及历史进度汇总。
验收标准为[原始上机题](./上机题_在建房屋地图_题面.md)；前端地图壳由题目提供，本仓库不实现前端。

- 技术栈：Java 21、Spring Boot 3.5.16、MyBatis 3.0.5、MySQL 8.4.11、Flyway。
- 所有业务 SQL 位于 [MyBatis XML](./src/main/resources/mapper/)，调用链为 Controller → Service → Mapper。
- 原题业务接口均已实现；照片原始文件存本地，元数据及审计记录存 MySQL。
- 已采集并通过 API 导入 200 条 Austin 真实许可；仓库只保留 20 条样本，完整数据不随克隆提供。

## 2. 快速启动

准备 JDK 21、已启动的 Docker Engine（如 Docker Desktop）及支持 `--wait` 的 Docker Compose v2。
数据脚本另需 Python 3.9 或更高版本（仅标准库）。Maven Wrapper 无需预装 Maven，首次构建和拉取镜像需要联网。
以下命令均在项目根目录执行，确保本机 3306、8080 端口未被其他服务占用。

首次配置时复制[环境变量示例](./.env.example)，不要覆盖已有 `.env`：

```bash
cp -n .env.example .env
# 编辑 .env，替换 CHANGE_ME_APP_PASSWORD 和 CHANGE_ME_ROOT_PASSWORD
```

`DB_USERNAME` / `DB_PASSWORD` 是应用账号，`MYSQL_ROOT_PASSWORD` 是隔离数据库测试使用的 root 密码。
使用两个不同的随机密码，建议不带引号的十六进制字符串；不要把真实密码写进 README 或提交 `.env`。
默认 `DB_URL` 指向本机 `construction_tracker`；Spring Boot 自动读取 `.env`，同名环境变量可覆盖配置。

按“数据库健康 → 测试 → 应用启动”的顺序执行：

```bash
docker compose up -d --wait
docker compose ps                         # mysql 应显示 healthy
./mvnw test                               # 默认包含真实 MySQL 测试
./mvnw spring-boot:run                    # 前台启动，监听 8080
```

[Compose](./docker-compose.yml) 首次在空卷中创建 `construction_tracker` 数据库和应用账号，仅开放 `127.0.0.1:3306`。
应用启动时 Flyway 执行 [V1](./src/main/resources/db/migration/V1__create_construction_tracker_tables.sql)，创建三张业务表及 `flyway_schema_history`；后续启动校验迁移，不覆盖业务数据。
全新克隆并首次初始化数据库后没有 200 条业务数据；须按第 5 节执行采集及 API 导入。
默认照片目录为 `./data/local/photos`；需要更换时，在启动前设置 `PHOTO_STORAGE_DIRECTORY` 为可写目录。
连接、迁移、上传限制及存储配置见 [application.yml](./src/main/resources/application.yml)。

另开终端验证健康状态；此接口不需要身份头：

```bash
curl -i http://localhost:8080/actuator/health
# 正常为 HTTP 200，响应 {"status":"UP"}
```

需要查看数据库时使用交互密码提示，避免密码出现在命令参数中：

```bash
docker compose exec mysql mysql -u construction_tracker -p construction_tracker
# 输入 .env 中的 DB_PASSWORD，再执行以下只读 SQL
```

```sql
SHOW TABLES;
SELECT version, script, success FROM flyway_schema_history ORDER BY installed_rank;
```

V1 应为 `version='1'`、`success=1`。按 `Ctrl+C` 停止应用；数据库可用 `docker compose stop` 暂停。
数据保存在命名卷 `mysql-data`；不要用 `docker compose down -v` 清除需要保留的数据。
已有卷不会因修改 `.env` 自动更新账号密码；若健康检查或登录失败，先核对原凭据，不删除卷解决。

## 3. 自动化测试

先按第 2 节配置密码并等待 MySQL healthy，然后执行 `./mvnw test`。
最近一次实际默认运行：**2026-10-13 21:37（Asia/Shanghai），396 项通过，0 失败、0 错误、0 跳过，BUILD SUCCESS**。

| 范围 | 实际用例数 | 验证内容 |
| --- | ---: | --- |
| 单元、MockMvc、H2 及随机端口 HTTP 测试 | 357 | 认证授权、接口与错误响应、文件内容/大小、EXIF/GPS、时区及故障补偿 |
| `MySqlMigrationTests` | 8 | 实际 V1、唯一/外键/CHECK、历史汇总和日期边界 |
| `MySqlHouseCreationTests` | 31 | 实际 SQL、幂等、照片并发、封面与列表联动、阶段竞争/回滚、汇总一致快照 |

[POM](./pom.xml) 默认设置 `mysql.integration=true`，通过 Surefire 传给测试进程。
MySQL 不可用、凭据错误或测试失败时，完整验收会失败；不会自动降级成 H2 或静默跳过。
两组 MySQL 测试从环境变量或 `.env` 读取 root 密码，各自创建随机 `construction_tracker_test_<随机值>` 数据库，只清理本次成功创建的测试库，不写正式业务库。
普通框架测试仍使用[测试配置](./src/test/resources/application-test.yml)中的 H2；不是所有测试都依赖 MySQL。

```bash
./mvnw -Dtest=MySqlMigrationTests,MySqlHouseCreationTests test
./mvnw -Dmysql.integration=false test      # 开发时显式跳过；不能作为完整验收结果
python3 -B -W error::ResourceWarning -m unittest discover -s scripts/tests -v
```

Python 脚本测试独立于 Maven，最近实际运行 34 项通过（采集 20、导入 14）；覆盖 200 条首次/重复导入、带照片重跑和真实字段冲突，使用离线模拟请求，不重新采集或导入。
Java 测试报告位于 `target/surefire-reports/`，构建产物被忽略。上述结果来自现有环境，不代表已重新验证全新机器。

## 4. API 接口

基础地址：`http://localhost:8080`。除上传及照片文件下载外，请求/响应使用 JSON。
所有 `/api/**` 请求必须携带非空 `X-User` 和合法 `X-Role`；`SITE_MANAGER` 还必须提供非空 `X-Community`。
身份字段去除首尾空白；角色和社区区分大小写。身份缺失或非法返回 401，权限不足返回 403。

| 角色 | 读取 | 写入 |
| --- | --- | --- |
| `ADMIN` | 全部社区，包括照片和汇总 | 创建房屋，上传、设置封面、推进所有社区的房屋 |
| `SITE_MANAGER` | 全部社区 | 仅上传、设置封面、推进所属社区房屋；不能创建 |
| `VIEWER` | 全部社区 | 禁止修改 |

| 方法与路径 | 请求及主要行为 | HTTP 状态 |
| --- | --- | --- |
| `POST /api/houses` | `permitNo,address,community,lat,lng`；重复许可证返回原记录，不覆盖 | 新建 201，重复 200 |
| `GET /api/houses` | 可选 `minLat,maxLat,minLng,maxLng,stage`；ID 升序，无结果 `[]` | 200 |
| `GET /api/houses/{id}` | 完整基本信息及 `photos`，按拍摄时间、ID 升序；无照片 `[]` | 200，不存在 404 |
| `POST /api/houses/{id}/photos` | Multipart，字段 `file`；依据实际内容识别格式并去重 | 新建 201，重复 200，超限 413，类型无效 415 |
| `GET /api/houses/{id}/photos/{photoId}/file` | 认证后下载原始文件，检查房屋归属，返回实际 Content-Type 和 `nosniff` | 200，不存在 404 |
| `PUT /api/houses/{id}/cover` | `{"photoId":...}`；重复设置正常返回 | 200，照片不存在或不属于该房屋 422 |
| `POST /api/houses/{id}/advance` | `{"fromStage":"LAND_CLEARING","toStage":"FOUNDATION"}` | 200，当前阶段冲突 409，非下一阶段或无合格照片 422 |
| `GET /api/summary` | 可选 `asOf`（UTC ISO-8601，`Z` 或 `+00:00`）；返回 `stageCounts,staleHouseIds` | 200，非法时间 400 |

错误统一为 `{"code":"...","message":"..."}`，不向客户端返回堆栈。
非法参数、JSON 或非正整数 ID 返回 400；目标房屋不存在返回 404；文件/数据库等服务器故障返回 500。
创建字段长度上限：许可证 128、地址 512、社区 128；纬度 [-90,90]、经度 [-180,180]，最多 7 位小数。
坐标可同时省略或为 null，不能只缺一个。公开来源扩展 `sourceUrl` 与 `sourceFetchedAt` 必须同时提供，分别保存 HTTP(S) URL 与 UTC 获取时间。
列表支持单边界，省略边界取全球范围；兼容 `bbox=minLng,minLat,maxLng,maxLat`，但不能与独立坐标参数混用。
范围包含边界；格式错误、越界、反向范围、非法阶段返回 400。有范围时排除空坐标，无范围时保留。
列表每项包含 `id,permitNo,address,community,lat,lng,stage,coverPhotoUrl,lastPhotoBusinessDate`；后两项与真实照片联动，无数据时键仍存在且值为 null。
照片响应包含 `id,locationStatus,takenAt,businessDate,url` 等元数据；封面及照片 URL 也需要身份头，直接用无 Header 的 `<img>` 请求会返回 401。

```bash
curl -i http://localhost:8080/api/houses -H 'X-User: reviewer' -H 'X-Role: VIEWER'
curl -i -X POST http://localhost:8080/api/houses -H 'X-User: admin' -H 'X-Role: ADMIN' \
  -H 'Content-Type: application/json' \
  -d '{"permitNo":"EXAMPLE-001","address":"Example address","community":"North Austin","lat":30.2672,"lng":-97.7431}'
curl -i -X POST http://localhost:8080/api/houses/1/photos -H 'X-User: admin' -H 'X-Role: ADMIN' \
  -F 'file=@/absolute/path/photo.jpg'
```

上传示例中的路径和房屋 ID 须替换为实际值；创建响应提供新房屋 ID。

## 5. 数据获取与导入

来源：[Austin 官方 Issued Construction Permits](https://data.austintexas.gov/Building-and-Development/Issued-Construction-Permits/3syk-w9eu/about_data)，数据集 `3syk-w9eu`。
使用前核对[使用条款](https://data.austintexas.gov/stories/s/ranj-cccq)；[采集脚本](./scripts/fetch_austin_permits.py)每次检查 robots，禁止访问或规则无法识别时停止。
串行请求至少间隔 2 秒，并遵循更长的 robots 限速；429/临时服务错误采用有限重试、Retry-After 和退避。
筛选：2025 年以来发证、`BP`、`Residential`、`R- 101 Single Family Houses`、`New`、`Active`。
按发证日降序、完整许可证号升序分页；Active 不代表实际施工进度，创建阶段统一为 `LAND_CLEARING`。
完整许可证号映射为 `permitNo`，街道/城市/州/邮编组合为地址；Council District 1—10 映射为 `Austin Council District N` 社区分组，不声称是真实小区名称。
坐标校验后四舍五入至 7 位；每条 `sourceUrl` 定位官方原记录，`sourceFetchedAt` 保存实际 UTC 获取时间，不以发证日代替。
首批排除缺失、无法解析、非有限或越界坐标，统计原因；不填零、不猜测、不额外地理编码。API 仍允许成对空坐标。
许可证去重，并排除空/超长文本、非法行政区及不符合筛选条件的记录。

```bash
# 新环境获取至少 200 条有效唯一记录；会更新本地结果及仓库样本
python3 -B scripts/fetch_austin_permits.py
# 应用已按第 2 节启动，明确指定 8080（脚本默认端口为 8081）
python3 -B scripts/import_austin_houses.py --base-url http://127.0.0.1:8080 --report data/local/austin-import-first.json
python3 -B scripts/import_austin_houses.py --base-url http://127.0.0.1:8080 --report data/local/austin-import-second.json
```

已有 `data/local/austin-houses.json` 时无需重新采集，使用同一文件重复导入；重新采集会刷新获取时间，可能与已入库来源信息冲突。
采集输出完整清洗数据、统计报告至 `data/local/`，仅保存[20 条仓库样本](./data/samples/austin-houses.json)（最多允许 50 条），不提交大型原始数据。
[导入脚本](./scripts/import_austin_houses.py)先校验全部输入，只通过 ADMIN 身份的 GET/POST `/api/houses` 导入和核对；不连接数据库、不自动重试 POST。
已实际验收的 200 条数据首次为 200 新建、0 已存在、0 失败；同一输入再次运行为 0 新建、200 已存在、0 失败，ID 和原记录保持不变。
脚本严格核对七个导入字段及 ID、阶段、来源类型、创建信息；POST 与列表比较仅排除两个照片派生字段，导入前后已有列表状态仍须保持不变。错误返回非零退出码。
这批结果是既有验收记录，新环境仍需采集并导入；公开数据会变化，不保证未来采集得到相同许可证集合。

## 6. 关键设计与取舍

- **数据模型**：`house` 保存房屋、社区、阶段及来源；`photo` 保存上传时阶段、文件和 EXIF 元数据；`stage_history` 保存操作人、前后阶段和 UTC 时间。InnoDB 唯一键、外键和 CHECK 作为数据库兜底，封面复合外键保证照片归属。Flyway 禁用 clean/自动 baseline，不修改已执行的 V1。
- **权限**：MVC 拦截器解析身份，写入请求 attribute；Service 查询目标房屋后调用集中授权组件，社区严格比较，客户端参数不能代替数据库社区。按题目模拟登录，不使用 Spring Security、JWT、Session 或 ThreadLocal。
- **幂等与并发**：许可证全局唯一；照片按 `(house_id, SHA-256)` 唯一。单条自动提交 INSERT 的唯一键冲突后重新查询原记录，其他数据库错误不伪装成重复；重复不覆盖元数据。不同照片用 UUID 和 CREATE_NEW 保存，不覆盖文件；真实 MySQL 测试验证 2/5 请求同内容及多份不同内容。
- **阶段推进**：`LAND_CLEARING → FOUNDATION → FRAMING → MEP → INTERIOR → CO_READY`，仅前进一步；要求当前房屋、当前阶段存在非 SUSPECT 照片（UNKNOWN 可用）。事务内条件 UPDATE 校验 `fromStage`，失败返回 409；阶段与审计 INSERT 一起提交或回滚。
- **图片与 EXIF**：实际解码 JPEG/PNG/WebP，不信任扩展名或 Content-Type；10 MB 采用 10,000,000 字节，等于上限允许。保留原始字节；metadata-extractor 仅提取必要 EXIF，PNG 读 eXIf、WebP 读 EXIF，1 MiB 解析预算不是总内存上限。
- **时区与定位**：有效 DateTimeOriginal 优先，合法偏移转 UTC；无偏移按 America/Chicago，DST 缺口回退上传、重叠选第一次。缺失/非法时间回退真实上传时刻，时间与 GPS 独立降级；UTC 存 DATETIME(6)，businessDate 单独存 DATE。GPS 保留 7 位，按保存精度计算 Haversine，不先取整；≤200 米 VERIFIED，>200 米 SUSPECT，GPS 无效或房屋无坐标为 UNKNOWN。
- **查询与快照**：列表一次 SQL 完成范围/阶段过滤及 MAX(business_date) 聚合，封面 URL 直接构造，无 N+1；详情固定两次查询。汇总只读 REPEATABLE_READ 事务共用时点及快照，按创建/上传时间控制可见性、阶段历史还原阶段；排除未来照片业务日，无照片从创建业务日起算，日差 >14 才陈旧，六阶段补零。
- **文件一致性**：先保存候选文件再入库；明确失败只清理本次文件，重复冲突返回原记录。已识别提交结果不明或插入成功后读取失败时保留文件，避免误删；补偿删除失败记录原异常及 suppressed 信息，不引入分布式事务或复杂恢复框架。

## 7. 已知限制与交付说明

- 本地文件与 MySQL 不具备跨资源原子提交；崩溃、提交不明或补偿失败可能留下孤立/残缺文件，尚无自动恢复清理。提交不明故障以注入异常验证，未实际切断网络或穷举驱动异常。
- EXIF 可被修改，VERIFIED 只表示文件提供的 GPS 距离符合规则，不证明真实拍摄地点；历史上传记录不自动补解析，重复上传也不覆盖原元数据。
- 上传时阶段使用请求读取到的房屋阶段；上传与阶段推进交错时，照片可能保留推进前阶段，不使用跨请求锁。
- 全部原题业务接口已实现并有自动化验证；尚未单独验收全新克隆环境，200 条数据是既有导入验收结果，不代表正式库当前数量。396 项结果仅对应前述实际测试运行，后续修改须重新验证。
- `.env`、`data/local/`、日志与构建产物不交付；更换默认存储路径后也应避免把原始照片提交。新环境不会自动获得既有 200 条业务数据。
- 原题另要求至少 8 次有意义提交、不改写已推送历史，提交仓库地址并准备约 30 分钟代码讲解；最终 Git 状态、访问权限与 AI 附件须在提交时核对。
