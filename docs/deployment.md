# Deploying WithUnion Clinic to a VPS

This guide takes you from an empty Ubuntu server to the clinic system running on
`https://<your domain>`, with nightly encrypted backups. Follow it top to bottom
the first time. Every command is meant to be copied exactly; replace only the
values written in `<angle brackets>`.

**Where commands run.** Commands under **On your computer** run on your own
laptop. Commands under **On the server** run in an SSH session on the VPS.

---

## 1. The three words you need

- **Docker** runs programs in sealed boxes, so the server only needs Docker
  itself. Node.js, PostgreSQL and the web server all live inside the boxes,
  at exactly the versions this project was tested with.
- **An image** is a ready-made, read-only package of one program and
  everything it needs. This project builds three of them: the API, the
  migration tool, and Caddy with the website inside.
- **A container** is a running copy of an image. Stopping or deleting a
  container never deletes your data, because the data lives in named
  **volumes** that outlive containers.

### What runs on the server

| Container  | What it does | Reachable from |
|------------|--------------|----------------|
| `caddy`    | Serves the website, forwards `/api` to the API, gets and renews the HTTPS certificate from Let's Encrypt | the internet, ports 80 and 443 only |
| `api`      | The clinic API (Node.js) | `caddy` only |
| `postgres` | The database (PostgreSQL 18) | `api` and `migrate` only. Not the internet, not even the server itself |
| `migrate`  | Starts, applies any new database migrations, then exits | – |

Files involved: `docker-compose.prod.yml`, `server/Dockerfile.prod`,
`deploy/caddy/`, `deploy/backup/`, `.env.production.example`.

The older `docker-compose.yml` in the project root is the **development**
setup (a local PostgreSQL on port 5432, an API built from the old
`server/Dockerfile`, and an nginx example). **Do not use it on the server.**

---

## 2. Before you start

- A VPS running **Ubuntu 24.04 LTS** with at least **2 GB RAM** and 20 GB of
  disk. Building the images needs the memory.
- A domain name you control, e.g. `clinic.withunion.net`.
- **Where the data lives.** Patient data must stay in Ethiopia. That applies
  to the VPS itself as well as the backups, so choose the provider and data
  centre with that in mind.

---

## 3. Prepare the server (once)

### 3.1 SSH key login

**On your computer** (skip `ssh-keygen` if you already have a key):

```bash
ssh-keygen -t ed25519 -C "<your name> withunion-clinic"
ssh-copy-id root@<server IP>
ssh root@<server IP>
```

### 3.2 A normal user for daily work

**On the server**, as root:

```bash
adduser clinic                      # choose a strong password when asked
usermod -aG sudo clinic
rsync --archive --chown=clinic:clinic ~/.ssh /home/clinic
```

**On your computer**, open a *new* terminal and check that this works
**before** going further:

```bash
ssh clinic@<server IP>
sudo whoami                         # must print: root
```

### 3.3 Turn off password and root logins

**On the server** (as `clinic`):

```bash
printf 'PasswordAuthentication no\nPermitRootLogin no\n' | sudo tee /etc/ssh/sshd_config.d/99-withunion.conf
sudo sshd -t && sudo systemctl restart ssh
```

Keep your current session open, and check from a **new** terminal that
`ssh clinic@<server IP>` still works.

### 3.4 Firewall: only SSH, HTTP and HTTPS

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443          # TCP and UDP (UDP is HTTP/3)
sudo ufw enable
sudo ufw status
```

> Docker manages its own firewall rules. A port that a container
> *publishes* is open even if ufw does not list it. This setup publishes
> only 80 and 443. PostgreSQL and the API publish nothing, so they stay
> closed. Never add a `ports:` entry to `postgres` or `api`.

### 3.5 Automatic security updates

```bash
sudo apt update && sudo apt -y upgrade
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades     # answer "Yes"
```

### 3.6 Install Docker (from Docker's own repository)

```bash
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker clinic
```

Log out and back in (so the `docker` group applies), then check:

```bash
docker run --rm hello-world
docker compose version
```

### 3.7 Tools for backups

```bash
sudo apt install -y age rsync git
```

---

## 4. Point the domain at the server

At your domain registrar or DNS provider, create an **A record**:

| Type | Name | Value |
|------|------|-------|
| A | `clinic` (for `clinic.withunion.net`) or `@` for the bare domain | `<server IP>` |

Wait until it resolves to the server. **On your computer**:

```bash
nslookup <your domain>          # must show <server IP>
```

Do not start the stack before this works. Let's Encrypt checks the domain
during the first start.

---

## 5. Copy the project to the server

**On the server**:

```bash
sudo mkdir -p /opt/withunion-clinic
sudo chown clinic:clinic /opt/withunion-clinic
git clone <repository URL> /opt/withunion-clinic
cd /opt/withunion-clinic
chmod +x deploy/backup/*.sh
```

(Without git access on the server, copy the project from your computer with
`rsync -a --exclude node_modules --exclude .git --exclude '.env*' ./ clinic@<server IP>:/opt/withunion-clinic/`.)

---

## 6. Fill in the settings

```bash
cd /opt/withunion-clinic
cp .env.production.example .env.production
chmod 600 .env.production
openssl rand -hex 32     # copy the output -> POSTGRES_PASSWORD
openssl rand -hex 48     # copy the output -> SESSION_SECRET
nano .env.production
```

Fill in `DOMAIN`, `ACME_EMAIL`, `POSTGRES_PASSWORD`, `SESSION_SECRET` and the
`CLINIC_*` lines. Each setting is explained in the file. Save with
`Ctrl+O`, `Enter`, `Ctrl+X`.

- `.env.production` holds the keys to the system. It is git-ignored. Never
  commit it, e-mail it or paste it into a chat.
- The database password is stored inside the database at the very first
  start. Changing `POSTGRES_PASSWORD` later does **not** change it in the
  database (see section 12).

### A shortcut for the long commands

Every Docker command needs the same two file names. Add a shortcut once:

```bash
echo "alias dcp='docker compose --env-file /opt/withunion-clinic/.env.production -f /opt/withunion-clinic/docker-compose.prod.yml'" >> ~/.bashrc
source ~/.bashrc
```

From now on, `dcp` means "Docker Compose for the production clinic stack".

---

## 7. First start

```bash
cd /opt/withunion-clinic
APP_VERSION=$(git rev-parse --short HEAD) dcp up -d --build
```

The first build takes several minutes. Then check:

```bash
dcp ps                          # postgres, api: "healthy"; caddy: "Up"; migrate: "Exited (0)"
dcp logs migrate | tail -n 3    # "Migrations complete!"
dcp logs caddy | grep -i -E "certificate obtained|error"
curl https://<your domain>/health
# {"data":{"status":"ok","database":true},"error":null,"meta":null}
```

If the certificate fails, the usual causes are DNS not pointing at the server
yet (section 4) or ports 80/443 blocked by the provider's own firewall.

**Do not run `src/db/seed.ts` on the server.** It creates demo accounts with a
shared password, and it is left out of the production image on purpose.

---

## 8. Create the first owner account

```bash
dcp exec api node dist/scripts/createOwner.js
```

It asks for a username, the full name and a password (at least 12
characters, typed twice, not shown on screen). It refuses an existing
username. Then open `https://<your domain>` in a browser, sign in, and create
the staff accounts from **Users**.

---

## 9. Backups

### How they work

`deploy/backup/backup.sh` dumps the database inside the `postgres` container
and pipes it straight into **age** encryption. Only the encrypted file
(`withunion-clinic_YYYYmmdd-HHMMSS.dump.age`) is written to
**`/var/backups/withunion-clinic`** on the server. The newest **14** files
are kept and older ones are deleted. The file names use the server clock
(normally UTC).

age encrypts to a **public key**. The server holds only that public key, so
it can make backups but **cannot read them**. The matching **private key**
lives off the server, with the owner. Someone who breaks into the server
cannot open the backups, and losing the server does not lose the ability to
restore.

### 9.1 Make the backup key (once, on the owner's computer, NOT the server)

**On your computer** (install age first: `sudo apt install age` on
Ubuntu, `brew install age` on a Mac; on Windows download it from the
age project's GitHub releases page):

```bash
age-keygen -o withunion-backup-key.txt
```

It prints `Public key: age1...`. Then:

- Keep `withunion-backup-key.txt` safe: on the owner's computer **and** on a
  USB stick in a locked drawer. **Without it, no backup can ever be
  restored.**
- Copy the `age1...` public key line for the next step.

### 9.2 Set up backups on the server

```bash
sudo mkdir -p /etc/withunion-clinic /var/backups/withunion-clinic /var/log/withunion-clinic
sudo chown clinic:clinic /var/backups/withunion-clinic /var/log/withunion-clinic
echo "<the age1... public key>" | sudo tee /etc/withunion-clinic/backup-recipients.txt
sudo cp /opt/withunion-clinic/deploy/backup/backup.conf.example /etc/withunion-clinic/backup.conf
sudo nano /etc/withunion-clinic/backup.conf      # check APP_DIR, BACKUP_DIR, KEEP_BACKUPS
/opt/withunion-clinic/deploy/backup/backup.sh    # first backup by hand
ls -l /var/backups/withunion-clinic
```

### 9.3 Every night, automatically

```bash
crontab -e
```

Add the line from `deploy/backup/withunion-backup.cron.example`:

```
30 23 * * * /opt/withunion-clinic/deploy/backup/backup.sh >> /var/log/withunion-clinic/backup.log 2>&1
```

(23:30 server time, i.e. UTC, is 02:30 in Addis Ababa.) The next morning,
check with `tail /var/log/withunion-clinic/backup.log`.

### 9.4 A second copy elsewhere (strongly recommended)

A backup on the same server is lost with the server. Set
`OFFSITE_RSYNC_TARGET` in `/etc/withunion-clinic/backup.conf` to a machine
**you control inside Ethiopia** (for example a small computer at the clinic
reachable by SSH), e.g. `backup@192.0.2.10:/srv/withunion-backups/`. The files
are already encrypted, and that machine never needs the private key. **Do
not use foreign cloud storage.** Backups contain patient data and must stay
in Ethiopia.

### 9.5 Restore test (do this monthly)

A backup you have never restored is a hope, not a backup. The restore test
puts the backup into a **temporary, separate database** and never touches the
live one:

**On your computer**, copy the private key up temporarily:

```bash
scp withunion-backup-key.txt clinic@<server IP>:/tmp/
```

**On the server**:

```bash
ls /var/backups/withunion-clinic
/opt/withunion-clinic/deploy/backup/restore.sh --identity /tmp/withunion-backup-key.txt \
  /var/backups/withunion-clinic/<newest file>.dump.age
shred -u /tmp/withunion-backup-key.txt           # remove the private key again
```

It prints every table's row count next to the live database's count. The
counts match if nobody worked since the backup. It also checks the
backup's migration list against the project, ending with
`migration table matches the repository: OK`.

### 9.6 Restoring over the live database (emergencies only)

This **replaces all current data** with the backup. Use it only when the
live database is lost or damaged:

```bash
/opt/withunion-clinic/deploy/backup/restore.sh --identity /tmp/withunion-backup-key.txt \
  --into-live --yes-overwrite-live-database /var/backups/withunion-clinic/<file>.dump.age
```

It needs both flags and asks you to type the database name. It then takes a
safety backup (`withunion-clinic-prerestore_*.dump.age`), stops the API,
restores in one transaction (on any error nothing changes) and starts
everything again. Remove the private key afterwards
(`shred -u /tmp/withunion-backup-key.txt`).

---

## 10. Updating to a new version

```bash
cd /opt/withunion-clinic
/opt/withunion-clinic/deploy/backup/backup.sh        # 1. fresh backup first
git rev-parse --short HEAD                            # 2. note the CURRENT version, e.g. 62796df
git pull                                              # 3. get the new version
APP_VERSION=$(git rev-parse --short HEAD) dcp up -d --build   # 4. build and switch
dcp ps                                                # 5. all healthy?
curl https://<your domain>/health
```

New database migrations run automatically (the `migrate` container) before
the new API starts.

### Rolling back

The previous version's images are still on the server, tagged with the
version you noted in step 2:

```bash
cd /opt/withunion-clinic
git checkout <previous version, e.g. 62796df>
APP_VERSION=<previous version> dcp up -d --no-build
```

Migrations only go forward. If the new version added a migration and the
old version does not work with the changed database, restore the backup from
step 1 over the live database (section 9.6) after rolling back. Then go
back to the main branch with `git checkout main` before the next update.

Clean out old images now and then (keeps everything in use):
`docker image prune -a --filter "until=720h"`.

---

## 11. Everyday commands

```bash
dcp ps                        # what is running
dcp logs -f --tail 100 api    # API log (Ctrl+C to stop)
dcp logs --tail 100 caddy     # web server / certificate log
dcp restart api               # restart the API (sessions survive)
dcp down                      # stop everything (data stays in the volumes)
dcp up -d                     # start everything again
```

**Never run `dcp down -v`.** The `-v` deletes the database volume, which
means all clinic data.

---

## 12. Good to know

- **Time zone.** The database, the API and the reports run on Addis Ababa
  time (UTC+3), set in `docker-compose.prod.yml`. The server's own clock can
  stay on UTC.
- **Changing the database password** after the first start:
  ```bash
  openssl rand -hex 32                                  # the new password
  dcp exec postgres psql -U withunion -d withunion_clinic
  ```
  At the `withunion_clinic=#` prompt type
  `ALTER USER withunion PASSWORD '<new password>';` then `\q`. (Use your
  `POSTGRES_USER` and `POSTGRES_DB` if you changed them.) Then put the same
  password in `POSTGRES_PASSWORD` and restart:
  ```bash
  nano .env.production
  dcp up -d
  ```
- **Changing `SESSION_SECRET`** signs everyone out.
- **Certificates** renew automatically. They are kept in the `caddy_data`
  volume, so do not delete it, or Let's Encrypt may rate-limit new requests.
- **Logs** are rotated by Docker (5 × 10 MB per container).

---

## 13. Go-live checklist

- [ ] SSH works with a key as `clinic`. Password and root logins are off (3.3)
- [ ] `sudo ufw status` shows only OpenSSH, 80/tcp and 443 (3.4)
- [ ] Unattended upgrades are enabled (3.5)
- [ ] `nslookup <your domain>` shows the server IP (4)
- [ ] `.env.production` is filled in, has `chmod 600`, and is not in git (6)
- [ ] `dcp ps` shows postgres and api healthy, caddy up, migrate `Exited (0)` (7)
- [ ] `https://<your domain>` shows a valid padlock in the browser (7)
- [ ] The owner account was created with `createOwner.js`. No demo accounts exist (8)
- [ ] The backup private key is stored off the server in two places (9.1)
- [ ] A manual backup ran and a restore test passed (9.2, 9.5)
- [ ] The nightly cron job is installed and ran at least once (9.3)
- [ ] An off-site copy inside Ethiopia is configured, or that risk is accepted in writing (9.4)
- [ ] Staff accounts are created and each person has signed in once
- [ ] A test patient went through the whole visit (registration to receipt), and the test data was then cancelled or noted
