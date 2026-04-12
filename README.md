# my-pi

Personal [pi](https://pi.dev) coding agent wrapper with MCP tool
integration.

Built on the
[@mariozechner/pi-coding-agent](https://github.com/badlogic/pi-mono)
SDK. Adds MCP server support so models without built-in web search
(like Mistral) can still use external tools.

## Setup

```bash
pnpm install
pnpm run build
```

### API Keys

Pi handles authentication natively via `AuthStorage`. Options
(in priority order):

1. **`pi auth`** — interactive login, stores credentials in
   `~/.pi/agent/auth.json`
2. **Environment variables** — `ANTHROPIC_API_KEY`,
   `MISTRAL_API_KEY`, etc.
3. **OAuth** — supported for providers that offer it

## Usage

### Interactive mode (full TUI)

```bash
node dist/index.js
```

Pi's full terminal UI with editor, `/commands`, model switching
(`Ctrl+L`), session tree (`/tree`), and message queuing.

### Print mode (one-shot)

```bash
node dist/index.js "your prompt here"
node dist/index.js -P "explicit print mode"
```

### Non-TTY

When run without a prompt in a non-TTY environment (e.g. piped or
from an LLM agent), shows usage help instead of launching the TUI.

## MCP Servers

MCP servers are configured via `mcp.json` files and managed as a
pi extension. Servers are spawned on startup and their tools
registered via `pi.registerTool()`.

### Global config

`~/.pi/agent/mcp.json` — available to all projects:

```json
{
  "mcpServers": {
    "mcp-sqlite-tools": {
      "command": "npx",
      "args": ["-y", "mcp-sqlite-tools"]
    }
  }
}
```

### Project config

`./mcp.json` in the project root — overrides global servers by
name:

```json
{
  "mcpServers": {
    "my-search": {
      "command": "npx",
      "args": ["-y", "some-mcp-server"],
      "env": {
        "API_KEY": "..."
      }
    }
  }
}
```

Project servers merge with global servers. If both define the same
server name, the project config wins.

### Commands

In interactive mode:

- `/mcp list` — show connected servers and tool counts
- `/mcp enable <server>` — enable a disabled server's tools
- `/mcp disable <server>` — disable a server's tools
- `/skills list` — show loaded commands
- `/skills tools` — show all registered tools

### How it works

1. Pi extension loads `mcp.json` configs (global + project)
2. Spawns each MCP server as a child process (stdio transport)
3. Performs the MCP `initialize` handshake
4. Calls `tools/list` to discover available tools
5. Registers each tool via `pi.registerTool()` as
   `mcp__<server>__<tool>`
6. `/mcp enable/disable` toggles tools via
   `pi.setActiveTools()`
7. Cleanup on `session_shutdown`

## Project Structure

```
src/
  index.ts          CLI entry point (citty + pi SDK)
  extension.ts      Pi extension (MCP + skills management)
  mcp/
    client.ts       Minimal MCP stdio client (JSON-RPC 2.0)
    config.ts       Loads and merges mcp.json configs
mcp.json            Project MCP server config
```

## Development

```bash
pnpm run dev        # Watch mode
pnpm run check      # Lint + type check
pnpm run test       # Run tests
pnpm run build      # Production build
```

## License

MIT
