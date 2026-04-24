# Documentation Index

La documentación auxiliar del proyecto está agrupada en este directorio para dejar el root del repositorio enfocado en el challenge original.

## Documents

1. [executive-summary.md](executive-summary.md)
   Resumen corto de la solución implementada.

2. [technical-decisions.md](technical-decisions.md)
   Decisiones técnicas, alternativas evaluadas y trade-offs.

3. [deployment.md](deployment.md)
   Opciones de despliegue y pasos de operación.

4. [verification.md](verification.md)
   Checklist de validación local y end-to-end.

5. [implementation-notes.md](implementation-notes.md)
   Apuntes breves para recorrer la solución rápidamente.

6. [../README.md](../README.md)
   Enunciado original del challenge.

## Suggested Reading Order

1. [../README.md](../README.md)
2. [executive-summary.md](executive-summary.md)
3. [technical-decisions.md](technical-decisions.md)
4. [deployment.md](deployment.md)
5. [verification.md](verification.md)

## Repository Map

```text
colppy/
├── README.md
├── docs/
│   ├── index.md
│   ├── executive-summary.md
│   ├── technical-decisions.md
│   ├── deployment.md
│   ├── verification.md
│   └── implementation-notes.md
├── src/
├── __tests__/
├── scripts/
├── logs/
├── artifacts/
└── .github/workflows/
```

## Quick Checks

- Run `npm test` to validate application behavior.
- Run `npm run analyze-logs` to generate incident reports.
- Review `.github/workflows/ci.yml` for the CI/CD pipeline.
- Use [verification.md](verification.md) for the full validation checklist.
