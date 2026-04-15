import { describe, expect, it } from 'vitest';
import {
	DEFAULT_PROMPT_PRESETS,
	merge_prompt_presets,
	normalize_prompt_presets,
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
