# EXPORT_TO_WEBSERVER

Steg-for-steg migrering fra `aatracker.grendal.duckdns.org` til `frontline.grendal.duckdns.org` med trygg testflyt og rollback.

## 0. Målbilde

- Nytt domene: `frontline.grendal.duckdns.org`
- Test-root: `/var/www/test-frontline-companion/tracker`
- Prod-root: `/var/www/frontline-companion/tracker`
- Prod API: `127.0.0.1:8765`
- Test API: `127.0.0.1:8766`

Anbefaling: behold gammel side (`aatracker...`) aktiv i en overgangsperiode.

## 1. Engangsoppsett på Raspberry Pi

```bash
ssh gatekeeper@192.168.86.253

sudo mkdir -p /var/www/test-frontline-companion/tracker
sudo mkdir -p /var/www/frontline-companion/tracker
sudo chown -R gatekeeper:gatekeeper /var/www/test-frontline-companion /var/www/frontline-companion

mkdir -p /home/gatekeeper/aa-saves-test
```

## 2. Opprett test-nginx site (HTTP på 8081, kun LAN)

Lag fil:

```bash
sudo nano /etc/nginx/sites-available/frontline-companion-test
```

Innhold:

```nginx
server {
    listen 8081;
    listen [::]:8081;
    server_name _;

    root /var/www/test-frontline-companion/tracker;
    index index.html index.htm;

    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;

    location /api/ {
        proxy_pass http://127.0.0.1:8766/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 10s;
    }

    location ~* \.(py)$ { return 404; }
    location /saves/     { return 404; }

    location / {
        try_files $uri $uri/ =404;
    }

    location ~* \.csv$ {
        types { text/csv csv; }
        add_header Content-Type text/csv;
    }

    location ~* \.(css|js|jpg|jpeg|png|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1d;
        add_header Cache-Control "public";
    }
}
```

Aktiver:

```bash
sudo ln -sf /etc/nginx/sites-available/frontline-companion-test /etc/nginx/sites-enabled/frontline-companion-test
sudo nginx -t
sudo systemctl reload nginx
```

Hvis UFW er aktiv:

```bash
sudo ufw allow 8081/tcp
```

Test-URL: `http://192.168.86.253:8081`

## 3. Opprett systemd for test API (8766)

Lag fil:

```bash
sudo nano /etc/systemd/system/frontline-companion-api-test.service
```

Innhold:

```ini
[Unit]
Description=Frontline Companion Test Save API
After=network.target

[Service]
Type=simple
User=gatekeeper
WorkingDirectory=/var/www/test-frontline-companion/tracker
Environment=AA_SAVES_DIR=/home/gatekeeper/aa-saves-test
ExecStart=/usr/bin/python3 /var/www/test-frontline-companion/tracker/saves-api.py 8766
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Aktiver/start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable frontline-companion-api-test
sudo systemctl start frontline-companion-api-test
sudo systemctl status frontline-companion-api-test
```

## 4. Deploy testversjon fra Windows

Kjør fra prosjektroten (Git Bash/WSL):

```bash
rsync -avz --delete "data/" gatekeeper@192.168.86.253:/var/www/test-frontline-companion/tracker/
```

PowerShell alias (med WSL):

```powershell
function Deploy-FCTest {
    wsl rsync -avz --delete \
        "/mnt/c/Users/tgren/Documents/prosjekter/Axies and Allies/Frontline Companion/data/" \
        "gatekeeper@192.168.86.253:/var/www/test-frontline-companion/tracker/"
}
```

## 5. Verifisering (test)

```bash
# Fra egen maskin
curl http://192.168.86.253:8081/api/saves

# På Pi
sudo systemctl status frontline-companion-api-test
journalctl -u frontline-companion-api-test -n 50 --no-pager
sudo tail -n 100 /var/log/nginx/error.log
```

## 6. DNS + TLS for nytt domene

1. Oppdater DuckDNS slik at `frontline.grendal.duckdns.org` peker til din offentlige IP.
2. Legg til prod-site i nginx for nytt domene.

Lag fil:

```bash
sudo nano /etc/nginx/sites-available/frontline-companion
```

Midlertidig HTTP (for certbot webroot):

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name frontline.grendal.duckdns.org;

    root /var/www/frontline-companion/tracker;
    location /.well-known/acme-challenge/ { root /var/www/frontline-companion/tracker; }
    location / { return 301 https://$host$request_uri; }
}
```

Aktiver og reload:

```bash
sudo ln -sf /etc/nginx/sites-available/frontline-companion /etc/nginx/sites-enabled/frontline-companion
sudo nginx -t
sudo systemctl reload nginx
```

Kjør certbot:

```bash
sudo certbot certonly --webroot \
  -w /var/www/frontline-companion/tracker \
  -d frontline.grendal.duckdns.org
```

Bytt deretter `frontline-companion`-filen til full HTTPS-konfig:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name frontline.grendal.duckdns.org;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name frontline.grendal.duckdns.org;

    ssl_certificate /etc/letsencrypt/live/frontline.grendal.duckdns.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/frontline.grendal.duckdns.org/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;

    root /var/www/frontline-companion/tracker;
    index index.html index.htm;

    location /api/ {
        proxy_pass http://127.0.0.1:8765/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 10s;
    }

    location ~* \.(py)$ { return 404; }
    location /saves/     { return 404; }

    location / {
        try_files $uri $uri/ =404;
    }

    location ~* \.csv$ {
        types { text/csv csv; }
        add_header Content-Type text/csv;
    }

    location ~* \.(css|js|jpg|jpeg|png|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

Reload:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 7. Promote test -> production

Alternativ A (fra Windows direkte):

```bash
rsync -avz --delete "data/" gatekeeper@192.168.86.253:/var/www/frontline-companion/tracker/
```

Alternativ B (kopier på Pi):

```bash
ssh gatekeeper@192.168.86.253
rsync -av --delete /var/www/test-frontline-companion/tracker/ /var/www/frontline-companion/tracker/
```

## 8. Foreslaatt overgang uten nedetid

1. La `aatracker.grendal.duckdns.org` fortsette aa kjore som i dag.
2. Sett opp `frontline.grendal.duckdns.org` parallelt.
3. Test alt paa nytt domene.
4. Naer alt er verifisert: annonser nytt domene.
5. Etter 1-2 uker: legg redirect fra gammelt domene til nytt (valgfritt).

Eksempel redirect i gammel HTTPS-site:

```nginx
return 301 https://frontline.grendal.duckdns.org$request_uri;
```

## 9. Rollback

Hvis noe feiler etter bytte:

```bash
# Deaktiver nytt site midlertidig
sudo rm -f /etc/nginx/sites-enabled/frontline-companion
sudo nginx -t
sudo systemctl reload nginx

# Restart gammel API/site om nodvendig
sudo systemctl restart aatracker-api
```

## 10. Hurtigsjekk-liste

- [ ] Testsite svarer paa http://192.168.86.253:8081
- [ ] Test API svarer paa /api/saves
- [ ] frontlinedomene peker til riktig IP
- [ ] HTTPS-sertifikat er utstedt
- [ ] Ny prodside svarer paa https://frontline.grendal.duckdns.org
- [ ] Lagring fungerer (save/load/delete)
- [ ] Gammel side holdes oppe under overgang
