import {
	getAgentDir,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
} from '@mariozechner/pi-coding-agent';
import {
	Container,
	SettingsList,
	Text,
	type SettingItem,
} from '@mariozechner/pi-tui';
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

export type PromptPresetKind = 'base' | 'layer';
export type PromptPresetSource = 'builtin' | 'user' | 'project';

export interface PromptPreset {
	kind?: PromptPresetKind;
	description?: string;
	instructions: string;
}

export type PromptPresetMap = Record<string, PromptPreset>;

export interface LoadedPromptPreset extends PromptPreset {
	name: string;
	kind: PromptPresetKind;
	source: PromptPresetSource;
}

interface PromptPresetState {
	base_name: string | null;
	layer_names: string[];
}

const PRESET_STATE_TYPE = 'prompt-preset-state';
const ENABLED = '[x]';
const DISABLED = '[ ]';
const SELECTED = '(x)';
const UNSELECTED = '( )';
const NONE_BASE_ID = '__base_none__';

export const DEFAULT_PROMPT_PRESETS: PromptPresetMap = {
	terse: {
		kind: 'base',
		description: 'Short, direct, no fluff',
		instructions:
			"Be concise and direct. Default to the shortest response that fully solves the user's request. No purple prose, no filler, no repetitive caveats. Prefer a short paragraph or a few bullets. Only include extra detail when it materially affects the decision, implementation, or next step.",
	},
	standard: {
		kind: 'base',
		description: 'Clear and concise with key context',
		instructions:
			'Be clear, direct, and concise. Include only the reasoning and implementation details that matter. Avoid filler, grandstanding, and ornamental language. Use bullets when they improve scanability.',
	},
	detailed: {
		kind: 'base',
		description: 'More explanation when nuance matters',
		instructions:
			'Be thorough when the task is complex or tradeoffs matter, but stay practical. Explain only the details that help the user decide, verify, or implement. Avoid purple prose and unnecessary scene-setting.',
	},
	'no-purple-prose': {
		kind: 'layer',
		description: 'Strip out ornamental language',
		instructions:
			'Do not use purple prose, flourish, motivational filler, or theatrical transitions. Prefer plain language and concrete statements.',
	},
	bullets: {
		kind: 'layer',
		description: 'Prefer short bullets when useful',
		instructions:
			'When presenting options, findings, or steps, prefer short bullet lists over long paragraphs.',
	},
	'clarify-first': {
		kind: 'layer',
		description:
			'Ask brief clarifying questions when requirements are ambiguous',
		instructions:
			'If the request is materially ambiguous, ask the minimum clarifying question(s) needed before proceeding. Do not ask unnecessary questions.',
	},
	'include-risks': {
		kind: 'layer',
		description: 'Call out notable risks or tradeoffs',
		instructions:
			'When making a recommendation or implementation plan, briefly mention the key risk, tradeoff, or caveat if one materially matters.',
	},
};

export function normalize_prompt_presets(
	input: unknown,
): PromptPresetMap {
	if (!input || typeof input !== 'object') return {};

	const normalized: PromptPresetMap = {};
	for (const [raw_name, raw_value] of Object.entries(input)) {
		const name = raw_name.trim();
		if (!name) continue;

		if (typeof raw_value === 'string') {
			normalized[name] = {
				kind: 'base',
				instructions: raw_value,
			};
			continue;
		}

		if (!raw_value || typeof raw_value !== 'object') continue;
		const candidate = raw_value as {
			kind?: unknown;
			description?: unknown;
			instructions?: unknown;
		};
		if (typeof candidate.instructions !== 'string') continue;

		normalized[name] = {
			instructions: candidate.instructions,
			...(candidate.kind === 'layer'
				? { kind: 'layer' as const }
				: {}),
			...(typeof candidate.description === 'string'
				? { description: candidate.description }
				: {}),
		};
	}

	return normalized;
}

export function merge_prompt_presets(
	...sources: PromptPresetMap[]
): PromptPresetMap {
	return Object.assign({}, ...sources);
}

function to_loaded_prompt_presets(
	presets: PromptPresetMap,
	source: PromptPresetSource,
): Record<string, LoadedPromptPreset> {
	return Object.fromEntries(
		Object.entries(presets).map(([name, preset]) => [
			name,
			{
				name,
				kind: preset.kind === 'layer' ? 'layer' : 'base',
				source,
				...preset,
			},
		]),
	);
}

function get_global_presets_path(): string {
	return join(getAgentDir(), 'presets.json');
}

function get_project_presets_path(cwd: string): string {
	return join(cwd, '.pi', 'presets.json');
}

function read_prompt_presets_file(path: string): PromptPresetMap {
	if (!existsSync(path)) return {};

	try {
		return normalize_prompt_presets(
			JSON.parse(readFileSync(path, 'utf-8')),
		);
	} catch {
		return {};
	}
}

export function load_prompt_presets(
	cwd: string,
): Record<string, LoadedPromptPreset> {
	return Object.assign(
		{},
		to_loaded_prompt_presets(DEFAULT_PROMPT_PRESETS, 'builtin'),
		to_loaded_prompt_presets(
			read_prompt_presets_file(get_global_presets_path()),
			'user',
		),
		to_loaded_prompt_presets(
			read_prompt_presets_file(get_project_presets_path(cwd)),
			'project',
		),
	);
}

function sort_prompt_presets(
	presets: PromptPresetMap,
): PromptPresetMap {
	return Object.fromEntries(
		Object.entries(presets).sort(([a], [b]) => a.localeCompare(b)),
	);
}

function save_project_prompt_presets(
	cwd: string,
	presets: PromptPresetMap,
): string {
	const path = get_project_presets_path(cwd);
	const dir = dirname(path);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true, mode: 0o700 });
	}

	const tmp = `${path}.tmp-${Date.now()}`;
	writeFileSync(
		tmp,
		JSON.stringify(sort_prompt_presets(presets), null, '\t') + '\n',
		{ mode: 0o600 },
	);
	renameSync(tmp, path);
	return path;
}

function get_last_preset_state(
	ctx: ExtensionContext,
): PromptPresetState | undefined {
	const entries = ctx.sessionManager.getEntries();
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i] as {
			type?: string;
			customType?: string;
			data?: PromptPresetState;
		};
		if (
			entry.type === 'custom' &&
			entry.customType === PRESET_STATE_TYPE &&
			entry.data
		) {
			return entry.data;
		}
	}
	return undefined;
}

function sets_equal(
	a: ReadonlySet<string>,
	b: ReadonlySet<string>,
): boolean {
	if (a.size !== b.size) return false;
	for (const value of a) {
		if (!b.has(value)) return false;
	}
	return true;
}

function get_prompt_source_label(source: PromptPresetSource): string {
	switch (source) {
		case 'builtin':
			return 'built-in';
		case 'user':
			return 'user';
		case 'project':
			return 'project';
	}
}

function list_base_presets(
	presets: Record<string, LoadedPromptPreset>,
): LoadedPromptPreset[] {
	return Object.values(presets)
		.filter((preset) => preset.kind === 'base')
		.sort((a, b) => a.name.localeCompare(b.name));
}

function list_layer_presets(
	presets: Record<string, LoadedPromptPreset>,
): LoadedPromptPreset[] {
	return Object.values(presets)
		.filter((preset) => preset.kind === 'layer')
		.sort((a, b) => a.name.localeCompare(b.name));
}

function format_summary(
	active_base_name: string | undefined,
	active_layers: ReadonlySet<string>,
	presets: Record<string, LoadedPromptPreset>,
): string {
	const lines = [`Base: ${active_base_name ?? '(none)'}`];

	const layer_names = [...active_layers].sort();
	if (layer_names.length === 0) {
		lines.push('Layers: (none)');
	} else {
		lines.push('Layers:');
		for (const name of layer_names) {
			const preset = presets[name];
			const description = preset?.description
				? ` — ${preset.description}`
				: '';
			lines.push(`- ${name}${description}`);
		}
	}

	return lines.join('\n');
}

function format_active_details(
	active_base_name: string | undefined,
	active_layers: ReadonlySet<string>,
	presets: Record<string, LoadedPromptPreset>,
): string {
	const parts: string[] = [];

	if (active_base_name) {
		const base = presets[active_base_name];
		if (base) {
			parts.push(`Base: ${base.name}`);
			if (base.description)
				parts.push(`Description: ${base.description}`);
			parts.push(`Source: ${get_prompt_source_label(base.source)}`);
			parts.push('', base.instructions.trim());
		}
	}

	const layer_names = [...active_layers].sort();
	if (layer_names.length > 0) {
		if (parts.length > 0) parts.push('', '---', '');
		parts.push('Layers:');
		for (const name of layer_names) {
			const layer = presets[name];
			if (!layer) continue;
			parts.push(
				`- ${layer.name} (${get_prompt_source_label(layer.source)})`,
			);
			if (layer.description) parts.push(`  ${layer.description}`);
		}
	}

	return parts.join('\n') || 'No preset or layers active';
}

function set_status(
	ctx: ExtensionContext,
	active_base_name: string | undefined,
	active_layers: ReadonlySet<string>,
): void {
	const label = active_base_name ?? 'none';
	const layer_suffix =
		active_layers.size > 0 ? ` +${active_layers.size}` : '';
	ctx.ui.setStatus('preset', `prompt:${label}${layer_suffix}`);
}

function persist_state(
	pi: ExtensionAPI,
	active_base_name: string | undefined,
	active_layers: ReadonlySet<string>,
): void {
	pi.appendEntry(PRESET_STATE_TYPE, {
		base_name: active_base_name ?? null,
		layer_names: [...active_layers].sort(),
	});
}

function normalize_active_state(
	presets: Record<string, LoadedPromptPreset>,
	active_base_name: string | undefined,
	active_layers: ReadonlySet<string>,
): {
	active_base_name: string | undefined;
	active_layers: Set<string>;
} {
	const next_base_name =
		active_base_name && presets[active_base_name]?.kind === 'base'
			? active_base_name
			: undefined;
	const next_layers = new Set(
		[...active_layers].filter(
			(name) => presets[name]?.kind === 'layer',
		),
	);
	return {
		active_base_name: next_base_name,
		active_layers: next_layers,
	};
}

function parse_preset_flag(flag: string): string[] {
	return flag
		.split(',')
		.map((item) => item.trim())
		.filter(Boolean);
}

function is_subcommand(command: string): boolean {
	return [
		'list',
		'show',
		'clear',
		'edit',
		'reload',
		'base',
		'enable',
		'disable',
		'toggle',
	].includes(command);
}

export default async function prompt_presets(pi: ExtensionAPI) {
	let presets: Record<string, LoadedPromptPreset> = {};
	let active_base_name: string | undefined;
	let active_layers = new Set<string>();

	function get_base(
		name: string | undefined,
	): LoadedPromptPreset | undefined {
		return name ? presets[name] : undefined;
	}

	function get_layer(name: string): LoadedPromptPreset | undefined {
		const preset = presets[name];
		return preset?.kind === 'layer' ? preset : undefined;
	}

	function commit_state(
		ctx: ExtensionContext,
		next_base_name: string | undefined,
		next_layers: ReadonlySet<string>,
		options?: { persist?: boolean; notify?: string },
	): void {
		active_base_name = next_base_name;
		active_layers = new Set(next_layers);
		set_status(ctx, active_base_name, active_layers);
		if (options?.persist !== false) {
			persist_state(pi, active_base_name, active_layers);
		}
		if (options?.notify) {
			ctx.ui.notify(options.notify, 'info');
		}
	}

	function activate_base(
		name: string | undefined,
		ctx: ExtensionContext,
		options?: { persist?: boolean },
	): boolean {
		if (!name) {
			commit_state(ctx, undefined, active_layers, {
				persist: options?.persist,
				notify: 'Base preset cleared',
			});
			return true;
		}

		const preset = get_base(name);
		if (!preset) {
			ctx.ui.notify(`Unknown base preset: ${name}`, 'warning');
			return false;
		}

		commit_state(ctx, preset.name, active_layers, {
			persist: options?.persist,
			notify: `Base preset "${preset.name}" activated`,
		});
		return true;
	}

	function set_layer_enabled(
		name: string,
		enabled: boolean,
		ctx: ExtensionContext,
		options?: { persist?: boolean },
	): boolean {
		const preset = get_layer(name);
		if (!preset) {
			ctx.ui.notify(`Unknown prompt layer: ${name}`, 'warning');
			return false;
		}

		const next_layers = new Set(active_layers);
		if (enabled) {
			next_layers.add(preset.name);
		} else {
			next_layers.delete(preset.name);
		}

		commit_state(ctx, active_base_name, next_layers, {
			persist: options?.persist,
			notify: enabled
				? `Layer "${preset.name}" enabled`
				: `Layer "${preset.name}" disabled`,
		});
		return true;
	}

	function toggle_layer(
		name: string,
		ctx: ExtensionContext,
		options?: { persist?: boolean },
	): boolean {
		return set_layer_enabled(
			name,
			!active_layers.has(name),
			ctx,
			options,
		);
	}

	async function edit_preset(
		name: string,
		ctx: ExtensionCommandContext,
	): Promise<void> {
		const existing = presets[name];
		const kind_choice = await ctx.ui.select('Preset kind', [
			existing?.kind === 'layer'
				? 'layer (current)'
				: 'base (current)',
			existing?.kind === 'layer' ? 'base' : 'layer',
		]);
		if (!kind_choice) return;
		const kind: PromptPresetKind = kind_choice.startsWith('layer')
			? 'layer'
			: 'base';

		const description = await ctx.ui.input(
			`Description for ${name}`,
			existing?.description ?? '',
		);
		if (description === undefined) return;

		const instructions = await ctx.ui.editor(
			`Edit ${kind} preset: ${name}`,
			existing?.instructions ?? '',
		);
		if (instructions === undefined) return;

		save_project_prompt_presets(ctx.cwd, {
			...read_prompt_presets_file(get_project_presets_path(ctx.cwd)),
			[name]: {
				kind,
				instructions,
				...(description.trim()
					? { description: description.trim() }
					: {}),
			},
		});

		presets = load_prompt_presets(ctx.cwd);
		const normalized = normalize_active_state(
			presets,
			active_base_name,
			active_layers,
		);
		active_base_name = normalized.active_base_name;
		active_layers = normalized.active_layers;

		if (kind === 'base') {
			activate_base(name, ctx);
		} else {
			set_layer_enabled(name, true, ctx);
		}
		ctx.ui.notify(
			`Saved preset "${name}" to ${get_project_presets_path(ctx.cwd)}`,
			'info',
		);
	}

	async function show_manager(
		ctx: ExtensionCommandContext,
	): Promise<void> {
		const base_presets = list_base_presets(presets);
		const layer_presets = list_layer_presets(presets);
		if (base_presets.length === 0 && layer_presets.length === 0) {
			ctx.ui.notify('No prompt presets available', 'warning');
			return;
		}

		const initial_base = active_base_name;
		const initial_layers = new Set(active_layers);
		let selected_base = active_base_name;
		const enabled_layers = new Set(active_layers);

		const items: SettingItem[] = [];
		const base_ids = new Set<string>();
		const layer_ids = new Set<string>();

		items.push({
			id: '__header_base__',
			label: `── Base presets (${base_presets.length + 1}) ──`,
			description: '',
			currentValue: '',
		});
		items.push({
			id: NONE_BASE_ID,
			label: '(none)',
			description: 'No active base preset',
			currentValue: UNSELECTED,
			values: [SELECTED, UNSELECTED],
		});
		base_ids.add(NONE_BASE_ID);

		for (const preset of base_presets) {
			items.push({
				id: preset.name,
				label: preset.name,
				description: [
					`${get_prompt_source_label(preset.source)} • ${preset.description ?? 'base preset'}`,
				].join('\n'),
				currentValue: UNSELECTED,
				values: [SELECTED, UNSELECTED],
			});
			base_ids.add(preset.name);
		}

		items.push({
			id: '__header_layers__',
			label: `── Prompt layers (${layer_presets.length}) ──`,
			description: '',
			currentValue: '',
		});
		for (const preset of layer_presets) {
			items.push({
				id: preset.name,
				label: preset.name,
				description: [
					`${get_prompt_source_label(preset.source)} • ${preset.description ?? 'layer'}`,
				].join('\n'),
				currentValue: DISABLED,
				values: [ENABLED, DISABLED],
			});
			layer_ids.add(preset.name);
		}

		function sync_values() {
			for (const item of items) {
				if (base_ids.has(item.id)) {
					const is_selected =
						(item.id === NONE_BASE_ID && !selected_base) ||
						item.id === selected_base;
					item.currentValue = is_selected ? SELECTED : UNSELECTED;
				} else if (layer_ids.has(item.id)) {
					item.currentValue = enabled_layers.has(item.id)
						? ENABLED
						: DISABLED;
				}
			}
		}

		sync_values();

		await ctx.ui.custom((tui, theme, _kb, done) => {
			const list = new SettingsList(
				items,
				Math.min(Math.max(items.length + 4, 8), 24),
				{
					cursor: theme.fg('accent', '›'),
					label: (text, selected) => {
						if (text.startsWith('──') && text.endsWith('──')) {
							return theme.fg('dim', theme.bold(text));
						}
						return selected ? theme.fg('accent', text) : text;
					},
					value: (text, selected) => {
						const color =
							text === ENABLED || text === SELECTED
								? ('success' as const)
								: ('dim' as const);
						const rendered = theme.fg(color, text);
						return selected
							? theme.bold(theme.fg('accent', rendered))
							: rendered;
					},
					description: (text) => theme.fg('muted', text),
					hint: (text) => theme.fg('dim', text),
				},
				(id, new_value) => {
					if (id.startsWith('__header_')) return;

					if (base_ids.has(id)) {
						selected_base =
							new_value === SELECTED && id !== NONE_BASE_ID
								? id
								: undefined;
						sync_values();
						return;
					}

					if (layer_ids.has(id)) {
						if (new_value === ENABLED) {
							enabled_layers.add(id);
						} else {
							enabled_layers.delete(id);
						}
						sync_values();
					}
				},
				() => done(undefined),
				{ enableSearch: true },
			);

			const container = new Container();
			container.addChild({
				render: () => [
					theme.fg('accent', theme.bold('Prompt presets')),
					theme.fg(
						'muted',
						`base: ${selected_base ?? '(none)'} • ${enabled_layers.size} layer(s) enabled`,
					),
					'',
				],
				invalidate: () => {},
			});
			container.addChild({
				render(width: number) {
					return list.render(width);
				},
				invalidate() {
					list.invalidate();
				},
			});
			container.addChild(
				new Text(
					theme.fg(
						'dim',
						'search filters • enter toggles • esc close',
					),
					0,
					1,
				),
			);

			return {
				render(width: number) {
					return container.render(width);
				},
				invalidate() {
					container.invalidate();
				},
				handleInput(data: string) {
					list.handleInput(data);
					tui.requestRender();
				},
			};
		});

		if (
			selected_base !== initial_base ||
			!sets_equal(initial_layers, enabled_layers)
		) {
			commit_state(ctx, selected_base, enabled_layers, {
				notify: 'Updated prompt preset selection',
			});
		}
	}

	pi.registerFlag('preset', {
		description:
			'Activate prompt config on startup. Accepts a base preset or comma-separated preset/layer names.',
		type: 'string',
	});

	pi.registerCommand('preset', {
		description: 'Manage base prompt presets and prompt layers',
		getArgumentCompletions: (prefix) => {
			const trimmed = prefix.trim();
			const parts = trimmed ? trimmed.split(/\s+/) : [];
			const base_names = list_base_presets(presets).map(
				(preset) => preset.name,
			);
			const layer_names = list_layer_presets(presets).map(
				(preset) => preset.name,
			);
			const all_names = [...base_names, ...layer_names];

			if (parts.length <= 1) {
				const query = parts[0] ?? '';
				const subcommands = [
					'list',
					'show',
					'clear',
					'edit',
					'reload',
					'base',
					'enable',
					'disable',
					'toggle',
				];
				return [
					...subcommands
						.filter((item) => item.startsWith(query))
						.map((item) => ({ value: item, label: item })),
					...all_names
						.filter((item) => item.startsWith(query))
						.map((item) => ({ value: item, label: item })),
				];
			}

			const command = parts[0];
			const query = parts.slice(1).join(' ');
			if (command === 'base') {
				return base_names
					.filter((item) => item.startsWith(query))
					.map((item) => ({ value: `base ${item}`, label: item }));
			}
			if (['enable', 'disable', 'toggle'].includes(command)) {
				return layer_names
					.filter((item) => item.startsWith(query))
					.map((item) => ({
						value: `${command} ${item}`,
						label: item,
					}));
			}
			if (command === 'edit') {
				return all_names
					.filter((item) => item.startsWith(query))
					.map((item) => ({ value: `edit ${item}`, label: item }));
			}
			return null;
		},
		handler: async (args, ctx) => {
			const trimmed = args.trim();
			if (!trimmed) {
				if (ctx.hasUI) {
					await show_manager(ctx);
					return;
				}
				ctx.ui.notify(
					format_summary(active_base_name, active_layers, presets),
					'info',
				);
				return;
			}

			const [first, ...rest] = trimmed.split(/\s+/);
			const arg = rest.join(' ').trim();

			switch (first) {
				case 'list':
					ctx.ui.notify(
						format_summary(active_base_name, active_layers, presets),
						'info',
					);
					return;
				case 'show':
					ctx.ui.notify(
						format_active_details(
							active_base_name,
							active_layers,
							presets,
						),
						'info',
					);
					return;
				case 'clear':
					commit_state(ctx, undefined, new Set(), {
						notify: 'Cleared base preset and prompt layers',
					});
					return;
				case 'reload': {
					presets = load_prompt_presets(ctx.cwd);
					const normalized = normalize_active_state(
						presets,
						active_base_name,
						active_layers,
					);
					active_base_name = normalized.active_base_name;
					active_layers = normalized.active_layers;
					set_status(ctx, active_base_name, active_layers);
					ctx.ui.notify('Reloaded prompt presets', 'info');
					return;
				}
				case 'base':
					if (!arg) {
						ctx.ui.notify('Usage: /preset base <name>', 'warning');
						return;
					}
					activate_base(arg, ctx);
					return;
				case 'enable':
					if (!arg) {
						ctx.ui.notify('Usage: /preset enable <layer>', 'warning');
						return;
					}
					set_layer_enabled(arg, true, ctx);
					return;
				case 'disable':
					if (!arg) {
						ctx.ui.notify(
							'Usage: /preset disable <layer>',
							'warning',
						);
						return;
					}
					set_layer_enabled(arg, false, ctx);
					return;
				case 'toggle':
					if (!arg) {
						ctx.ui.notify('Usage: /preset toggle <layer>', 'warning');
						return;
					}
					toggle_layer(arg, ctx);
					return;
				case 'edit':
					if (!arg) {
						ctx.ui.notify('Usage: /preset edit <name>', 'warning');
						return;
					}
					await edit_preset(arg, ctx);
					return;
			}

			if (is_subcommand(first)) {
				ctx.ui.notify(
					`Unsupported preset command: ${first}`,
					'warning',
				);
				return;
			}

			const preset = presets[trimmed];
			if (!preset) {
				ctx.ui.notify(
					`Unknown preset or layer: ${trimmed}`,
					'warning',
				);
				return;
			}
			if (preset.kind === 'base') {
				activate_base(preset.name, ctx);
			} else {
				toggle_layer(preset.name, ctx);
			}
		},
	});

	pi.on('session_start', async (_event, ctx) => {
		presets = load_prompt_presets(ctx.cwd);
		active_base_name = undefined;
		active_layers = new Set();

		const preset_flag = pi.getFlag('preset');
		if (typeof preset_flag === 'string' && preset_flag.trim()) {
			for (const name of parse_preset_flag(preset_flag)) {
				const preset = presets[name];
				if (!preset) continue;
				if (preset.kind === 'base') {
					active_base_name = name;
				} else {
					active_layers.add(name);
				}
			}
			const normalized = normalize_active_state(
				presets,
				active_base_name,
				active_layers,
			);
			active_base_name = normalized.active_base_name;
			active_layers = normalized.active_layers;
			set_status(ctx, active_base_name, active_layers);
			return;
		}

		const restored = get_last_preset_state(ctx);
		if (restored) {
			active_base_name = restored.base_name ?? undefined;
			active_layers = new Set(restored.layer_names ?? []);
		}
		const normalized = normalize_active_state(
			presets,
			active_base_name,
			active_layers,
		);
		active_base_name = normalized.active_base_name;
		active_layers = normalized.active_layers;
		set_status(ctx, active_base_name, active_layers);
	});

	pi.on('before_agent_start', async (event) => {
		const blocks: string[] = [];
		const base = get_base(active_base_name);
		if (base?.instructions.trim()) {
			blocks.push(
				`## Active Base Prompt: ${base.name}\n${base.instructions.trim()}`,
			);
		}

		const layer_blocks = [...active_layers]
			.sort()
			.map((name) => presets[name])
			.filter((preset): preset is LoadedPromptPreset =>
				Boolean(preset?.instructions.trim()),
			)
			.map(
				(preset) =>
					`### ${preset.name}\n${preset.instructions.trim()}`,
			);
		if (layer_blocks.length > 0) {
			blocks.push(
				`## Active Prompt Layers\n\n${layer_blocks.join('\n\n')}`,
			);
		}

		if (blocks.length === 0) return;
		return {
			systemPrompt: `${event.systemPrompt}\n\n${blocks.join('\n\n')}`,
		};
	});

	pi.on('session_shutdown', async (_event, ctx) => {
		ctx.ui.setStatus('preset', undefined);
	});
}
