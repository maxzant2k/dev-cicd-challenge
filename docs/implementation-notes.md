# Implementation Notes

## Quick Technical Summary

- `__tests__/app.test.js` cubre el caso correcto y el caso degradado.
- `Dockerfile` usa multi-stage build y expone `3001`.
- `.github/workflows/ci.yml` ejecuta tests, build, staging, producción y rollback.
- `scripts/ai-resolver.js` genera reportes estructurados a partir de logs.
- Producción está integrada con Render y usa `/health` como endpoint de verificación.

## Useful Commands

```bash
npm test
npm run analyze-logs
docker build -t dev-cicd-challenge:latest .
docker run -p 3001:3001 -e APP_ENV=production dev-cicd-challenge:latest
```

## Main Decisions

### Tests

Se mantuvo `APP_ENV` como requisito del servicio y se corrigió la suite para reflejar ese contrato en vez de relajar la aplicación.

### Container image

Se eligió multi-stage build para reducir tamaño final y limitar lo que llega a runtime.

### Pipeline

Se usó GitHub Actions por cercanía al repositorio, trazabilidad y facilidad para almacenar artefactos del pipeline.

### Incident analysis

El analizador trabaja localmente sobre patrones conocidos y genera salidas Markdown y JSON para revisión manual o integración futura.

## Where To Look Next

- [technical-decisions.md](technical-decisions.md)
- [deployment.md](deployment.md)
- [verification.md](verification.md)
- [../README.md](../README.md)
