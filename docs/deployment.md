# Deployment Guide

Este documento describe cómo desplegar la aplicación a diferentes plataformas.

## Opciones de Deployment

### 1. Railway.app (Recomendado para Staging)

**Ventajas:**
- Setup en 2 minutos
- GitHub integration automática
- Environment variables en UI
- Logs en tiempo real

**Pasos:**

```bash
# 1. Conectar repositorio en Railway
# - Ir a https://railway.app
# - Click "New Project" → "Deploy from GitHub"
# - Autorizar y seleccionar este repo

# 2. Configurar variables en Railway UI
APP_ENV=staging
PORT=3000

# 3. Railway detecta Dockerfile automáticamente
# 4. Deploy automático en cada push a develop

# 5. Verificar salud
curl https://your-app.railway.app/health
```

---

### 2. Render.com (Alternativa)

**Setup:**

```bash
# 1. Conectar en https://render.com
# 2. "New" → "Web Service" → "Connect Repository"
# 3. Configurar:
#    - Build Command: npm install
#    - Start Command: npm start
#    - Environment: APP_ENV=staging

# 4. Click Deploy
```

---

### 3. Fly.io (Para Production)

**Setup:**

```bash
# 1. Install Fly CLI
# curl -L https://fly.io/install.sh | sh

# 2. Login
# fly auth login

# 3. Launch
# fly launch --dockerfile Dockerfile

# 4. Deploy
# fly deploy
```

---

### 4. Docker Compose (Local/VPS)

**docker-compose.yml:**

```yaml
version: '3.8'
services:
  app:
    build: .
    ports:
      - "3001:3001"
    environment:
      - APP_ENV=production
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/health"]
      interval: 30s
      timeout: 3s
      retries: 3
      start_period: 40s
```

**Deploy:**

```bash
docker-compose up -d
docker-compose logs -f app
```

---

### 5. Kubernetes

**deployment.yaml:**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: dev-cicd-challenge
spec:
  replicas: 2
  selector:
    matchLabels:
      app: dev-cicd-challenge
  template:
    metadata:
      labels:
        app: dev-cicd-challenge
    spec:
      containers:
      - name: app
        image: ghcr.io/your-org/dev-cicd-challenge:latest
        ports:
        - containerPort: 3001
        env:
        - name: APP_ENV
          value: "production"
        livenessProbe:
          httpGet:
            path: /health
            port: 3001
          initialDelaySeconds: 40
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health
            port: 3001
          initialDelaySeconds: 5
          periodSeconds: 5
```

**Deploy:**

```bash
kubectl apply -f deployment.yaml
kubectl rollout status deployment/dev-cicd-challenge
```

---

## Health Check Verification

```bash
# Desarrollar localmente
APP_ENV=development npm start
curl http://localhost:3001/health

# Test en Docker
docker build -t app:test .
docker run -p 3001:3001 -e APP_ENV=test app:test
curl http://localhost:3001/health

# Expected response
# {"status":"ok","env":"test"}
```

---

## Rollback Procedure

### Manual Rollback

```bash
# Si deployment falla:

# 1. Identificar versión anterior buena
docker images | grep dev-cicd-challenge

# 2. Revert a versión anterior
docker run -p 3001:3001 -e APP_ENV=production app:v1.2.3

# 3. Verificar salud
curl http://localhost:3001/health

# 4. Update orchestration (K8s, Docker Compose, etc)
```

### Automático via GitHub Actions

El workflow en `.github/workflows/ci.yml` ejecuta rollback automático si:
- Health check falla post-deploy
- Status code ≠ 200

```yaml
- name: Rollback on failure
  if: failure()
  run: |
    echo "Rolling back to previous version..."
    # Deployment platform specific commands
```

---

## Environment Variables

| Variable | Required | Default | Ejemplo |
|----------|----------|---------|---------|
| APP_ENV | Yes | - | test, staging, production |
| PORT | No | 3001 | 3001 |
| NODE_ENV | No | production | development, production |

---

## Monitoring & Alerts

### Logs
```bash
# Railway
# CLI: railway logs -f

# Docker Compose
docker-compose logs -f app

# Kubernetes
kubectl logs -f deployment/dev-cicd-challenge
```

### Health Dashboard

```bash
# Simple monitoring script
while true; do
  STATUS=$(curl -s http://localhost:3001/health | jq .status)
  TIMESTAMP=$(date)
  echo "[$TIMESTAMP] Status: $STATUS"
  sleep 30
done
```

---

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| 500 on /health | APP_ENV missing | Set `export APP_ENV=production` |
| Port already in use | Process on 3001 | `lsof -i :3001` y kill |
| Container won't start | Missing dependencies | `npm install` en Dockerfile |
| Health check timeout | App not responding | Check logs: `docker logs <container>` |
| Deploy fails | Push rejected | Check GitHub Actions workflow |

---

## CI/CD Integration

El pipeline en `.github/workflows/ci.yml` maneja:

1. **Testing** (every push)
   - npm test
   - On fail → AI Resolver

2. **Build** (every push)
   - Docker build
   - Push to ghcr.io

3. **Deploy Staging** (develop branch)
   - Automático

4. **Deploy Production** (main branch)
   - Manual approval o automático (configurable)
   - Rollback automático si falla health check

---

## Best Practices

✅ **Do:**
- Always set APP_ENV explicitly
- Run health checks before declaring success
- Keep staging/prod environments separated
- Monitor logs continuously
- Test rollback procedure

❌ **Don't:**
- Hardcode credentials in code
- Deploy without health checks
- Use single replica in production
- Ignore warnings from AI Resolver
- Skip tests before deploy

---

**Last Updated**: 2026-04-24
