# BESTCRM 标书中心 V1

- 日期：2026-09-05
- 状态：第 8 步本地验收完成，等待暗部署确认
- 冻结规范：`../superpowers/specs/2026-09-04-bestcrm-bid-center-v1-design.md`
- 实施计划：`../superpowers/plans/2026-09-04-bestcrm-bid-center-v1-implementation.md`

本目录保存标书中心 V1 的冻结规范依据、验收基准和分步实施报告。生产功能开关仍默认关闭。

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

第 0 至第 8 步已经完成本地实现和验收。第 8 步候选保持：

1. `BID_CENTER_ENABLED=false`，不会改变现有生产导航和路由。
2. 邮件中心、收信和发信开关继续关闭。
3. 未执行生产迁移、推送或部署。
4. 下一步只能在用户确认后执行暗部署；暗部署不等于启用。

等待用户指令：`确认部署标书中心 V1 暗部署`。
