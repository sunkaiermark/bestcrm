# 本地运行与迁移

## 合成数据审阅

在项目根目录运行 node scripts/local-ai-source.mjs。地址 http://127.0.0.1:3001/ai-sources。使用 var/ai-source-local-login.json 中的随机本地账号登录。该文件被 Git 忽略，不得上传或共享。数据库保存在 var/ai-source-local-db，刷新和重启后保留人工处理。机器 API 在此运行器中关闭，邮件等外部连接清空。

PGlite 是本地测试开发依赖；生产仍使用既有 pg.Pool 和 PostgreSQL。不要把本地数据库、凭据或合成记录部署到生产。

## 配置与升级

AI_SOURCE_ENABLED 控制人工工作区，SUNKAIER_AI_INTEGRATION_ENABLED 控制机器入口，两者在 .env.example 均为 false。独立启用需先完成隔离环境、身份、私有文件存储及扫描器验证。本次没有启用生产开关。

新增迁移 121_sunkai_ai_lead_integration.sql，仅新增 AI Source 表、索引和保护函数，不改历史业务记录。按现有 db:migrate 机制在同一连接事务执行。新增 SQL 可重复执行，现有历史迁移不重写。常规迁移运行器的连接管理未在本次重构；部署前按现有流程验证。

## 回退

首先关闭机器入口和人工工作区，回退应用代码。保留新表、来源、事件、业务关联和私有证据，不自动 DROP，不删除已创建 Lead 或修改已关联商机。已有业务结果不能通过删除来源撤销。任何数据清理另行授权并进行引用和保留期审查。

## 验证命令

- node --test tests/integrations/ai-source.test.mjs
- node scripts/verify-ai-source-local.mjs
- node scripts/build-ai-source-openapi.mjs
- npm.cmd test
- git diff --check

监控管理员运行审计中的认证失败、冲突和扫描失败。错误响应不返回内部堆栈。大型部署可另行评估 substring 查询索引和私有文件孤儿对账，当前查询为参数化分词 ILIKE，不是 AI 语义搜索。

## 清理后的默认行为

本地启动默认不灌入演示数据，来源列表为空，数据库结构和本地登录账号保留。需要合成演练时可显式运行 node scripts/local-ai-source.mjs --seed-demo；不能在真实数据库运行该脚本。旧 local-preview.mjs 与 preview/ai-source 已移除。备份目录保留，不纳入垃圾删除。
