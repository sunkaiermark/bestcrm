# BESTCRM 运维手册

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
scp .\scripts\backup-production.sh .\scripts\deploy-production.sh .\scripts\rollback-production.sh ubuntu@175.27.225.156:/tmp/
```

登录云服务器：

```powershell
ssh ubuntu@175.27.225.156
```

在云服务器执行：

```bash
sudo mkdir -p /opt/bestcrm/scripts
sudo cp /tmp/backup-production.sh /tmp/deploy-production.sh /tmp/rollback-production.sh /opt/bestcrm/scripts/
sudo chmod +x /opt/bestcrm/scripts/*.sh
```

## 6. 部署新版本

登录云服务器：

```powershell
ssh ubuntu@175.27.225.156
```

执行部署：

```bash
/opt/bestcrm/scripts/deploy-production.sh /opt/bestcrm/bestcrm-release.zip v2026.06.23-01
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

浏览器访问：

```text
http://175.27.225.156/login
```

## 7. 手工备份

每次上线前，部署脚本会自动备份。

如果需要单独手工备份：

```bash
/opt/bestcrm/scripts/backup-production.sh
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

