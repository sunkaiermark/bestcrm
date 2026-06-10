# BESTCRM Production Deployment Plan

This plan is for deploying BESTCRM to a public cloud server for company use.
It assumes one Linux server running Node.js, PostgreSQL, Nginx, and systemd.

## Deployment Goals

- Run BESTCRM on a public HTTPS domain.
- Keep PostgreSQL private and inaccessible from the public internet.
- Store uploaded CRM files in a persistent server directory.
- Support version rollback through Git tags.
- Back up database data and uploaded files every day.
- Avoid demo accounts in production.

## Recommended Architecture

```text
Internet
  |
  v
Nginx HTTPS :443
  |
  v
BESTCRM Node.js app :3000
  |
  +--> PostgreSQL on 127.0.0.1:5432
  |
  +--> /var/bestcrm/uploads
```

## Server Baseline

Recommended starting server:

- OS: Ubuntu LTS
- CPU: 2 cores minimum
- RAM: 4 GB minimum
- Disk: 80 GB minimum SSD
- Firewall: allow 22, 80, 443 only
- Database port 5432: local only, not public

## Production Directory Layout

```text
/opt/bestcrm/app              # Git checkout
/etc/bestcrm/bestcrm.env      # production environment variables
/var/bestcrm/uploads          # uploaded files
/var/backups/bestcrm          # database and upload backups
/var/log/bestcrm              # optional app logs
```

## Required Environment Variables

Create `/etc/bestcrm/bestcrm.env`:

```bash
NODE_ENV=production
PORT=3000
BASE_URL=https://crm.example.com
DATABASE_URL=postgres://bestcrm:REPLACE_WITH_STRONG_PASSWORD@127.0.0.1:5432/bestcrm
SESSION_SECRET=REPLACE_WITH_LONG_RANDOM_SECRET
UPLOAD_DIR=/var/bestcrm/uploads
MAX_UPLOAD_MB=25
```

Important:

- `NODE_ENV=production` is mandatory.
- `SESSION_SECRET` must be long, random, and never committed to Git.
- `DATABASE_URL` must use a strong database password.
- `UPLOAD_DIR` must be backed up.

## First Deployment Steps

1. Create a production release tag locally.

```bash
git tag v0.1.0-production-start
```

2. Install server dependencies.

```bash
sudo apt update
sudo apt install -y nginx postgresql git
```

Install Node.js LTS using the server team's preferred source, then verify:

```bash
node --version
npm --version
```

3. Create PostgreSQL database and user.

```bash
sudo -u postgres psql
```

```sql
CREATE USER bestcrm WITH PASSWORD 'REPLACE_WITH_STRONG_PASSWORD';
CREATE DATABASE bestcrm OWNER bestcrm;
\q
```

4. Create app directories.

```bash
sudo mkdir -p /opt/bestcrm /etc/bestcrm /var/bestcrm/uploads /var/backups/bestcrm
sudo chown -R $USER:$USER /opt/bestcrm /var/bestcrm /var/backups/bestcrm
```

5. Deploy code.

```bash
cd /opt/bestcrm
git clone <YOUR_REPOSITORY_URL> app
cd /opt/bestcrm/app
git checkout v0.1.0-production-start
npm ci --omit=dev
```

6. Run database migrations.

```bash
set -a
. /etc/bestcrm/bestcrm.env
set +a
npm run db:migrate
```

7. Seed production roles only.

```bash
BESTCRM_ALLOW_PRODUCTION_SEED=true npm run db:seed
```

This creates or updates system roles only. It does not create demo users.

8. Create the first real administrator.

Production currently needs a controlled admin creation step. Use a one-time script or SQL to create the real administrator, for example Yang Shenghua, with the `administrator` role. Do not enable demo accounts.

## systemd Service

Create `/etc/systemd/system/bestcrm.service`:

```ini
[Unit]
Description=BESTCRM
After=network.target postgresql.service

[Service]
Type=simple
WorkingDirectory=/opt/bestcrm/app
EnvironmentFile=/etc/bestcrm/bestcrm.env
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
User=www-data
Group=www-data

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo chown -R www-data:www-data /opt/bestcrm/app /var/bestcrm/uploads
sudo systemctl daemon-reload
sudo systemctl enable bestcrm
sudo systemctl start bestcrm
sudo systemctl status bestcrm
```

Health check:

```bash
curl http://127.0.0.1:3000/health
```

Expected response:

```json
{"ok":true,"app":"BESTCRM"}
```

## Nginx Reverse Proxy

Create `/etc/nginx/sites-available/bestcrm`:

```nginx
server {
    listen 80;
    server_name crm.example.com;

    client_max_body_size 25m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable it:

```bash
sudo ln -s /etc/nginx/sites-available/bestcrm /etc/nginx/sites-enabled/bestcrm
sudo nginx -t
sudo systemctl reload nginx
```

Add HTTPS certificate using your preferred certificate tool. After HTTPS is active, `BASE_URL` should be the HTTPS URL.

## Backup Plan

Create daily backups for both database and uploads.

Database backup:

```bash
pg_dump "$DATABASE_URL" > "/var/backups/bestcrm/bestcrm-$(date +%F).sql"
```

Uploaded files backup:

```bash
tar -czf "/var/backups/bestcrm/uploads-$(date +%F).tar.gz" /var/bestcrm/uploads
```

Minimum retention:

- Daily backups: 14 days
- Weekly backups: 8 weeks
- Monthly backups: 12 months

Backups should be copied off the server.

## Restore Plan

1. Stop the app.

```bash
sudo systemctl stop bestcrm
```

2. Restore database.

```bash
dropdb bestcrm
createdb bestcrm
psql "$DATABASE_URL" < /var/backups/bestcrm/bestcrm-YYYY-MM-DD.sql
```

3. Restore uploads.

```bash
sudo rm -rf /var/bestcrm/uploads
sudo mkdir -p /var/bestcrm/uploads
sudo tar -xzf /var/backups/bestcrm/uploads-YYYY-MM-DD.tar.gz -C /
sudo chown -R www-data:www-data /var/bestcrm/uploads
```

4. Start the app.

```bash
sudo systemctl start bestcrm
```

## Version Upgrade Procedure

1. Confirm working production version.

```bash
cd /opt/bestcrm/app
git status --short
git log --oneline -1
```

2. Back up database and uploads.

3. Pull or fetch the new version.

```bash
git fetch --tags
git checkout <NEW_VERSION_TAG>
npm ci --omit=dev
npm run db:migrate
sudo systemctl restart bestcrm
```

4. Verify:

```bash
curl http://127.0.0.1:3000/health
```

Then test login and a basic opportunity page in the browser.

## Rollback Procedure

Use this if the new version has a production problem.

```bash
cd /opt/bestcrm/app
git checkout <PREVIOUS_GOOD_TAG>
npm ci --omit=dev
sudo systemctl restart bestcrm
```

If the failed version changed the database and rollback needs old schema/data, restore from the pre-upgrade backup.

## Production Checklist

- [ ] Domain points to the server.
- [ ] HTTPS certificate is active.
- [ ] `NODE_ENV=production` is set.
- [ ] `SESSION_SECRET` is set and strong.
- [ ] PostgreSQL is not public.
- [ ] `npm run db:migrate` completed.
- [ ] Production roles seeded once.
- [ ] Real administrator account created.
- [ ] Demo accounts are not present.
- [ ] `/var/bestcrm/uploads` exists and is writable by the app user.
- [ ] Login works.
- [ ] File upload, preview, download work.
- [ ] Daily database backup works.
- [ ] Daily upload backup works.
- [ ] Rollback tag is recorded.

## Open Items Before Actual Deployment

These should be confirmed before executing deployment:

- Final domain name.
- Cloud server provider and operating system.
- Whether PostgreSQL will be local or managed.
- Exact first administrator username and temporary password.
- Backup destination outside the server.
- Whether Nginx or another reverse proxy will terminate HTTPS.
