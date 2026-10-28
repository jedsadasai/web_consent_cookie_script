# Site: consent.rajthanee.com

| Item | Value |
|---|---|
| URL | https://consent.rajthanee.com |
| Image | `consent-cookie:1.2` (loaded from `~/consent/consent-cookie.tar`) |
| Container | `consent`, port `3001` (not published on the host) |
| Database | SQL Server `192.168.11.135:1433` |
| Certificate | RapidSSL wildcard `*.rajthanee.com`, valid until **7 Jan 2027** |
| App files | `~/docker-setup/apps/consent/` → deployed to `/opt/apps/consent/` |
| nginx site | `~/docker-setup/gateway/nginx/conf.d/consent.rajthanee.com.conf` → `/opt/gateway/nginx/conf.d/` |

## Request flow

```
Browser ──HTTPS 443──► router ──► VM ens33 (192.168.50.12)
   │  UFW + CrowdSec checks (DOCKER-USER chain)
   ▼
gateway-nginx  (172.30.0.10, port 8443 inside the container)
   │  TLS, security headers, rate limits, 64 KB body limit, dotfile block
   │  network: gateway-edge (private)
   ▼
consent  (port 3001)
   │
   ▼
SQL Server 192.168.11.135:1433
```

---

## 1. compose.yaml

`~/docker-setup/apps/consent/compose.yaml`

```yaml
name: consent

x-hardening: &hardening
  image: consent-cookie:1.2
  pull_policy: never
  init: true
  read_only: true
  tmpfs:
    - /tmp:size=16m,mode=1777
  cap_drop: [ALL]
  security_opt:
    - no-new-privileges:true
  env_file: .env

services:
  app:
    <<: *hardening
    # nginx reaches the app by this name: set $upstream http://consent:3001;
    container_name: consent
    # No host ports: reachable only through gateway-nginx on gateway-edge.
    networks: [gateway-edge]
    restart: unless-stopped
    deploy:
      resources:
        limits:
          cpus: "1.0"
          memory: 256M
          pids: 256
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "5"

networks:
  gateway-edge:
    external: true
```

| Setting | What it does / why |
|---|---|
| `name: consent` | Compose project name. Manage it with `sudo docker compose -f /opt/apps/consent/compose.yaml ...` |
| `x-hardening: &hardening` | A reusable block of settings. Any service that includes it (`<<: *hardening`) gets all of them, e.g. a future `migrate` service. |
| `image: consent-cookie:1.2` | The image to run. Change this tag to deploy a new version. |
| `pull_policy: never` | Use the local image only; never download from a registry. A same-named image on Docker Hub can never be pulled by mistake. |
| `init: true` | Runs a tiny init process as PID 1. It forwards stop signals so the app shuts down cleanly and cleans up finished child processes. |
| `read_only: true` | The container's filesystem is read-only. An attacker can't change the code or plant files. |
| `tmpfs /tmp 16m` | The only writable place: 16 MB in memory, wiped on restart. |
| `cap_drop: [ALL]` | Removes every Linux capability. |
| `no-new-privileges` | Blocks setuid programs, so a process can't become root. |
| `env_file: .env` | The app's settings. The deployed copy is `0600 root`. The admin/migration passwords are **not** in it (see below). |
| `container_name: consent` | The fixed name nginx uses (`http://consent:3001`). If this doesn't match the nginx config, you get **502**. |
| `networks: [gateway-edge]` | Only on the private gateway network. **There's no `ports:` section**, so the app is reachable only through nginx. |
| `restart: unless-stopped` | Restarts after a crash or reboot, unless you stopped it yourself. |
| `cpus: "1.0"` | At most 1 CPU core. |
| `memory: 256M` | Killed and restarted if it goes over 256 MB, so a memory leak can't take down the VM. |
| `pids: 256` | At most 256 processes, which stops a fork bomb. (Compose rejects `pids_limit` when this `deploy` section is present, so the limit goes here.) |
| `json-file`, 10 MB × 5 | Log size is capped at about 50 MB. |
| `external: true` | Uses the existing `gateway-edge` network created by the gateway. |

### Environment files (`~/docker-setup/apps/consent/`, all `0600`)

| File | Contents | Used by |
|---|---|---|
| `.env` | The app's settings: `NODE_ENV=production`, `PORT=3001`, `TRUST_PROXY=1`, DB app login (INSERT/SELECT only), etc. | The running app; the deploy script copies it to `/opt/apps/consent/.env` |
| `.env.migrate` | Full settings, including `MIGRATE_DB_USER`, `MIGRATE_DB_PASSWORD`, `MSSQL_SA_PASSWORD` | Only one-off migration runs; **never deployed** |
| `.env.bak.20261028-095833` | Backup of the original `.env` (contains the admin secrets) | Delete it once you're happy with the split |

Run migrations with a one-off container (replace `<migrate command>` with your image's migrate command):

```bash
sudo docker run --rm --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges:true --network gateway-edge --env-file ~/docker-setup/apps/consent/.env.migrate consent-cookie:1.2 <migrate command>
```

---

## 2. nginx site config

`~/docker-setup/gateway/nginx/conf.d/consent.rajthanee.com.conf`

```nginx
# consent (image consent-cookie:1.2, port 3001) -> https://consent.rajthanee.com
# Certificate: RapidSSL wildcard *.rajthanee.com in /opt/gateway/certs/rajthanee.com/

# Stricter per-IP limit for the consent API (POST /api/v1/consent writes to SQL Server).
# Many users behind one office NAT share an IP: raise rate/burst if they see 429s.
limit_req_zone $binary_remote_addr zone=consent_api:10m rate=5r/s;

server {
    listen 8443 ssl;
    http2 on;
    server_name consent.rajthanee.com;

    ssl_certificate     /etc/nginx/certs/rajthanee.com/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/rajthanee.com/privkey.pem;

    include /etc/nginx/snippets/security-headers.conf;

    limit_req  zone=perip burst=40 nodelay;
    limit_conn connperip 30;

    # Consent submissions are small JSON bodies; keep them in memory and reject
    # anything larger with 413 before it reaches the app.
    client_max_body_size    64k;
    client_body_buffer_size 64k;

    # Block dotfiles (.git, .env, ...) except .well-known.
    location ~ /\.(?!well-known/) {
        return 404;
    }

    location /api/ {
        # A location-level limit_req replaces the server-level one, so repeat it.
        limit_req zone=perip burst=40 nodelay;
        limit_req zone=consent_api burst=20 nodelay;

        set $upstream http://consent:3001;
        include /etc/nginx/snippets/proxy.conf;
        # The gateway already sends these (security-headers.conf).
        proxy_hide_header Referrer-Policy;
        proxy_hide_header Permissions-Policy;
        proxy_pass $upstream;
    }

    location / {
        # "localhost" inside the nginx container is nginx itself; use the app's
        # container name on the gateway-edge network.
        set $upstream http://consent:3001;
        include /etc/nginx/snippets/proxy.conf;
        # The gateway already sends these (security-headers.conf).
        proxy_hide_header Referrer-Policy;
        proxy_hide_header Permissions-Policy;
        proxy_pass $upstream;
    }
}
```

| Setting | What it does / why |
|---|---|
| `limit_req_zone ... consent_api ... 5r/s` | A separate rate-limit counter for the consent API: 5 requests/s per client IP. It's defined in this file, so it only affects this site. |
| `listen 8443 ssl` | nginx's HTTPS port inside the container. Docker maps host **443 → 8443**. nginx runs as a non-root user, so it can't use 443 directly. |
| `http2 on` | Enables HTTP/2. |
| `server_name` | Requests for any other hostname go to the catch-all server, which refuses the TLS connection. |
| `ssl_certificate` / `_key` | The `*.rajthanee.com` wildcard, shared with other subdomains. Renewing it once updates them all. The key is `0640 root:101`. |
| `security-headers.conf` | Adds HSTS (1 year), `nosniff`, `X-Frame-Options SAMEORIGIN`, Referrer-Policy and Permissions-Policy. |
| `limit_req zone=perip burst=40` | General limit: 20 requests/s per IP, bursts up to 40. Beyond that, **429**. |
| `limit_conn connperip 30` | At most 30 simultaneous connections per IP. |
| `client_max_body_size 64k` | Bodies over 64 KB get **413** from nginx and never reach the app. (Other sites allow 20 MB.) |
| `client_body_buffer_size 64k` | Allowed bodies stay in memory instead of being written to temporary files. |
| Dotfile block | `/.env`, `/.git/...` → 404 before the request reaches the app. `/.well-known/` is still allowed. |
| `location /api/` | The consent API (`POST /api/v1/consent`). Both limits apply here: the general 20/s and the stricter **5/s, burst 20**. The general limit is repeated because a `limit_req` inside a location replaces the server-level one. |
| `location /` | Everything else: `/consent.manifest.json` and the widget script `/v/<hash>/consent.js`. Only the general limit applies. |
| `set $upstream http://consent:3001` | Looks up the container through Docker's DNS **for each request**. If consent is down, only this site returns 502; nginx and the other sites keep running. |
| `proxy_hide_header Referrer-Policy / Permissions-Policy` | Strips the app's copies so each header is sent once (the gateway's version). |

### What the shared snippets add

**`snippets/proxy.conf`** (included in both locations):
- `Host`, `X-Real-IP`, `X-Forwarded-Proto: https`, `X-Forwarded-Host`.
- `X-Forwarded-For` is **replaced** with the real client IP, not appended to, so a client can't fake its IP. This works safely with `TRUST_PROXY=1` in `.env`.
- WebSocket upgrade support.
- Blocks the `Proxy` header, which defends against the "httpoxy" attack.
- Timeouts: connect 5s, send/read 60s.
- Strips `X-Powered-By`, `X-AspNet-Version`, and the app's own `X-Frame-Options`, `X-Content-Type-Options` and `Strict-Transport-Security`, so only the gateway's copies are sent.

**`nginx.conf`** (global settings):
- TLS 1.2 and 1.3 only, with post-quantum key exchange (`X25519MLKEM768`).
- `server_tokens off`, so the nginx version is hidden.
- Slow-client timeouts of 15–30s.
- Access log to stdout in the standard combined format, which CrowdSec reads.

**`00-default.conf`** (catch-all):
- `http://` → 301 redirect to `https://`.
- An unknown hostname or bare IP gets its TLS connection refused (no certificate is shown).

The app itself sends a strict `Content-Security-Policy` (`default-src 'none'; frame-ancestors 'none'`) and `Access-Control-Allow-Origin: *` for the public widget files, so the gateway adds neither.

---

## Verified (28 Oct 2026)

| Test | Result |
|---|---|
| `/healthz`, `/consent.manifest.json` | 200, HTTP/2, certificate verified |
| Headers on manifest and `/api/v1/consent` (GET and OPTIONS) | Referrer-Policy, Permissions-Policy and HSTS each appear **once** |
| `POST` 100 KB body to `/api/v1/consent` | **413** from nginx |
| `POST {}` | Reaches the app, which refuses it (403 `ORIGIN_NOT_ALLOWED`) |
| 40 rapid preflights to `/api/v1/consent` | 28 × 204, then **12 × 429** |
| 40 rapid requests to the manifest | 40 × 200 (normal limit) |
| Port 3001 on the host | Not open |
| `MIGRATE_DB_USER`, `MIGRATE_DB_PASSWORD`, `MSSQL_SA_PASSWORD` in the running container | Absent |

---

## Operations

Both changes deploy with `07-app-deploy.sh`. It copies `.env` and `compose.yaml` to `/opt/apps/consent/`, recreates the container, and waits until it's healthy. It then reloads the gateway, which tests nginx's config before applying it.

### Quick reference

| I want to… | Edit | Command |
|---|---|---|
| Change settings | `~/docker-setup/apps/consent/.env` | `sudo bash ~/docker-setup/07-app-deploy.sh consent` |
| Deploy a new version | `image:` in `compose.yaml` | `sudo bash ~/docker-setup/07-app-deploy.sh consent ~/consent/<new>.tar` |
| Roll back | `image:` back to the old tag | `sudo bash ~/docker-setup/07-app-deploy.sh consent` |
| Change the nginx config | `~/docker-setup/gateway/nginx/conf.d/consent.rajthanee.com.conf` | `sudo bash ~/docker-setup/06-gateway-deploy.sh` |
| Restart the app | none | `sudo docker compose -f /opt/apps/consent/compose.yaml restart` |

### A. Change environment variables (`.env`)

**1. Edit the source file.** Always edit the copy in your home folder. `/opt/apps/consent/.env` is overwritten on every deploy.

```bash
nano ~/docker-setup/apps/consent/.env
```

Rules:
- One `KEY=value` per line, with no spaces around `=`.
- **Don't** put `MIGRATE_DB_USER`, `MIGRATE_DB_PASSWORD` or `MSSQL_SA_PASSWORD` back. They belong only in `.env.migrate`.
- Leave `TRUST_PROXY=1`. A different value would let clients fake their IP.

**2. Keep the file private:**

```bash
chmod 600 ~/docker-setup/apps/consent/.env
```

**3. Deploy** (no `.tar`, so the image isn't reloaded). Docker sees the settings changed and recreates the container. Expect a few seconds of 502 while it restarts.

```bash
sudo bash ~/docker-setup/07-app-deploy.sh consent
```

**4. Check it:**

```bash
sudo docker logs --tail 30 consent
```

```bash
curl -s https://consent.rajthanee.com/healthz
```

**If you changed `POLICY_URL`:** the widget script's hash changes. Websites that embed the widget must use the new `url` and `integrity` values from:

```bash
curl -s https://consent.rajthanee.com/consent.manifest.json
```

### B. Upload and deploy a new image version

**1. Build and export on your development machine.** Use a **new version tag** each time (e.g. `1.3`), so the old version stays on the server for rollback. `--platform linux/amd64` matters if you build on an Apple Silicon Mac or an ARM machine; the server is x86_64.

```bash
docker build --platform linux/amd64 -t consent-cookie:1.3 .
```

```bash
docker save consent-cookie:1.3 -o consent-cookie-1.3.tar
```

**2. Upload to the server.** From your development machine (on Windows you can use WinSCP; put the file in `/home/rjhadmin/consent/`):

```bash
scp consent-cookie-1.3.tar rjhadmin@192.168.50.12:~/consent/
```

Optional: confirm the file arrived intact by running this on both machines and comparing the hashes:

```bash
sha256sum consent-cookie-1.3.tar
```

**3. Check what's inside the tar.** On the server:

```bash
tar -xOf ~/consent/consent-cookie-1.3.tar repositories
```

You should see `{"consent-cookie":{"1.3":...}}`. That name and tag must match `image:` in the next step.

**4. Update the image tag in `compose.yaml`:**

```bash
nano ~/docker-setup/apps/consent/compose.yaml
```

```yaml
  image: consent-cookie:1.3
```

**5. Run database migrations, if this version needs them.** Do this **before** deploying, with the migration-only settings. Replace `<migrate command>` with your app's migrate command.

```bash
sudo docker load -i ~/consent/consent-cookie-1.3.tar
```

```bash
sudo docker run --rm --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges:true --network gateway-edge --env-file ~/docker-setup/apps/consent/.env.migrate consent-cookie:1.3 <migrate command>
```

**6. Deploy:**

```bash
sudo bash ~/docker-setup/07-app-deploy.sh consent ~/consent/consent-cookie-1.3.tar
```

The script refuses a file that isn't a Docker image. If the tag in `compose.yaml` doesn't match the tar, it stops with "Image consent-cookie:1.3 not found". In both cases nothing changes and the old version keeps running.

**7. Check it:**

```bash
sudo docker ps --filter name=consent
```

```bash
sudo docker logs --tail 30 consent
```

```bash
curl -s https://consent.rajthanee.com/consent.manifest.json
```

If the widget script changed, the manifest shows a new `hash` and `integrity`. Update the websites that embed it.

### C. Roll back to the previous version

The old image is still loaded, so set `image: consent-cookie:1.2` back in `compose.yaml`, then:

```bash
sudo bash ~/docker-setup/07-app-deploy.sh consent
```

If the new version ran database migrations, check that the old version still works with the migrated database before relying on a rollback.

### D. Clean up old images

Keep the current version and the one before it. You can also delete the matching old `.tar` files from `~/consent/`.

```bash
sudo docker image ls consent-cookie
```

```bash
sudo docker image rm consent-cookie:1.1
```

### E. Logs

All need `sudo`. The gateway's request log is shared by all sites and doesn't record the hostname, so filter by consent's paths (`/api/`, `/consent.manifest.json`, `/v/`). Timestamps are in **UTC** (Thailand is UTC+7); `--since 1h` avoids the conversion.

App log, live:

```bash
sudo docker logs -f consent
```

App errors and warnings in the last 24 hours:

```bash
sudo docker logs --since 24h consent 2>&1 | grep -iE 'error|warn|fail|exception'
```

Consent requests through the gateway, live:

```bash
sudo docker logs -f gateway-nginx 2>&1 | grep --line-buffered -E '"[A-Z]+ /(api/|consent\.manifest\.json|v/)'
```

Problem responses (413, 429, 5xx) in the last 24 hours:

```bash
sudo docker logs --since 24h gateway-nginx 2>&1 | grep -E '"[A-Z]+ /(api/|consent\.manifest\.json|v/)' | grep -E '" (413|429|5[0-9][0-9]) '
```

Responses by status code:

```bash
sudo docker logs --since 24h gateway-nginx 2>&1 | grep -E '"[A-Z]+ /(api/|consent\.manifest\.json|v/)' | awk '{print $9}' | sort | uniq -c | sort -rn
```

Top client IPs calling the API:

```bash
sudo docker logs --since 24h gateway-nginx 2>&1 | grep '/api/v1/consent' | awk '{print $1}' | sort | uniq -c | sort -rn | head -20
```

nginx errors for this site (rate-limit hits, app down or slow):

```bash
sudo docker logs --since 24h gateway-nginx 2>&1 | grep 'consent.rajthanee.com' | grep -E '\[(error|warn)\]'
```

Health, resource use, restarts and whether it was killed for running out of memory:

```bash
sudo docker inspect --format '{{json .State.Health}}' consent
```

```bash
sudo docker stats --no-stream consent
```

```bash
sudo docker inspect --format 'restarts={{.RestartCount}} oom_killed={{.State.OOMKilled}} started={{.State.StartedAt}}' consent
```

CrowdSec alerts, current bans, and unbanning an IP:

```bash
sudo cscli alerts list
```

```bash
sudo cscli decisions list
```

```bash
sudo cscli decisions delete --ip <ip>
```

Logs keep about 50 MB for the app and 30 MB for the gateway, then the oldest lines are deleted. Recreating a container (e.g. on redeploy) clears its logs.

### Tuning

- **Users behind one office network get 429:** many people sharing one public IP count as one client. Raise `rate=5r/s` or `burst=20` in the site config, then redeploy the gateway.
- **Legitimate submissions get 413:** raise `client_max_body_size` (and `client_body_buffer_size`) in the site config.

## Open items

- `DB_TRUST_SERVER_CERT=true`: the database connection is encrypted, but the app doesn't check SQL Server's certificate. Install a trusted certificate on SQL Server (192.168.11.135), then set this to `false` and redeploy the app.
- Delete `.env.bak.20261028-095833` once you've confirmed the app runs without the admin passwords. It still contains them.
