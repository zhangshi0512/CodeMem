import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import dotenv from 'dotenv';
import { EverMemClient } from './evermind-client.js';

// Load environment variables
dotenv.config();

const EVERMEM_API_KEY = process.env.EVERMEM_API_KEY;

if (!EVERMEM_API_KEY) {
  console.error("EVERMEM_API_KEY environment variable is not set.");
  process.exit(1);
}

const DEFAULT_USER_ID = process.env.USER_ID || 'codemem_user_1';
const DEFAULT_GROUP_ID = process.env.GROUP_ID || 'codemem_workspace_1';

const evermem = new EverMemClient(EVERMEM_API_KEY);

const server = new Server(
  {
    name: 'CodeMem',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define the tools we expose to the IDE
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'save_project_decision',
        description: 'Save an architectural decision, bug fix pattern, or important context to the project\'s long-term memory. Use this when you make or learn about a significant technical choice.',
        inputSchema: {
          type: 'object',
          properties: {
            content: {
              type: 'string',
              description: 'The content of the decision or context to save (e.g., "We chose PostgreSQL over MongoDB for the user data because we need relational joins").',
            },
          },
          required: ['content'],
        },
      },
      {
        name: 'search_project_memory',
        description: 'Search the project\'s memory for past decisions, context, or code patterns. Use this before writing code to check if relevant decisions or preferences already exist.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'What to search for (e.g., "What database do we use?", "authentication approach").',
            },
            retrieve_method: {
              type: 'string',
              enum: ['hybrid', 'agentic', 'keyword', 'vector'],
              description: 'Retrieval strategy. "hybrid" (default) combines keyword + vector search. "agentic" uses LLM-guided multi-round retrieval for complex queries.',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'add_developer_preference',
        description: 'Save a developer preference or coding style rule as Profile memory (e.g., "always use strict TypeScript", "prefer functional React components").',
        inputSchema: {
          type: 'object',
          properties: {
            preference: {
              type: 'string',
              description: 'The preference or rule to save.',
            },
          },
          required: ['preference'],
        },
      },
      {
        name: 'list_recent_memories',
        description: 'Browse saved memories by type. Use this to see what decisions, facts, or preferences have been recorded, or to review project history.',
        inputSchema: {
          type: 'object',
          properties: {
            memory_type: {
              type: 'string',
              enum: ['episodic_memory', 'event_log', 'profile', 'foresight'],
              description: 'Type of memory to list. "episodic_memory" for session summaries, "event_log" for atomic facts, "profile" for user preferences, "foresight" for future plans/TODOs.',
            },
            page: {
              type: 'number',
              description: 'Page number (starts from 1). Default: 1.',
            },
            page_size: {
              type: 'number',
              description: 'Number of results per page (max 100). Default: 10.',
            },
          },
          required: [],
        },
      },
      {
        name: 'delete_memory',
        description: 'Delete a specific memory by its ID, or delete all memories of a given type. Use with caution.',
        inputSchema: {
          type: 'object',
          properties: {
            memory_id: {
              type: 'string',
              description: 'The ID of the specific memory to delete. Use "__all__" to delete all matching memories (requires memory_type).',
            },
            memory_type: {
              type: 'string',
              enum: ['episodic_memory', 'event_log', 'profile', 'foresight'],
              description: 'Only delete memories of this type. Required when using "__all__".',
            },
          },
          required: [],
        },
      },
      {
        name: 'add_foresight_todo',
        description: 'Record a future task, tech debt item, or planned improvement as Foresight memory. The system will remember these for later retrieval.',
        inputSchema: {
          type: 'object',
          properties: {
            content: {
              type: 'string',
              description: 'The future task or plan (e.g., "Need to add rate limiting to the API before launch", "Refactor the auth module to use JWT instead of sessions").',
            },
          },
          required: ['content'],
        },
      },
    ],
  };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  switch (request.params.name) {
    case 'save_project_decision': {
      const args = request.params.arguments as { content: string };
      try {
        const result = await evermem.addMemory({
          message_id: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          create_time: new Date().toISOString(),
          sender: DEFAULT_USER_ID,
          role: 'assistant',
          group_id: DEFAULT_GROUP_ID,
          content: args.content,
          flush: true
        });
        return {
          content: [{ type: 'text', text: `Decision saved to project memory. Request ID: ${result.request_id || 'queued'}` }],
        };
      } catch (error: any) {
        return {
          content: [{ type: 'text', text: `Error saving decision: ${error.message}` }],
          isError: true,
        };
      }
    }

    case 'search_project_memory': {
      const args = request.params.arguments as { query: string; retrieve_method?: string };
      try {
        const result = await evermem.searchMemories({
          user_id: DEFAULT_USER_ID,
          group_ids: [DEFAULT_GROUP_ID],
          query: args.query,
          memory_types: ['episodic_memory', 'profile'],
          retrieve_method: (args.retrieve_method as any) || 'hybrid',
          top_k: 10
        });

        let formattedOutput = "";
        let resultCount = 0;

        if (result?.result?.memories?.length > 0) {
          result.result.memories.forEach((mem: any, index: number) => {
            resultCount++;
            formattedOutput += `[${index + 1}] Type: ${mem.memory_type}`;
            if (mem.summary) formattedOutput += ` | Summary: ${mem.summary}`;
            if (mem.atomic_fact) formattedOutput += ` | Fact: ${mem.atomic_fact}`;
            if (mem.foresight) formattedOutput += ` | Plan: ${mem.foresight}`;
            if (mem.timestamp) formattedOutput += ` | Time: ${mem.timestamp}`;
            if (mem.score) formattedOutput += ` | Relevance: ${(mem.score * 100).toFixed(0)}%`;
            formattedOutput += '\n';
          });
        }

        if (result?.result?.profiles?.length > 0) {
          result.result.profiles.forEach((prof: any, index: number) => {
            resultCount++;
            const label = prof.category || prof.trait_name || 'Preference';
            formattedOutput += `[Profile] ${label}: ${prof.description}`;
            if (prof.score) formattedOutput += ` | Relevance: ${(prof.score * 100).toFixed(0)}%`;
            formattedOutput += '\n';
          });
        }

        if (resultCount === 0) {
          formattedOutput = "No relevant memories found for this query.";
        } else {
          formattedOutput = `Found ${resultCount} relevant memories:\n\n${formattedOutput}`;
        }

        return {
          content: [{ type: 'text', text: formattedOutput }],
        };
      } catch (error: any) {
        return {
          content: [{ type: 'text', text: `Error searching memory: ${error.message}` }],
          isError: true,
        };
      }
    }

    case 'add_developer_preference': {
      const args = request.params.arguments as { preference: string };
      try {
        const result = await evermem.addMemory({
          message_id: `pref_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          create_time: new Date().toISOString(),
          sender: DEFAULT_USER_ID,
          group_id: DEFAULT_GROUP_ID,
          role: 'user',
          content: `My developer preference: ${args.preference}`,
          flush: true
        });
        return {
          content: [{ type: 'text', text: `Preference saved: "${args.preference}"` }],
        };
      } catch (error: any) {
        return {
          content: [{ type: 'text', text: `Error saving preference: ${error.message}` }],
          isError: true,
        };
      }
    }

    case 'list_recent_memories': {
      const args = request.params.arguments as {
        memory_type?: string;
        page?: number;
        page_size?: number;
      };
      try {
        const result = await evermem.getMemories({
          user_id: DEFAULT_USER_ID,
          group_ids: [DEFAULT_GROUP_ID],
          memory_type: (args.memory_type as any) || 'episodic_memory',
          page: args.page || 1,
          page_size: args.page_size || 10
        });

        let formattedOutput = "";
        const memories = result?.result?.memories || [];
        const totalCount = result?.result?.total_count || 0;

        if (memories.length === 0) {
          formattedOutput = `No ${args.memory_type || 'episodic_memory'} memories found.`;
        } else {
          formattedOutput = `Showing ${memories.length} of ${totalCount} ${args.memory_type || 'episodic_memory'} memories:\n\n`;
          memories.forEach((mem: any, index: number) => {
            const num = ((args.page || 1) - 1) * (args.page_size || 10) + index + 1;
            formattedOutput += `[${num}] ID: ${mem.id}\n`;
            if (mem.summary) formattedOutput += `    Summary: ${mem.summary}\n`;
            if (mem.atomic_fact) formattedOutput += `    Fact: ${mem.atomic_fact}\n`;
            if (mem.foresight) formattedOutput += `    Plan: ${mem.foresight}\n`;
            if (mem.profile_data) formattedOutput += `    Profile: ${JSON.stringify(mem.profile_data)}\n`;
            if (mem.content) formattedOutput += `    Content: ${mem.content}\n`;
            if (mem.timestamp || mem.created_at) formattedOutput += `    Time: ${mem.timestamp || mem.created_at}\n`;
            formattedOutput += '\n';
          });
        }

        return {
          content: [{ type: 'text', text: formattedOutput }],
        };
      } catch (error: any) {
        return {
          content: [{ type: 'text', text: `Error listing memories: ${error.message}` }],
          isError: true,
        };
      }
    }

    case 'delete_memory': {
      const args = request.params.arguments as {
        memory_id?: string;
        memory_type?: string;
      };
      try {
        const result = await evermem.deleteMemories({
          memory_id: args.memory_id,
          user_id: DEFAULT_USER_ID,
          group_id: DEFAULT_GROUP_ID,
          memory_type: args.memory_type as any
        });
        return {
          content: [{ type: 'text', text: `Memory deleted successfully. ${JSON.stringify(result)}` }],
        };
      } catch (error: any) {
        return {
          content: [{ type: 'text', text: `Error deleting memory: ${error.message}` }],
          isError: true,
        };
      }
    }

    case 'add_foresight_todo': {
      const args = request.params.arguments as { content: string };
      try {
        const result = await evermem.addMemory({
          message_id: `todo_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          create_time: new Date().toISOString(),
          sender: DEFAULT_USER_ID,
          group_id: DEFAULT_GROUP_ID,
          role: 'assistant',
          content: `Future task / tech debt: ${args.content}`,
          flush: true
        });
        return {
          content: [{ type: 'text', text: `Future task recorded: "${args.content}"` }],
        };
      } catch (error: any) {
        return {
          content: [{ type: 'text', text: `Error recording future task: ${error.message}` }],
          isError: true,
        };
      }
    }

    default:
      throw new McpError(
        ErrorCode.MethodNotFound,
        `Unknown tool: ${request.params.name}`
      );
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('CodeMem MCP server running on stdio');
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
