# Backups and Restore Checks

`scripts/backup.sh` briefly stops the backend so the database and uploads cannot change between snapshots. It restarts the backend even if the backup fails. The script verifies both archives, writes SHA-256 checksums, and only then publishes the backup directory. Backups contain personal data; keep the directory private and never commit or serve it publicly.

## Local Windows Check

Run from the repository root in Git Bash while the Compose stack is healthy:

```bash
COMPOSE_PROJECT_NAME=oge-tutor-app-v2 BACKUP_DIR="$PWD/backups" bash scripts/backup.sh

bash scripts/verify-backup.sh "$PWD/backups/BACKUP_DIRECTORY"
```

Replace `BACKUP_DIRECTORY` with the directory printed by the backup command. Expect a short API interruption while the backend is stopped. The verification script checks the SHA-256 hashes, reads the uploads archive, and restores the database into a disposable PostgreSQL container with no network access or published port. It never restores into the running application database.

## Daily VPS Backup

The deployment checkout lives in `/opt/oge-tutor`. Create the backup directory and install a daily cron entry for the deployment user:

```bash
install -m 700 -d /opt/oge-tutor/backups
crontab -e
```

```cron
0 2 * * * cd /opt/oge-tutor && BACKUP_DIR=/opt/oge-tutor/backups bash scripts/backup.sh >> /opt/oge-tutor/backups/backup.log 2>&1
```

After the first scheduled run, inspect `backup.log` and run `bash scripts/verify-backup.sh /opt/oge-tutor/backups/BACKUP_DIRECTORY`. Repeat the restore check regularly, especially after changing PostgreSQL versions or the schema. Copy backups to a separate encrypted location; a copy on the same VPS does not protect against host loss. Monitor free space and apply a retention policy appropriate for the deployment. Do not delete the only verified backup.

For a real recovery, stop writes, preserve the failed database and uploads, and restore into a new environment first. Pointing `pg_restore` at the live database is deliberately not automated by these scripts.
