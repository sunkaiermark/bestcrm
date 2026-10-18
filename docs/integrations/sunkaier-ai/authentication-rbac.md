# 认证与权限

机器接口仅使用专用 HMAC，不使用浏览器 Session 或 CSRF。所有请求需提供 X-Sunkaier-Key-Id、X-Sunkaier-Timestamp、X-Sunkaier-Nonce、X-Sunkaier-Content-SHA256、X-Sunkaier-Signature。

签名原文为 METHOD、完整绝对路径（例如 /api/integrations/sunkaier-ai/v1/sources）、Unix 秒时间戳、nonce、正文 SHA256，以 LF 连接。签名及哈希使用小写十六进制。GET 使用空正文哈希。禁止查询字符串及内容压缩。服务器按常量时间比对签名，时间窗口正负 300 秒，nonce 持久化防重放。

SUNKAIER_AI_KEYS_JSON 从部署环境注入，值为对象数组，每项包含 id、clientId、secret；secret 至少 32 字符，不能写 Git、日志或文档。轮换时新旧 keyId 使用相同 clientId，保留来源访问权；不同 clientId 无权查询或追加另一方来源。keyId 不得在轮换后重复用于不同主体。每 keyId 十分钟最多 600 个未过期 nonce，超过返回 429。

## 人工权限

- 销售仅可见被分配给自己的来源。
- 销售经理和管理员可见来源工作区所有记录；沿用现有 Lead 经理全局可见规则，本次没有新增团队层级。
- 只有经理或管理员可分派、恢复删除、刷新和复核匹配候选。
- 转 Lead 调用现有 submitSalesLead，要求完整公司、联系人、邮箱、电话、需求及有效经理和销售人员；资料不足继续留在 AI Source。
- 关联商机同时校验既有商机可见性；销售还必须为该商机销售负责人。关联不创建商机或改审批。
- 运行审计仅管理员可读。管理员不因此获得原有销售审批权。

人工 POST 强制 CSRF；列表、详情和下载在路由与服务层校验来源可见性。业务来源回链仍受同一权限控制。新关联会将来源分配给对应销售负责人，经理保留管理可见权。

本机合成运行器仅绑定 127.0.0.1，使用随机本地账号与真实登录，未启用机器接入。它不能用于生产。
