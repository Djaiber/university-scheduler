# ADR-0001: TypeScript para el producto, Python para la optimización

- Estado: aceptado · Fecha: 2026-08-27 · Issue: SCRUM-9

## Contexto
El producto (usuarios, estados, aprobaciones) y el problema combinatorio tienen ciclos de cambio,
herramientas y perfiles distintos. OR-Tools tiene su API más madura en Python.

## Decisión
- `apps/api` (NestJS) y `apps/web` (React) en TypeScript.
- `services/optimizer` y `services/validator` en Python 3.12+.
- Comunicación solo mediante contratos JSON versionados (`data/schemas`), nunca clases compartidas.

## Consecuencias
+ Cada lado evoluciona y se despliega por separado.
− Dos toolchains en CI; los contratos deben mantenerse con pruebas en ambos lados.
