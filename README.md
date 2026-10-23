# Construction Tracker

Construction Tracker 是面向住宅建设项目的地图可视化与施工进度管理系统，不局限于 Austin；Austin 许可数据是当前演示数据来源。应用提供房屋地图与筛选、Summary 统计、房屋详情、受保护照片、封面设置和施工阶段推进。

## 技术与目录

| 部分 | 技术与位置 |
| --- | --- |
| 后端 | Java 21、Spring Boot 3、MyBatis、MySQL 8.4、Flyway；[backend/](./backend/) |
| 前端 | React、TypeScript、Vite、React Router、CSS Modules、Leaflet / OpenStreetMap；[frontend/](./frontend/) |
| 数据工具 | Austin 采集、API 导入与 Demo 脚本；[scripts/](./scripts/) |
| 根目录 | [Docker Compose](./docker-compose.yml)、[环境模板](./.env.example)、`./mvnw`、[start.command](./start.command) |
| 本地数据 | `data/local/` 保存照片及报告，不纳入 Git；[data/samples/](./data/samples/) 保存少量样本 |

页面：`/` Overview，`/map` Summary / House Explorer 地图工作区，`/houses/:id` 房屋详情，`/houses/new` Admin 创建房屋。House Explorer 支持地图范围浏览与全库地址、社区、阶段组合筛选。

## 快速启动

需要 Git、JDK 21、Docker Engine 与支持 `--wait` 的 Docker Compose v2、Node.js 和 npm；Node 版本范围见 [package.json](./frontend/package.json)。浏览器 E2E 使用本机 Google Chrome。macOS Finder 双击启动方式还需系统的 `open` 和 `lsof`。

```sh
git clone https://github.com/Stone361/Construction_Tracker.git
cd Construction_Tracker
cp .env.example .env
```

编辑根目录 `.env`，分别设置 `DB_PASSWORD` 和 `MYSQL_ROOT_PASSWORD` 的实际密码。`DB_URL` 默认指向 `localhost:3306/construction_tracker`。不要提交 `.env`。从仓库根目录启动数据库和后端：

```sh
docker compose up -d --wait
./mvnw spring-boot:run
```

后端监听 `8080`；Maven 转发脚本让后端从仓库根目录读取 `.env`。Flyway 随应用启动建表或校验迁移，不要运行 `clean`。另开终端安装并启动前端：

```sh
cd frontend
npm ci
cd ..
./start.command
```

`start.command` 从自身路径定位项目，在 **5173** 严格端口启动 Vite，就绪后尝试用 Google Chrome 打开 `http://localhost:5173/`；端口被占用则报错，不自动换端口或安装依赖。macOS Finder 也可双击该脚本。不用脚本时可在 `frontend/` 运行 `npm run dev`。前后端在各自终端按 `Ctrl+C` 停止；脚本启动的前端在关闭该地址的全部页面后也会自动停止。数据库用 `docker compose stop` 停止并保留数据卷。本地服务停止后 localhost 地址不可访问。

Vite 将开发环境 `/api` 代理到 `http://localhost:8080`；MySQL 默认端口为 `3306`。照片默认保存在根目录 `data/local/photos/`，可由 `PHOTO_STORAGE_DIRECTORY` 指定。正式部署需另外配置 API 转发、前端路由回退、认证与持久文件存储。

### 健康检查、测试与构建

```sh
docker compose ps
curl --fail http://localhost:8080/actuator/health
curl --fail http://localhost:5173/
./mvnw test
./mvnw verify
cd frontend
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run build
```

后端测试包含使用独立临时测试库的真实 MySQL 集成测试；运行前检查 `.env`、MySQL 连接及 `MYSQL_ROOT_PASSWORD`，不得指向业务库。报告在 `backend/target/surefire-reports/`，JAR 在 `backend/target/construction-tracker-0.0.1-SNAPSHOT.jar`。前端构建在 `frontend/dist/`；Playwright 在 `4173` 启动独立 Vite 服务，使用受控 API 与本地模拟地图瓦片。历史后端验证有 396 项正式测试通过，其中真实 MySQL 测试 39 项；这不是新克隆环境的通过承诺。

## API、身份与业务规则

七个核心 API 如下；详细字段以 [Controller](./backend/src/main/java/com/example/constructiontracker/controller/)、[DTO](./backend/src/main/java/com/example/constructiontracker/dto/) 和正式测试为准。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST` | `/api/houses` | Admin 创建；201 新建，许可证重复返回 200 和原房屋 |
| `GET` | `/api/houses` | 列表；可传 `bbox=minLng,minLat,maxLng,maxLat` 或四个独立边界参数及单一 `stage`，两种边界格式不可混用 |
| `GET` | `/api/houses/{id}` | 基础资料、来源、阶段、封面照片 ID 和照片元数据 |
| `POST` | `/api/houses/{id}/photos` | multipart 单张 `file`；201 新增，内容重复返回 200 |
| `PUT` | `/api/houses/{id}/cover` | `{"photoId":123}`，选择该房屋已有照片 |
| `POST` | `/api/houses/{id}/advance` | `{"fromStage":"LAND_CLEARING","toStage":"FOUNDATION"}`，只能推进一级 |
| `GET` | `/api/summary` | 当前六阶段统计及 `staleHouseIds`，可选 UTC `asOf` 单时点 |

受保护原图辅助接口为 `GET /api/houses/{id}/photos/{photoId}/file`，同样要求身份头。所有业务 `/api/**` 请求携带 `X-User`、`X-Role`，仅 SITE_MANAGER 还需 `X-Community`；角色和社区严格匹配大小写。前端右上角的 **Demo identity** 默认 Viewer，Site Manager 从真实房屋社区中选择所属社区；这是模拟身份，**不是正式登录**。身份无效返回 401，权限不足返回 403。前端隐藏操作入口不能替代后端授权，地图瓦片不携带业务身份头。

| 角色 | 读取 | 写入 |
| --- | --- | --- |
| ADMIN | 全部房屋、照片、统计 | 创建房屋；任意社区的照片上传、设封面、推进阶段 |
| SITE_MANAGER | 全部社区的房屋、照片、统计 | 仅所属社区房屋的照片上传、设封面、推进阶段 |
| VIEWER | 全部社区的房屋、照片、统计 | 无 |

照片支持 JPEG、PNG、WebP，最大 **10MB**。后端按同一房屋内的内容哈希去重，并解析 EXIF/GPS；拍摄时间、上传 UTC 时间、`America/Chicago` 照片业务日各有不同含义。GPS 距房屋不超过 200 米为 VERIFIED，超出为 SUSPECT，缺少有效定位为 UNKNOWN。SUSPECT 可上传，但不能满足阶段推进资格；VERIFIED 和 UNKNOWN 可以。原图通过带身份头的请求读取；目前没有缩略图服务。

阶段顺序为 `LAND_CLEARING → FOUNDATION → FRAMING → MEP → INTERIOR → CO_READY`；推进要求当前阶段至少一张非 SUSPECT 照片，后端负责最终判断，CO_READY 为终点。Summary 的 Needs Attention 由后端按 Chicago 业务日期判断超过 14 天无新现场照片；无照片从房屋创建业务日起算，前端不自行重算。Austin 的 `Council District` 是行政分组，不是住宅小区。

## 数据初始化与限制

**新克隆不会自动拥有房屋或完整照片。** Flyway 只建表；Git 中的 [Austin 样本](./data/samples/austin-houses.json)仅有 **20 条**。后端启动后，可通过 Admin 身份的导入脚本显式写入样本：

```sh
python3 scripts/import_austin_houses.py --input data/samples/austin-houses.json --base-url http://127.0.0.1:8080
```

报告默认写入 `data/local/austin-import-report.json`。重复许可证号走后端幂等逻辑。如需重新采集约 200 条，可运行 `python3 scripts/fetch_austin_permits.py`，再以 `--input data/local/austin-houses.json` 导入。采集依赖 Austin 官方实时接口，结果随时间变化，且会更新仓库内样本文件；无法保证复现开发机相同的 200 条及 ID。

开发机的五栋 Demo 曾对应 ID 225、226、230～232，许可证号 `DEMO001`～`DEMO005`。前两栋位于 Demo Community 1，用于照片与封面演示；**其数据库记录和照片未纳入 Git，无法从仓库恢复**。后三栋位于 Demo Community 2，用于 Needs Attention；[脚本](./scripts/seed_needs_attention_demo.py)在数据库及 `data/local/photos/` 目录准备好后，可用 `--apply` 显式创建三栋及脚本生成的照片，不带 `--apply` 只检查。脚本不创建前两栋，也不保证新库中的 Demo ID 或合计 205 栋房屋。

当前还没有正式认证、城市／ZIP 地理编码、缩略图、批量上传、房屋基础资料编辑、删除或阶段历史 UI。后端支持 `asOf` 历史单时点汇总，但没有历史回溯前端 UI。公共 OpenStreetMap 瓦片用于开发演示，部署时应遵守[瓦片政策](https://operations.osmfoundation.org/policies/tiles/)；数据库与文件存储没有跨资源原子事务。阶段推进已有受控测试和人工交互验收，但真实 Demo 房屋写入与完整交付环境仍需单独验证。
