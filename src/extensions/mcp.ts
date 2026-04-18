import {
	type ExtensionAPI,
	defineTool,
} from '@mariozechner/pi-coding-agent';
import { McpClient, type McpServerConfig } from '../mcp/client.js';
import { load_mcp_config } from '../mcp/config.js';

interface ServerState {
	config: McpServerConfig;
	client?: McpClient;
	tool_names: string[];
	enabled: boolean;
	status: 'disconnected' | 'connecting' | 'connected' | 'failed';
	error?: string;
	connect_promise?: Promise<void>;
}

function remove_server_tools_from_active(
	pi: ExtensionAPI,
	tool_names: string[],
): void {
	const tool_set = new Set(tool_names);
	pi.setActiveTools(
		pi.getActiveTools().filter((tool) => !tool_set.has(tool)),
	);
}

function format_server_status(state: ServerState): string {
	switch (state.status) {
		case 'connected':
			return state.enabled ? 'enabled' : 'disabled';
		case 'connecting':
			return state.enabled ? 'connecting' : 'connecting, disabled';
		case 'failed':
			return state.enabled ? 'failed' : 'failed, disabled';
		default:
			return state.enabled ? 'not connected yet' : 'disabled';
	}
}

// Default export for Pi Package / additionalExtensionPaths loading
export default async function mcp(pi: ExtensionAPI) {
	const cwd = process.cwd();
	const configs = load_mcp_config(cwd);
	const servers = new Map<string, ServerState>(
		configs.map((config) => [
			config.name,
			{
				config,
				tool_names: [],
				enabled: true,
				status: 'disconnected' as const,
			},
		]),
	);
	const registered_tool_names = new Set<string>();

	const connect_server = async (
		state: ServerState,
	): Promise<void> => {
		if (state.status === 'connected') return;
		if (state.connect_promise) {
			await state.connect_promise;
			return;
		}

		state.connect_promise = (async () => {
			state.status = 'connecting';
			state.error = undefined;

			const client = new McpClient(state.config);
			try {
				await client.connect();
				state.client = client;

				const mcp_tools = await client.listTools();
				const tool_names: string[] = [];

				for (const mcp_tool of mcp_tools) {
					const tool_name = `mcp__${state.config.name}__${mcp_tool.name}`;
					tool_names.push(tool_name);

					if (registered_tool_names.has(tool_name)) continue;
					registered_tool_names.add(tool_name);

					pi.registerTool(
						defineTool({
							name: tool_name,
							label: `${state.config.name}: ${mcp_tool.name}`,
							description: mcp_tool.description || mcp_tool.name,
							parameters: (mcp_tool.inputSchema || {
								type: 'object',
								properties: {},
							}) as Parameters<typeof defineTool>[0]['parameters'],
							execute: async (_id, params) => {
								const result = (await state.client!.callTool(
									mcp_tool.name,
									params as Record<string, unknown>,
								)) as {
									content?: Array<{
										type: string;
										text?: string;
									}>;
								};

								const text =
									result?.content
										?.map((c) => c.text || '')
										.join('\n') || JSON.stringify(result);

								return {
									content: [{ type: 'text' as const, text }],
									details: {},
								};
							},
						}),
					);
				}

				state.tool_names = tool_names;
				state.status = 'connected';
				if (!state.enabled) {
					remove_server_tools_from_active(pi, state.tool_names);
				}
			} catch (error) {
				state.status = 'failed';
				state.error =
					error instanceof Error ? error.message : String(error);
				state.client = undefined;
				await client.disconnect().catch(() => {});
				console.error(
					`MCP server failed (${state.config.name}): ${state.error}`,
				);
				throw error;
			} finally {
				state.connect_promise = undefined;
			}
		})();

		await state.connect_promise;
	};

	const connect_all_servers = async (
		options: { include_failed?: boolean } = {},
	): Promise<void> => {
		await Promise.allSettled(
			Array.from(servers.values())
				.filter((state) => state.enabled)
				.filter(
					(state) =>
						options.include_failed || state.status !== 'failed',
				)
				.map((state) => connect_server(state)),
		);
	};

	pi.on('session_start', async () => {
		void connect_all_servers();
	});

	pi.on('before_agent_start', async (event) => {
		await connect_all_servers();
		return event;
	});

	pi.registerCommand('mcp', {
		description: 'Manage MCP servers (list, enable, disable)',
		getArgumentCompletions: (prefix) => {
			const parts = prefix.split(' ');
			if (parts.length <= 1) {
				return ['list', 'enable', 'disable']
					.filter((s) => s.startsWith(prefix))
					.map((s) => ({ value: s, label: s }));
			}
			if (parts[0] === 'enable' || parts[0] === 'disable') {
				const name_prefix = parts[1] || '';
				return Array.from(servers.keys())
					.filter((n) => n.startsWith(name_prefix))
					.map((n) => ({
						value: `${parts[0]} ${n}`,
						label: n,
					}));
			}
			return null;
		},
		handler: async (args, ctx) => {
			const [sub, ...rest] = args.trim().split(/\s+/);
			const name = rest.join(' ');

			switch (sub || 'list') {
				case 'list': {
					if (servers.size === 0) {
						ctx.ui.notify('No MCP servers configured');
						return;
					}
					const lines: string[] = [];
					for (const [sname, state] of servers.entries()) {
						lines.push(
							`${sname} (${format_server_status(state)}) — ${state.tool_names.length} tools${state.error ? ` — ${state.error}` : ''}`,
						);
					}
					ctx.ui.notify(lines.join('\n'));
					break;
				}
				case 'enable': {
					const server = servers.get(name);
					if (!server) {
						ctx.ui.notify(`Unknown server: ${name}`, 'warning');
						return;
					}
					if (server.enabled && server.status !== 'failed') {
						ctx.ui.notify(`${name} already enabled`);
						return;
					}
					server.enabled = true;
					if (server.status === 'connected') {
						const active = pi.getActiveTools();
						pi.setActiveTools([...active, ...server.tool_names]);
						ctx.ui.notify(`Enabled ${name}`);
						return;
					}
					if (server.status === 'failed') {
						server.status = 'disconnected';
						server.error = undefined;
					}
					void connect_server(server);
					ctx.ui.notify(
						`Enabling ${name} and connecting in background`,
					);
					break;
				}
				case 'disable': {
					const server = servers.get(name);
					if (!server) {
						ctx.ui.notify(`Unknown server: ${name}`, 'warning');
						return;
					}
					if (!server.enabled) {
						ctx.ui.notify(`${name} already disabled`);
						return;
					}
					server.enabled = false;
					remove_server_tools_from_active(pi, server.tool_names);
					ctx.ui.notify(`Disabled ${name}`);
					break;
				}
				default:
					ctx.ui.notify(
						`Unknown subcommand: ${sub}. Use list, enable, or disable.`,
						'warning',
					);
			}
		},
	});

	pi.on('session_shutdown', async () => {
		await Promise.allSettled(
			Array.from(servers.values()).map(async (server) => {
				await server.connect_promise?.catch(() => {});
				await server.client?.disconnect();
				server.client = undefined;
				if (server.status !== 'failed') {
					server.status = 'disconnected';
				}
			}),
		);
	});
}
