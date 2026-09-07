# BESTCRM 原始邮件归档与安全分类 V1 冻结设计

日期：2026-09-08  
状态：设计冻结候选；只允许本地实现和验证，未批准生产启用

## 1. 目标

把完整原始邮件作为不可替代的主数据。`Inquiries`、`Customers`、`Contacts`、
`Opportunities`、邮件线程、分类结果和统计都是可重建的派生数据。

本设计解决以下缺口：

- 当前生产通过 `sales@sunkaier.com` 的网易企业邮箱 IMAP `INBOX` 获取完整邮件，
  但完整 MIME/RFC822 字节仅在进程内短暂存在；
- PostgreSQL 保存了解析后的正文、HTML、安全邮件头和邮件身份，附件保存在
  `/var/bestcrm/uploads/email-archive`；
- `email_messages.raw_eml_*` 字段已经存在，但生产数据尚未使用；
- 当前应用没有独立病毒或恶意附件扫描器；
- 垃圾邮件分类与原件归档仍需彻底解耦。

## 2. 冻结原则

1. 先隔离归档完整原件，再扫描、解析和分类。
2. 原件是否保存不由规则、AI、人员判断或扫描结果决定。
3. “进入CRM归档”不等于“进入有效询价列表”。
4. 病毒扫描负责技术安全；规则和AI只提供业务分类建议；市场内勤作最终业务判断。
5. 原始邮件、扫描结果、分类结果和人工裁决均只追加，不覆盖历史。
6. 未知、冲突、扫描失败或分类失败默认进入待处理队列，不得静默删除。
7. 附件默认不发送给外部AI；原始HTML不得加载外部资源或直接执行。
8. 未完成备份恢复演练和生产对账前，不得删除源邮箱中的任何历史邮件。

## 3. 系统责任

| 层级 | 执行者 | 责任 |
| --- | --- | --- |
| 原件获取 | BESTCRM入站归档工作进程 | 从邮箱读取完整RFC822字节并建立幂等身份 |
| 不可变存储 | BESTCRM原件归档服务 | 原子写入、SHA-256、文件权限、数据库索引 |
| 技术安全 | 独立受限扫描工作进程 | ClamAV或兼容扫描器检查`.eml`和每个附件 |
| 初步分类 | BESTCRM确定性规则；可选AI建议 | 标注询价、系统通知、营销、垃圾和待确认 |
| 最终裁决 | 市场内勤/询价管理员 | 确认有效、恢复误判、确认垃圾或归档 |
| 策略管理 | 系统管理员 | 扫描器、规则版本、权限、监控、备份与恢复 |

AI不得替代安全扫描器，也不得独立创建客户、绑定旧商机或删除邮件。

## 4. 主数据和派生数据

```text
email_raw_messages（完整原件，主数据）
  -> email_raw_scan_attempts（安全扫描事件）
  -> email_messages（解析后的邮件）
  -> email_classification_events（规则/AI/人工分类事件）
  -> email_threads（会话投影）
  -> inquiries（询价投影）
  -> customers / contacts / opportunities（确认后的业务主档）
```

删除或重写CRM程序后，必须能够从 `email_raw_messages` 和原件文件重建邮件、询价及
其来源关系。客户、联系人和商机的人工确认结果属于独立业务主档，不得由重建过程猜测覆盖。

## 5. 数据库增量

### 5.1 `email_raw_messages`

新增独立原件索引表，至少包含：

- `id`；
- `mailbox_key`, `provider_name`, `provider_mailbox`；
- `provider_uid_validity`, `provider_uid`；
- `rfc_message_id_hint`；
- `source_received_at`, `first_observed_at`；
- `stored_path`, `file_size`, `sha256`；
- `created_at`。

约束：

- `(mailbox_key, provider_mailbox, provider_uid_validity, provider_uid)` 唯一；
- `stored_path` 唯一；
- `sha256` 为64位小写十六进制；
- 原件记录禁止更新和删除；
- 相同provider身份重复到达时必须验证SHA-256一致，否则记录严重完整性事件。

### 5.2 `email_messages`

- 新增 `raw_message_id NOT NULL REFERENCES email_raw_messages(id) ON DELETE RESTRICT`；
- 每个入站 `email_message` 只能对应一个原件；
- 现有 `raw_eml_stored_path/raw_eml_file_size/raw_eml_sha256/imported_at` 在兼容期同步填写，
  但 `email_raw_messages` 是唯一权威来源；
- 解析字段继续不可变。

### 5.3 `email_raw_scan_attempts`

只追加扫描事件：

- `raw_message_id`, `attempt_no`；
- `engine`, `engine_version`, `signature_version`；
- `verdict`: `clean`, `malware`, `suspicious`, `error`；
- `finding_code`, `safe_detail`；
- `started_at`, `completed_at`。

同一原件可以在病毒库升级后重新扫描，但不得覆盖旧结果。

### 5.4 `email_attachment_scan_attempts`

每个提取附件单独保存扫描事件。附件没有最新 `clean` 结果时：

- 普通用户不能预览或下载；
- 不能进入报价包或公共资料库；
- 只能由授权管理员查看安全状态，不能执行文件内容。

### 5.5 `email_classification_events`

记录确定性规则、可选AI建议和人工裁决：

- `message_id`, `thread_id`；
- `actor_type`: `rule`, `ai`, `human`；
- `actor_version` 或操作用户；
- `category`, `confidence`, `reason_codes`；
- `is_final`, `created_at`。

最终人工裁决不删除早期分类证据。当前 `classification_*` 字段仅作为最新状态投影。

## 6. 原件文件存储

生产默认根目录：

```text
/var/bestcrm/uploads/email-raw/
  <mailbox-key-hash>/
    <uid-validity>/
      <uid>-<sha256-prefix>.eml
```

要求：

- 不在路径中暴露邮箱地址或邮件主题；
- 同一文件系统内临时写入、`fsync`、原子重命名；
- 文件权限 `0600`，目录仅归档服务账户可进入；
- 禁止通过静态文件服务器访问；下载必须经过管理员权限和审计；
- 归档路径、大小与SHA-256必须同时成功写入数据库；
- 备份必须同时覆盖数据库、`email-raw`、`email-archive` 和校验清单。

## 7. 入站处理顺序

```text
IMAP读取完整source
  -> 尺寸和provider身份检查
  -> 隔离区原子保存.eml并计算SHA-256
  -> 插入不可变email_raw_messages
  -> 提交“原件已捕获”检查点
  -> 安全扫描.eml
  -> clean后解析正文/HTML/附件
  -> 附件逐个隔离保存并扫描
  -> 生成email_messages和email_threads
  -> 规则/AI给出分类建议
  -> 人工复核或进入正常询价工作流
```

IMAP同步检查点与解析/分类检查点必须分离。只要原件及其数据库索引已经持久化，即可推进
捕获检查点；扫描、解析和分类失败由独立队列重试。

## 8. 失败语义

- 原件写入失败：不得推进IMAP捕获检查点，重试读取。
- 数据库写入失败：保留隔离临时文件并由孤儿恢复任务核对，不能静默丢弃。
- 扫描器不可用：原件保留为 `scan_pending/error`，不解析、不展示附件，持续重试并告警。
- 检出恶意内容：原件永久隔离，附件禁止访问，线程进入安全隔离队列。
- 解析失败：原件仍完整，记录解析错误并允许升级解析器后重建。
- 分类失败：默认 `manual_review`，不得自动标记垃圾。
- 重复消息：验证provider身份和SHA-256后复用原件，不创建重复询价。
- SHA-256冲突：停止该邮箱后续推进并触发严重告警，禁止自动选择任一副本。

## 9. 垃圾邮件处理

- `Spam/Junk` 邮件也进入完整原件归档；
- 垃圾邮件保留在独立 `Spam Review` 队列，不出现在正常Inquiries；
- 垃圾邮件不能自动创建客户、联系人或商机；
- 人工可恢复误判，恢复动作进入分类事件和审计日志；
- 确认垃圾邮件可进入压缩冷归档，但V1不执行物理删除；
- 源邮箱文件夹名称必须先只读发现，不硬编码网易或其他提供商的本地化名称。

## 10. 历史回填

1. 只读枚举 `INBOX`、实际 `Spam/Junk`、`Sent` 及其他业务文件夹；
2. 先输出每个文件夹的消息数、UIDVALIDITY、UID范围和预计存储量；
3. 小批量保存原件并验证SHA-256，不修改现有询价和商机；
4. 用provider身份、RFC Message-ID和现有 `email_messages` 对账；
5. 只建立可靠的一对一链接，冲突进入人工处理清单；
6. 完成全量计数、随机抽样重新解析、附件数量和哈希核验；
7. 在隔离环境完成数据库加文件恢复演练；
8. 只有全部证据通过后，才可讨论源邮箱保留策略。

## 11. 验收标准

1. 新入站邮件在任何分类前均有完整 `.eml`、大小和SHA-256。
2. 重复IMAP同步不会生成重复原件、邮件、线程或询价。
3. 使用保存的 `.eml` 可重建相同Message-ID、正文、HTML、收发件人与附件哈希。
4. EICAR等安全测试样本被隔离，普通用户不能下载；原件不会被删除。
5. 扫描器停机、解析失败和分类失败均不会丢信。
6. 垃圾邮件不进入正常询价列表，但授权人员可追溯和恢复。
7. 原件、解析邮件、附件和源邮箱计数可对账，所有差异都有明确清单。
8. 生产备份在隔离环境恢复后，数据库与所有归档文件SHA-256一致。
9. 未授权用户不能通过菜单、URL、附件接口或文件路径读取邮件原件。
10. 完整测试、迁移回退、服务重启恢复和磁盘容量告警测试通过。

## 12. 实施与确认门

- 阶段0：冻结本设计并提交文档检查点；不改数据库、不部署。
- 阶段1：本地迁移、不可变约束、原件文件服务和假扫描器测试。
- 阶段2：本地IMAP捕获、真实ClamAV适配器、失败恢复与权限测试。
- 阶段3：历史邮箱只读盘点和回填预演；不写生产。
- 阶段4：构建生产部署包、数据库/文件备份与回滚演练；不启用入站。
- 阶段5：取得明确批准后暗部署，功能开关保持关闭。
- 阶段6：测试邮箱小批量试点并核验。
- 阶段7：再次批准后回填 `sales@sunkaier.com`，最后才切换实时入站。

每个阶段必须独立测试、提交和保留回退点。任何生产写入、安装扫描器、启用服务、历史
回填或邮箱文件夹操作都必须在对应确认门重新获得明确批准。
