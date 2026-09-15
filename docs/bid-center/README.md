# BESTCRM 旧标书中心（已退役）

- 日期：2026-09-05
- 退役日期：2026-09-15
- 状态：已由商机下的 Datasheet、Technical Agreement 和 Bidding Document 三种技术资料完全取代
- 冻结规范：`../superpowers/specs/2026-09-04-bestcrm-bid-center-v1-design.md`
- 实施计划：`../superpowers/plans/2026-09-04-bestcrm-bid-center-v1-implementation.md`

本目录仅保存旧标书中心 V1 的历史规范、验收基准和分步报告，不再代表可部署功能。

退役边界：

1. 导航不再显示“标书中心”。
2. `/bid-center/*` 和 `/opportunities/:id/bid-workspace` 不再挂载，旧环境开关不能恢复它们。
3. 商机仅从“技术资料”进入三种新文档工作流。
4. 旧数据库表、迁移和已有数据保留，仅用于审计、回滚和历史包兼容，不清除生产数据。

## 文件

- `samples-inventory.md`：历史标书、公共资料和品牌资产清单。
- `industry-baseline-v1.md`：行业依据、端到端工作流、评审门和受控内容规则。
- `design-change-001-industry-baseline-first.md`：行业基线优先的设计变更记录。
- `content-taxonomy.md`：技术、商务和通用内容分类及边界。
- `output-style-v1.md`：DOCX/PDF 行业基线版式和文件命名规则。
- `acceptance-baseline.md`：黄金输出、语言、权限和可追溯性验收清单。
- `fixtures/synthetic-bid-v1.json`：仅用于测试设计的合成项目数据，不代表真实工程参数或商务承诺。
- `step-1-report.md` 至 `step-8-report.md`：各阶段实施范围、验证证据、边界和下一确认门。

## 当前门禁

本目录下的旧实施计划和暗部署指令已作废，不得再用于发布旧标书中心。
