// Genera tipos TypeScript desde data/schemas/*.v1.json (fuente de verdad de los contratos)
import { compileFromFile } from 'json-schema-to-typescript';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const schemas = path.resolve(here, '../../../data/schemas');
const out = path.resolve(here, '../src/generated');
const files = { 'problem.v1.json': 'problem.ts', 'job-message.v1.json': 'job-message.ts', 'result.v1.json': 'result.ts' };

for (const [schema, target] of Object.entries(files)) {
  const ts = await compileFromFile(path.join(schemas, schema), {
    cwd: schemas,
    bannerComment: `/* Generado desde data/schemas/${schema}. No editar a mano: npm run generate */`,
    additionalProperties: false,
    style: { singleQuote: true },
  });
  await writeFile(path.join(out, target), ts);
  console.log(`✓ ${target}`);
}
