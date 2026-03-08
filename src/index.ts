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

// Ensure user specifies a user ID or defaults to a generic one
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
        description: 'Save an architectural decision, bug fix pattern, or important context to the project\'s memory.',
        inputSchema: {
          type: 'object',
          properties: {
            content: {
              type: 'string',
              description: 'The content of the decision or context to save.',
            },
          },
          required: ['content'],
        },
      },
      {
        name: 'search_project_memory',
        description: 'Search the project\'s memory for past decisions, context, or code patterns.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'What to search for (e.g., "How do we handle auth in this project?").',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'add_developer_preference',
        description: 'Save a developer preference or coding style rule (e.g. "always use strict typing").',
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
      }
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
          flush: true // Force immediate extraction for tool calls
        });
        return {
          content: [{ type: 'text', text: `Successfully saved to EverMemOS: ${JSON.stringify(result)}` }],
        };
      } catch (error: any) {
        return {
          content: [{ type: 'text', text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    }

    case 'search_project_memory': {
      const args = request.params.arguments as { query: string };
      try {
        const result = await evermem.searchMemories({
          user_id: DEFAULT_USER_ID,
          group_ids: [DEFAULT_GROUP_ID],
          query: args.query,
          memory_types: ['episodic_memory', 'profile'],
          retrieve_method: 'hybrid',
          top_k: 5
        });

        // Format the results nicely for the LLM
        let formattedOutput = "Memory Results:\n";
        
        if (result?.result?.memories?.length > 0) {
          result.result.memories.forEach((mem: any, index: number) => {
            formattedOutput += `\n[${index + 1}] Type: ${mem.memory_type}\n`;
            if (mem.memory_type === 'episodic_memory') {
               formattedOutput += `Summary: ${mem.summary}\n`;
            } else if (mem.memory_type === 'event_log') {
               formattedOutput += `Fact: ${mem.atomic_fact}\n`;
            } else if (mem.memory_type === 'profile') {
               // We might need to handle profile from result.result.profiles
            }
          });
        }
        
        if (result?.result?.profiles?.length > 0) {
            result.result.profiles.forEach((prof: any, index: number) => {
               formattedOutput += `\n[Profile ${index + 1}] ${prof.category || prof.trait_name}: ${prof.description}\n`;
            });
        }

        if (formattedOutput === "Memory Results:\n") {
            formattedOutput = "No relevant memories found.";
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
          role: 'user', // Preference usually comes from user
          content: `My developer preference: ${args.preference}`, // Hint the LLM to extract this as profile
          flush: true
        });
        return {
          content: [{ type: 'text', text: `Preference saved: ${args.preference}` }],
        };
      } catch (error: any) {
        return {
          content: [{ type: 'text', text: `Error: ${error.message}` }],
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
