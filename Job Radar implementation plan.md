# Job Radar 改造计划（2026-10-14）

## 目标与定位

把 Job Radar 做成一个能交给招聘经理打开、且能在面试中讲清楚工程取舍的公开项目。定位为 **TypeScript 数据集成与 AWS serverless 交付**：从瑞典官方 JobTech API 采集一个明确有界的软件岗位样本，验证、去重、生成公开 JSON，再用静态 React 页面展示。它是工程作品，也是可用的轻量岗位入口，但不声称覆盖全部职位或自动判断申请资格。

本次主动退休本地 Profile、SQLite、Fastify、AI 评分、申请管理、复杂审核交互与多来源爬虫。公开产品不存求职者个人资料，不需要常驻服务器或数据库。原 Git 历史可追溯旧实现。

## 为什么选这条技术路线

2024 年 TechSverige 的企业能力需求调查中，云技术增长预期为 62%，Azure 61%，AWS 45%，React 45%，Java 40%。这说明 AWS 有市场相关性，也说明**不能宣称 AWS 是瑞典需求最高的云**。该调查测量的是未来能力需求预期，不是 2026 年斯德哥尔摩初级岗位的数量、竞争人数或签证友好程度。[TechSverige 原报告](https://www.techsverige.se/app/uploads/sites/2/2024/02/TECHSVERIGE-RAPPORT-KOMPETENSBEHOVEN-INOM-TECH-ONLINE-VERSION.pdf)

具体雇主也存在 TypeScript、React、AWS 和 IaC 同时使用的产品团队，例如 Evolution 斯德哥尔摩的职位写明 React/TypeScript、AWS 与 CDK；但它要求资深经验，**只用于验证技术组合存在，不作为应届职位证据**。[Evolution 职位](https://careers.evolution.com/job/744000143488189/)

因此目前的求职叙事是“能负责一个小型数据产品从外部 API 到云上交付的 software engineer”，而不是“发现了竞争较低的市场空缺”。下一轮用 20–30 条真正可申请、英语可工作的目标岗位做人工样本表，记录地点、语言、年限、后端、云和 IaC；若 Azure/.NET 明显占优，再调整下一项目或学习重点，而不是给本项目硬塞第二套后端。

## 产品范围

公开页面只保留：

1. 最近一次成功采集的时间和岗位数量。
2. 标题、雇主、地点、发布日期、结构化语言要求、原始岗位链接。
3. 标题/雇主/城市搜索与地区筛选。
4. 采集过期提示、空状态、错误状态、覆盖范围说明。

首屏直接显示岗位与筛选。架构和工程取舍放在 README，不占用求职者浏览岗位的页面空间。

不做登录、收藏、简历上传、候选人评分、申请管理、邮件通知或岗位正文镜像。JobTech 的结构化语言字段缺失时，卡片不显示语言标签；不能据此推断为不要求瑞典语。用户应打开原广告核对语言、工作许可、身份和地点条件。

## 部署拓扑

```text
JobTech Search API
    │ 每天 6 个固定查询，每个最多 100 条
    ▼
EventBridge Scheduler → Lambda (Node.js 22 / arm64 / 256 MB)
                           │ Zod 解析、地区过滤、去重
                           ▼
                   S3 data/latest.json（版本控制）
                           │
React/Vite 静态文件 → 同一个私有 S3 bucket → CloudFront HTTPS/OAC → 浏览器
```

- AWS 区域：`eu-north-1`（Stockholm）。CloudFront 为全球分发。无需 EC2、ECS、RDS、NAT Gateway 或自定义域名。
- Lambda 每天 07:00 `Europe/Stockholm` 运行，最多并发 1，失败时不覆盖 `latest.json`。S3 版本控制支持回滚；旧版本 30 天后清理。
- S3 桶完全私有，CloudFront 用 Origin Access Control 读取。Lambda 仅有写入 `data/latest.json` 的 IAM 权限。
- CloudWatch 日志保留 14 天。运行日志只记公开数量与时间，不记岗位正文或凭据。
- CloudFront 默认域名先作为演示地址；自定义域名与 Route 53 在实际需要时再决定。
- CloudFormation 定义资源，`scripts/deploy.sh` 负责构建、上传、部署及首次采集。部署必须另行获得用户明确授权。

## 数据边界与采样取舍

JobTech 官方将 Search API 定位为搜索，而不是全量广告下载；全量应走 Stream API。[JobTech 文档](https://gitlab.com/arbetsformedlingen/job-ads/jobsearch-apis/-/blob/main/docs/GettingStartedJobSearchEN.md) 本项目每天运行 4 个宽泛查询（`software engineer`、`systemutvecklare`、`backend developer`、`frontend developer`），再为 Västerbotten 与 Norrbotten 各运行 1 个地区限定的 `systemutvecklare` 查询，避免北部岗位被全国相关性排序淹没。每个查询只取第一页、最多 100 个结果，再限定 Stockholm、Uppsala、Södermanland、Västerbotten、Norrbotten，并排除标题明确属于安全领域的岗位。公开 JSON 只包含展示所需的岗位字段与生成时间；页面标示为样本，具体采样规则留在文档和代码中。

搜索结果目前包含展示所需的结构化字段；2026-10-14 的只读 HTTP 检查返回 200。本地自动测试只用虚构数据，不依赖 JobTech 在线可用性。若 API 契约变化导致没有可发布岗位，任务失败，旧版本继续服务；不得以空数据覆盖正常版本。

## 成本边界

低流量情景：6 次搜索/日约 180 次来源请求/月；Lambda 约 30–31 次运行/月；页面只有静态资源和一个 JSON。AWS 官方当前公布的 Lambda 月免费额度为 100 万次请求和 40 万 GB 秒，EventBridge Scheduler 月免费额度为 1400 万次调用，CloudFront 按量付费每月免费额度为 1 TB 流量和 1000 万请求。实际账单仍取决于账户资格、流量、S3 存储/请求、日志、跨区流量、税费和其他已有资源，不能承诺零成本。[Lambda 定价](https://aws.amazon.com/lambda/pricing/)、[EventBridge 定价](https://aws.amazon.com/eventbridge/pricing/)、[CloudFront 免费额度](https://aws.amazon.com/cloudfront/faqs/)

预算由独立的 `us-east-1` CloudFormation 栈创建（AWS Budgets 资源在 `eu-north-1` 不受支持），额度为每月 **5 美元账户级预算、达到 50% 时发邮件**；站点栈仍在 Stockholm。预算是延迟提醒，不是硬停机上限；若账户另有资源，提醒也会受其支出影响。部署前核对 AWS Pricing Calculator 和账户 Free Tier 状态；部署后每周查看账单。S3 桶设置 `Retain` 以防意外丢失，删除栈后需手工清理桶，否则仍可能计费。

## 实施与验收

| 阶段 | 交付 | 验收 |
| --- | --- | --- |
| A 范围收缩 | 删除旧 API/DB/评分/Profile；更新 README 与状态文档 | 只有 web、ingest、shared 三个工作区 |
| B 数据链路 | JobTech 有界查询、Zod 契约、地区过滤、去重、失败保护 | 虚构 fixtures 覆盖重复、异常链接、429、来源错误、空结果 |
| C 页面 | 静态列表、搜索、筛选、来源链接、过期与错误状态 | 桌面/窄屏检查；不显示个人数据或完整 JD |
| D 云交付 | CloudFormation、预算、CI、手动部署脚本 | 模板校验、最小权限审核、CloudFront/S3/Lambda 实际健康检查 |
| E 求职包装 | 公开地址、代码仓库、简历一条成果描述、架构和故障演示 | 陌生人 60 秒内看懂项目价值；能解释成本与故障处理 |

A–C 已在本地实现，D 的配置已写入仓库，但 **尚未在 AWS 创建资源或进行公网发布**。D 的云端验证、E 的公开地址需要另行明确授权和可用 AWS 账户。完成这些后，才可称为已上线的作品。

## 面试可讲的工程决策

- 为什么没有数据库：公开只读样本是整批替换，S3 版本对象已满足交付与回滚。
- 为什么保留 JSON 契约：生产者和浏览器分别校验，来源字段变化会明确失败。
- 为什么不做语言/身份自动筛选：结构化数据无法证明无要求，错误排除会误导求职者。
- 为什么不做全量抓取：遵守 JobTech Search API 的用途并降低请求成本。
- 故障演练：让采集返回 429/无效数据，证明现有快照不被覆盖、页面显示过期提示。
