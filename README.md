# CodeMem

A **Long-Term Pair Programmer** built on the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) and powered by [EverMemOS](https://evermind.ai/).

CodeMem acts as a universal, persistent memory backend for your AI coding assistants. It quietly extracts **architectural decisions**, **coding preferences**, and **project context** into a cloud-synced memory vault powered by EverMemOS.

When your AI IDE writes code, it autonomously queries CodeMem to retrieve project-specific context that standard LLMs forget between sessions. Because the memory lives in the cloud, your compatible AI tools can share memory for the same user identity across sessions and projects.

---

## Key Features

- **Universal Compatibility** — Works with any MCP-compatible tool: Cursor, Windsurf, Claude Code, Cline, Roo Code, and more.
- **Auto-Detection** — Automatically detects your GitHub username, project name, and creates unique session IDs. No manual config needed.
- **Session Tracking** — Each coding session gets a unique ID, allowing you to isolate or merge context across sessions.
- **Scope Control** — Retrieve memories from current session, entire project, or globally using the `scope` parameter.
- **Conversational Saving** — Just tell your AI: *"Save the decision that we are using Tailwind for this project."*
- **Autonomous Retrieval** — The AI automatically searches your memory bank before writing code.
- **Shared AI Brain** — Syncs context seamlessly across all your AI development tools.
- **Full Memory Lifecycle** — Save, search, browse, consolidate, and delete memories with safety checks and status tracking.
- **Multiple Retrieval Strategies** — Keyword, vector, hybrid, and LLM-guided agentic retrieval.
- **Hierarchical Decision Writes** — Important decisions are stored in both narrative and atomic-fact formats to improve retrieval depth.
- **Spatial Memory** — Anchor memories to specific files and architectural layers. File-scoped search filters noise to only what's relevant to your current context.
- **Git-Anchored Context** — Memories automatically embed the current branch and commit hash, enabling temporal traceability across your project history.
- **Supersession Convention** — Mark old decisions as replaced by new ones. Superseded memories are automatically filtered from search results.
- **Memory Consolidation** — Merge fragmented episodic memories into a single canonical fact, demonstrating the Memory → Reasoning → Action loop.
- **Staleness Detection** — Cross-reference recent git changes against file-anchored memories to surface decisions that may no longer be accurate.
- **Conversation Metadata Control** — Read and update conversation metadata to tune extraction/retrieval behavior. Auto-tags sessions by detected architectural layer.

---

## Available Tools

CodeMem exposes 13 MCP tools to your IDE's AI:

### Write Tools

| Tool | Description | Memory Type |
|:---|:---|:---|
| `save_project_decision` | Save architectural decisions with dual writes (narrative + atomic fact). Supports file anchoring, architectural layer, and supersession of prior decisions. | Episodic + Event-like |
| `add_developer_preference` | Save coding style rules and preferences. Optionally anchor to specific files. | Profile |
| `add_foresight_todo` | Record future tasks, tech debt, or planned improvements. Supports file anchoring and layer tagging. | Foresight |
| `consolidate_memories` | Merge fragmented episodic memories into one canonical profile-level fact. Deletes source fragments after write. | Profile |

### Retrieval Tools

| Tool | Description | Memory Type |
|:---|:---|:---|
| `search_project_memory` | Search past decisions with scope control, optional file filtering, and automatic supersession deduplication. | Episodic + Profile |
| `search_project_memory_index` | Compact index view with IDs, relevance scores, and token cost estimates. Supports file filtering. | Episodic + Profile |
| `get_memory_timeline` | Show chronological context around a specific memory ID. | All types |
| `get_memory_details` | Fetch full memory records by ID for deep reading. | All types |
| `list_recent_memories` | Browse saved memories by type with pagination. | All types |
| `scan_stale_memories` | Detect memories whose anchored files have been modified in recent commits. | Episodic |

### Management Tools

| Tool | Description | Memory Type |
|:---|:---|:---|
| `delete_memory` | Delete by ID or bulk-delete by type (requires explicit confirmation). | All types |
| `get_conversation_meta` | Retrieve group conversation metadata used by EverMemOS extraction/retrieval. | Meta |
| `update_conversation_meta` | Update metadata fields (tags, timezone, scene, user details, llm settings). | Meta |

---

## Spatial Memory

Memories can be anchored to specific files and architectural layers, enabling precise file-scoped retrieval via structured content prefixes.

### Anchoring a Decision to Files

```
AI: "We decided to use Zod for request validation in the API layer.
     Save that with affected_files: ['src/api/routes.ts', 'src/api/middleware.ts']
     and component_layer: 'api'."
```

The saved memory will be prefixed with:
```
[files:src/api/routes.ts,src/api/middleware.ts | layer:api | branch:main | commit:a3f1b2c]
```

This prefix is embedded in memory content, enabling keyword-based file-scoped search via the `file_filter` parameter.

### File-Scoped Search

```
AI: "What decisions exist specifically for src/api/routes.ts?"
→ search_project_memory(query="decisions", file_filter="src/api/routes.ts")
→ Returns only memories anchored to that file
```

### Supported `component_layer` Values

`api` · `database` · `frontend` · `auth` · `infrastructure` · `testing` · `config`

Auto-tagging: on first write with `affected_files`, CodeMem silently updates the conversation metadata with detected layer tags — no manual step needed.

---

## Memory Evolution (Supersession & Consolidation)

### Superseding an Outdated Decision

When a decision changes, mark the old memory as replaced:

```
AI: "We switched from REST to GraphQL. Save as a new decision superseding
     memory ID mem_abc123."
→ save_project_decision(content="...", supersedes_ids=["mem_abc123"])
```

The new memory embeds `[supersedes:mem_abc123]`. Both search tools automatically filter out superseded memories when the newer one appears in the same result set.

### Consolidating Fragmented Memories

Over time, multiple small decisions about the same topic accumulate. Consolidation merges them into a single canonical fact:

1. **Search** — find related fragments with `search_project_memory`
2. **Reason** — the AI synthesizes a unified canonical summary
3. **Act** — call `consolidate_memories` with the synthesis and source IDs

```
AI: "Consolidate these three auth-related memories into one canonical fact."
→ consolidate_memories(
     consolidated_fact="Auth uses session cookies (not JWT) for XSS resistance,
                        enforced in src/auth/session.ts since commit a3f1b2c.",
     source_memory_ids=["mem_1", "mem_2", "mem_3"],
     affected_files=["src/auth/session.ts"],
     component_layer="auth"
   )
→ Writes 1 canonical fact, deletes 3 source fragments
```

### Detecting Stale Memories

When code changes, decisions may become outdated:

```
AI: "Check if any saved decisions reference files I've recently changed."
→ scan_stale_memories(commits_back=5)
→ Returns memories anchored to recently modified files with suggested actions
```

---

## Auto-Detection & Session Tracking

CodeMem automatically detects your development context, eliminating manual configuration:

### User ID (Automatic)
CodeMem identifies you in this priority order:
1. **Override** — Set `USER_ID` env var to manually specify
2. **GitHub API** — Uses `GITHUB_TOKEN` if available (for enterprise users with different usernames)
3. **Git Config** — Reads `git config user.name` (your GitHub username if properly configured)
4. **System Username** — Falls back to `USER` or `USERNAME` environment variable

### Project ID (Automatic)
CodeMem detects your project automatically:
1. **Override** — Set `GROUP_ID` env var to manually specify
2. **Git Repository** — Uses the folder name of your git repo root (e.g., "CodeMem")

> **Note:** If `USER_ID` or `GROUP_ID` are set in your `.env`, they take priority and suppress auto-detection. Remove them to let git config drive identity automatically.

### Platform Detection (Automatic)
CodeMem detects which IDE/tool is using it:
1. **Explicit Override** — Set `PLATFORM` env var (e.g., `PLATFORM=cursor`)
2. **IDE Environment Detection** — Checks for IDE-specific env vars:
   - `CURSOR_ENVIRONMENT` → Cursor
   - `WINDSURF_HOME` / `CODEIUM_WINDSURF` → Windsurf
   - `CLAUDE_VERSION` → Claude Code
3. **Parent Process Detection** — Inspects parent process name (macOS/Linux)
4. **Windows Detection** — Uses `wmic` to identify parent process (Windows)
5. **Fallback** — Defaults to "unknown" if detection fails

**Supported Platforms:**
- `claude-code` — Claude Code (CLI)
- `cursor` — Cursor
- `windsurf` — Windsurf
- `cline` — Cline
- `unknown` — Unrecognized IDE or explicit override

### Session ID (Per-Invocation)
Each time CodeMem starts, it generates a unique session ID:
- **Format:** `YYYYMMDD-HHMMSS-randomstring` (e.g., `20260309-143022-abc123`)
- **Purpose:** Tracks which memories belong to which coding session AND which platform created them
- **Shown in Results:** Memories display `[current via claude-code]` or `[session-xxx via cursor]` labels
- **Cannot Override:** Ensures session isolation and context accuracy

**Example Auto-Detection Output:**
```
👤 USER: Simon Zhang (from git config user.name)
📁 PROJECT: CodeMem (from repo folder name)
🔐 SESSION: 20260309-143022-abc123 (auto-generated this invocation)
🖥️  PLATFORM: claude-code (auto-detected from environment)
```

---

## Memory Scope Control

When searching memories, you can control the scope of retrieval using the `scope` parameter in `search_project_memory`:

### Scope Options

| Scope | Retrieves | Use Case |
|-------|-----------|----------|
| **`session`** | Current session only | Fresh context for isolated tasks; avoids outdated decisions |
| **`repo`** (default) | All sessions in this project | Maintain project consistency; leverage all accumulated knowledge |
| **`all`** | All projects for current user | Reuse personal patterns across repositories |

### Usage Examples

**Default behavior (repo scope):**
```
AI: "What database do we use for this project?"
→ Returns all database-related memories from any session
```

**Current session only:**
```
AI: "search_project_memory(query='TODO items', scope='session')"
→ Returns only TODOs from this current coding session
```

**Configuration:**
```bash
# Set default scope globally
export MEMORY_SCOPE=session

# Or pass as env var to MCP server
claude mcp add codemem node ./dist/index.js -e MEMORY_SCOPE=session
```

### When to Use Each Scope

- **`session` scope**: When building isolated features, debugging specific issues, or focusing on current work
- **`repo` scope**: When implementing features that touch multiple parts, maintaining consistency, or leveraging past decisions
- **Mix and match**: AI can choose the right scope for each query automatically

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

**Required:**
```env
EVERMEM_API_KEY=your_api_key_here
```

**Optional (auto-detected if not specified):**
```env
# GitHub token for enterprise users (reads GH username from API)
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Platform/IDE identification - auto-detected from environment or parent process
# Options: claude-code | cursor | windsurf | cline | unknown
PLATFORM=cursor

# Default memory retrieval scope: 'session' | 'repo' | 'all' (default: 'repo')
MEMORY_SCOPE=repo

# Override auto-detected identity (leave unset to use git config / repo name)
# USER_ID=your_username
# GROUP_ID=project_name
```

**Auto-Detection Priority:**
- `USER_ID`: env var override → GitHub token API → git config user.name → system username
- `GROUP_ID`: env var override → git repository folder name
- `PLATFORM`: Explicit env var → IDE-specific env vars → parent process name → wmic (Windows) → "unknown"
- `SESSION_ID`: Auto-generated unique ID per MCP invocation (cannot be overridden)

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
   - **Environment:** Add variables (if not using `.env` file):
     - `EVERMEM_API_KEY`: Your API key from EverMemOS
     - `GITHUB_TOKEN` (optional): For enterprise users
     - `MEMORY_SCOPE` (optional): Default retrieval scope

**Note:** CodeMem will auto-detect `USER_ID` and `GROUP_ID` from git config and repo name. You only need to set them explicitly if you want to override the defaults.

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
        "EVERMEM_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

3. Save the file and reload Windsurf.

### Claude Code (CLI)

Claude Code has native MCP support. Add CodeMem with environment variables:

```bash
claude mcp add codemem node /absolute/path/to/CodeMem/dist/index.js \
  -e EVERMEM_API_KEY=your_api_key_here
```

**With optional environment variables:**
```bash
claude mcp add codemem node /absolute/path/to/CodeMem/dist/index.js \
  -e EVERMEM_API_KEY=your_api_key_here \
  -e GITHUB_TOKEN=ghp_xxxxxxxxxxxx \
  -e MEMORY_SCOPE=repo
```

**Auto-Detection:**
CodeMem will automatically detect:
- `USER_ID` from GitHub config or system username
- `GROUP_ID` from git repository folder name
- `PLATFORM` from environment variables or parent process (detects "claude-code" automatically)
- `SESSION_ID` generates a unique ID for this invocation

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

**Saving a decision with spatial anchoring:**
> "We decided to use Zod for validation in the API layer. Save that with
> affected_files: ['src/api/routes.ts'] and component_layer: 'api'."

**Saving a decision that replaces an old one:**
> "We switched from MongoDB to PostgreSQL. Save that decision
> and supersede memory ID mem_abc123."

**Searching context filtered to a specific file:**
> "What decisions exist for src/auth/session.ts specifically?"

**Detecting stale memories after a refactor:**
> "I just rewrote the auth module. Scan for stale memories that reference
> those changed files."

**Consolidating fragmented memories:**
> "I have 4 small memories about our database setup. Consolidate them
> into one canonical fact."

**Setting a preference:**
> "I always want error handling to use Try/Catch blocks. Save that preference."

**Searching within current session:**
> "Search memory for decisions made in this session only."

**Browsing all memories:**
> "List all the project decisions we've saved so far."

**Recording tech debt:**
> "We need to add rate limiting to the API before launch. Record that as
> a future task with affected_files: ['src/api/routes.ts']."

**Deleting outdated context:**
> "Delete the memory about using MongoDB — we switched to PostgreSQL."

**Bulk delete safely (explicit confirmation required):**
> "Delete all `event_log` memories with confirm=true."

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

## Competition Alignment (Genesis)

- **Quality & Execution:** Stable MCP server with auto-detection, scoped retrieval, safe bulk-delete guards, request lifecycle visibility, and git-aware context injection. All parameters are optional and backward-compatible.
- **Memory Integration:** Uses dual-write decision storage (narrative + atomic fact linked via `refer_list` threading), structured `[files | layer | branch | commit]` content prefixes for keyword-based file-scoped search, hierarchical consolidation from episodic fragments to canonical profile facts, and automatic conversation metadata tagging with `assistant` scene to unlock EventLog and Foresight extraction.
- **Memory → Reasoning → Action Loop:** `scan_stale_memories` detects drift between code and decisions → AI reasons about which memories need updating → `consolidate_memories` or `save_project_decision` with `supersedes_ids` closes the loop. Search-first prompts ensure retrieved context actively shapes every new code change.

---

## License

ISC
