/* Run with:  npm test   or   node --test   (Node 18 or newer, no packages to install) */
import { test } from 'node:test';
import cases from './cases.js';

for (const c of cases) test(`${c.group} › ${c.name}`, c.run);
