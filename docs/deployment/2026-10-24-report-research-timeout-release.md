# v2026.10.24-03-rc.1 — Customer report research timeout

Customer research previously aborted after 90 seconds and exposed the runtime timeout message. Its default server deadline is now 180 seconds; LAB_ARK_RESEARCH_TIMEOUT_MS optionally accepts 90000 through 240000 milliseconds. Other AI analysis and speech deadlines are unchanged.

Both new-lead and saved-report clients allow 270 seconds, below the production Nginx read deadline confirmed as 300 seconds. User-facing progress no longer promises completion within 90 seconds. Timeout errors explain the cause in Chinese, retain existing report contents, and restore editing controls. No automatic retry or extra paid request is introduced.

Validation: 23 focused regression tests passed, covering provider timeout during connection and response-body reads, bounded configuration, source/product-fit handling, successful generation, and retained contents/control restoration after errors. Tests use synthetic requests; live paid research has not been performed locally.

Deployment is from v2026.10.24-02-rc.1 only. No migration or production environment, Nginx, AI key, Office or email configuration change is required. Create and verify a full backup before cutover, verify all historical migrations 124–133 remain present, and retain the current service and configuration checks.
