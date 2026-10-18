# 字段与状态映射

API 前缀为 /api/integrations/sunkaier-ai/v1，资源为 sources。以 openapi.yaml 和 src/integrations/sunkaier-ai/contracts.mjs 为字段规范；未知字段拒绝，超长、错误格式、未来时间和错误枚举拒绝。数据体上限 128 KiB。

## 数据与业务映射

external_lead_id 在 clientId 内标识稳定 AI Source，external_event_id 标识单次事件，idempotency_key 标识同一次业务请求。source_system 固定 sunkaier_ai。来源主体无需已有 CRM 客户、销售或商机 ID。

source_channel 支持 ai_project_search、website_form、web_chat、phone_consultation、email_reference。真实获客渠道与接入系统分开保存。company_name、contact_name、email、E.164 phone 等允许缺失；title、requirement_summary、标识、发生时间、consent_status、data_origin 必填。搜索项目无会话和联系人也可接收。金额采用十进制字符串及三位大写币种；未给出的数据不编造。

project 保存项目名称、阶段、公开出处、发现时间、搜索任务号及核实状态。出处只允许无用户名、密码、查询参数和 fragment 的 HTTP(S) URL；CRM 不主动抓取。ai 保存摘要、受控意图、紧急度、置信度和待跟进建议，不能提交系统提示词或内部推理字段。

原始来源资料写 ai_sources.payload，后续完整提交或交互写事件；资料不自动覆盖。Lead 只保存自身业务必要字段及 aiSourceId，附件与原始事件不复制到业务表。商机只增加关联。

## 对外最小状态

| 状态 | 含义 |
| --- | --- |
| received | 单次提交已接收，不代表业务认可 |
| pending_review | 来源尚未关联业务且未归档 |
| archived | 人工归档，无业务关联 |
| lead_created | 人工已转入 Lead |
| linked_to_opportunity | 人工已关联已有商机 |
| deleted | 逻辑删除，基础记录仍保留 |

保留状态和业务关联分开存储。已关联再归档时，对外仍返回关联结果；不返回关联对象 ID、人员、客户或审批备注。Lead 后续审批不通过本接口镜像。

邮箱唯一精确匹配、带国家区号电话、企业域名和公司名称可生成候选，均需人工确认；不会自动绑定或合并。现有 CRM 没有企业注册号主字段，因此注册号只保存，不宣称支持 CRM 注册号匹配。
