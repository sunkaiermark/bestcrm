# BESTCRM 运维手册

> 重要：本手册中的 `175.27.225.156` 是南京旧环境资料，不能用于新加坡发布。
> 新加坡候选发布必须使用 `docs/deployment/2026-09-03-singapore-release-candidate.md`，
> 并在执行前实时核对 DNS、IP、SSH 用户、应用路径、服务、数据库和附件目录。

本文档用于控制 BESTCRM 正式使用后的更新、备份和回退，目标是避免系统在运行一段时间后失控。

## 1. 基本原则

1. 本地代码库是唯一开发源头：`C:\Users\Mark\Documents\BESTCRM`
2. 云服务器只运行正式版本，不直接改业务代码。
3. 每次上线前必须先备份数据库、附件和环境配置。
4. 每次上线必须有 Git commit 和版本号。
5. 默认只做代码回退；只有数据确实损坏时，才做数据库和附件完整恢复。

当前云服务器信息：

| 项目 | 值 |
| --- | --- |
| 服务器 IP | `175.27.225.156` |
| 系统 | Ubuntu Server 22.04 LTS |
| 应用目录 | `/opt/bestcrm/app` |
| 版本目录 | `/opt/bestcrm/releases` |
| 脚本目录 | `/opt/bestcrm/scripts` |
| 配置文件 | `/etc/bestcrm/bestcrm.env` |
| 附件目录 | `/var/bestcrm/uploads` |
| 备份目录 | `/var/backups/bestcrm` |
| 服务名 | `bestcrm` |

## 2. 版本命名

建议使用日期版本号：

```text
v2026.06.23-01
v2026.06.23-02
v2026.06.24-01
```

规则：

- 同一天第一次发布用 `-01`
- 同一天第二次发布用 `-02`
- 每次正式上线前都要记录版本号

## 3. 本地开发流程

在 Windows PowerShell 进入项目目录：

```powershell
cd C:\Users\Mark\Documents\BESTCRM
```

修改前先看工作区：

```powershell
git status
```

开发完成后运行测试：

```powershell
npm test
```

至少确认以下重点功能：

- 登录
- 商机列表
- 商机详情
- 附件上传
- 附件预览
- 附件下载
- 审批按钮

提交代码：

```powershell
git add .
git commit -m "简短说明本次修改"
```

打版本标签：

```powershell
git tag v2026.06.23-01
```

## 4. 制作生产包

推荐用 Git 生成生产包，避免把 `node_modules`、本地日志、临时文件打进去：

```powershell
git archive --format=zip -o bestcrm-release.zip HEAD
```

上传到云服务器：

```powershell
scp .\bestcrm-release.zip ubuntu@175.27.225.156:/opt/bestcrm/bestcrm-release.zip
```

## 5. 首次安装运维脚本

本步骤只需要在云服务器上配置一次。以后脚本有更新时，再重复执行。

在本地 PowerShell 上传脚本：

```powershell
scp .\scripts\backup-production.sh .\scripts\deploy-production.sh .\scripts\rollback-production.sh .\scripts\read-env-value.mjs ubuntu@175.27.225.156:/tmp/
```

登录云服务器：

```powershell
ssh ubuntu@175.27.225.156
```

在云服务器执行：

```bash
sudo mkdir -p /opt/bestcrm/scripts
sudo cp /tmp/backup-production.sh /tmp/deploy-production.sh /tmp/rollback-production.sh /tmp/read-env-value.mjs /opt/bestcrm/scripts/
sudo chmod +x /opt/bestcrm/scripts/*.sh
sudo chmod 755 /opt/bestcrm/scripts/read-env-value.mjs
```

## 6. 部署新版本

登录云服务器：

```powershell
ssh ubuntu@175.27.225.156
```

执行部署：

```bash
sudo -n /opt/bestcrm/scripts/deploy-production.sh /opt/bestcrm/bestcrm-release.zip v2026.06.23-01
```

这个脚本会自动做以下事情：

1. 先执行生产备份
2. 解压新版本到 `/opt/bestcrm/releases/<version>`
3. 安装生产依赖
4. 停止 `bestcrm` 服务
5. 切换 `/opt/bestcrm/app` 到新版本
6. 执行数据库迁移
7. 启动服务
8. 输出服务状态

部署后检查：

```bash
curl http://127.0.0.1:3000/health
sudo systemctl status bestcrm --no-pager
```

### Install the email intake worker

Install the managed worker only after the application release contains
`scripts/poll-email-inquiries.mjs`. The installer follows the main BESTCRM
service user and deliberately does not enable or start the worker. Like the
historical backfill unit, it uses `PrivateTmp=false` because `clamdscan
--fdpass` must pass restricted staging-file descriptors to the host ClamAV
daemon:

```bash
sudo -n /opt/bestcrm/app/scripts/install-email-intake-service.sh
```

Before activation, keep `EMAIL_INTAKE_ENABLED=false`, validate the NetEase
client authorization code with the read-only classification preview, and set
`EMAIL_INTAKE_MAX_MESSAGES` to no more than `50`. Enable and start
`bestcrm-email-intake.service` only after those checks pass. Historical mail is
imported separately with `npm run email:backfill`; ordinary incremental intake
must not be treated as a history migration.

For the shared mailbox plus personal mailboxes, copy
`docs/deployment/templates/email-intake-accounts.example.json` to
`/etc/bestcrm/email-intake-accounts.json`, replace every Sent-folder name, then
set `EMAIL_INTAKE_ACCOUNTS_FILE` to that absolute path. The approved default
omits `historicalSince`, which imports all history still retained by each mail
server and therefore begins at that mailbox's earliest available message.
Keep authorization codes only in the named variables in
`/etc/bestcrm/bestcrm.env`; do not put them in source control or chat. Install
the accounts file as `root:ubuntu` mode `0640`. The accounts file replaces the
single-mailbox source list, so it must retain `sales@sunkaier.com` as well as
the five personal mailboxes. Every personal address must already have one
active CRM user assignment or the worker stops before connecting.

With the production environment loaded, run `npm run email:accounts:verify`
before starting either worker. It logs in read-only and opens every configured
folder without fetching message bodies or changing read state. Then run
`npm run email:preview -- --limit=5` to review the inbound classification sample
for every configured account.

If the exact Sent folder is unknown, first run `npm run email:folders:list`.
This reads folder metadata only. Use the exact `path` whose `specialUse` is
`\\Sent`, update the account JSON, and then run the account verification.

Import only `INBOX` and the provider's exact Sent folder. Spam, Junk, Trash,
Deleted and their Chinese equivalents are rejected by configuration. Exact
Message-ID duplicates are represented once in the CRM conversation while an
immutable delivery record is retained for each mailbox and provider UID. A
high-confidence junk message is rejected before CRM archive creation;
suspected junk remains in the quarantine view for human review. Existing
contacts and replies to an existing CRM conversation are protected from the
automatic junk rejection rule.

Multi-mailbox intake always preserves provider read/unread state. Do not add
`"markSeen": true` to an account; the configuration rejects it. UID cursors,
not the Seen flag, control incremental deduplication.

Keep `historicalSince` omitted to import each mailbox from its earliest message
still retained by the provider. Add an account- or folder-level `YYYY-MM-DD`
value only when the business explicitly approves a later cutoff. Keep
`EMAIL_RAW_BACKFILL_ENABLED=false` until the Sent folder names, backup
integrity, free disk space, and a small classification sample are all verified.
Never enable historical backfill merely to start ordinary new-mail intake.

For a resumable historical import, install the separate backfill unit:

```bash
sudo -n /opt/bestcrm/app/scripts/install-email-backfill-service.sh
sudo -n systemctl enable --now bestcrm-email-backfill.service
```

The backfill unit uses a persisted IMAP history cursor, imports at most 50
messages per batch, waits for `EMAIL_INTAKE_POLL_INTERVAL_MS` between batches,
and resumes after a failure. It exits successfully when history is complete.
The incremental intake worker continues from its independent cursor. The
backfill unit deliberately uses `PrivateTmp=false` because `clamdscan --fdpass`
must pass each restricted staging-file descriptor to the host ClamAV daemon;
do not restore `PrivateTmp=true` without replacing and verifying that scanner
transport.

浏览器访问：

```text
http://175.27.225.156/login
```

## 7. 手工备份

每次上线前，部署脚本会自动备份。

如果需要单独手工备份：

```bash
sudo -n /opt/bestcrm/scripts/backup-production.sh
```

备份目录格式：

```text
/var/backups/bestcrm/20260623-153000/
  database.sql
  uploads.tar.gz
  bestcrm.env
  manifest.txt
```

查看已有备份：

```bash
ls -la /var/backups/bestcrm
```

## 8. 代码回退

如果只是新版本代码有问题，数据没有损坏，优先使用代码回退。

例如回到旧版本：

```bash
/opt/bestcrm/scripts/rollback-production.sh code v2026.06.23-01
```

代码回退不会恢复数据库，也不会恢复附件，所以不会丢失用户在系统里新录入的数据。

回退后检查：

```bash
curl http://127.0.0.1:3000/health
sudo systemctl status bestcrm --no-pager
```

## 9. 完整回退

只有以下情况才考虑完整回退：

- 数据库被错误迁移破坏
- 大量业务数据被误删
- 附件目录被破坏
- 代码回退后系统仍无法使用

完整回退会恢复数据库和附件，会丢失备份时间之后录入的新数据。执行前必须确认。

命令格式：

```bash
BESTCRM_CONFIRM_FULL_ROLLBACK=yes /opt/bestcrm/scripts/rollback-production.sh full 20260623-153000 v2026.06.23-01
```

含义：

- `20260623-153000` 是备份目录名
- `v2026.06.23-01` 是要回到的代码版本

## 10. 每日自动备份

建议在云服务器加 cron：

```bash
crontab -e
```

添加：

```cron
30 2 * * * /opt/bestcrm/scripts/backup-production.sh >> /var/backups/bestcrm/backup.log 2>&1
```

含义：每天凌晨 2:30 自动备份。

备份默认保留最近 7 个有完整备份的日期，并且每个日期只保留时间最新的一份完整备份；可通过 `BESTCRM_BACKUP_KEEP_DAYS` 显式覆盖保留日期数。仅名称符合 `YYYYMMDD-HHMMSS` 且包含 `manifest.txt` 的完整备份参与自动清理，手工恢复点不会被删除；当次备份未完成时会自动移除它自己的不完整目录。

## 11. 发布记录模板

每次上线建议记录：

```text
日期：
版本：
Git commit：
发布人：
备份目录：
变更内容：
验证结果：
是否回退：
备注：
```

示例：

```text
日期：2026-06-23
版本：v2026.06.23-01
Git commit：abc1234
发布人：Mark
备份目录：/var/backups/bestcrm/20260623-153000
变更内容：修复附件下载，新增运维脚本
验证结果：登录、商机详情、附件下载正常
是否回退：否
备注：无
```

## 12. 禁止事项

不要做：

- 不备份直接上线
- 直接在 `/opt/bestcrm/app` 修改代码
- 直接删除 `/var/bestcrm/uploads`
- 不记录版本号
- 不知道备份目录就执行完整回退
- 在生产环境随意执行 `npm run db:seed`

## 13. 常用检查命令

服务状态：

```bash
sudo systemctl status bestcrm --no-pager
```

应用健康检查：

```bash
curl http://127.0.0.1:3000/health
```

查看日志：

```bash
sudo journalctl -u bestcrm -n 100 --no-pager
```

重启服务：

```bash
sudo systemctl restart bestcrm
```

查看当前版本：

```bash
cat /opt/bestcrm/current-release.txt
```

查看版本目录：

```bash
ls -la /opt/bestcrm/releases
```
