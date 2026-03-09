# CodeMem

A **Long-Term Pair Programmer** built on the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) and powered by [EverMemOS](https://evermind.ai/).

CodeMem acts as a universal, persistent memory backend for your AI coding assistants. It quietly extracts **architectural decisions**, **coding preferences**, and **project context** into a cloud-synced memory vault powered by EverMemOS.

When your AI IDE writes code, it autonomously queries CodeMem to retrieve project-specific context that standard LLMs forget between sessions. Because the memory lives in the cloud, **all your AI tools share the same brain** — save a preference in Claude Code, and Cursor knows about it instantly.

---

## Key Features

- **Universal Compatibility** — Works with any MCP-compatible tool: Cursor, Windsurf, Claude Code, Cline, Roo Code, and more.
- **Conversational Saving** — Just tell your AI: *"Save the decision that we are using Tailwind for this project."*
- **Autonomous Retrieval** — The AI automatically searches your memory bank before writing code.
- **Shared AI Brain** — Syncs context seamlessly across all your AI development tools.
- **Full Memory Lifecycle** — Save, search, browse, and delete memories. Supports all four EverMemOS memory types: Profile, Episodic, EventLog, and Foresight.
- **Multiple Retrieval Strategies** — Keyword, vector, hybrid, and LLM-guided agentic retrieval.

---

## Available Tools

CodeMem exposes six MCP tools to your IDE's AI:

| Tool | Description | Memory Type |
|:---|:---|:---|
| `save_project_decision` | Save architectural decisions, bug fix patterns, or important context | Episodic / EventLog |
| `search_project_memory` | Search past decisions and context using hybrid or agentic retrieval | Episodic + Profile |
| `add_developer_preference` | Save coding style rules and preferences | Profile |
| `list_recent_memories` | Browse saved memories by type with pagination | All types |
| `delete_memory` | Delete a specific memory by ID or clear by type | All types |
| `add_foresight_todo` | Record future tasks, tech debt, or planned improvements | Foresight |

---

## Installation & Setup

### 1. Build the Server

```bash
git clone https://github.com/zhangshi0512/CodeMem.git
cd CodeMem
npm install
npm run build
```

### 2. Configure Environment Variables

Create a `.env` file in the root of the `CodeMem` directory. You will need an API key from [EverMemOS Cloud](https://api.evermind.ai/).

```env
EVERMEM_API_KEY=your_api_key_here
# Optional: Isolate memories by user and project
USER_ID=your_username
GROUP_ID=project_name
```

---

## Connecting to AI Platforms

Because CodeMem is a standard MCP server, connecting it to your favorite tools is straightforward. Point the tool to the `dist/index.js` file generated during the build step.

> Replace `/absolute/path/to/CodeMem` with the actual path on your machine.

### Cursor

1. Open Cursor and go to **Settings** > **Features** > **MCP Servers**
2. Click **+ Add new MCP server**
3. Configure:
   - **Name:** `codemem`
   - **Type:** `command`
   - **Command:** `node`
   - **Args:** `/absolute/path/to/CodeMem/dist/index.js`
4. The script reads your `.env` file automatically.

### Windsurf

1. Open your global Windsurf MCP configuration file:
   - **Mac/Linux:** `~/.codeium/windsurf/mcp_config.json`
   - **Windows:** `%USERPROFILE%\.codeium\windsurf\mcp_config.json`
2. Add the `codemem` server:

```json
{
  "mcpServers": {
    "codemem": {
      "command": "node",
      "args": ["/absolute/path/to/CodeMem/dist/index.js"],
      "env": {
        "EVERMEM_API_KEY": "your_api_key_here",
        "USER_ID": "my_local_user",
        "GROUP_ID": "my_project_group"
      }
    }
  }
}
```

3. Save the file and reload Windsurf.

### Claude Code (CLI)

Claude Code has native MCP support. Add CodeMem with:

```bash
claude mcp add codemem node /absolute/path/to/CodeMem/dist/index.js
```

Claude Code will automatically detect all six tools.

### Other MCP-Compatible Tools (Cline, Roo Code, Antigravity, etc.)

Any AI tool that supports MCP clients will work. Provide the launch command:
`node /absolute/path/to/CodeMem/dist/index.js` and ensure the `.env` file is accessible.

> **Note:** GitHub Copilot / Codex does not natively support the open MCP standard at this time.

---

## Auto-Save Mode (Prompts)

CodeMem includes **MCP Prompts** — reusable instruction templates that tell your AI to automatically save and retrieve memories without you having to ask.

| Prompt | What it does |
|:---|:---|
| `codemem-auto` | AI automatically saves decisions, preferences, and TODOs at the end of each task. No manual "save" needed. |
| `codemem-context` | AI automatically searches project memory before writing new code, ensuring consistency with past decisions. |
| `codemem-full` | Both auto-save and context-aware combined. Full autopilot. |

### How to activate a prompt

**In Cursor:** Open the chat and type: *"Use the codemem-full prompt"* or select it from the prompt picker if available.

**In Claude Code:** Prompts are automatically available. The AI can reference them when you start a coding session.

**Tip:** For the best experience, start your coding session with:
> "Use codemem-full mode for this session."

The AI will then silently search memory before writing code and save new decisions afterward — zero manual effort.

---

## Manual Usage

You can also use CodeMem manually by talking to your AI naturally:

**Saving a decision:**
> "We just decided to use Zustand for state management. Save that to project memory."

**Setting a preference:**
> "I always want error handling to use Try/Catch blocks. Save that preference."

**Searching context:**
> "What database did we decide to use for this project?"

**Browsing all memories:**
> "List all the project decisions we've saved so far."

**Recording tech debt:**
> "We need to add rate limiting to the API before launch. Record that as a future task."

**Deleting outdated context:**
> "Delete the memory about using MongoDB — we switched to PostgreSQL."

---

## Architecture

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   Cursor     │    │  Windsurf    │    │  Claude Code │
│   (MCP)      │    │  (MCP)       │    │  (MCP)       │
└──────┬───────┘    └──────┬───────┘    └──────┬───────┘
       │                   │                   │
       └───────────────────┼───────────────────┘
                           │
                    ┌──────▼───────┐
                    │   CodeMem    │
                    │  MCP Server  │
                    │  (stdio)     │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │  EverMemOS   │
                    │  Cloud API   │
                    └──────────────┘
```

---

## Tech Stack

- **Runtime:** Node.js + TypeScript
- **Protocol:** Model Context Protocol (MCP) via `@modelcontextprotocol/sdk`
- **Memory Backend:** EverMemOS Cloud API
- **HTTP Client:** Axios

---

## License

ISC
