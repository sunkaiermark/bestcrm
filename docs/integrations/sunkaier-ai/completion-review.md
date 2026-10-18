# AI Source 完工审阅

## 交付范围

CRM 端正式来源工作区、数据库持久化、全库授权查询、分页、归档及逻辑删除、人工转入线索与已有商机关联，以及五类默认关闭的 AI API。基础资料与证据只保存于来源体系，业务通过关联引用。旧前端演示保留但不承担数据保存。

## 文件与用途

| 文件 | 用途 |
| --- | --- |
| src/db/migrations/121_sunkai_ai_lead_integration.sql | 新增来源、事件、nonce、审计、候选、证据与业务关联，保护原始事实 |
| src/integrations/sunkaier-ai/contracts.mjs | 严格字段、格式、枚举及文件元数据校验 |
| src/integrations/sunkaier-ai/config.mjs | 独立开关及环境注入的机器身份配置 |
| src/integrations/sunkaier-ai/auth.mjs | HMAC、时间窗口、正文哈希、nonce和速率控制 |
| src/integrations/sunkaier-ai/repository.mjs | 参数化查询、数据库分页、事务幂等及原始记录 |
| src/integrations/sunkaier-ai/service.mjs | 双层权限中的服务层，归档分派及业务关联事务 |
| src/integrations/sunkaier-ai/routes.mjs | 提交、追加、证据、状态和补账机器 API |
| src/integrations/sunkaier-ai/ui-routes.mjs | 登录、CSRF、来源列表详情、处理及下载路由 |
| src/integrations/sunkaier-ai/matching.mjs | 仅供人工复核的身份匹配候选 |
| src/integrations/sunkaier-ai/evidence.mjs | 隔离、类型哈希大小校验、扫描和完整性下载 |
| src/integrations/sunkaier-ai/client.mjs | AI 项目可采用的签名客户端及退避计算 |
| src/integrations/sunkaier-ai/local-database.mjs | 仅本地测试的持久化 PostgreSQL 引擎适配 |
| src/views/ai-sources/index.html | 固定页头、来源分类、数据库列表与分页 |
| src/views/ai-sources/detail.html | 原文、交互、证据、人工处置与审计 |
| src/views/ai-sources/audit.html | 管理员运行审计 |
| src/public/assets/ai-source.css | 邮件中心风格、紧凑与独立滚动布局 |
| src/server.mjs | 模块装配和开关，不修改原入口逻辑 |
| src/views/partials/app-start.ejs | 按角色和开关显示 AI Source 菜单 |
| src/views/lead-submissions/detail.ejs | 来源记录回链 |
| src/views/opportunities/detail.ejs | 已关联来源的受权查看入口 |
| scripts/local-ai-source.mjs | 仅本机合成数据库审阅运行器 |
| scripts/verify-ai-source-local.mjs | 空库全部迁移及新增迁移重复验证 |
| scripts/build-ai-source-openapi.mjs | 从实际字段校验生成 OpenAPI |
| tests/integrations/ai-source-fixtures.mjs | 纯合成数据库和随机测试账号 |
| tests/integrations/ai-source.test.mjs | 新增功能、权限、幂等、扫描和持久化验收 |
| package.json 与 package-lock.json | 本地 PostgreSQL 引擎开发依赖及运行命令 |
| .env.example | 默认关闭示例与既有 MFA 安全默认值 |
| .gitignore | 排除恢复前锁文件备份；原有 .env、var、node_modules 排除保留 |
| docs/integrations/sunkaier-ai | 架构、最终接口、权限、安全、运维、回滚与合成示例 |

## 实际验证

新增集成测试当前 30 项通过，零失败。覆盖签名、时间、nonce、哈希、未知字段、格式、幂等、并发、跨 client 隔离、归档删除恢复、全库查询、分页、人工转线索、回滚、商机权限和不变性、候选、真实 multipart、模拟扫描失败、下载越权、轮换、SDK HTTP、关闭重开持久化和首次原文唯一存储。

最终完整回归：node --test "tests/**/*.test.mjs"，共 1458 项，通过 1438、跳过 20、失败 0。新增 AI Source 测试 30 项全部通过。git diff --check 和提交内容格式检查通过。

全部迁移 001 至 121 已在隔离空库执行，121 重复执行通过。浏览器已验证正式登录、数据库列表、人工归档后刷新保持结果、全库搜索包含归档和不同渠道，30 条结果分页显示。

扫描测试注入合成 clean、malware 和错误结果；没有假称实际 ClamAV 服务验收。PGlite 使用 PostgreSQL 引擎验证 SQL 与持久化，不替代生产环境的原生 PostgreSQL 多连接、容量与运行扫描器验收。

## 迁移和回退

本次未执行生产迁移。关闭两项开关并回退应用即可停止新功能，保留新增表和私有证据，不能删除已创建 Lead 或修改已关联商机来假装回滚。详细操作见 operations-manual.md。

## 尚未启用

未部署、未推送、未使用真实客户资料、未切官网、未接真实 AI 或邮件。实际 SUNKAIER AI 项目的旧适配器和 outbox 没有改动；交付的 OpenAPI 和 SDK 供该项目下一步采用。企业注册号匹配缺少 CRM 主字段，只保存待核实信息。

## 本地版本记录

从恢复目录建立新的本地记录，不是原云端 Git 历史，不能据此声称已完成对生产逐文件差异核验。

本机文件保护影响 D 盘 Git 对象及部分文件读取。Git 元数据使用 C:/Users/sun/.codex/project-git/BESTCRM-20261018，D:/BESTCRM/.git 为 Git 原生指向文件；源码仍在 D:/BESTCRM。保留本次损坏元数据备份于 Git 忽略的 var 目录，不把备份作为基线。未修改系统保护设置。项目搬迁时应同时保留独立元数据目录或按正常 Git 流程克隆，不能只复制 .git 指向文件。

功能提交：ae77d0b，feat(integrations): add sunkaier ai lead handoff boundary。独立本地 Git 元数据同时配置项目级 readable-source clean/smudge 转换，确保 Node 可读源码以正文而非系统包装字节进入版本记录；该配置仅保存在本机 Git 目录，没有修改全局 Git 或系统保护。
