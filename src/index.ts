import { execSync, spawnSync } from 'child_process';
import dotenv from 'dotenv';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { AddMemoryRequest, EverMemClient } from './evermind-client.js';
import {
  buildSearchFilters,
  chooseRetrieveMethod,
  estimateTokenCount,
  extractFilesFromContent,
  filterSuperseded,
  getPlatformFromMemory,
  getSessionFromMemory,
  isBulkDelete,
  matchesFileFilter,
  normalizeScope,
  SearchMemoryRecord,
} from './policies.js';
import { sanitizeForMemoryWrite } from './privacy.js';
import { createWriteDedupeRegistry } from './dedupe.js';

dotenv.config();

const EVERMEM_API_KEY = process.env.EVERMEM_API_KEY;
if (!EVERMEM_API_KEY) {
  console.error('EVERMEM_API_KEY environment variable is not set.');
  process.exit(1);
}

function detectUserID(): string {
  // Env override must win.
  if (process.env.USER_ID) return process.env.USER_ID;

  const ghToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (ghToken) {
    try {
      const response = execSync('gh api user --jq .login', { encoding: 'utf-8' }).trim();
      if (response) return response;
    } catch {
      // Continue fallbacks
    }
  }

  try {
    const gitUsername = execSync('git config user.name', { encoding: 'utf-8' }).trim();
    if (gitUsername) return gitUsername;
  } catch {
    // Continue fallbacks
  }

  try {
    const gitEmail = execSync('git config user.email', { encoding: 'utf-8' }).trim();
    const username = gitEmail.split('@')[0];
    if (username) return username;
  } catch {
    // Continue fallbacks
  }

  const systemUser = process.env.USER || process.env.USERNAME;
  if (systemUser) return systemUser;

  return 'codemem_user';
}

function detectGroupID(): string {
  // Env override must win.
  if (process.env.GROUP_ID) return process.env.GROUP_ID;

  try {
    const repoRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim();
    const projectName = repoRoot.split(/[\\/]/).pop();
    if (projectName) return projectName;
  } catch {
    // Continue fallback
  }

  return 'codemem_workspace';
}

function generateSessionID(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const time = now.toTimeString().slice(0, 8).replace(/:/g, '');
  const random = Math.random().toString(36).substring(2, 8);
  return `${date}-${time}-${random}`;
}

function detectPlatform(): string {
  if (process.env.PLATFORM) return process.env.PLATFORM;

  if (process.env.CURSOR_ENVIRONMENT) return 'cursor';
  if (process.env.WINDSURF_HOME || process.env.CODEIUM_WINDSURF) return 'windsurf';
  if (process.env.CLAUDE_CODE || process.env.CLAUDE_VERSION) return 'claude-code';

  try {
    const result = spawnSync('ps', ['-p', process.ppid.toString(), '-o', 'comm='], { encoding: 'utf-8' });
    const parentProcess = result.stdout?.trim().toLowerCase() || '';
    if (parentProcess.includes('cursor')) return 'cursor';
    if (parentProcess.includes('windsurf')) return 'windsurf';
    if (parentProcess.includes('claude')) return 'claude-code';
    if (parentProcess.includes('cline')) return 'cline';
  } catch {
    // Continue to Windows fallback
  }

  if (process.platform === 'win32') {
    try {
      const parent = execSync(`wmic process where processid=${process.ppid} get name`, { encoding: 'utf-8' });
      const parentName = parent.split('\n')[1]?.trim().toLowerCase() || '';
      if (parentName.includes('cursor')) return 'cursor';
      if (parentName.includes('windsurf')) return 'windsurf';
      if (parentName.includes('claude')) return 'claude-code';
    } catch {
      // Fallback below
    }
  }

  return 'unknown';
}

function detectGitContext(): { commitHash: string; branch: string } {
  let commitHash = 'unknown';
  let branch = 'unknown';

  try {
    commitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    // Not in a git repo or git not available
  }

  try {
    branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    // Not in a git repo or git not available
  }

  return { commitHash, branch };
}

function buildContentPrefix(options: {
  affectedFiles?: string[];
  componentLayer?: string;
}): string {
  const git = detectGitContext();
  const parts: string[] = [];

  if (options.affectedFiles && options.affectedFiles.length > 0) {
    parts.push(`files:${options.affectedFiles.join(',')}`);
  }
  if (options.componentLayer) {
    parts.push(`layer:${options.componentLayer}`);
  }
  if (git.branch !== 'unknown') {
    parts.push(`branch:${git.branch}`);
  }
  if (git.commitHash !== 'unknown') {
    parts.push(`commit:${git.commitHash}`);
  }

  return parts.length > 0 ? `[${parts.join(' | ')}] ` : '';
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logEvent(level: 'info' | 'warn' | 'error', event: string, meta: Record<string, unknown> = {}) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    event,
    ...meta,
  };
  const line = JSON.stringify(payload);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.error(line);
}

const DEFAULT_USER_ID = detectUserID();
const DEFAULT_GROUP_ID = detectGroupID();
const SESSION_ID = generateSessionID();
const DEFAULT_MEMORY_SCOPE = normalizeScope(undefined, process.env.MEMORY_SCOPE || 'repo');
const DEDUPE_WINDOW_MS = Math.max(10, Number(process.env.DEDUPE_WINDOW_SECONDS || '120')) * 1000;
const PLATFORM = detectPlatform();
const evermem = new EverMemClient(EVERMEM_API_KEY);
const writeDedupe = createWriteDedupeRegistry(DEDUPE_WINDOW_MS);
let sessionMetaTagged = false;

function detectComponentLayers(files: string[]): string[] {
  const layers = new Set<string>();
  for (const file of files) {
    const lower = file.toLowerCase().replace(/\\/g, '/');
    if (/\/(api|routes?|endpoints?|controllers?)\//i.test(lower)) layers.add('api');
    if (/\/(db|database|migrations?|schemas?|models?)\//i.test(lower)) layers.add('database');
    if (/\/(components?|pages?|views?|ui|frontend|styles?)\//i.test(lower) || /\.(css|scss|jsx|tsx)$/.test(lower)) layers.add('frontend');
    if (/\/(auth|sessions?|permissions?|rbac)\//i.test(lower)) layers.add('auth');
    if (/\/(infra|deploy|ci|docker|terraform|k8s)\//i.test(lower)) layers.add('infrastructure');
    if (/\/(tests?|specs?|__tests?__)\//i.test(lower) || /\.(test|spec)\.[jt]sx?$/.test(lower)) layers.add('testing');
    if (/\/(configs?|settings?|env)\//i.test(lower)) layers.add('config');
  }
  return Array.from(layers);
}

function autoTagConversationMeta(affectedFiles: string[]): void {
  if (sessionMetaTagged || !affectedFiles.length) return;
  sessionMetaTagged = true;

  const layers = detectComponentLayers(affectedFiles);
  if (layers.length === 0) return;

  evermem.updateConversationMeta({
    group_id: DEFAULT_GROUP_ID,
    tags: layers,
  }).then(() => {
    logEvent('info', 'meta.auto_tagged', { tags: layers });
  }).catch((err) => {
    logEvent('warn', 'meta.auto_tag_failed', { message: err?.message });
  });
}

type WaitOptions = {
  wait_for_completion?: boolean;
  timeout_seconds?: number;
  poll_interval_ms?: number;
};

type MemoryListRecord = {
  id?: string;
  summary?: string;
  atomic_fact?: string;
  foresight?: string;
  profile_data?: unknown;
  content?: string;
  timestamp?: string;
  created_at?: string;
};

async function waitForRequestCompletion(
  requestId: string,
  timeoutSeconds: number = 20,
  pollIntervalMs: number = 1500
) {
  const deadline = Date.now() + timeoutSeconds * 1000;

  while (Date.now() < deadline) {
    const statusResult = await evermem.getRequestStatus(requestId);
    const status = statusResult?.data?.status?.toLowerCase();
    if (status === 'success' || status === 'failed' || status === 'error') {
      return { status, raw: statusResult };
    }
    await sleep(pollIntervalMs);
  }

  return { status: 'timeout', raw: null };
}

function buildMessageId(prefix: string): string {
  return `${prefix}_${SESSION_ID}_${PLATFORM}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

async function addMemoryWithOptionalWait(payload: AddMemoryRequest, options: WaitOptions = {}) {
  const start = Date.now();
  const result = await evermem.addMemory(payload);
  const requestId = result?.request_id as string | undefined;

  if (options.wait_for_completion && requestId) {
    const final = await waitForRequestCompletion(
      requestId,
      options.timeout_seconds ?? 20,
      options.poll_interval_ms ?? 1500
    );
    logEvent('info', 'memory.add.waited', {
      request_id: requestId,
      final_status: final.status,
      duration_ms: Date.now() - start,
    });
    return { result, finalStatus: final.status };
  }

  logEvent('info', 'memory.add.queued', {
    request_id: requestId,
    duration_ms: Date.now() - start,
  });
  return { result, finalStatus: 'queued' };
}

async function listMemoriesWindow(
  memoryType: 'episodic_memory' | 'event_log' | 'profile' | 'foresight',
  maxPages: number = 10,
  pageSize: number = 50
): Promise<MemoryListRecord[]> {
  const all: MemoryListRecord[] = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const result = await evermem.getMemories({
      user_id: DEFAULT_USER_ID,
      group_ids: [DEFAULT_GROUP_ID],
      memory_type: memoryType,
      page,
      page_size: pageSize,
    });

    const memories = (result?.result?.memories || []) as MemoryListRecord[];
    all.push(...memories);

    if (memories.length < pageSize) break;
  }

  return all;
}

const server = new Server(
  {
    name: 'CodeMem',
    version: '1.1.0',
  },
  {
    capabilities: {
      tools: {},
      prompts: {},
    },
  }
);

server.setRequestHandler(ListPromptsRequestSchema, async () => {
  return {
    prompts: [
      {
        name: 'codemem-auto',
        description: 'Auto-save mode: AI saves important decisions, preferences, and tech debt automatically.',
      },
      {
        name: 'codemem-context',
        description: 'Context-aware mode: AI searches project memory before writing significant code.',
      },
      {
        name: 'codemem-full',
        description: 'Full mode: combines context-aware retrieval + auto-save behaviors.',
      },
    ],
  };
});

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name } = request.params;

  const autoSaveInstructions = `## CodeMem Auto-Save Instructions

You have access to CodeMem persistent memory.

Context: user "${DEFAULT_USER_ID}", group "${DEFAULT_GROUP_ID}", session "${SESSION_ID}", platform "${PLATFORM}".

After each significant task, save:
- architectural decisions via \`save_project_decision\`
- coding preferences via \`add_developer_preference\`
- future tasks/tech debt via \`add_foresight_todo\`

Rules:
- save silently
- avoid duplicates
- skip trivial details`;

  const contextAwareInstructions = `## CodeMem Context-Aware Instructions

Before significant code changes, search project memory:
- call \`search_project_memory\`
- respect existing decisions/preferences unless current request overrides them
- use scope intentionally: session/repo/all`;

  switch (name) {
    case 'codemem-auto':
      return {
        description: 'Auto-save mode for CodeMem',
        messages: [{ role: 'user' as const, content: { type: 'text' as const, text: autoSaveInstructions } }],
      };
    case 'codemem-context':
      return {
        description: 'Context-aware mode for CodeMem',
        messages: [{ role: 'user' as const, content: { type: 'text' as const, text: contextAwareInstructions } }],
      };
    case 'codemem-full':
      return {
        description: 'Full autopilot mode for CodeMem',
        messages: [
          {
            role: 'user' as const,
            content: { type: 'text' as const, text: `${contextAwareInstructions}\n\n${autoSaveInstructions}` },
          },
        ],
      };
    default:
      throw new McpError(ErrorCode.InvalidRequest, `Unknown prompt: ${name}`);
  }
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'save_project_decision',
        description:
          'Save a technical decision with dual writes: narrative context + atomic fact for stronger hierarchical retrieval. Optionally anchor to specific files and architectural layer for spatial retrieval.',
        inputSchema: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'Architectural decision and concise rationale.' },
            affected_files: {
              type: 'array',
              items: { type: 'string' },
              description: 'File paths this decision affects (e.g. ["src/api/routes.ts", "src/db/schema.ts"]). Embedded in content prefix for keyword-based file-scoped search.',
            },
            component_layer: {
              type: 'string',
              description: 'Architectural layer this decision belongs to (e.g. "api", "database", "frontend", "auth", "infrastructure").',
            },
            supersedes_ids: {
              type: 'array',
              items: { type: 'string' },
              description: 'Memory IDs that this decision replaces. Superseded memories are automatically filtered from future search results.',
            },
            wait_for_completion: {
              type: 'boolean',
              description: 'If true, poll request status until completion or timeout.',
            },
            timeout_seconds: {
              type: 'number',
              description: 'Polling timeout when wait_for_completion is true. Default 20.',
            },
          },
          required: ['content'],
        },
      },
      {
        name: 'search_project_memory',
        description:
          'Search memory with scope control. Retrieval method is auto-orchestrated unless explicitly provided. Supports file-scoped filtering and automatic supersession deduplication.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query.' },
            retrieve_method: {
              type: 'string',
              enum: ['hybrid', 'agentic', 'keyword', 'vector'],
              description: 'Optional explicit retrieval method. If omitted, CodeMem chooses automatically.',
            },
            scope: {
              type: 'string',
              enum: ['session', 'repo', 'all'],
              description: 'session=current session, repo=current project, all=all projects for current user.',
            },
            file_filter: {
              type: 'string',
              description: 'Filter results to memories anchored to this file path (e.g. "src/api/routes.ts"). Matches against the [files:...] content prefix and memory text.',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'search_project_memory_index',
        description:
          'Step 1 (compact index): return lightweight results with IDs, relevance, and estimated read cost. Supports file-scoped filtering and automatic supersession deduplication.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query.' },
            retrieve_method: {
              type: 'string',
              enum: ['hybrid', 'agentic', 'keyword', 'vector'],
              description: 'Optional explicit retrieval method. If omitted, CodeMem chooses automatically.',
            },
            scope: {
              type: 'string',
              enum: ['session', 'repo', 'all'],
              description: 'session=current session, repo=current project, all=all projects for current user.',
            },
            file_filter: {
              type: 'string',
              description: 'Filter results to memories anchored to this file path (e.g. "src/api/routes.ts").',
            },
            limit: {
              type: 'number',
              description: 'Max index rows to return (1-20, default 10).',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'get_memory_timeline',
        description:
          'Step 2 (timeline): show chronological context around one memory ID from recent memories.',
        inputSchema: {
          type: 'object',
          properties: {
            anchor_memory_id: { type: 'string', description: 'Target memory ID to center timeline around.' },
            memory_type: {
              type: 'string',
              enum: ['episodic_memory', 'event_log', 'profile', 'foresight'],
              description: 'Memory type to search for anchor and timeline context.',
            },
            before: { type: 'number', description: 'Items before anchor in timeline (default 3).' },
            after: { type: 'number', description: 'Items after anchor in timeline (default 3).' },
            max_pages: { type: 'number', description: 'Max pages to scan for context (default 10).' },
          },
          required: ['anchor_memory_id'],
        },
      },
      {
        name: 'get_memory_details',
        description:
          'Step 3 (details): fetch full memory records by ID from paginated storage for deep reading.',
        inputSchema: {
          type: 'object',
          properties: {
            memory_ids: {
              type: 'array',
              items: { type: 'string' },
              description: 'IDs of memories to fetch.',
            },
            memory_type: {
              type: 'string',
              enum: ['episodic_memory', 'event_log', 'profile', 'foresight'],
              description: 'Memory type to scan (defaults to episodic_memory).',
            },
            max_pages: { type: 'number', description: 'Max pages to scan for IDs (default 20).' },
          },
          required: ['memory_ids'],
        },
      },
      {
        name: 'add_developer_preference',
        description: 'Save a developer preference as profile memory. Optionally anchor to specific files for spatial retrieval.',
        inputSchema: {
          type: 'object',
          properties: {
            preference: { type: 'string', description: 'Preference or coding rule to store.' },
            affected_files: {
              type: 'array',
              items: { type: 'string' },
              description: 'File paths this preference applies to (e.g. ["src/components/**"]). Embedded in content prefix for keyword-based file-scoped search.',
            },
            wait_for_completion: {
              type: 'boolean',
              description: 'If true, poll request status until completion or timeout.',
            },
            timeout_seconds: {
              type: 'number',
              description: 'Polling timeout when wait_for_completion is true. Default 20.',
            },
          },
          required: ['preference'],
        },
      },
      {
        name: 'list_recent_memories',
        description: 'List memories by type with pagination.',
        inputSchema: {
          type: 'object',
          properties: {
            memory_type: {
              type: 'string',
              enum: ['episodic_memory', 'event_log', 'profile', 'foresight'],
              description: 'Memory type to list.',
            },
            page: { type: 'number', description: 'Page number (>= 1).' },
            page_size: { type: 'number', description: 'Page size (<= 100).' },
          },
          required: [],
        },
      },
      {
        name: 'delete_memory',
        description: 'Delete one memory by ID, or bulk-delete by memory_type with explicit confirmation.',
        inputSchema: {
          type: 'object',
          properties: {
            memory_id: {
              type: 'string',
              description: 'Memory ID. Use "__all__" only for bulk delete.',
            },
            memory_type: {
              type: 'string',
              enum: ['episodic_memory', 'event_log', 'profile', 'foresight'],
              description: 'Required for bulk delete.',
            },
            confirm: {
              type: 'boolean',
              description: 'Must be true for bulk delete operations.',
            },
          },
          required: [],
        },
      },
      {
        name: 'add_foresight_todo',
        description: 'Save a future task/tech debt item as foresight memory. Optionally anchor to specific files and architectural layer.',
        inputSchema: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'Future task or plan.' },
            affected_files: {
              type: 'array',
              items: { type: 'string' },
              description: 'File paths this task relates to (e.g. ["src/api/rate-limit.ts"]). Embedded in content prefix for keyword-based file-scoped search.',
            },
            component_layer: {
              type: 'string',
              description: 'Architectural layer (e.g. "api", "database", "frontend", "auth", "infrastructure").',
            },
            wait_for_completion: {
              type: 'boolean',
              description: 'If true, poll request status until completion or timeout.',
            },
            timeout_seconds: {
              type: 'number',
              description: 'Polling timeout when wait_for_completion is true. Default 20.',
            },
          },
          required: ['content'],
        },
      },
      {
        name: 'consolidate_memories',
        description:
          'Merge fragmented episodic memories into a single canonical profile-level fact. The AI should first search for related fragments, synthesize them, then call this tool with the consolidated summary and source IDs. Source memories are deleted after consolidation. Demonstrates the Memory → Reasoning → Action loop.',
        inputSchema: {
          type: 'object',
          properties: {
            consolidated_fact: {
              type: 'string',
              description: 'The AI-synthesized canonical summary merging all source fragments into one clear fact.',
            },
            source_memory_ids: {
              type: 'array',
              items: { type: 'string' },
              description: 'IDs of the fragmented episodic memories being consolidated. These will be deleted after the canonical fact is saved.',
            },
            affected_files: {
              type: 'array',
              items: { type: 'string' },
              description: 'File paths the consolidated fact relates to.',
            },
            component_layer: {
              type: 'string',
              description: 'Architectural layer (e.g. "api", "database", "frontend").',
            },
            wait_for_completion: {
              type: 'boolean',
              description: 'If true, poll until the consolidated write completes. Default false.',
            },
            timeout_seconds: {
              type: 'number',
              description: 'Polling timeout. Default 20.',
            },
          },
          required: ['consolidated_fact', 'source_memory_ids'],
        },
      },
      {
        name: 'scan_stale_memories',
        description:
          'Detect potentially stale memories by cross-referencing recent git changes against file-anchored memories. Returns memories whose anchored files have been modified in recent commits, indicating the decision may need review.',
        inputSchema: {
          type: 'object',
          properties: {
            commits_back: {
              type: 'number',
              description: 'How many commits back to scan for changed files. Default 5, max 20.',
            },
            query: {
              type: 'string',
              description: 'Optional query to narrow the memory search. If omitted, searches broadly for file-anchored decisions.',
            },
          },
          required: [],
        },
      },
      {
        name: 'get_conversation_meta',
        description: 'Get conversation metadata for the current group or a specified group_id.',
        inputSchema: {
          type: 'object',
          properties: {
            group_id: {
              type: 'string',
              description: 'Optional group_id. Defaults to current project group.',
            },
          },
          required: [],
        },
      },
      {
        name: 'update_conversation_meta',
        description: 'Update conversation metadata to tune extraction/retrieval behavior.',
        inputSchema: {
          type: 'object',
          properties: {
            group_id: { type: 'string', description: 'Optional group_id. Defaults to current project group.' },
            description: { type: 'string', description: 'Conversation description.' },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Tags to apply.',
            },
            default_timezone: { type: 'string', description: 'Default timezone, e.g. America/Los_Angeles.' },
            scene_desc: { type: 'object', description: 'Scene description object.' },
            user_details: { type: 'object', description: 'Per-user metadata object.' },
            llm_custom_setting: { type: 'object', description: 'Boundary/extraction model overrides.' },
          },
          required: [],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const toolStart = Date.now();
  const toolName = request.params.name;

  try {
    switch (toolName) {
      case 'save_project_decision': {
        const args = request.params.arguments as {
          content: string;
          affected_files?: string[];
          component_layer?: string;
          supersedes_ids?: string[];
        } & WaitOptions;
        const sanitized = sanitizeForMemoryWrite(args.content);
        if (!sanitized) {
          return {
            content: [
              {
                type: 'text',
                text: 'Decision not saved because all content was marked private.',
              },
            ],
          };
        }
        if (writeDedupe.isDuplicate('save_project_decision', sanitized)) {
          return {
            content: [
              {
                type: 'text',
                text: 'Decision deduped: same content was already saved recently in this session window.',
              },
            ],
          };
        }

        const prefix = buildContentPrefix({
          affectedFiles: args.affected_files,
          componentLayer: args.component_layer,
        });
        const supersedesTag = args.supersedes_ids?.length
          ? `[supersedes:${args.supersedes_ids.join(',')}] `
          : '';

        if (args.affected_files?.length) {
          autoTagConversationMeta(args.affected_files);
        }

        // Write episodic first, then link the event write back to it via refer_list
        // (refer_list is for message ID threading, not file paths)
        const episodicMsgId = buildMessageId('decisionepi');
        const episodicPayload: AddMemoryRequest = {
          message_id: episodicMsgId,
          create_time: new Date().toISOString(),
          sender: DEFAULT_USER_ID,
          role: 'assistant',
          group_id: DEFAULT_GROUP_ID,
          content: `${prefix}${supersedesTag}Architectural decision and rationale: ${sanitized}`,
          flush: true,
        };

        const eventPayload: AddMemoryRequest = {
          message_id: buildMessageId('decisionfact'),
          create_time: new Date().toISOString(),
          sender: DEFAULT_USER_ID,
          role: 'assistant',
          group_id: DEFAULT_GROUP_ID,
          content: `${prefix}${supersedesTag}Atomic engineering fact: ${sanitized}`,
          refer_list: [episodicMsgId], // Thread event back to episodic for conversation graph
          flush: true,
        };

        const episodicResult = await addMemoryWithOptionalWait(episodicPayload, args);
        const eventResult = await addMemoryWithOptionalWait(eventPayload, args);

        const anchorInfo = args.affected_files?.length ? ` anchored to ${args.affected_files.length} file(s)` : '';
        const supersedesInfo = args.supersedes_ids?.length ? ` superseding ${args.supersedes_ids.length} prior decision(s)` : '';
        return {
          content: [
            {
              type: 'text',
              text:
                `Decision saved with hierarchical writes${anchorInfo}${supersedesInfo}:\n` +
                `- episodic request_id: ${episodicResult.result?.request_id || 'n/a'} status: ${episodicResult.finalStatus}\n` +
                `- event-like request_id: ${eventResult.result?.request_id || 'n/a'} status: ${eventResult.finalStatus}`,
            },
          ],
        };
      }

      case 'search_project_memory': {
        const args = request.params.arguments as {
          query: string;
          retrieve_method?: string;
          scope?: string;
          file_filter?: string;
        };
        const scope = normalizeScope(args.scope, DEFAULT_MEMORY_SCOPE);
        const searchFilters = buildSearchFilters(scope, DEFAULT_USER_ID, DEFAULT_GROUP_ID);
        const selectedMethod = chooseRetrieveMethod(args.query, args.retrieve_method);

        let result: any;
        let methodUsed = selectedMethod;
        let fallbackUsed = false;

        try {
          result = await evermem.searchMemories({
            ...searchFilters,
            query: args.query,
            memory_types: ['episodic_memory', 'profile'],
            retrieve_method: selectedMethod,
            top_k: 20,
          });
        } catch (error) {
          if (selectedMethod === 'agentic') {
            fallbackUsed = true;
            methodUsed = 'hybrid';
            result = await evermem.searchMemories({
              ...searchFilters,
              query: args.query,
              memory_types: ['episodic_memory', 'profile'],
              retrieve_method: 'hybrid',
              top_k: 20,
            });
          } else {
            throw error;
          }
        }

        let filteredMemories = (result?.result?.memories || []) as SearchMemoryRecord[];
        if (scope === 'session') {
          filteredMemories = filteredMemories.filter((mem) => {
            const session = getSessionFromMemory(mem);
            return session === SESSION_ID || session === null;
          });
        }

        // Phase 2a: file-scoped filtering
        if (args.file_filter) {
          filteredMemories = filteredMemories.filter((mem) => matchesFileFilter(mem, args.file_filter!));
        }

        // Phase 2b: supersession deduplication
        filteredMemories = filterSuperseded(filteredMemories);

        let output = '';
        let count = 0;
        for (const [idx, mem] of filteredMemories.slice(0, 10).entries()) {
          count += 1;
          const memSession = getSessionFromMemory(mem);
          const memPlatform = getPlatformFromMemory(mem);
          const sessionLabel = memSession ? (memSession === SESSION_ID ? 'current' : memSession) : 'unknown-session';
          const platformLabel = memPlatform ? ` via ${memPlatform}` : '';

          output += `[${idx + 1}] Type: ${mem.memory_type} [${sessionLabel}${platformLabel}]`;
          if (mem.summary) output += ` | Summary: ${mem.summary}`;
          if (mem.atomic_fact) output += ` | Fact: ${mem.atomic_fact}`;
          if (mem.foresight) output += ` | Plan: ${mem.foresight}`;
          if (mem.timestamp) output += ` | Time: ${mem.timestamp}`;
          if (mem.score) output += ` | Relevance: ${(mem.score * 100).toFixed(0)}%`;
          output += '\n';
        }

        const profiles = result?.result?.profiles || [];
        if (scope !== 'session' && profiles.length > 0) {
          for (const prof of profiles) {
            count += 1;
            const label = prof.category || prof.trait_name || 'Preference';
            output += `[Profile] ${label}: ${prof.description}`;
            if (prof.score) output += ` | Relevance: ${(prof.score * 100).toFixed(0)}%`;
            output += '\n';
          }
        }

        const filterLabel = args.file_filter ? `, file: ${args.file_filter}` : '';
        if (count === 0) {
          output = `No relevant memories found (scope: ${scope}, method: ${methodUsed}${filterLabel}).`;
        } else {
          output =
            `Found ${count} memories (scope: ${scope}, method: ${methodUsed}${fallbackUsed ? ', fallback: yes' : ''}${filterLabel}):\n\n` +
            output;
        }

        return { content: [{ type: 'text', text: output }] };
      }

      case 'search_project_memory_index': {
        const args = request.params.arguments as {
          query: string;
          retrieve_method?: string;
          scope?: string;
          file_filter?: string;
          limit?: number;
        };
        const scope = normalizeScope(args.scope, DEFAULT_MEMORY_SCOPE);
        const searchFilters = buildSearchFilters(scope, DEFAULT_USER_ID, DEFAULT_GROUP_ID);
        const selectedMethod = chooseRetrieveMethod(args.query, args.retrieve_method);
        const limit = Math.min(20, Math.max(1, Math.floor(args.limit || 10)));

        let result: any;
        let methodUsed = selectedMethod;
        let fallbackUsed = false;

        try {
          result = await evermem.searchMemories({
            ...searchFilters,
            query: args.query,
            memory_types: ['episodic_memory', 'profile'],
            retrieve_method: selectedMethod,
            top_k: 30,
          });
        } catch (error) {
          if (selectedMethod === 'agentic') {
            fallbackUsed = true;
            methodUsed = 'hybrid';
            result = await evermem.searchMemories({
              ...searchFilters,
              query: args.query,
              memory_types: ['episodic_memory', 'profile'],
              retrieve_method: 'hybrid',
              top_k: 30,
            });
          } else {
            throw error;
          }
        }

        let memories = (result?.result?.memories || []) as SearchMemoryRecord[];
        if (scope === 'session') {
          memories = memories.filter((mem) => {
            const session = getSessionFromMemory(mem);
            return session === SESSION_ID || session === null;
          });
        }

        // Phase 2a: file-scoped filtering
        if (args.file_filter) {
          memories = memories.filter((mem) => matchesFileFilter(mem, args.file_filter!));
        }

        // Phase 2b: supersession deduplication
        memories = filterSuperseded(memories);

        const rows = memories.slice(0, limit).map((mem, idx) => {
          const session = getSessionFromMemory(mem);
          const platform = getPlatformFromMemory(mem);
          const sessionLabel = session ? (session === SESSION_ID ? 'current' : session) : 'unknown-session';
          const platformLabel = platform ? ` via ${platform}` : '';
          const brief = mem.summary || mem.atomic_fact || mem.content || '(no summary)';
          const compact = brief.length > 140 ? `${brief.slice(0, 137)}...` : brief;
          const cost = estimateTokenCount([brief]);
          const relevance = mem.score ? `${(mem.score * 100).toFixed(0)}%` : 'n/a';
          return `[${idx + 1}] id=${mem.id || 'n/a'} | ${mem.memory_type || 'unknown'} | ${relevance} | ~${cost} tokens | [${sessionLabel}${platformLabel}] | ${compact}`;
        });

        const total = rows.length;
        const estimatedReadTokens = memories.slice(0, limit).reduce((acc, mem) => {
          return acc + estimateTokenCount([mem.summary, mem.atomic_fact, mem.content]);
        }, 0);

        const filterLabel = args.file_filter ? `, file: ${args.file_filter}` : '';
        const text =
          total === 0
            ? `No relevant memories found (scope: ${scope}, method: ${methodUsed}${filterLabel}).`
            : `Index results: ${total} (scope: ${scope}, method: ${methodUsed}${fallbackUsed ? ', fallback: yes' : ''}${filterLabel}, est_read_tokens: ~${estimatedReadTokens})\n\n${rows.join('\n')}`;

        return { content: [{ type: 'text', text }] };
      }

      case 'get_memory_timeline': {
        const args = request.params.arguments as {
          anchor_memory_id: string;
          memory_type?: 'episodic_memory' | 'event_log' | 'profile' | 'foresight';
          before?: number;
          after?: number;
          max_pages?: number;
        };

        const memoryType = args.memory_type || 'episodic_memory';
        const before = Math.min(10, Math.max(0, Math.floor(args.before || 3)));
        const after = Math.min(10, Math.max(0, Math.floor(args.after || 3)));
        const maxPages = Math.min(30, Math.max(1, Math.floor(args.max_pages || 10)));

        const memories = await listMemoriesWindow(memoryType, maxPages, 50);
        const withTime = memories
          .filter((mem) => (mem.timestamp || mem.created_at))
          .sort((a, b) => {
            const ta = new Date(a.timestamp || a.created_at || 0).getTime();
            const tb = new Date(b.timestamp || b.created_at || 0).getTime();
            return ta - tb;
          });

        const anchorIdx = withTime.findIndex((mem) => mem.id === args.anchor_memory_id);
        if (anchorIdx < 0) {
          return {
            content: [
              {
                type: 'text',
                text: `Anchor memory not found in scanned window (memory_type: ${memoryType}, max_pages: ${maxPages}).`,
              },
            ],
          };
        }

        const start = Math.max(0, anchorIdx - before);
        const end = Math.min(withTime.length - 1, anchorIdx + after);
        const timeline = withTime.slice(start, end + 1);
        const formatted = timeline
          .map((mem) => {
            const marker = mem.id === args.anchor_memory_id ? '*' : ' ';
            const ts = mem.timestamp || mem.created_at || 'unknown-time';
            const label = mem.summary || mem.atomic_fact || mem.foresight || mem.content || '(no content)';
            const compact = label.length > 160 ? `${label.slice(0, 157)}...` : label;
            return `${marker} ${ts} | id=${mem.id || 'n/a'} | ${compact}`;
          })
          .join('\n');

        return {
          content: [
            {
              type: 'text',
              text: `Timeline around ${args.anchor_memory_id} (* = anchor)\n\n${formatted}`,
            },
          ],
        };
      }

      case 'get_memory_details': {
        const args = request.params.arguments as {
          memory_ids: string[];
          memory_type?: 'episodic_memory' | 'event_log' | 'profile' | 'foresight';
          max_pages?: number;
        };

        const targetIds = new Set((args.memory_ids || []).filter(Boolean));
        if (targetIds.size === 0) {
          throw new McpError(ErrorCode.InvalidParams, 'memory_ids must contain at least one ID.');
        }

        const memoryType = args.memory_type || 'episodic_memory';
        const maxPages = Math.min(40, Math.max(1, Math.floor(args.max_pages || 20)));
        const memories = await listMemoriesWindow(memoryType, maxPages, 50);

        const found = memories.filter((mem) => mem.id && targetIds.has(mem.id));
        const foundIds = new Set(found.map((mem) => mem.id as string));
        const missing = Array.from(targetIds).filter((id) => !foundIds.has(id));

        const body = found
          .map((mem, index) => {
            return [
              `[${index + 1}] ID: ${mem.id}`,
              mem.summary ? `Summary: ${mem.summary}` : '',
              mem.atomic_fact ? `Fact: ${mem.atomic_fact}` : '',
              mem.foresight ? `Plan: ${mem.foresight}` : '',
              mem.profile_data ? `Profile: ${JSON.stringify(mem.profile_data)}` : '',
              mem.content ? `Content: ${mem.content}` : '',
              mem.timestamp || mem.created_at ? `Time: ${mem.timestamp || mem.created_at}` : '',
            ]
              .filter(Boolean)
              .join('\n');
          })
          .join('\n\n');

        return {
          content: [
            {
              type: 'text',
              text:
                `Found ${found.length}/${targetIds.size} requested memories (memory_type: ${memoryType}, max_pages: ${maxPages}).` +
                (missing.length > 0 ? ` Missing: ${missing.join(', ')}` : '') +
                (body ? `\n\n${body}` : ''),
            },
          ],
        };
      }

      case 'add_developer_preference': {
        const args = request.params.arguments as {
          preference: string;
          affected_files?: string[];
        } & WaitOptions;
        const sanitized = sanitizeForMemoryWrite(args.preference);
        if (!sanitized) {
          return {
            content: [
              {
                type: 'text',
                text: 'Preference not saved because all content was marked private.',
              },
            ],
          };
        }
        if (writeDedupe.isDuplicate('add_developer_preference', sanitized)) {
          return {
            content: [
              {
                type: 'text',
                text: 'Preference deduped: same content was already saved recently in this session window.',
              },
            ],
          };
        }

        const prefix = buildContentPrefix({ affectedFiles: args.affected_files });

        if (args.affected_files?.length) {
          autoTagConversationMeta(args.affected_files);
        }

        const write = await addMemoryWithOptionalWait(
          {
            message_id: buildMessageId('pref'),
            create_time: new Date().toISOString(),
            sender: DEFAULT_USER_ID,
            group_id: DEFAULT_GROUP_ID,
            role: 'user',
            content: `${prefix}Developer preference: ${sanitized}`,
            flush: true,
          },
          args
        );

        return {
          content: [
            {
              type: 'text',
              text: `Preference saved. request_id: ${write.result?.request_id || 'n/a'}, status: ${write.finalStatus}`,
            },
          ],
        };
      }

      case 'list_recent_memories': {
        const args = request.params.arguments as { memory_type?: string; page?: number; page_size?: number };
        const result = await evermem.getMemories({
          user_id: DEFAULT_USER_ID,
          group_ids: [DEFAULT_GROUP_ID],
          memory_type: (args?.memory_type as any) || 'episodic_memory',
          page: args?.page || 1,
          page_size: args?.page_size || 10,
        });

        const memories = result?.result?.memories || [];
        const totalCount = result?.result?.total_count || 0;
        if (memories.length === 0) {
          return {
            content: [{ type: 'text', text: `No ${(args?.memory_type as string) || 'episodic_memory'} memories found.` }],
          };
        }

        let formatted = `Showing ${memories.length} of ${totalCount} ${(args?.memory_type as string) || 'episodic_memory'} memories:\n\n`;
        memories.forEach((mem: any, index: number) => {
          const num = ((args?.page || 1) - 1) * (args?.page_size || 10) + index + 1;
          formatted += `[${num}] ID: ${mem.id}\n`;
          if (mem.summary) formatted += `    Summary: ${mem.summary}\n`;
          if (mem.atomic_fact) formatted += `    Fact: ${mem.atomic_fact}\n`;
          if (mem.foresight) formatted += `    Plan: ${mem.foresight}\n`;
          if (mem.profile_data) formatted += `    Profile: ${JSON.stringify(mem.profile_data)}\n`;
          if (mem.content) formatted += `    Content: ${mem.content}\n`;
          if (mem.timestamp || mem.created_at) formatted += `    Time: ${mem.timestamp || mem.created_at}\n`;
          formatted += '\n';
        });

        return { content: [{ type: 'text', text: formatted }] };
      }

      case 'delete_memory': {
        const args = request.params.arguments as { memory_id?: string; memory_type?: string; confirm?: boolean };
        const memoryId = args?.memory_id;
        const memoryType = args?.memory_type;
        const bulk = isBulkDelete(memoryId);

        if (!memoryId && !memoryType) {
          throw new McpError(
            ErrorCode.InvalidParams,
            'Provide memory_id for single delete, or memory_type with confirm=true for bulk delete.'
          );
        }

        if (bulk && !memoryType) {
          throw new McpError(ErrorCode.InvalidParams, 'Bulk delete requires memory_type.');
        }

        if (bulk && args?.confirm !== true) {
          throw new McpError(
            ErrorCode.InvalidParams,
            'Bulk delete requires confirm=true to prevent accidental mass deletion.'
          );
        }

        const payload = {
          memory_id: memoryId || '__all__',
          user_id: DEFAULT_USER_ID,
          group_id: DEFAULT_GROUP_ID,
          memory_type: memoryType as any,
        };

        const result = await evermem.deleteMemories(payload);
        const mode = bulk ? `bulk ${memoryType}` : `single ${memoryId}`;
        return {
          content: [{ type: 'text', text: `Delete success (${mode}). ${JSON.stringify(result)}` }],
        };
      }

      case 'add_foresight_todo': {
        const args = request.params.arguments as {
          content: string;
          affected_files?: string[];
          component_layer?: string;
        } & WaitOptions;
        const sanitized = sanitizeForMemoryWrite(args.content);
        if (!sanitized) {
          return {
            content: [
              {
                type: 'text',
                text: 'Future task not saved because all content was marked private.',
              },
            ],
          };
        }
        if (writeDedupe.isDuplicate('add_foresight_todo', sanitized)) {
          return {
            content: [
              {
                type: 'text',
                text: 'Future task deduped: same content was already saved recently in this session window.',
              },
            ],
          };
        }

        const prefix = buildContentPrefix({
          affectedFiles: args.affected_files,
          componentLayer: args.component_layer,
        });

        if (args.affected_files?.length) {
          autoTagConversationMeta(args.affected_files);
        }

        const write = await addMemoryWithOptionalWait(
          {
            message_id: buildMessageId('todo'),
            create_time: new Date().toISOString(),
            sender: DEFAULT_USER_ID,
            group_id: DEFAULT_GROUP_ID,
            role: 'assistant',
            content: `${prefix}Future task / tech debt: ${sanitized}`,
            flush: true,
          },
          args
        );

        return {
          content: [
            {
              type: 'text',
              text: `Future task saved. request_id: ${write.result?.request_id || 'n/a'}, status: ${write.finalStatus}`,
            },
          ],
        };
      }

      case 'consolidate_memories': {
        const args = request.params.arguments as {
          consolidated_fact: string;
          source_memory_ids: string[];
          affected_files?: string[];
          component_layer?: string;
        } & WaitOptions;

        const sanitized = sanitizeForMemoryWrite(args.consolidated_fact);
        if (!sanitized) {
          return {
            content: [{ type: 'text', text: 'Consolidated fact not saved because all content was marked private.' }],
          };
        }

        const sourceIds = (args.source_memory_ids || []).filter(Boolean);
        if (sourceIds.length === 0) {
          throw new McpError(ErrorCode.InvalidParams, 'source_memory_ids must contain at least one ID.');
        }

        const prefix = buildContentPrefix({
          affectedFiles: args.affected_files,
          componentLayer: args.component_layer,
        });
        const consolidationTag = `[consolidated from ${sourceIds.length} sources] `;
        const supersedesTag = `[supersedes:${sourceIds.join(',')}] `;

        if (args.affected_files?.length) {
          autoTagConversationMeta(args.affected_files);
        }

        // Write the canonical consolidated fact
        const writeResult = await addMemoryWithOptionalWait(
          {
            message_id: buildMessageId('consolidated'),
            create_time: new Date().toISOString(),
            sender: DEFAULT_USER_ID,
            role: 'assistant',
            group_id: DEFAULT_GROUP_ID,
            content: `${prefix}${consolidationTag}${supersedesTag}Consolidated fact: ${sanitized}`,
            flush: true,
          },
          args
        );

        // Delete source fragments
        const deleteResults: Array<{ id: string; success: boolean }> = [];
        for (const sourceId of sourceIds) {
          try {
            await evermem.deleteMemories({
              memory_id: sourceId,
              user_id: DEFAULT_USER_ID,
              group_id: DEFAULT_GROUP_ID,
            });
            deleteResults.push({ id: sourceId, success: true });
          } catch {
            deleteResults.push({ id: sourceId, success: false });
          }
        }

        const deletedCount = deleteResults.filter((d) => d.success).length;
        const failedDeletes = deleteResults.filter((d) => !d.success);
        const failedInfo = failedDeletes.length > 0
          ? ` (failed to delete: ${failedDeletes.map((d) => d.id).join(', ')})`
          : '';

        logEvent('info', 'memory.consolidated', {
          source_count: sourceIds.length,
          deleted_count: deletedCount,
          request_id: writeResult.result?.request_id,
        });

        return {
          content: [
            {
              type: 'text',
              text:
                `Consolidation complete: ${sourceIds.length} fragments → 1 canonical fact.\n` +
                `- Write request_id: ${writeResult.result?.request_id || 'n/a'}, status: ${writeResult.finalStatus}\n` +
                `- Deleted ${deletedCount}/${sourceIds.length} source fragments${failedInfo}`,
            },
          ],
        };
      }

      case 'scan_stale_memories': {
        const args = request.params.arguments as {
          commits_back?: number;
          query?: string;
        };

        const commitsBack = Math.min(20, Math.max(1, Math.floor(args.commits_back || 5)));

        // Get recently changed files from git
        let changedFiles: string[] = [];
        try {
          const diffOutput = execSync(`git diff --name-only HEAD~${commitsBack}`, { encoding: 'utf-8' }).trim();
          changedFiles = diffOutput.split('\n').filter(Boolean);
        } catch {
          try {
            // Fallback: if HEAD~N doesn't exist (shallow clone or few commits), use HEAD~1
            const diffOutput = execSync('git diff --name-only HEAD~1', { encoding: 'utf-8' }).trim();
            changedFiles = diffOutput.split('\n').filter(Boolean);
          } catch {
            return {
              content: [{ type: 'text', text: 'Cannot scan for stale memories: not in a git repository or no commit history.' }],
            };
          }
        }

        if (changedFiles.length === 0) {
          return {
            content: [{ type: 'text', text: `No files changed in the last ${commitsBack} commit(s). No stale memories to report.` }],
          };
        }

        // Search memories that might reference changed files
        const searchQuery = args.query || 'architectural decision technical preference';
        const searchFilters = buildSearchFilters('repo', DEFAULT_USER_ID, DEFAULT_GROUP_ID);

        let memories: SearchMemoryRecord[] = [];
        try {
          const result = await evermem.searchMemories({
            ...searchFilters,
            query: searchQuery,
            memory_types: ['episodic_memory', 'profile'],
            retrieve_method: 'hybrid',
            top_k: 30,
          });
          memories = (result?.result?.memories || []) as SearchMemoryRecord[];
        } catch {
          return {
            content: [{ type: 'text', text: 'Failed to search memories for staleness check.' }],
            isError: true,
          };
        }

        // Cross-reference: find memories whose content references changed files
        const staleMatches: Array<{
          memory: SearchMemoryRecord;
          matchedFiles: string[];
        }> = [];

        for (const mem of memories) {
          const memText = [mem.summary, mem.atomic_fact, mem.content].filter(Boolean).join(' ');
          const memFiles = extractFilesFromContent(memText);
          const matchedFiles: string[] = [];

          for (const changedFile of changedFiles) {
            // Check if memory content mentions the changed file
            if (memText.includes(changedFile)) {
              matchedFiles.push(changedFile);
            } else {
              // Check extracted files list for partial matches
              for (const memFile of memFiles) {
                if (memFile.includes(changedFile) || changedFile.includes(memFile)) {
                  matchedFiles.push(changedFile);
                  break;
                }
              }
            }
          }

          if (matchedFiles.length > 0) {
            staleMatches.push({ memory: mem, matchedFiles });
          }
        }

        if (staleMatches.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `Scanned ${changedFiles.length} changed file(s) across ${commitsBack} commit(s) against ${memories.length} memories. No potentially stale memories found.`,
              },
            ],
          };
        }

        const rows = staleMatches.map((match, idx) => {
          const mem = match.memory;
          const brief = mem.summary || mem.atomic_fact || mem.content || '(no content)';
          const compact = brief.length > 120 ? `${brief.slice(0, 117)}...` : brief;
          return `[${idx + 1}] id=${mem.id || 'n/a'} | changed: ${match.matchedFiles.join(', ')} | ${compact}`;
        });

        return {
          content: [
            {
              type: 'text',
              text:
                `Found ${staleMatches.length} potentially stale memor${staleMatches.length === 1 ? 'y' : 'ies'} ` +
                `(${changedFiles.length} file(s) changed in last ${commitsBack} commit(s)):\n\n` +
                `${rows.join('\n')}\n\n` +
                `Suggested actions:\n` +
                `- Review each memory to confirm if it is still accurate\n` +
                `- Use consolidate_memories to merge outdated fragments into updated canonical facts\n` +
                `- Use save_project_decision with supersedes_ids to record updated decisions`,
            },
          ],
        };
      }

      case 'get_conversation_meta': {
        const args = request.params.arguments as { group_id?: string };
        const result = await evermem.getConversationMeta({ group_id: args?.group_id || DEFAULT_GROUP_ID });
        return {
          content: [{ type: 'text', text: `Conversation metadata:\n${JSON.stringify(result, null, 2)}` }],
        };
      }

      case 'update_conversation_meta': {
        const args = request.params.arguments as {
          group_id?: string;
          description?: string;
          tags?: string[];
          default_timezone?: string;
          scene_desc?: Record<string, unknown>;
          user_details?: Record<string, unknown>;
          llm_custom_setting?: Record<string, unknown>;
        };

        const payload = {
          group_id: args?.group_id || DEFAULT_GROUP_ID,
          description: args?.description,
          tags: args?.tags,
          default_timezone: args?.default_timezone,
          scene_desc: args?.scene_desc,
          user_details: args?.user_details as any,
          llm_custom_setting: args?.llm_custom_setting as any,
        };

        const result = await evermem.updateConversationMeta(payload);
        return {
          content: [{ type: 'text', text: `Conversation metadata updated:\n${JSON.stringify(result, null, 2)}` }],
        };
      }

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
    }
  } catch (error: any) {
    logEvent('error', 'tool.error', {
      tool: toolName,
      duration_ms: Date.now() - toolStart,
      message: error?.message || 'Unknown error',
    });
    const message = error instanceof McpError ? error.message : `Error in ${toolName}: ${error?.message || 'unknown'}`;
    return {
      content: [{ type: 'text', text: message }],
      isError: true,
    };
  } finally {
    logEvent('info', 'tool.done', {
      tool: toolName,
      duration_ms: Date.now() - toolStart,
    });
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logEvent('info', 'server.started', {
    user_id: DEFAULT_USER_ID,
    group_id: DEFAULT_GROUP_ID,
    session_id: SESSION_ID,
    platform: PLATFORM,
    default_scope: DEFAULT_MEMORY_SCOPE,
    dedupe_window_seconds: DEDUPE_WINDOW_MS / 1000,
  });

  // Set assistant scene so EverMemOS extracts EventLog and Foresight memory types.
  // Without this, group_id triggers group-chat scene which only extracts episodic_memory.
  evermem.updateConversationMeta({
    group_id: DEFAULT_GROUP_ID,
    scene_desc: { scene: 'assistant', description: 'AI coding assistant session' },
  }).catch((err) => {
    logEvent('warn', 'server.scene_init_failed', { message: err?.message });
  });
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
