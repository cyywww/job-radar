# Job Radar 项目实施方案

项目目录：`/Users/yuweicao/Projects/job-radar`

## 1. 产品目标

Job Radar 是一个本地优先的个人求职系统：

- 根据结构化 Profile 搜索最新岗位。
- 从 JobTech 和公司招聘系统采集完整 JD。
- 去重、识别更新和关闭岗位。
- 先执行硬性资格判断，再进行证据化匹配评分。
- 在 React 浏览器界面中审核、收藏、忽略和追踪申请。
- 通过 Codex CLI 启动、扫描、诊断和维护。
- 支持每日自动扫描，但不自动提交申请。

### 首版不做

- 多用户注册和权限系统。
- 云部署和手机 App。
- LinkedIn 自动抓取。
- 自动投递申请。
- 未经用户确认自动修改评分权重。
- 面向公众发布 Plugin。

## 2. 成功标准

首版达到以下标准才视为可日用：

- 首次配置不超过 10 分钟。
- 一条 Codex 指令即可启动应用。
- 新岗位从采集到浏览器可见不超过 5 分钟。
- 95% 以上的结构化来源扫描成功。
- 跨来源重复岗位率低于 3%。
- 每个 AI 分数都包含匹配证据、缺口、置信度和评分版本。
- Job Top 10 中用户愿意申请的比例达到 60%，积累反馈后达到 70%。
- 过期或关闭岗位不会继续出现在默认推荐中。
- Profile、API Key 和完整 JD 不出现在日志中。

## 3. 总体技术架构

采用 pnpm workspace，不引入 Turborepo，减少首版复杂度。

| 层       | 技术                                | 职责                             |
| -------- | ----------------------------------- | -------------------------------- |
| Web      | React + TypeScript + Vite           | 浏览器界面                       |
| API      | Fastify + TypeScript                | REST API、业务逻辑、静态前端托管 |
| 数据校验 | Zod + JSON Schema                   | 前后端契约、AI 输出校验          |
| 数据库   | SQLite + Drizzle ORM                | 岗位、历史、评分和申请状态       |
| 数据采集 | TypeScript connectors               | JobTech、ATS、公司招聘页         |
| 后台任务 | 内部任务队列 + 单实例调度器         | 扫描、详情抓取、评分             |
| AI       | 可替换 Provider                     | Codex CLI 或 OpenAI API          |
| 测试     | Vitest + Playwright                 | 单元、集成、端到端               |
| Codex    | `.agents/skills/job-radar/SKILL.md` | 启动、扫描、诊断和项目操作       |

Vite 官方提供 `react-ts` 模板；Fastify具备 TypeScript 和请求 Schema 支持；Drizzle 支持 SQLite 的 `node:sqlite` 与 `better-sqlite3`；Playwright用于浏览器端到端测试。[Vite](https://vite.dev/guide/)、[Fastify TypeScript](https://fastify.dev/docs/latest/Reference/TypeScript/)、[Drizzle SQLite](https://orm.drizzle.team/docs/sqlite/get-started-sqlite)、[Playwright](https://playwright.dev/docs/next/intro)

安装依赖时使用当时的稳定版本并提交 lockfile，不在方案中硬编码易过期的包版本。

### 运行形态

开发环境：

```text
Vite Web        http://127.0.0.1:5173
Fastify API     http://127.0.0.1:8787
```

正式本地运行：

```text
Fastify API + React 静态资源
http://127.0.0.1:8787
```

生产模式只启动一个进程，由 Fastify 托管构建后的 React 文件。

## 4. 推荐目录结构

```text
job-radar/
├── AGENTS.md
├── README.md
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── eslint.config.js
├── prettier.config.js
├── .env.example
├── .gitignore
│
├── .agents/
│   └── skills/
│       └── job-radar/
│           ├── SKILL.md
│           └── references/
│               └── operations.md
│
├── apps/
│   ├── web/
│   │   ├── src/
│   │   │   ├── app/
│   │   │   ├── pages/
│   │   │   ├── components/
│   │   │   ├── features/
│   │   │   ├── api/
│   │   │   └── styles/
│   │   └── vite.config.ts
│   │
│   └── server/
│       ├── src/
│       │   ├── app.ts
│       │   ├── routes/
│       │   ├── services/
│       │   ├── workers/
│       │   ├── scheduler/
│       │   └── security/
│       └── public/
│
├── packages/
│   ├── contracts/
│   │   ├── src/
│   │   └── schemas/
│   ├── db/
│   │   ├── src/schema/
│   │   ├── src/repositories/
│   │   └── migrations/
│   ├── connectors/
│   │   ├── src/jobtech/
│   │   ├── src/greenhouse/
│   │   ├── src/lever/
│   │   ├── src/ashby/
│   │   ├── src/teamtailor/
│   │   ├── src/workday/
│   │   └── src/generic/
│   ├── scoring/
│   │   ├── src/gates/
│   │   ├── src/extraction/
│   │   ├── src/engine/
│   │   └── src/audit/
│   └── cli/
│       └── src/
│
├── prompts/
│   ├── extract-requirements.md
│   └── explain-score.md
├── fixtures/
│   ├── jobtech/
│   ├── ats/
│   └── scoring/
├── data/
│   └── job-radar.sqlite
├── logs/
├── docs/
│   ├── architecture.md
│   ├── scoring.md
│   ├── connectors.md
│   └── operations.md
└── tests/
    └── e2e/
```

`data/`、`logs/`、`.env.local` 和所有个人资料必须加入 `.gitignore`。

## 5. Codex CLI 操作设计

OpenAI 官方文档说明 Codex 会从仓库的 `.agents/skills` 发现项目级 Skill，因此 Job Radar 应将自然语言入口放在该目录，而不是把核心业务逻辑写进 Skill。[OpenAI Skills 文档](https://learn.chatgpt.com/docs/build-skills)

最终用户操作：

```bash
cd /Users/yuweicao/Projects/job-radar
codex
```

进入 Codex 后：

```text
$job-radar setup
$job-radar start
$job-radar scan
$job-radar status
$job-radar doctor
$job-radar stop
```

映射到项目自己的确定性 CLI：

| Codex 指令          | 底层命令                   |
| ------------------- | -------------------------- |
| `$job-radar setup`  | `pnpm radar setup`         |
| `$job-radar start`  | `pnpm radar service start` |
| `$job-radar dev`    | `pnpm dev`                 |
| `$job-radar scan`   | `pnpm radar scan`          |
| `$job-radar status` | `pnpm radar status`        |
| `$job-radar doctor` | `pnpm radar doctor`        |
| `$job-radar stop`   | `pnpm radar service stop`  |

Skill 只允许承担：

- 判断用户意图。
- 调用项目 CLI。
- 检查 `/api/health`。
- 出错时读取脱敏日志。
- 返回浏览器地址。
- 提醒用户需要确认的操作。

Skill 不承担：

- 直接编辑 SQLite。
- 直接编写分数。
- 直接拼接 JSONL。
- 自己抓取网页。
- 在自然语言中维护业务状态。

### Codex AI Provider

项目支持两个 AI Provider：

1. `codex_cli`：个人本地使用的默认方案。
2. `openai_api`：更适合长期无人值守的可选方案。

Codex CLI Provider 使用：

```bash
codex exec \
  --ephemeral \
  --sandbox read-only \
  --output-schema ./packages/contracts/schemas/job-score.schema.json \
  -o ./data/tmp/score-output.json \
  "<scoring prompt>"
```

官方文档明确支持用 `codex exec` 执行脚本/定时流水线，并通过 `--output-schema` 约束最终 JSON；默认只读沙箱也适合评分任务。[Codex 非交互模式](https://learn.chatgpt.com/docs/non-interactive-mode)

安全要求：

- 在独立临时目录中执行评分。
- 临时目录只包含脱敏后的 Profile、JD 和输出 Schema。
- 不向评分进程暴露数据库、环境变量或项目源码。
- JD 永远视为不可信数据，不能执行其中的任何指令。
- 自动评分失败时保留 `pending`，不能生成猜测分数。
- 批量评分每批按 token 长度动态控制，不固定塞入大量岗位。

## 6. 数据模型

### `profiles`

| 字段                      | 说明                         |
| ------------------------- | ---------------------------- |
| `id`                      | Profile ID                   |
| `name`                    | 显示名称                     |
| `location`                | 当前所在地                   |
| `summary`                 | 个人介绍                     |
| `languages_json`          | 语言及熟练度                 |
| `work_authorization_json` | 公民身份、工作许可、赞助需求 |
| `target_roles_json`       | 目标岗位                     |
| `preferences_json`        | 公司、地点、远程、薪资等偏好 |
| `version`                 | Profile 版本                 |
| `created_at/updated_at`   | 时间戳                       |

### `profile_evidence`

保存可用于证明能力的证据：

```text
技能 / 经历 / 项目 / 时间范围 / 熟练度 / 证据原文 / 来源
```

AI 评分只能引用这里存在的证据，不能根据技能名称自行推断经验深度。

### `sources`

```text
id
type
name
base_url
enabled
config_json
last_success_at
last_error
health_status
```

### `jobs`

```text
id
canonical_key
company
title
location
remote_mode
employment_type
salary_min
salary_max
salary_currency
published_at
deadline
first_seen_at
last_seen_at
active
closed_at
canonical_url
current_snapshot_id
```

### `job_sources`

保存同一个岗位的不同来源：

```text
job_id
source_id
source_job_id
source_url
first_seen_at
last_seen_at
```

### `job_snapshots`

```text
id
job_id
content_hash
description_text
description_html
raw_json
fetched_at
```

JD 内容变化时创建新 snapshot，并使旧评分失效。

### `job_requirements`

AI 提取后的结构化要求：

```text
required_skills
preferred_skills
responsibilities
seniority
years_required
languages
work_authorization
education
domain
location_policy
salary
extraction_confidence
extractor_version
```

### `job_scores`

```text
job_id
profile_version
snapshot_id
scoring_version
match_score
ranking_score
confidence
eligible
gate_reasons_json
breakdown_json
matched_evidence_json
gaps_json
unknowns_json
model_provider
model_name
created_at
invalidated_at
```

### `job_triage`

```text
job_id
status: new | shortlisted | ignored | archived
note
updated_at
```

### `applications`

```text
job_id
stage: prepared | applied | screening | interview | offer | rejected | withdrawn
applied_at
resume_version
cover_letter_path
contact
next_action
next_action_at
notes
```

### `feedback`

```text
job_id
type: job_specific | scoring_rule | preference | profile_correction
original_score
corrected_score
feedback
resolved_into_rule
created_at
```

### `scan_runs` 和 `source_runs`

保存每次扫描状态、耗时、发现数量、错误和重试情况。

## 7. 岗位采集流程

```text
创建 scan_run
    ↓
并发运行各 connector
    ↓
获取岗位列表
    ↓
获取每个岗位完整详情
    ↓
标准化字段
    ↓
URL 与 source_job_id 去重
    ↓
公司 + 标题 + 地点 + JD 相似度跨来源去重
    ↓
创建或更新 job_snapshot
    ↓
识别新岗位、变化岗位、消失岗位
    ↓
运行资格 Gate
    ↓
提取要求并评分
    ↓
完成 scan_run
```

### Connector 统一接口

```ts
interface JobConnector {
  type: SourceType;
  healthCheck(): Promise<HealthResult>;
  discover(context: ScanContext): Promise<DiscoveredJob[]>;
  fetchDetail(job: DiscoveredJob): Promise<RawJobDetail>;
  normalize(raw: RawJobDetail): Promise<NormalizedJob>;
}
```

### 首版来源顺序

1. JobTech API。
2. Greenhouse。
3. Lever。
4. Ashby。
5. Teamtailor。
6. Workday。
7. Jobylon。
8. SuccessFactors。
9. Generic HTML，默认关闭，仅允许用户手动启用。

每个来源必须实现：

- 超时。
- 指数退避。
- 最大重试次数。
- 并发限制。
- 独立错误隔离。
- 可复现的测试 fixture。
- 明确 User-Agent。
- 不绕过登录、验证码或访问限制。

### 岗位生命周期

- 本次看到：更新 `last_seen_at`。
- JD hash 改变：创建新 snapshot，重新提取和评分。
- 连续 3 次扫描消失：标记 `active=false`。
- 到达 deadline：标记关闭。
- 手动打开链接确认 404/closed：立即关闭。
- Profile 或评分版本变化：旧分数失效，进入重新评分队列。

## 8. 评分系统

### 8.1 资格 Gate

资格不满足时设置 `eligible=false`，而不是伪装成低匹配分：

- 工作许可或国籍不满足。
- 地点不在允许范围且不支持远程。
- 必须语言不满足。
- 明确需要安全审查且用户不符合。
- 用户明确排除的岗位类型或公司。
- 岗位已关闭。

不确定的信息进入 `unknowns`，不能直接判定不符合。

### 8.2 AI 只提取事实

AI 输出结构化要求和证据匹配，不直接自由决定最终分数。

必须输出：

```json
{
  "requirements": [],
  "matchedEvidence": [],
  "gaps": [],
  "unknowns": [],
  "seniorityFit": "full",
  "roleFit": "full",
  "confidence": 0.84
}
```

每条 `matchedEvidence` 必须同时包含：

- JD 原文片段。
- Profile evidence ID。
- 匹配解释。
- 证据深度。

### 8.3 确定性分数

| 维度               | 权重 |
| ------------------ | ---: |
| 必需技能覆盖       |   30 |
| 技能深度与成果证据 |   20 |
| 职责/岗位方向      |   15 |
| 经验与职级         |   15 |
| 行业和业务背景     |    8 |
| 地点和工作方式     |    7 |
| 用户软偏好         |    5 |
| 合计               |  100 |

发布时间不加入匹配度，而是单独影响排序：

```text
ranking_score =
  match_score
  + freshness_boost
  + target_company_boost
  - uncertainty_penalty
```

UI 同时显示 `match_score` 和“推荐排序”，避免把“刚发布”误解为“能力更匹配”。

### 8.4 评分审计

每次评分后强制检查：

- JSON Schema 是否有效。
- 分数是否为 0–100 整数。
- Gate 是否被绕过。
- Profile evidence 是否真实存在。
- Seniority 结论是否与提取结果一致。
- Reason 是否同时包含匹配点和缺口。
- 置信度低于阈值时是否进入人工复核。
- 同岗位跨来源评分是否一致。

## 9. 浏览器产品设计

### 9.1 Onboarding

步骤式配置：

1. 导入简历或粘贴 Profile。
2. AI 提取事实。
3. 用户确认每项技能和证据。
4. 设置目标岗位。
5. 设置地点、远程、语言和工作许可。
6. 设置目标公司和排除条件。
7. 预览搜索关键词及 Gate。
8. 运行一次测试扫描。

验收条件：

- 所有 AI 提取内容都可以修改。
- 未确认的内容不能进入正式 Profile。
- 配置错误必须在页面中指出。
- 完成后能直接进入首次扫描。

### 9.2 Dashboard

显示：

- 今日新增。
- 强匹配数量。
- 待评分数量。
- 已关闭岗位。
- 来源健康状态。
- 最近扫描时间。
- Top 10 推荐。
- 申请漏斗。
- 下一步待办。

### 9.3 Jobs 页面

支持：

- 表格和卡片视图。
- 按匹配度、发布时间和截止日期排序。
- 按 lane、地点、远程、公司、来源、状态筛选。
- 搜索标题、公司和技能。
- 批量收藏、忽略、重新评分。
- 保存筛选条件。

### 9.4 Job Detail

必须显示：

- 完整 JD。
- 原始来源链接。
- 发布时间、截止时间和最后确认时间。
- 匹配分数及分项。
- 匹配证据。
- 技能缺口。
- 未知条件。
- Gate 结果。
- 评分版本。
- 同岗位的其他来源。
- JD 变化历史。
- 收藏、忽略、申请、纠正评分按钮。

### 9.5 Applications

采用 Kanban：

```text
准备中 → 已申请 → HR沟通 → 面试 → Offer
                         ↘ 拒绝
```

支持：

- 下一步行动。
- Follow-up 日期。
- 使用的简历版本。
- Cover Letter。
- 联系人。
- 面试记录。
- 拒绝原因。

### 9.6 Settings 与 Runs

Settings：

- Profile。
- 偏好。
- AI Provider。
- 定时扫描。
- 通知。
- 数据导入导出。

Runs：

- 每次扫描的阶段。
- 每个来源的成功/失败。
- 抓取、去重、评分数量。
- 脱敏错误信息。
- 重试按钮。

## 10. API 设计

### Profile

```text
GET    /api/profile
PUT    /api/profile
POST   /api/profile/import
POST   /api/profile/confirm
GET    /api/profile/versions
```

### Preferences

```text
GET    /api/preferences
PUT    /api/preferences
POST   /api/preferences/preview
```

### Jobs

```text
GET    /api/jobs
GET    /api/jobs/:id
PATCH  /api/jobs/:id/triage
POST   /api/jobs/:id/rescore
POST   /api/jobs/:id/refresh
GET    /api/jobs/:id/history
POST   /api/jobs/bulk-triage
```

### Sources

```text
GET    /api/sources
POST   /api/sources
PATCH  /api/sources/:id
DELETE /api/sources/:id
POST   /api/sources/:id/test
```

### Scans

```text
POST   /api/scans
GET    /api/scans
GET    /api/scans/:id
GET    /api/scans/:id/events
POST   /api/scans/:id/retry
```

`events` 使用 Server-Sent Events 向浏览器发送扫描进度。

### Applications

```text
GET    /api/applications
POST   /api/applications
PATCH  /api/applications/:id
POST   /api/applications/:id/materials
```

### Feedback

```text
POST   /api/jobs/:id/feedback
GET    /api/feedback
PATCH  /api/feedback/:id/resolve
```

### Operations

```text
GET    /api/health
GET    /api/readiness
POST   /api/backup
POST   /api/export
POST   /api/import
```

## 11. 实施阶段与验收

估算按一个开发者使用 Codex 实施，不视为固定工期。

### M0：项目骨架，2–3 天

- [ ] `JR-001` 初始化 Git、pnpm workspace 和基础配置。
- [ ] `JR-002` 创建 Vite React TypeScript 应用。
- [ ] `JR-003` 创建 Fastify API 和 `/api/health`。
- [ ] `JR-004` 配置共享 Zod contracts。
- [ ] `JR-005` 配置 SQLite、Drizzle 和首个 migration。
- [ ] `JR-006` 配置 lint、format、typecheck、Vitest。
- [ ] `JR-007` 配置 React build 由 Fastify 静态托管。
- [ ] `JR-008` 创建 `.env.example`、日志和数据目录策略。

验收：

```bash
pnpm install
pnpm db:migrate
pnpm dev
pnpm build
pnpm start
```

全部成功，浏览器能打开空 Dashboard。

### M1：Profile 与配置，3–4 天

- [ ] `JR-101` 实现 Profile 数据库模型和版本。
- [ ] `JR-102` 实现 Profile CRUD API。
- [ ] `JR-103` 实现简历/Profile 导入契约。
- [ ] `JR-104` 实现 AI 提取与人工确认流程。
- [ ] `JR-105` 实现 Preferences Schema。
- [ ] `JR-106` 实现 Onboarding 页面。
- [ ] `JR-107` 实现搜索 lane 和 Gate 预览。
- [ ] `JR-108` 添加 Profile evidence 引用机制。

验收：

- 可以完全通过浏览器完成配置。
- 未确认事实不会写入正式 Profile。
- Profile 修改会增加版本号。

### M2：岗位采集与生命周期，6–8 天

- [ ] `JR-201` 定义 Connector 接口。
- [ ] `JR-202` 实现 scan run/source run。
- [ ] `JR-203` 实现 JobTech 列表和完整详情。
- [ ] `JR-204` 实现 Greenhouse、Lever、Ashby。
- [ ] `JR-205` 实现 Teamtailor、Workday。
- [ ] `JR-206` 保存原始响应和 snapshot。
- [ ] `JR-207` 实现 URL canonicalization。
- [ ] `JR-208` 实现跨来源去重。
- [ ] `JR-209` 实现 JD 内容变化检测。
- [ ] `JR-210` 实现岗位关闭判定。
- [ ] `JR-211` 为所有 Connector 建立 fixtures。
- [ ] `JR-212` 实现来源健康检查。

验收：

- 测试扫描能写入完整 JD。
- 同一岗位多来源只显示一次。
- JD 改变后生成新 snapshot。
- 单个来源失败不会中止整个扫描。

### M3：评分系统，5–7 天

- [ ] `JR-301` 定义 AI extraction Schema。
- [ ] `JR-302` 实现 Codex CLI Provider。
- [ ] `JR-303` 定义 AI Provider 接口。
- [ ] `JR-304` 实现语言、身份、地点等 Gate。
- [ ] `JR-305` 实现确定性加权评分。
- [ ] `JR-306` 实现 matched evidence 和 gaps。
- [ ] `JR-307` 实现 confidence 与 unknowns。
- [ ] `JR-308` 实现评分版本与失效规则。
- [ ] `JR-309` 实现自动审计。
- [ ] `JR-310` 建立至少 30 个评分 eval 样本。
- [ ] `JR-311` 实现失败重试和 pending 队列。

验收：

- 相同输入和评分版本产生相同数值分数。
- 每个分数均引用真实 Profile evidence。
- Gate 不可能被 AI 覆盖。
- 无效 AI 输出不会写入正式评分表。

### M4：岗位审核前端，5–6 天

- [ ] `JR-401` Dashboard。
- [ ] `JR-402` Jobs 表格、排序和筛选。
- [ ] `JR-403` Job Detail 页面或侧栏。
- [ ] `JR-404` 分项评分和证据展示。
- [ ] `JR-405` 收藏、忽略和批量操作。
- [ ] `JR-406` 手动刷新与重新评分。
- [ ] `JR-407` Scan 进度 SSE。
- [ ] `JR-408` Sources/Runs 健康页面。
- [ ] `JR-409` 响应式与空状态、错误状态。
- [ ] `JR-410` 无障碍键盘操作。

验收：

- 日常审核不需要终端。
- 所有状态操作可以撤销。
- 页面刷新后状态不丢失。
- 失败来源和失败阶段可见。

### M5：Codex CLI 与自动运行，3–4 天

- [ ] `JR-501` 实现项目 CLI。
- [ ] `JR-502` 创建仓库级 `$job-radar` Skill。
- [ ] `JR-503` 实现 `setup/start/stop/status/doctor`。
- [ ] `JR-504` macOS launchd 单一服务实现。
- [ ] `JR-505` 服务启动时执行 migration。
- [ ] `JR-506` 实现每日调度和单实例锁。
- [ ] `JR-507` 实现本地通知。
- [ ] `JR-508` 实现自动备份和恢复。
- [ ] `JR-509` 实现崩溃后任务恢复。

验收：

```text
$job-radar start
```

能够：

1. 启动后台服务。
2. 检查数据库 migration。
3. 等待 health check 成功。
4. 返回 `http://127.0.0.1:8787`。
5. 重复执行不会启动第二个实例。

### M6：申请管理与反馈，3–4 天

- [ ] `JR-601` Applications 数据模型。
- [ ] `JR-602` Kanban 页面。
- [ ] `JR-603` 下一步行动和提醒。
- [ ] `JR-604` 申请材料目录管理。
- [ ] `JR-605` 评分反馈分类。
- [ ] `JR-606` 将规则级反馈转化为显式配置。
- [ ] `JR-607` Profile 修正重新触发评分。
- [ ] `JR-608` 导出申请记录。

验收：

- 用户能追踪完整申请阶段。
- 反馈不会只无限追加到 Prompt。
- 任何自动生成的规则都必须经过用户确认。

### M7：质量加固与 v1，3–5 天

- [ ] `JR-701` 单元测试覆盖核心评分和 Gate。
- [ ] `JR-702` Connector fixture 集成测试。
- [ ] `JR-703` Playwright 端到端测试。
- [ ] `JR-704` 安全和隐私检查。
- [ ] `JR-705` XSS、SSRF 和 prompt injection 测试。
- [ ] `JR-706` 数据库并发和崩溃恢复测试。
- [ ] `JR-707` 大数据量性能测试。
- [ ] `JR-708` 完成 README 和运维文档。
- [ ] `JR-709` 创建备份恢复演练。
- [ ] `JR-710` 发布 `v1.0.0`。

## 12. 测试矩阵

### 单元测试

- URL canonicalization。
- 工作许可和语言 Gate。
- 分数计算。
- 排序加成。
- Profile evidence 检查。
- 岗位生命周期。
- 状态机转换。

### Connector 测试

每个来源保存固定 HTML/JSON fixture，禁止测试完全依赖实时网站。

检查：

- 列表解析。
- 详情解析。
- 分页。
- 空字段。
- 页面结构变化。
- 429/5xx 重试。
- 部分失败。

### API 集成测试

使用临时 SQLite：

- Profile CRUD。
- 扫描创建。
- Job 合并。
- Snapshot 变化。
- 评分写入。
- 状态更新。
- 并发写入。

### AI Eval

至少覆盖：

- 强匹配。
- 技能关键词匹配但深度不足。
- Senior 职级不匹配。
- 必需瑞典语。
- 瑞典语仅为加分项。
- 工作许可不确定。
- ML 训练与部署差异。
- 同义技术栈。
- JD prompt injection。
- 信息不足。

### Playwright E2E

- 首次 Onboarding。
- 运行测试扫描。
- 查看岗位详情。
- 收藏、忽略和撤销。
- 手动重新评分。
- 更新申请阶段。
- 服务重启后数据仍存在。

## 13. 每个任务的 Definition of Done

任何任务只有同时满足以下条件才算完成：

- 功能代码完成。
- TypeScript 无错误。
- 输入输出 Schema 完成。
- 必要 migration 完成。
- 单元或集成测试完成。
- 错误状态和空状态完成。
- 日志已脱敏。
- README 或相关文档更新。
- `pnpm lint` 通过。
- `pnpm typecheck` 通过。
- `pnpm test` 通过。
- `pnpm build` 通过。
- 涉及 UI 时 Playwright 用例通过。

## 14. 发布检查清单

```text
[ ] 首次安装在干净环境中成功
[ ] 一条 Codex 指令可以启动
[ ] 数据库自动迁移
[ ] 浏览器只能绑定 127.0.0.1
[ ] 没有密钥或 Profile 被提交到 Git
[ ] 所有来源均有健康状态
[ ] 评分失败不会产生默认分
[ ] Gate 不能被模型绕过
[ ] 岗位更新会重新评分
[ ] 关闭岗位默认隐藏
[ ] 状态操作可以撤销
[ ] 数据可以导出和恢复
[ ] 定时任务不会重叠运行
[ ] 日志不包含完整 JD 或个人资料
[ ] 核心 E2E 全部通过
```

## 15. 推荐交付节点

| 节点        | 完成阶段 | 可以做什么                   |
| ----------- | -------- | ---------------------------- |
| 技术骨架    | M0       | 浏览器打开、API 和数据库可用 |
| 数据 Alpha  | M2       | 搜索、存储、去重和岗位更新   |
| 推荐 Beta   | M4       | 浏览器查看证据化评分并审核   |
| Daily Ready | M5       | Codex 启动和每日自动扫描     |
| 求职闭环    | M6       | 申请管理和反馈               |
| v1.0        | M7       | 稳定日用、可恢复、可测试     |

依赖关系：

```text
M0
├── M1 Profile
├── M2 Connectors
└── M4 前端骨架

M1 + M2
└── M3 Scoring

M2 + M3 + M4
└── M5 Automation

M4
└── M6 Applications

全部阶段
└── M7 Hardening
```

实施时应先完成 M0，不要一开始同时开发所有 Connector、AI 评分和完整 Dashboard。第一个垂直切片应当是：

```text
最小 Profile
→ JobTech 抓取一个岗位
→ SQLite 保存
→ 固定规则评分
→ React 页面显示
→ 浏览器修改状态
```

这个切片通过后，再逐步增加 ATS、AI 和自动调度。
