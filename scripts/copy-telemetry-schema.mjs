import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const source = resolve('src/extensions/telemetry-schema.sql');
const target = resolve('dist/telemetry-schema.sql');

mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
