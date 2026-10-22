# Database and Upload Backups

`scripts/backup.sh` backs up the bundled Compose PostgreSQL database and uploads volume as one snapshot. It briefly stops the backend, restarts it even after a failed snapshot, checks both archives, then restores the dump and uploads in an isolated container before marking the copy `VERIFIED`. A failed run is recorded and never silently replaces the latest successful record. The script refuses to back up a bundled database when the backend points to an external database.

Backups contain personal data. Keep them private, encrypted when copied offsite, and outside any public web root. A backup on the same VPS does not protect against host loss.

## Local Check

Run in Git Bash from the repository root with the Compose stack healthy. Use an external directory for durable copies; the default `backups/` is ignored by Git and deployment sync.

```bash
COMPOSE_PROJECT_NAME=oge-tutor-app-v2 BACKUP_DIR="$PWD/backups" bash scripts/backup.sh
BACKUP_DIR="$PWD/backups" bash scripts/check-backups.sh
```

Expect a short API interruption. `backup.sh` verifies the restore automatically. To repeat it for a specific snapshot:

```bash
bash scripts/verify-backup.sh "$PWD/backups/BACKUP_DIRECTORY"
```

`verify-backup.sh` never writes to the running database. It validates SHA-256 checksums, restores the dump into a disposable PostgreSQL container without networking, extracts the uploads archive, checks for application tables, and destroys the container.

## Daily VPS Timer

The project must be checked out on a Linux systemd host, with Docker Compose available to the deployment user. Preview the units first:

```bash
sudo bash scripts/install-backup-timer.sh --project /opt/oge-tutor --backup-dir /var/lib/oge-tutor/backups --user deploy --dry-run
```

After confirming paths, user, disk space, and Docker access, install and activate the daily 02:00 UTC timer:

```bash
sudo bash scripts/install-backup-timer.sh --project /opt/oge-tutor --backup-dir /var/lib/oge-tutor/backups --user deploy --enable
systemctl list-timers --all oge-tutor-backup.timer
```

Replace `deploy` with the actual deployment user. `--calendar` changes the schedule; `--keep` changes the number of verified copies retained (default 14). The timer is persistent, so a missed run starts when the host returns. Failed or damaged snapshots are preserved for diagnosis and never count toward retention. The install script does not activate anything unless `--enable` is passed.

After the first run, verify health and inspect the journal:

```bash
sudo systemctl start oge-tutor-backup.service
BACKUP_DIR=/var/lib/oge-tutor/backups bash scripts/check-backups.sh
sudo journalctl -u oge-tutor-backup.service -n 100 --no-pager
```

Run `check-backups.sh` from monitoring at least daily. It fails if the latest run failed, the latest verified copy is older than 26 hours, or its checksums no longer match. Adjust `BACKUP_MAX_AGE_SECONDS` if the schedule changes. Alert on a nonzero exit, a failed systemd unit, and low free space.

The default retention keeps 14 verified copies and 90 days of run records. Failed snapshots are intentionally not deleted automatically; monitor disk usage and investigate them before removal. Copy verified backups to a separate encrypted location with independent retention and periodically test a restore from that offsite copy.

For real recovery, stop writes, preserve the failed database and uploads, and restore into a new environment first. These scripts deliberately do not restore into the live database.
