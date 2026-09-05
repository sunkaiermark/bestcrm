# BESTCRM Google Workspace 统一销售邮箱与客户中心 V1 设计规范

- 日期：2026-09-05
- 状态：Frozen V1（用户已确认开始实施）
- 目标环境：新加坡 BESTCRM，`https://crm.sunkaier.com`
- 外部邮箱：`sales@sunkaier.com`
- 邮箱平台：Google Workspace Gmail
- 实施分支：`codex/google-workspace-customer-center-v1`

## 1. 冻结目标

使用一个对外地址 `sales@sunkaier.com` 完成所有销售询价和项目邮件的集中收发。
员工不共享 Gmail 账号或密码，只使用各自的 BESTCRM 账号工作。BESTCRM 必须记录真实
操作人，并把邮件归档到准确的客户、联系人、询价、商机和报价/技术文件版本。

V1 的核心原则是：

1. Google Workspace 是邮件传输、反垃圾和投递信誉层。
2. BESTCRM 是员工唯一工作台、客户主档、业务归属和审计归档层。
3. 客户只看到 `sales@sunkaier.com`，内部必须能够区分每一名员工。
4. 明确回复可自动归入原会话；没有可靠回复链的新邮件不得猜测商机。
5. 邮件、附件、原始 `.eml`、审批版本和审计记录不得因邮箱侧删除而消失。

## 2. 已有基础与本次差距

现有 BESTCRM 已具备：

- 客户、联系人、询价、商机、商机成员和负责人；
- 报价包及技术/商务资料版本、审批和附件校验和；
- `email_threads`、`email_messages`、`email_attachments` 和投递尝试；
- RFC `Message-ID`、`In-Reply-To`、`References` 回复串联；
- 固定 `sales@sunkaier.com` 发件地址和员工个人英文落款；
- 邮件中心、收件和发件独立功能开关；
- IMAP/SMTP 假服务测试和邮件访问权限控制。

当前差距：

- 收件依赖 IMAP 用户名/密码，发件依赖 SMTP 用户名/密码；
- 没有 Gmail API OAuth 2.0 连接器；
- 邮件提供商代码与业务归档逻辑尚未完全隔离；
- 没有 Google `historyId`、Gmail message/thread id 和 `watch` 生命周期；
- 没有共享队列的领取、转交、等待客户和完成状态；
- 客户详情尚未形成邮件、询价、商机、报价和任务的统一时间线；
- 没有加密保存邮件 OAuth 刷新令牌的独立密钥服务；
- 现有归档没有冻结完整原始 `.eml` 文件。

本设计扩展现有邮件中心，不另建第二套邮件业务模型。

## 3. 系统边界

### 3.1 Google Workspace 负责

- `sales@sunkaier.com` 邮箱及外部收发；
- 垃圾邮件、病毒检查和投递信誉；
- SPF、DKIM、DMARC 对应的邮件身份认证；
- Gmail message/thread/history 标识；
- Gmail API 与 Cloud Pub/Sub 邮箱变化通知。

### 3.2 BESTCRM 负责

- 每位员工的独立登录、角色和商机权限；
- 客户、联系人、询价和商机主档；
- 邮件编写、回复、领取、转交和状态管理；
- 回复链和商机归属；
- 报价包、技术/商务文件和审批版本绑定；
- 正文、附件、原始 `.eml`、投递状态和操作日志归档；
- 失败重试、重复防护、补偿同步、监控和告警；
- 数据库、上传文件和加密离线备份。

### 3.3 V1 不负责

- 营销群发、EDM、邮件序列或批量推广；
- 员工直接登录或共同操作 `sales@` Gmail 网页；
- 用主题、公司名称或 AI 猜测并自动写入商机；
- 自动翻译客户邮件；
- 修改官网表单、Chatwoot 或其他邮箱的业务逻辑；
- 在本地开发阶段修改生产 DNS、MX 或真实邮箱。

## 4. Google Workspace 冻结配置

### 4.1 账号

- 创建一个具有 Gmail 许可证的正式用户：`sales@sunkaier.com`。
- 创建独立管理身份并启用 MFA；`sales@` 不授予超级管理员权限。
- 员工不得获得 `sales@` 密码，不得多人共享登录。
- BESTCRM 服务端是 `sales@` 的唯一日常程序化访问方。

### 4.2 OAuth

- 在 Google Cloud 建立专用 BESTCRM 邮件项目并启用 Gmail API。
- OAuth consent 类型限定为 SUNKAER Workspace 组织内部使用。
- V1 只连接一个邮箱，采用 OAuth 2.0 Web Server 离线授权；不启用全域委派。
- 管理员对 `sales@` 完成一次授权，BESTCRM 保存刷新令牌。
- 只申请完成收件、发件和必要标签操作的最小 Gmail scopes。
- OAuth `state` 必须与管理员会话、CSRF token、过期时间和一次性随机值绑定。
- 访问令牌只保存在内存；刷新令牌必须使用 AES-256-GCM 加密后持久化。

### 4.3 DNS 与迁移

- 域名验证阶段只增加 Google 验证 TXT，不改变现有收件路径。
- 暗部署和程序测试完成前，不修改 MX。
- 如果其他 `@sunkaier.com` 邮箱继续在网易，正式上线采用 Google Split
  Delivery：`sales@` 进入 Gmail，未迁移收件人路由到网易。
- 并行发送期间，SPF 同时授权实际发送系统，避免出现多条 SPF 记录。
- 为 Google 生成独立 2048 位 DKIM selector，不覆盖网易 DKIM。
- DMARC 先使用监控策略并收集报告，验证后再逐步提高策略强度。
- DNS 变更必须保留变更前记录、TTL、执行人、时间和回退值。

## 5. 提供商适配器

邮件业务层不得直接依赖 Gmail、IMAP 或 SMTP。V1 定义统一适配器：

```text
MailProvider
├── verifyConnection()
├── getProfile()
├── listChanges(cursor)
├── getMessage(providerMessageId)
├── sendMessage(rawMessage)
├── startWatch(callbackTopic)
├── renewWatch()
└── stopWatch()
```

冻结约束：

- `GoogleGmailProvider` 使用 Gmail API；
- 现有 `ImapInboundProvider` 和 `SmtpOutboundProvider` 保留为可回退实现；
- 解析、归档、客户归属、权限和 UI 不得读取提供商专属凭据；
- 提供商只返回规范化邮件和稳定外部标识；
- 所有导入和发送操作必须幂等。

## 6. 数据模型增量

迁移从 `042_google_workspace_customer_center.sql` 开始，现有 `033`、`034` 邮件
归档表继续保留。

### 6.1 `mailbox_connections`

- `id`, `provider`, `mailbox_address`, `display_name`；
- `auth_type`, `encrypted_refresh_token`, `token_key_version`；
- `granted_scopes`, `connection_status`；
- `history_cursor`, `watch_expires_at`；
- `last_successful_sync_at`, `last_error_code`, `last_error_at`；
- `authorized_by`, `authorized_at`, `revoked_by`, `revoked_at`；
- `created_at`, `updated_at`；
- `provider + lower(mailbox_address)` 唯一。

数据库不得保存 Google 密码、明文刷新令牌或明文客户端密钥。

### 6.2 `email_threads` 増量

- `mailbox_connection_id`；
- `workflow_status`：`unassigned`、`assigned`、`waiting_customer`、`completed`；
- `assigned_user_id`, `assigned_at`, `assigned_by`；
- `completed_at`, `completed_by`；
- `last_inbound_at`, `last_outbound_at`；
- `provider_thread_id`。

### 6.3 `email_messages` 增量

- `mailbox_connection_id`, `provider_name`；
- `provider_message_id`, `provider_thread_id`, `provider_history_id`；
- `raw_eml_stored_path`, `raw_eml_file_size`, `raw_eml_sha256`；
- `imported_at`, `provider_labels`。

Gmail message id、RFC Message-ID 和现有 provider identity 分别建立幂等唯一索引。

### 6.4 `email_thread_assignment_events`

- 会话、原负责人、新负责人、动作、原因、操作人和时间；
- 动作包括领取、指派、转交、释放、等待客户、重新打开和完成；
- 事件只允许追加，不允许修改或删除。

### 6.5 客户时间线

V1 使用查询服务聚合现有表，不复制业务数据。时间线包含：

- 联系人与资料变更；
- 询价及处理结果；
- 商机及阶段变化；
- 入站/出站邮件；
- 报价、技术方案、商务包和标书版本；
- 任务、审批和关键审计事件。

## 7. 客户与商机归属规则

### 7.1 明确回复

如果 `In-Reply-To` 或 `References` 命中已归档消息：

- 进入同一 `email_thread`；
- 继承原询价、客户、联系人和商机；
- 保持原商机权限；
- 不创建新询价。

### 7.2 已知客户的新主题邮件

如果没有可靠回复头：

- 仅把发件邮箱匹配结果作为客户/联系人建议；
- 不因发件邮箱、公司域名或主题相似而自动归入旧商机；
- 创建受保护的新询价并显示候选客户/联系人；
- 由销售经理确认是否创建新商机或关联已有商机。

### 7.3 未知或冲突邮箱

- 未找到联系人：进入新询价，生成待确认客户/联系人草稿；
- 同一邮箱命中多个联系人：标记 `ambiguous_contact`，不得自动关联；
- 一个客户存在多个进行中商机：进入待归属队列；
- 垃圾邮件、退信、系统通知和营销邮件沿用现有分类规则处理。

### 7.4 数据质量

- 邮箱比较使用规范化小写地址；原始显示名和地址仍保留；
- 公司网站域名只用于候选提示，不是自动归属证据；
- 客户合并必须经过专门流程并保留原标识和审计；
- 导入不得静默创建重复客户或重复联系人。

## 8. 收件流程

```text
Gmail mailbox change
  -> Pub/Sub authenticated callback
  -> history.list incremental synchronization
  -> retrieve raw message
  -> transactionally archive message metadata
  -> store and checksum raw .eml and attachments
  -> deterministic thread matching
  -> inquiry/opportunity permission linkage
  -> assignment notification
```

可靠性要求：

- Pub/Sub 通知只表示“邮箱有变化”，不得把通知本身当作完整邮件；
- 使用 `historyId` 增量读取，成功提交后才推进本地 cursor；
- `watch` 每日续期，最迟不得超过 Google 七天有效期；
- 每五分钟执行补偿检查，每日执行完整差异核对；
- 通知可能重复、延迟或丢失，处理器必须幂等；
- 附件或 `.eml` 存储失败时不得把该消息标记为完整导入。

## 9. 发件流程

```text
employee composes in BESTCRM
  -> permission and approval checks
  -> freeze recipients/body/attachments/signature
  -> create pending archive and Message-ID
  -> Gmail API send
  -> record provider message/thread id
  -> mark sent or failed
  -> audited retry without creating a second business version
```

冻结要求：

- `From` 和 `Reply-To` 固定为 `sales@sunkaier.com`；
- 显示名与落款包含实际员工姓名、职位和联系方式；
- 邮件记录保存 `authored_by`、`sent_by` 和全部投递尝试；
- 支持工程师默认只能保存草稿，外发权限沿用现有商机授权；
- 正式报价/技术文件必须绑定准确的已批准版本及 SHA-256；
- Gmail API 接受不等于客户阅读或最终投递成功；
- 失败消息留在 CRM，不允许因重试覆盖原始审计。

## 10. 共享队列与页面

### 10.1 邮件中心

提供固定视图：

- 待归属；
- 我的处理中；
- 团队处理中；
- 等待客户；
- 已完成；
- 发送失败；
- 全部可见邮件。

同一会话只有一名主负责人。领取和转交使用数据库条件更新，防止两人同时抢占。

### 10.2 客户详情

客户详情新增：

- 联系人；
- 询价；
- 商机；
- 邮件会话；
- 报价/技术资料/标书；
- 任务和审批；
- 统一时间线。

时间线只显示当前用户有权查看的记录，不得因为进入客户页而扩大商机或询价权限。

### 10.3 商机详情

- 显示完整邮件线程；
- 提供写信、回复、附件和报价版本选择；
- 显示负责人、协作人、等待状态和最后客户回复时间；
- 内部备注与客户邮件采用不同数据类型和明显不同界面。

## 11. 权限

- 管理员：配置连接、查看健康状态和审计；不自动获得商机业务发送权。
- 销售经理：查看受保护询价、分配客户和商机、指派会话。
- 商机销售负责人：处理所属商机邮件并按审批规则外发。
- 商务人员：只处理获授权商机的商务内容和报价文件。
- 技术人员：只处理获授权商机的技术内容；默认草稿权限。
- 普通销售：不得通过邮件中心查看其他销售的询价或未授权商机。
- 所有直接 URL、附件下载、列表、搜索和 POST 路由均执行服务层权限检查。

## 12. 安全与合规

- 新增独立的 32 字节 `MAIL_OAUTH_ENCRYPTION_KEY`；不得复用 session、TOTP 或
  恢复码密钥。
- AES-256-GCM 每次加密使用新的随机 nonce，并保存密钥版本以支持轮换。
- Google client secret、刷新令牌和访问令牌不得写入日志、错误页、发布包或备份报告。
- Pub/Sub push 使用受验证的 OIDC token、固定 audience、issuer 和 Google 项目身份。
- HTML 邮件默认保存但不直接渲染；V1 阅读界面继续优先显示安全纯文本。
- 远程图片默认阻止；附件沿用大小、类型、路径和权限校验。
- 邮件记录和原件没有普通用户永久删除入口。
- 删除/归档客户、询价或商机不得级联删除邮件历史。
- 生产备份必须包含数据库、附件、原始 `.eml` 和密钥版本元数据，并完成异机恢复测试。

## 13. 监控和故障恢复

必须监控：

- OAuth 连接状态与刷新失败；
- `watch` 到期时间；
- 最后成功同步时间和 history cursor；
- 待导入、导入失败、发送失败和重试数量；
- Gmail/API 限流；
- 邮件数量、附件数量和归档文件数量差异；
- Pub/Sub 回调签名失败和重复通知。

故障行为：

- BESTCRM 暂停时，Gmail 保留邮件；恢复后从 cursor 补同步；
- Gmail/API 暂停时，出站保留为 `pending/failed`，不得丢弃；
- OAuth 被撤销时立即关闭真实收发并通知管理员重新授权；
- 本地归档失败时不推进 cursor，重复处理由幂等键吸收；
- 一键关闭 `GOOGLE_MAIL_ENABLED` 后回到只读归档/原提供商回退路径。

## 14. 功能开关

新增并保持默认关闭：

- `GOOGLE_MAIL_ENABLED=false`
- `GOOGLE_MAIL_INBOUND_ENABLED=false`
- `GOOGLE_MAIL_OUTBOUND_ENABLED=false`
- `GOOGLE_MAIL_PUSH_ENABLED=false`

已有开关继续有效：

- `CRM_EMAIL_CENTER_ENABLED`
- `EMAIL_INTAKE_ENABLED`
- `CRM_EMAIL_SENDING_ENABLED`

生产启用顺序固定为：邮件中心只读 -> Google 连接健康 -> 入站 -> 试点发件 -> 全量发件。

## 15. 验收标准

V1 只有满足以下条件才可正式启用：

1. 没有员工共享 Gmail 密码。
2. OAuth token 加密、轮换、撤销和重新授权测试通过。
3. 同一 Gmail 消息重复通知或重复同步不会产生重复 CRM 消息/询价。
4. 明确回复 100% 回到原线程；无可靠证据的新邮件不自动写入旧商机。
5. 每封外发邮件可追溯实际员工、商机、审批版本、附件和投递尝试。
6. 非授权用户不能通过菜单、列表、搜索、直接 URL 或附件接口查看邮件。
7. Gmail、CRM 消息数、原始 `.eml` 和附件的抽样对账无缺失。
8. Pub/Sub 延迟/丢失、OAuth 失败、Gmail 限流和服务器重启恢复测试通过。
9. 数据库及归档文件从生产备份恢复到隔离环境并核对成功。
10. DNS 分流、SPF、DKIM、DMARC 和回退演练完成。
11. 管理员加两名销售试点至少七天，无丢信、重复发件或错误客户归属。
12. 所有邮件相关功能开关可在不重新部署代码的情况下关闭。

## 16. 实施步骤与确认门

- 第0步：冻结本设计、创建隔离分支、确认现状与边界。
- 第1步：提供商适配器、OAuth token 密码学服务和配置验证。
- 第2步：迁移 042，增加连接、Gmail identity、原始 `.eml` 和会话状态。
- 第3步：Google OAuth 管理员连接/撤销/健康检查流程。
- 第4步：Gmail API 入站增量同步、解析、原件归档和幂等。
- 第5步：客户候选、询价门、待归属队列、领取和转交。
- 第6步：Gmail API 发件、回复、附件、签名和版本绑定。
- 第7步：客户统一时间线及邮件中心/客户/商机页面。
- 第8步：Pub/Sub、watch 续期、补偿同步、监控和告警。
- 第9步：权限、安全、备份恢复和完整本地端到端验收。
- 第10步：新加坡暗部署，所有 Google 邮件开关保持关闭。
- 第11步：Google Workspace 管理配置、DNS 预配置和测试邮箱验证。
- 第12步：管理员加两名销售试点、分流切换、观察和正式启用。

每一步独立测试、提交并保留回退点。第10步之前不得修改生产；第11步不得启用真实
`sales@` 收发；第12步修改 DNS 和真实邮箱前必须再次获得明确确认。

## 17. 行业依据

- HubSpot Conversations Inbox 支持一个团队邮箱由多名成员查看、分配和回复。
- Salesforce Email-to-Case 使用公共路由地址把客户邮件转成可分配记录。
- Zendesk Support Address 使用统一对外地址创建并管理客户工单。
- Google Gmail API 提供 OAuth 2.0、message/thread/history 和 Pub/Sub 通知。

BESTCRM V1 采用相同的“共享通道、个人账号、业务归属、集中审计”原则，但以 SUNKAER
的询价、客户、联系人、商机、报价和技术资料为核心对象。

## 18. 冻结后的变更规则

- 不改变一个外部 `sales@sunkaier.com` 的 V1 边界；
- 不允许为了方便而恢复共享密码；
- 不降低现有询价和商机权限；
- 不允许新主题邮件仅凭地址或主题自动归入旧商机；
- 不允许绕过报价/技术文件审批；
- 任何需要新增邮箱、多品牌、AI 自动分类、营销群发或个人 Gmail 登录的需求进入 V2；
- 冻结规范如需修改，必须建立有编号的设计变更记录并由用户确认。
