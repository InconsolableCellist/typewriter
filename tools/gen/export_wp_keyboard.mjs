#!/usr/bin/env node
// Dumps the word processor keyboard's size, slope, deck and key openings to tools/blender/wp_keyboard.json, the
// dimension source for tools/blender/build_wp_keyboard.py. Run after any change to src/machine/wp-keys.js or
// src/render/wp/keyboard-layout.js.
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import machine from '../../src/machine/wordproc1980.js';
import { KEYS } from '../../src/machine/wp-keys.js';
import { CASE, deckOrigin, keyRect, keyGroup, openings } from '../../src/render/wp/keyboard-layout.js';

const here = dirname(fileURLToPath(import.meta.url));
const { size, slope } = machine.units.keyboard;
const out = resolve(here, '../blender/wp_keyboard.json');
const keys = KEYS.map((k) => ({ pos: k.pos, row: k.row, group: keyGroup(k), ...keyRect(k) }));
writeFileSync(out, JSON.stringify({ size, slope, case: CASE, deck: deckOrigin(size, slope), openings: openings(), keys }, null, 1));
console.log(`wrote ${out}: ${keys.length} keys, openings ${Object.keys(openings()).join(', ')}`);
