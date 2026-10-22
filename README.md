# Construction Tracker（在建房屋地图）

Construction Tracker 是面向美国在建住宅管理的地图应用：在地图上浏览房屋，查看现场照片、封面和施工阶段，并按角色执行现场操作。当前**全部计划功能已开发完成，且通过对应阶段的 Chrome 人工验收**。下一步是前后端整体联调、最终演示验收及按需优化；阶段性 PASS 不代表这些最终工作已经完成。

后端提供七个核心业务 API；前端提供 Overview、地图工作区、房屋详情和新增房屋页面。历史后端正式测试有 **396 项通过记录，其中真实 MySQL 测试 39 项**。这些是此前的验证事实，不表示每次文档或前端变更都重新运行了后端测试。

## 1. 技术栈与工程位置

| 范围 | 实现 |
| --- | --- |
| 后端 | Java 21、Spring Boot 3、MyBatis、MySQL 8、Flyway、Maven Wrapper |
| 前端 | React、TypeScript 严格模式、Vite、React Router、CSS Modules、Leaflet + React Leaflet、OpenStreetMap |
| 测试 | 后端 JUnit 与独立真实 MySQL 集成测试；前端 Vitest + React Testing Library、Playwright（本机 Google Chrome）、ESLint |
| 数据与文件 | MySQL 保存房屋、照片元数据及阶段历史；原图保存在可配置的本地目录 |

| 位置 | 用途 |
| --- | --- |
| [`backend/`](./backend/) | 后端源码、测试、MyBatis Mapper、Flyway SQL 与 Maven 工程 |
| [`frontend/`](./frontend/) | 前端页面、组件、服务层、单元与浏览器测试 |
| [`scripts/`](./scripts/) | Austin 数据采集、幂等导入、Demo 案例脚本及脚本测试 |
| [`data/samples/`](./data/samples/) | 可提交的数据样本；被忽略的 `data/local/` 保存本地照片、报告和备份 |
| 根目录 | [README](./README.md)、[Docker Compose](./docker-compose.yml)、[配置模板](./.env.example)、Maven 转发入口及 [前端启动脚本](./start.command) |

接口实现可从 [Controller](./backend/src/main/java/com/example/constructiontracker/controller/)、[DTO](./backend/src/main/java/com/example/constructiontracker/dto/)、[Service](./backend/src/main/java/com/example/constructiontracker/service/) 和 [Mapper XML](./backend/src/main/resources/mapper/) 查看；数据库结构见 [Flyway SQL](./backend/src/main/resources/db/migration/)。

## 2. 功能开发记录

保留原后端第 1～9 步的业务顺序；第 0 阶段汇集工程与前端公共基础。下表的 PASS 是分阶段的开发与人工交互验收状态，不是最终联调结论。

| 阶段 | 已实现功能与子阶段 | 验收状态 |
| --- | --- | --- |
| **0：工程与前端公共基础** | 前后端工程和本地启动入口；0.3 前端工具链。前端 1.1 页面框架、1.2 Leaflet 地图、1.3-A 固定双栏与真实标记、1.3-B 房屋卡片和选择联动。 | 基础页面、地图及 1.3-A／B 已通过 Chrome 人工验收（PASS） |
| **1：后端工程初始化** | Spring Boot、Maven 与分层工程基础。 | 已实现；纳入后端正式测试记录 |
| **2：数据库与迁移** | MySQL 表结构、约束及 Flyway 版本化迁移；业务数据与原图分开保存。 | 已实现；纳入真实 MySQL 测试记录 |
| **3：模拟身份与权限** | 后端请求头身份和角色／社区授权；前端 AUTH-F1 全局 Demo identity、AUTH-F2 请求与异步数据隔离、AUTH-F3 按权限显示操作入口。 | AUTH-F1～F3 Chrome 人工验收 PASS；这不是正式登录 |
| **4：房屋接口** | 4.1 创建与许可证幂等、4.2 地图查询、4.3 详情、4.4 集成验收；前端 4-F1 范围／阶段查询与竞态处理、4-F2 独立详情。随后增加独立页面 D 的 Admin 创建表单。 | 4-F1／F2 及页面 D 人工验收 PASS |
| **5：Austin 数据导入** | 5.1 真实许可数据采集与清洗、5.2 通过创建 API 幂等导入；5-F1 来源与行政分组展示由房屋详情及 House Explorer 共同覆盖。 | 展示与导入能力已完成；不重复开发浏览器导入页 |
| **6：照片系统** | 后端 6.1～6.4 涵盖安全存储、EXIF/GPS、内容去重与一致性；前端 6-F1 受保护原图、6-F2 单张上传及结果反馈。 | 6-F1／F2 Chrome 人工验收 PASS |
| **7：封面与详情** | 后端校验照片归属；前端 7-F1 卡片／详情真实封面、7-F2 从已有照片手动设置封面。 | 7-F1／F2 Chrome 人工验收 PASS |
| **8：施工阶段** | 后端相邻阶段推进、事务与审计；前端 8-F1 六阶段及照片资格展示、8-F2 二次确认与推进结果同步。 | 8-F1／F2 交互验收 PASS；真实 Demo 房屋推进写入仍待最终联调 |
| **9：统计汇总** | 后端当前及 `asOf` 单时点汇总；前端 9-F1 在页面 B 展示 Summary、六阶段占比、Needs Attention 列表和橙色地图标记。 | 9-F1 及 Summary／Explorer 地图状态修复已通过 Chrome 人工验收（PASS） |

**9-F2 历史回溯前端 UI 不在开发范围内**。后端 `GET /api/summary?asOf=...` 能力保留；现有历史数据覆盖有限，不将它展示为完整趋势。第 9 组计划内前端功能至此完成。

当前页面为：**A** `/` Overview（地图背景与 Explore map 入口）；**B** `/map` 固定左右双栏地图工作区，右栏默认 Summary，可切换 House Explorer；**C** `/houses/:id` 独立只读资料、照片与阶段操作；**D** `/houses/new` 仅 Admin 可创建。B 页无筛选时按当前地图范围浏览；输入地址或选社区／阶段时，对已取回的无边界房屋列表做前端组合筛选。标记、卡片和数量使用同一筛选结果；无坐标房屋保留卡片及详情入口。Summary 使用后端返回的 `staleHouseIds`，不在前端重算 14 天规则。切换 B 页标签或重置地图会清除房屋选择、高亮和 Popup；Explorer 筛选条件保留。

## 3. API 与联调业务规则

原题规定的七个核心 API 保持原方法、字段与业务语义；前端联调应以当前 Controller、DTO、Service 和正式测试核对实际响应。当前实现另有受身份头保护的图片文件 GET 辅助接口。

| 方法 | 路径 | 用途与联调要点 |
| --- | --- | --- |
| `POST` | `/api/houses` | Admin 创建；201 为新建，许可证重复返回 200 和已有房屋，不覆盖原记录 |
| `GET` | `/api/houses` | 房屋列表；可用 `bbox=minLng,minLat,maxLng,maxLat` 或四个独立边界参数，不能混用；可加单一 `stage` |
| `GET` | `/api/houses/{id}` | 独立详情 DTO，含基础资料、来源、当前阶段、封面照片 ID 和真实照片元数据 |
| `POST` | `/api/houses/{id}/photos` | multipart 单张 `file`；201 新照片，按内容重复时 200 且不新增记录 |
| `PUT` | `/api/houses/{id}/cover` | `{photoId}`；只能选择所属房屋已有照片，不自动选择封面 |
| `POST` | `/api/houses/{id}/advance` | `{fromStage,toStage}`；只允许相邻推进，后端负责资格、并发和审计 |
| `GET` | `/api/summary` | 当前或 UTC `asOf` 单时点六阶段统计及 `staleHouseIds` |
| `GET` | `/api/houses/{id}/photos/{photoId}/file` | 当前实现的受保护原图辅助接口；需同样的身份请求头 |

### 演示身份与权限

所有业务 `/api/**` 请求携带 `X-User`、`X-Role`；仅 SITE_MANAGER 需要 `X-Community`。合法角色为 ADMIN、SITE_MANAGER、VIEWER；请求头解析去除首尾空白，角色和社区比较大小写敏感。身份缺失或非法返回 401，授权不足返回 403。前端默认 Viewer，Site Manager 从真实房屋数据选择所属社区；同一标签页以 `sessionStorage` 保存合法选择。身份切换会重新取数、取消或隔离旧请求，并释放旧图片 Blob URL。外部地图瓦片不携带业务身份头。前端隐藏操作入口**不代替**后端授权。

| 角色 | 读取 | 写入 |
| --- | --- | --- |
| ADMIN | 所有房屋、照片及统计 | 创建房屋；跨社区上传照片、设封面、推进阶段 |
| SITE_MANAGER | 所有社区的房屋、照片及统计 | 仅对身份所属社区的房屋上传、设封面、推进阶段；不能创建房屋 |
| VIEWER | 所有社区的房屋、照片及统计 | 无 |

### 照片、阶段与统计

照片只接受 JPEG、PNG、WebP，单张最大 **10,000,000 字节**；后端按实际内容校验、按同一房屋内的内容哈希去重并保留原始字节。EXIF 拍摄时间与上传 UTC 时间不同，照片业务日按 `America/Chicago` 计算。GPS 距房屋 ≤200 米为 VERIFIED，>200 米为 SUSPECT；缺少有效定位或房屋坐标为 UNKNOWN。SUSPECT 可上传，但不能用于阶段推进；UNKNOWN 与 VERIFIED 均可作为当前阶段合格照片。前端从受保护接口读取原图并管理取消、失败重试和 Blob URL；没有缩略图服务。

阶段顺序固定为 `LAND_CLEARING → FOUNDATION → FRAMING → MEP → INTERIOR → CO_READY`，只能推进一级，CO_READY 为终点。推进要求**当前阶段至少一张非 SUSPECT 照片**；前端资格提示不替代后端判断。冲突或业务失败时重新读取详情，网络结果不明时不自动重发写请求。数据库保存阶段审计，但目前没有审计查询 API。

Summary 的 `stageCounts` 为六阶段当前数量；`staleHouseIds` 按 Chicago 业务日期判断**超过 14 天没有新现场照片**，无照片时从创建业务日起算。当前后端口径包含 SUSPECT 照片日期，且未排除 CO_READY。B 页用已有房屋只读接口补足名单的地址等资料。列表的 `lastPhotoBusinessDate` 是最近照片业务日，**不是**房屋记录更新时间或最新上传时刻。

房屋来源 URL 和来源获取时间在实际有值时展示；Austin 导入的 `Austin Council District N` 是行政分组，不是具体住宅小区。后端创建接口允许经纬度成对为空，前端 D 页只接受手动合法坐标，不进行地理编码。当前后端没有服务端关键词搜索、社区筛选或分页；B 页地址、社区、阶段组合查询是在前端对无边界列表筛选。

## 4. 本地运行与测试

### 后端

需要 JDK 21、Docker Engine、支持 `--wait` 的 Docker Compose v2。首次且尚无 `.env` 时，按 [模板](./.env.example) 创建根目录 `.env` 并设置不同的实际密码；不要覆盖已有文件。数据库默认使用 3306，后端默认使用 8080。根目录执行：

```sh
docker compose up -d --wait
./mvnw spring-boot:run
```

健康检查为 `GET /actuator/health`。Flyway 在应用启动时应用并校验迁移，不手动执行 `clean` 或修改历史 SQL。Maven Wrapper 从根目录转发至 `backend/`；Spring Boot 和测试使用根目录工作目录读取 `.env`，照片默认保存于 `data/local/photos/`，可由 `PHOTO_STORAGE_DIRECTORY` 指定。直接运行 JAR 时也应从仓库根目录启动。停止应用按 `Ctrl+C`，停止数据库用 `docker compose stop`，不要删除数据卷。

| 命令（仓库根目录） | 说明 |
| --- | --- |
| `./mvnw test` | 全部正式后端测试，包含真实 MySQL 集成测试 |
| `./mvnw verify` | Maven 验证生命周期与打包检查 |

真实 MySQL 测试只在独立临时测试库写入与清理，不使用业务数据库；需有效的 `MYSQL_ROOT_PASSWORD`，测试地址默认 `127.0.0.1:3306`，可用 `mysql.test.address` 指定。测试报告在 `backend/target/surefire-reports/`，JAR 在 `backend/target/construction-tracker-0.0.1-SNAPSHOT.jar`。后端历史 396／39 项通过记录不能代替后续变更的适当复测。

### 前端

已验证的本地环境为 Node.js 26.12.0、npm 11.20.0；兼容范围见 [package.json](./frontend/package.json)。首次安装依赖从 `frontend/` 执行 `npm ci`，保留 [锁文件](./frontend/package-lock.json)。日常从根目录执行 `./start.command`，也可在 macOS Finder 双击 [start.command](./start.command)。脚本检查 Node、npm、依赖并选择 **5180–5199** 的空闲端口，以严格端口模式启动；就绪后用本机 Google Chrome 打开实际地址（通常 `http://localhost:5180/`）。它不会自动安装依赖。按 `Ctrl+C` 停止；关闭该地址的全部页面后也会自动停止。本地服务关闭时 localhost 地址不可访问。

| 命令（`frontend/`） | 说明 |
| --- | --- |
| `npm run dev` | 直接启动 Vite，默认 `http://127.0.0.1:5173`，端口占用时失败 |
| `npm run typecheck` | 独立 TypeScript 严格类型检查 |
| `npm run lint` | ESLint，警告也视为失败 |
| `npm test` | Vitest + React Testing Library 单次运行 |
| `npm run test:e2e` | Playwright 使用本机 Google Chrome（`channel: 'chrome'`） |
| `npm run build` | 类型检查及 Vite 生产构建，输出 `frontend/dist/` |
| `npm run preview` | 在 `http://127.0.0.1:4173` 预览构建产物 |

E2E 使用独立 Vite 服务和受控 API／模拟地图瓦片，不依赖真实 MySQL 或公开瓦片稳定性。[Vite 配置](./frontend/vite.config.ts) 将开发环境 `/api` 原路径代理到 `http://localhost:8080`，不硬编码生产 API；正式部署须另配 API 转发与 React Router 路由回退。A 页及 404 可单独运行；B／C／D 的真实数据需要后端可用。地图须保留 [OpenStreetMap 署名](https://www.openstreetmap.org/copyright)，正式部署前还需评估[公共瓦片服务政策](https://operations.osmfoundation.org/policies/tiles/)。

## 5. 演示数据与最终联调参考

Austin 官方 Issued Construction Permits 数据集为 `3syk-w9eu`；[采集脚本](./scripts/fetch_austin_permits.py)、[幂等导入脚本](./scripts/import_austin_houses.py)、[样本](./data/samples/austin-houses.json) 及其正式测试保留。采集排除无效坐标，不猜测或地理编码；导入通过 ADMIN 身份使用创建 API，保留来源 URL 和获取时间。导入脚本的默认端口为 8081，连接当前应用应显式指定 `--base-url http://127.0.0.1:8080`。

当前**本地**演示库有 205 栋房屋：200 条 PUBLIC_DATA、5 条 MANUAL Demo。新克隆不会自动获得该业务库。Demo 数据如下；房屋卡片使用 `address` 作为标题，没有独立房屋名称字段。

| ID | Permit No. | Address | Community | 演示用途 |
| --- | --- | --- | --- | --- |
| 225 | DEMO001 | Demo Address 1 | Demo Community 1 | Photo Demo：4 张照片，封面已设置 |
| 226 | DEMO002 | Demo Address 2 | Demo Community 1 | Photo Demo：3 张照片，封面已设置 |
| 230 | DEMO003 | Demo Address 3 | Demo Community 2 | Needs Attention：LAND_CLEARING |
| 231 | DEMO004 | Demo Address 4 | Demo Community 2 | Needs Attention：FOUNDATION |
| 232 | DEMO005 | Demo Address 5 | Demo Community 2 | Needs Attention：FRAMING |

三个 Needs Attention 案例由后端当前 Summary 规则自然返回，未在前端硬编码。[Demo 初始化脚本](./scripts/seed_needs_attention_demo.py) 仅在显式执行 `--apply` 时尝试创建这三条，已有完整案例时只读核对；Photo Demo 不由该脚本生成。原图、数据库备份、密码和本地报告保存在被忽略的本地路径，不纳入 Git。

后续整体联调应核对：真实身份权限与 401／403／404、B／C／D 与 Summary 的跨页面数据一致性、照片上传及封面刷新、真实 Demo 房屋阶段推进写入、异常与并发边界、演示环境及照片文件。**尚未对真实 Demo 房屋执行阶段推进**；现有 Mock 测试与阶段人工验收不能替代这项写入验证，任何业务库写入需单独明确授权。完成联调后再进行最终演示验收，必要的视觉或产品优化另行决定。

现有边界：Demo identity 不是生产认证；城市／ZIP Code 地理编码、许可证号搜索、缩略图、批量上传、房屋基本资料编辑、房屋／照片删除和阶段历史 UI 均未纳入本次已完成范围。数据库与文件存储没有跨资源原子事务，异常时可能留下孤立文件；正式瓦片服务、部署认证及移动端精细适配仍待选择。保留原题至少八次有意义 Git 提交、正式测试和必要的 AI 使用记录等交付要求；不要修改原题、历史迁移、业务数据或照片来掩盖联调问题。
