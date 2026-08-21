# BESTCRM 登录密码与短信二次认证

## 登录流程

1. 用户提交用户名和密码。
2. 系统验证 bcrypt 密码哈希，并应用现有的失败次数锁定规则。
3. 启用短信二次认证后，系统向用户资料中的手机号发送 6 位验证码；此时不会建立登录会话。
4. 验证码通过后，系统重新生成会话 ID 并完成登录。

验证码有效期默认 5 分钟，最多允许错误 5 次，60 秒后可重发。同一登录会话在冷却期内重复提交正确密码不会再次发送短信。验证码明文不会写入数据库或会话；服务端仅保存带密钥的 HMAC 摘要。密码失败和验证码失败共用登录锁定与审计机制。

## 腾讯云短信模板

登录验证码必须使用独立模板，不得复用关键事件通知模板。登录模板按顺序接受两个参数：

1. 6 位验证码。
2. 有效分钟数。

示例正文：`您的 BESTCRM 登录验证码为 {1}，{2} 分钟内有效。请勿向他人泄露。`

模板审核通过后，将模板 ID 写入 `TENCENT_SMS_LOGIN_TEMPLATE_ID`。

## 启用步骤

启用前先确认所有需要登录的激活用户都已在“系统管理 -> 用户”中维护有效手机号。中国大陆手机号可以使用 11 位号码，其他国家和地区使用 E.164 格式。

在生产环境文件中配置：

```dotenv
LOGIN_SMS_2FA_ENABLED=false
LOGIN_SMS_2FA_CODE_TTL_MINUTES=5
LOGIN_SMS_2FA_MAX_ATTEMPTS=5
LOGIN_SMS_2FA_RESEND_COOLDOWN_SECONDS=60
TENCENT_SMS_SECRET_ID=...
TENCENT_SMS_SECRET_KEY=...
TENCENT_SMS_REGION=ap-guangzhou
TENCENT_SMS_SDK_APP_ID=...
TENCENT_SMS_SIGN_NAME=...
TENCENT_SMS_LOGIN_TEMPLATE_ID=...
```

先保持 `LOGIN_SMS_2FA_ENABLED=false` 完成配置和用户手机号核对，再改为 `true` 并重启 BESTCRM。使用测试账号完成“密码 -> 短信验证码 -> 工作台”全流程后，才能视为启用成功。

如短信提供商异常导致用户无法登录，将 `LOGIN_SMS_2FA_ENABLED=false` 并重启服务即可回退到密码登录；不需要删除用户、修改密码或清理数据库。
