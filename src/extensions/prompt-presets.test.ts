import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	DEFAULT_PROMPT_PRESETS,
	merge_prompt_presets,
	normalize_prompt_presets,
	remove_project_prompt_preset,
	save_project_prompt_presets,
} from './prompt-presets.js';

describe('normalize_prompt_presets', () => {
	it('accepts string shorthand instructions', () => {
		expect(normalize_prompt_presets({ terse: 'Be brief.' })).toEqual({
			terse: { kind: 'base', instructions: 'Be brief.' },
		});
	});

	it('keeps valid object presets and skips invalid entries', () => {
		expect(
			normalize_prompt_presets({
				good: {
					description: 'Useful',
					instructions: 'Do the thing.',
				},
				layered: {
					kind: 'layer',
					instructions: 'Layer it on.',
				},
				bad: { description: 'Missing instructions' },
				nope: 42,
			}),
		).toEqual({
			good: {
				description: 'Useful',
				instructions: 'Do the thing.',
			},
			layered: {
				kind: 'layer',
				instructions: 'Layer it on.',
			},
		});
	});
});

describe('merge_prompt_presets', () => {
	it('lets later sources override earlier ones', () => {
		const merged = merge_prompt_presets(DEFAULT_PROMPT_PRESETS, {
			terse: {
				description: 'Project terse',
				instructions: 'Project override.',
			},
			custom: {
				instructions: 'Custom preset.',
			},
		});

		expect(merged.terse).toEqual({
			description: 'Project terse',
			instructions: 'Project override.',
		});
		expect(merged.custom).toEqual({
			instructions: 'Custom preset.',
		});
		expect(merged.standard).toEqual(DEFAULT_PROMPT_PRESETS.standard);
	});
});

describe('project preset persistence', () => {
	const dirs: string[] = [];
	afterEach(() => {
		for (const dir of dirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('removes a preset from the project file', () => {
		const cwd = mkdtempSync(join(tmpdir(), 'my-pi-presets-'));
		dirs.push(cwd);

		save_project_prompt_presets(cwd, {
			alpha: { instructions: 'A' },
			beta: { kind: 'layer', instructions: 'B' },
		});

		const result = remove_project_prompt_preset(cwd, 'alpha');
		expect(result.removed).toBe(true);
		expect(result.remaining).toBe(1);

		const saved = JSON.parse(
			readFileSync(join(cwd, '.pi', 'presets.json'), 'utf-8'),
		);
		expect(saved).toEqual({
			beta: { kind: 'layer', instructions: 'B' },
		});
	});

	it('deletes the file when the last preset is removed', () => {
		const cwd = mkdtempSync(join(tmpdir(), 'my-pi-presets-'));
		dirs.push(cwd);

		save_project_prompt_presets(cwd, {
			only: { instructions: 'A' },
		});

		const result = remove_project_prompt_preset(cwd, 'only');
		expect(result.removed).toBe(true);
		expect(result.remaining).toBe(0);
		expect(existsSync(join(cwd, '.pi', 'presets.json'))).toBe(false);
	});
});
