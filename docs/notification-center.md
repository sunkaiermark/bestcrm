# BESTCRM 通知中心

## 通知链路

商机工作流动作写入 `workflow_events` 后，PostgreSQL 触发器自动完成以下工作：

1. 为 `target_user_id` 建立一条站内通知。
2. 普通事件建立 Web Push 和延迟邮件投递记录。
3. 合同提交、合同批准、合同退回、赢单和失败属于关键事件，额外建立短信投递记录。
4. 用户已经在延迟时间内阅读通知时，邮件兜底自动跳过。
5. 用户可以分别关闭页面实时提醒、Web Push、邮件和短信。

通知写入与工作流事件处于同一个数据库事务。工作流回滚时，不会留下通知或投递记录。

## 本地使用

```powershell
docker compose up -d postgres
npm.cmd run db:migrate
npm.cmd run notifications:generate-vapid
npm.cmd start
```

将生成的 VAPID 公钥和私钥放入本地 `.env`。不要提交真实密钥。

发送一次待处理通知：

```powershell
$env:NOTIFICATION_DELIVERY_ENABLED="true"
npm.cmd run notifications:deliver:once
```

持续运行投递 worker：

```powershell
$env:NOTIFICATION_DELIVERY_ENABLED="true"
npm.cmd run notifications:deliver
```

## 正式配置

所需环境变量见 `.env.example`。正式启用前必须满足以下条件：

- BESTCRM 使用域名和 HTTPS。Web Push 在普通 HTTP 公网 IP 上不可用。
- `WEB_PUSH_PUBLIC_KEY` 和 `WEB_PUSH_PRIVATE_KEY` 成对配置。
- SMTP 使用专用客户端授权码，不使用个人登录密码。
- 腾讯云短信已开通，签名和通知模板已经审核通过。
- 短信模板接受两个参数：事件标题和 BESTCRM 链接。
- 登录短信二次认证使用独立模板和 `TENCENT_SMS_LOGIN_TEMPLATE_ID`，不得复用本通知模板；启用流程见 `docs/login-security.md`。
- 用户资料中维护有效邮箱和手机号；中国大陆手机号可填写 11 位号码，其他号码使用 E.164 格式。
- 投递 worker 使用独立 systemd 服务持续运行，并使用与 BESTCRM 相同的代码版本和环境文件。

## 部署边界

通知功能部署仍执行 BESTCRM 的标准流程：本地测试、云端备份、上传 release、执行迁移、切换 release、验证主服务，再启动通知 worker。不得直接修改 `/opt/bestcrm/app`，不得把密钥写入 release，且不得为了通知功能改变现有上传目录权限。

## 商机审批通知矩阵

| 动作 | 操作人 | 通知接收人 |
| --- | --- | --- |
| 提交商机立项 | 销售代表 | 销售经理 |
| 批准立项并指派报价工程师 | 销售经理 | 销售代表、报价工程师 |
| 提交技术方案 | 报价工程师 | 技术经理 |
| 批准技术方案 | 技术经理 | 报价工程师、销售代表 |
| 提交商务报价 | 报价工程师 | 商务经理 |
| 批准商务报价 | 商务经理 | 销售代表 |

通知系统会自动跳过操作人本人和重复接收人。驳回、更换报价工程师、合同审批和赢单/输单等现有通知规则继续保留。
