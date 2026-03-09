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
  getPlatformFromMessageId,
  getSessionFromMessageId,
  isBulkDelete,
  normalizeScope,
} from './policies.js';

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
const PLATFORM = detectPlatform();
const evermem = new EverMemClient(EVERMEM_API_KEY);

type WaitOptions = {
  wait_for_completion?: boolean;
  timeout_seconds?: number;
  poll_interval_ms?: number;
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
          'Save a technical decision with dual writes: narrative context + atomic fact for stronger hierarchical retrieval.',
        inputSchema: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'Architectural decision and concise rationale.' },
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
          'Search memory with scope control. Retrieval method is auto-orchestrated unless explicitly provided.',
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
          },
          required: ['query'],
        },
      },
      {
        name: 'add_developer_preference',
        description: 'Save a developer preference as profile memory.',
        inputSchema: {
          type: 'object',
          properties: {
            preference: { type: 'string', description: 'Preference or coding rule to store.' },
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
        description: 'Save a future task/tech debt item as foresight memory.',
        inputSchema: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'Future task or plan.' },
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
        const args = request.params.arguments as { content: string } & WaitOptions;

        const episodicPayload: AddMemoryRequest = {
          message_id: buildMessageId('decisionepi'),
          create_time: new Date().toISOString(),
          sender: DEFAULT_USER_ID,
          role: 'assistant',
          group_id: DEFAULT_GROUP_ID,
          content: `Architectural decision and rationale: ${args.content}`,
          flush: true,
        };

        const eventPayload: AddMemoryRequest = {
          message_id: buildMessageId('decisionfact'),
          create_time: new Date().toISOString(),
          sender: DEFAULT_USER_ID,
          role: 'assistant',
          group_id: DEFAULT_GROUP_ID,
          content: `Atomic engineering fact: ${args.content}`,
          flush: true,
        };

        const [episodicResult, eventResult] = await Promise.all([
          addMemoryWithOptionalWait(episodicPayload, args),
          addMemoryWithOptionalWait(eventPayload, args),
        ]);

        return {
          content: [
            {
              type: 'text',
              text:
                `Decision saved with hierarchical writes:\n` +
                `- episodic request_id: ${episodicResult.result?.request_id || 'n/a'} status: ${episodicResult.finalStatus}\n` +
                `- event-like request_id: ${eventResult.result?.request_id || 'n/a'} status: ${eventResult.finalStatus}`,
            },
          ],
        };
      }

      case 'search_project_memory': {
        const args = request.params.arguments as { query: string; retrieve_method?: string; scope?: string };
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

        let filteredMemories = result?.result?.memories || [];
        if (scope === 'session') {
          filteredMemories = filteredMemories.filter((mem: any) => {
            const messageId = mem.original_data?.[0]?.data?.[0]?.extend?.message_id as string | undefined;
            const session = getSessionFromMessageId(messageId || mem.id);
            return session === SESSION_ID;
          });
        }

        let output = '';
        let count = 0;
        for (const [idx, mem] of filteredMemories.slice(0, 10).entries()) {
          count += 1;
          const messageId = mem.original_data?.[0]?.data?.[0]?.extend?.message_id as string | undefined;
          const memSession = getSessionFromMessageId(messageId || mem.id);
          const memPlatform = getPlatformFromMessageId(messageId || mem.id);
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

        if (count === 0) {
          output = `No relevant memories found (scope: ${scope}, method: ${methodUsed}).`;
        } else {
          output =
            `Found ${count} memories (scope: ${scope}, method: ${methodUsed}${fallbackUsed ? ', fallback: yes' : ''}):\n\n` +
            output;
        }

        return { content: [{ type: 'text', text: output }] };
      }

      case 'add_developer_preference': {
        const args = request.params.arguments as { preference: string } & WaitOptions;

        const write = await addMemoryWithOptionalWait(
          {
            message_id: buildMessageId('pref'),
            create_time: new Date().toISOString(),
            sender: DEFAULT_USER_ID,
            group_id: DEFAULT_GROUP_ID,
            role: 'user',
            content: `Developer preference: ${args.preference}`,
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
        const args = request.params.arguments as { content: string } & WaitOptions;

        const write = await addMemoryWithOptionalWait(
          {
            message_id: buildMessageId('todo'),
            create_time: new Date().toISOString(),
            sender: DEFAULT_USER_ID,
            group_id: DEFAULT_GROUP_ID,
            role: 'assistant',
            content: `Future task / tech debt: ${args.content}`,
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
  });
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
