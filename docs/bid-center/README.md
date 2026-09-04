# BESTCRM 标书中心第 0 步资料

- 日期：2026-09-04
- 状态：行业基线 R1 已编制，等待第 0 步确认
- 冻结规范：`../superpowers/specs/2026-09-04-bestcrm-bid-center-v1-design.md`
- 实施计划：`../superpowers/plans/2026-09-04-bestcrm-bid-center-v1-implementation.md`

本目录只建立标书中心 V1 的样本、分类和验收基准，不包含数据库、服务、路由或页面实现。

## 文件

- `samples-inventory.md`：历史标书、公共资料和品牌资产清单。
- `industry-baseline-v1.md`：行业依据、端到端工作流、评审门和受控内容规则。
- `design-change-001-industry-baseline-first.md`：行业基线优先的设计变更记录。
- `content-taxonomy.md`：技术、商务和通用内容分类及边界。
- `output-style-v1.md`：DOCX/PDF 行业基线版式和文件命名规则。
- `acceptance-baseline.md`：黄金输出、语言、权限和可追溯性验收清单。
- `fixtures/synthetic-bid-v1.json`：仅用于测试设计的合成项目数据，不代表真实工程参数或商务承诺。

## 当前门禁

第 0 步现在按行业标准做法验收，不再把历史客户文件作为启动条件。当前产物已经覆盖：

1. 正式行业来源及其在 BESTCRM 中的可执行映射。
2. 技术、商务、通用内容分类和跨包边界。
3. 合规矩阵、专业评审、综合评审、发布和归档流程。
4. 中文、英文和双语 DOCX/PDF 输出默认规则。
5. 不含真实客户、工程和商务承诺的验收夹具。
6. 权限、版本、不可变性、输出和浏览器验收清单。

历史标书、正式品牌文件和公共资料为推荐的企业校准材料，不阻塞第 1 步。第 0 步确认前仍不编写迁移或产品代码。
