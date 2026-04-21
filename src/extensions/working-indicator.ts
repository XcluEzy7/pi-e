import type {
	ExtensionAPI,
	ExtensionContext,
	WorkingIndicatorOptions,
} from '@mariozechner/pi-coding-agent';
import {
	load_working_indicator_config,
	save_working_indicator_config,
	type WorkingIndicatorMode,
} from './working-indicator-config.js';

const COMMAND_MODES = [
	'dot',
	'none',
	'pulse',
	'spinner',
	'reset',
] as const;
const SPINNER_FRAMES = [
	'⠋',
	'⠙',
	'⠹',
	'⠸',
	'⠼',
	'⠴',
	'⠦',
	'⠧',
	'⠇',
	'⠏',
];

export function get_working_indicator(
	ctx: Pick<ExtensionContext, 'ui'>,
	mode: WorkingIndicatorMode,
): WorkingIndicatorOptions | undefined {
	switch (mode) {
		case 'dot':
			return {
				frames: [ctx.ui.theme.fg('accent', '●')],
			};
		case 'none':
			return { frames: [] };
		case 'pulse':
			return {
				frames: [
					ctx.ui.theme.fg('dim', '·'),
					ctx.ui.theme.fg('muted', '•'),
					ctx.ui.theme.fg('accent', '●'),
					ctx.ui.theme.fg('muted', '•'),
				],
				intervalMs: 120,
			};
		case 'spinner':
			return {
				frames: SPINNER_FRAMES.map((frame, index) =>
					ctx.ui.theme.fg(
						index % 2 === 0 ? 'accent' : 'muted',
						frame,
					),
				),
				intervalMs: 80,
			};
		case 'default':
			return undefined;
	}
}

export function describe_working_indicator_mode(
	mode: WorkingIndicatorMode,
): string {
	switch (mode) {
		case 'dot':
			return 'static dot';
		case 'none':
			return 'hidden';
		case 'pulse':
			return 'pulse';
		case 'spinner':
			return 'custom spinner';
		case 'default':
			return 'pi default spinner';
	}
}

export function parse_working_indicator_mode(
	input: string,
): WorkingIndicatorMode | null {
	const normalized = input.trim().toLowerCase();
	if (!normalized) return null;
	if (normalized === 'reset' || normalized === 'default') {
		return 'default';
	}
	if (
		normalized === 'dot' ||
		normalized === 'none' ||
		normalized === 'pulse' ||
		normalized === 'spinner'
	) {
		return normalized;
	}
	return null;
}

function apply_working_indicator(
	ctx: ExtensionContext,
	mode: WorkingIndicatorMode,
): void {
	ctx.ui.setWorkingIndicator(get_working_indicator(ctx, mode));
}

// Default export for Pi Package / additionalExtensionPaths loading
export default async function working_indicator(pi: ExtensionAPI) {
	let mode = load_working_indicator_config().mode;

	pi.on('session_start', async (_event, ctx) => {
		mode = load_working_indicator_config().mode;
		apply_working_indicator(ctx, mode);
	});

	pi.registerCommand('working-indicator', {
		description:
			'Set the streaming working indicator: dot, pulse, none, spinner, or reset',
		getArgumentCompletions: (prefix) => {
			const value = prefix.trim().toLowerCase();
			return COMMAND_MODES.filter((entry) =>
				entry.startsWith(value),
			).map((entry) => ({ value: entry, label: entry }));
		},
		handler: async (args, ctx) => {
			const next = parse_working_indicator_mode(args);
			if (next === null) {
				if (!args.trim()) {
					ctx.ui.notify(
						`Working indicator: ${describe_working_indicator_mode(mode)}`,
						'info',
					);
					return;
				}
				ctx.ui.notify(
					'Usage: /working-indicator [dot|pulse|none|spinner|reset]',
					'error',
				);
				return;
			}

			mode = next;
			save_working_indicator_config({ version: 1, mode });
			apply_working_indicator(ctx, mode);
			ctx.ui.notify(
				`Working indicator set to: ${describe_working_indicator_mode(mode)}`,
				'info',
			);
		},
	});
}
