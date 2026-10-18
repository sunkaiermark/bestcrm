# SUNKAIER AI Source 开发交付

2026 年 10 月 18 日。CRM AI Source 程序已实现，本地合成数据库与接口测试结果见 completion-review.md。生产部署、官网切流和真实 AI 联调尚未进行。

## 架构

SUNKAIER AI 持续搜索全球项目并甄别、去重、更新，也整理官网表单、聊天、电话等接待信息，提交 CRM AI Source。CRM 人工删除、归档、转入 Lead 或关联已有商机。原始资料保留在来源工作区，业务模块通过 ID 关联，不复制附件和事件。

这取代早期 AI 直接创建 Lead 以及旧 S21 商机交接目标。业务主数据与审批仍由 CRM 管理，现有邮件、人工 Lead 和官网入口不切换。

## 文档

- architecture.md：已确认业务架构及页面规则。
- implementation-dependencies.md：历史依赖计划及候选文件。
- ai-contract-handoff.md：AI 端改造背景，最终接口以下列文档为准。
- openapi.yaml：实际机器契约，JSON 格式的合法 YAML。
- field-and-status-mapping.md：字段和状态。
- authentication-rbac.md：HMAC 和人工权限。
- idempotency-retry-reconciliation.md：重试与对账。
- evidence-security.md：证据安全。
- operations-manual.md：本地运行、迁移、回退。
- implementation-status.md：已实现与未启用范围。
- completion-review.md：文件清单和实际验证结果。
- examples：合成请求响应。

正式人工工作区 /ai-sources。node scripts/local-ai-source.mjs 提供 127.0.0.1:3001 的持久化合成版本。旧纯前端布局样稿已移除；仅保留正式数据库工作区。
