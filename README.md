# CodeMem 🧠💻

A "Long-Term Pair Programmer" built on the Model Context Protocol (MCP) and powered by EverMemOS.

CodeMem acts as a universal, persistent memory backend for your favorite AI coding assistants (Cursor, Windsurf, Claude Code). It quietly observes and extracts **EventLog Memory** (architectural decisions, bug fixes) and **Profile Memory** (your preferred coding style) into a cloud-synced vault. 

When you ask your AI IDE a question, it autonomously queries CodeMem to retrieve exact project-specific context that standard LLMs otherwise forget between sessions.

Because it lives in the cloud, **CodeMem creates a "Shared Brain" effect**. Tell Claude Code a preference in your terminal, and Cursor will automatically know about it five minutes later.

---

## 🌟 Key Features

* **Universal Compatibility:** Works with any IDE or CLI that supports the open Model Context Protocol (MCP).
* **Conversational Saving:** You don't need to click buttons. Just tell your AI: *"Save the decision that we are using Tailwind for this project."*
* **Autonomous Retrieval:** The AI automatically searches your memory bank when it lacks context before writing code.
* **Shared AI Brain:** Syncs context seamlessly across Cursor, Windsurf, and Claude Code.
* **EverMemOS Powered:** Leverages the robust categorizations of Profile, Episodic, and EventLog memory to ensure high-fidelity context injection.

---

## 🛠️ Installation & Setup

### 1. Build the Server

Clone the repository and build the MCP server locally:

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

## 🔌 Connecting to AI Platforms

Because CodeMem is a standard MCP server, connecting it to your favorite tools is easy. You will point the tool to the `dist/index.js` file generated during the build step.

*(Note: Replace `/absolute/path/to/CodeMem` with the actual path on your machine).*

### 🖥️ Cursor
1. Open Cursor and go to **Settings** > **Features** > **MCP Servers**
2. Click **+ Add new MCP server**
3. Configure it as follows:
   * **Name:** `codemem`
   * **Type:** `command`
   * **Command:** `node`
   * **Args:** `/absolute/path/to/CodeMem/dist/index.js`
4. Make sure your `.env` file is in the CodeMem directory, as the script will read it automatically.

### 🏄 Windsurf
1. Open your global Windsurf MCP configuration file:
   * **Mac/Linux:** `~/.codeium/windsurf/mcp_config.json`
   * **Windows:** `%USERPROFILE%\.codeium\windsurf\mcp_config.json`
2. Add the `codemem` server to the `mcpServers` object. You can pass environment variables directly here:

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

### ⌨️ Claude Code (CLI)
Claude Code is built entirely around MCP. To add CodeMem to your CLI assistant:

1. Open your terminal and run:
```bash
claude mcp add codemem node /absolute/path/to/CodeMem/dist/index.js
```
2. Claude Code will automatically detect the tools (`save_project_decision`, `search_project_memory`, `add_developer_preference`).

### 🤖 Other MCP-Compatible Tools (Antigravity, Roo Code, Cline)
Any next-generation AI coding tool that supports MCP clients will work. Simply provide the launch command:
`node /absolute/path/to/CodeMem/dist/index.js` and ensure the `.env` file is accessible.

*(Note: GitHub Copilot / Codex does not natively support the open MCP standard at this time).*

---

## 🗣️ How to Use It

Once connected, simply talk to your AI naturally! The AI knows *what* the tools do and *when* to use them.

**Saving a Preference:**
> "Hey, we just decided to use Zustand for state management. Please save that to project memory."

**Setting a Developer Profile:**
> "Write a fetch function. Remember, I always want error handling to use standard Try/Catch blocks. Save that preference."

**Recalling Context:**
> "Create a new database schema for the user profile."
*(The AI will autonomously search CodeMem to find out what database syntax you prefer before writing the code).*
