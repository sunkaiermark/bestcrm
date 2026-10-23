# 自建文档服务部署包

本目录包含 compose.yml、Nginx 反向代理示例及共享密钥生成脚本。尚未启动或安装任何服务。

1. 检查云端 Docker、内存与空间。官方最低要求4GB内存、40GB磁盘；与 CRM 共机需额外预留现有服务资源，避免占满。
2. 准备文档服务 HTTPS 域名及可信证书，例如 docs.example.com；不要直接使用示例域名。CRM 地址也必须可由容器访问且证书可信。
3. 在独立配置目录复制 compose.yml 和 prepare-office-service.sh。选择验证过的官方镜像固定版本或摘要，设置 OFFICE_DOCS_IMAGE、OFFICE_DOCUMENT_SERVER_URL、OFFICE_CRM_BASE_URL 三个变量，执行 `bash prepare-office-service.sh`。脚本只生成配置，不启动服务，不修改生产设置。
4. 用 `docker compose up -d` 启动文档服务。配置并检查 Nginx 示例中的实际域名和证书；运行 `nginx -t` 成功后再重载。8088仅监听本机，不占用 CRM 的3000端口。
5. 将生成的 bestcrm-office.env 作为 BESTCRM systemd 服务的额外 EnvironmentFile 引用；不要覆盖现有 EnvironmentFile。先备份，部署应用并执行131迁移，再重启 BESTCRM。
6. 检查文档服务 `/healthcheck`、CRM `/health`，用专用测试商机验证在线编辑、保存及历史下载；未修改和重复保存不得新增版本。未完成联调前不向所有用户开放。

回退：将 OFFICE_EDIT_ENABLED 设为 false 并重启 CRM，附件预览、原文件及已保存历史文件保留。不要删除 Docker 数据卷，也不回滚/删除业务附件或版本表。

官方安装说明：https://helpcenter.onlyoffice.com/docs/installation/docs-community-install-docker.aspx
