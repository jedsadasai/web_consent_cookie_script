# Deploying the release bundle

The bundle folder `consent-cookie-<version>/` contains:

- `consent-cookie-<version>.tar.gz`: the Docker image (Node 24.22.1, linux/amd64)
- `docker-compose.yml`: runs that image, no build or source needed
- `.env.example`: every variable, for reference
- `SHA256SUMS`: checksum of the image archive

## Steps on the server

The server needs Docker Engine with the Compose plugin. Keep the server's own `.env` in the same folder as `docker-compose.yml` (production values: see README "Production deploy").

```bash
# 1. From your machine
scp -r consent-cookie-<version> user@server:/opt/consent-cookie/

# 2. On the server
cd /opt/consent-cookie/consent-cookie-<version>
sha256sum -c SHA256SUMS
cp ../.env .env                                   # or wherever the server's .env lives
gunzip -c consent-cookie-<version>.tar.gz | docker load

# 3. Only when the release has new migrations (needs MIGRATE_DB_USER / MIGRATE_DB_PASSWORD in .env)
docker compose run --rm migrate

# 4. Start / replace the running app
docker compose up -d app
docker compose ps
curl -fsS http://localhost:8080/readyz
```

## Rollback

Old images stay loaded. Point at the previous tag and restart:

```bash
IMAGE_TAG=<previous-version> docker compose up -d app
```
