/**
 * CodeMem Web Server
 * Serves the frontend and provides API routes to interact with CodeMem memory tools
 */

import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { EverMemClient } from './evermind-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface MemorySearchRequest {
  query: string;
  scope: 'session' | 'repo' | 'all';
  filters: {
    types: string[];
    layers: string[];
    files: string[];
    dateRange: { start?: string; end?: string } | null;
  };
  limit: number;
}

interface MemoryGraphRequest {
  scope: 'session' | 'repo' | 'all';
  includeRelations: boolean;
  maxDepth: number;
}

interface Memory {
  id: string;
  title: string;
  type: string;
  layer?: string;
  description: string;
  createdAt: string;
  platform?: string;
  affectedFiles?: string[];
  relations?: string[];
  content?: string;
}

interface GraphNode {
  id: string;
  title: string;
  type: string;
  x?: number;
  y?: number;
}

interface GraphEdge {
  from: string;
  to: string;
  type: string;
}

class CodeMemWebServer {
  private app: express.Application;
  private port: number;
  private everMemClient: EverMemClient;
  private memoriesCache: Map<string, Memory> = new Map();

  constructor(everMemClient: EverMemClient, port: number = 3000) {
    this.app = express();
    this.port = port;
    this.everMemClient = everMemClient;

    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware() {
    // JSON parsing
    this.app.use(express.json());

    // Static files
    const publicPath = path.join(__dirname, '../public');
    this.app.use(express.static(publicPath));

    // Logging
    this.app.use((req, res, next) => {
      console.log(`${req.method} ${req.path}`);
      next();
    });
  }

  private setupRoutes() {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // Session info
    this.app.get('/api/session/info', (req, res) => {
      res.json({
        timestamp: new Date().toISOString(),
        platform: process.platform,
      });
    });

    // Search memories
    this.app.post('/api/memories/search', async (req: Request, res: Response) => {
      try {
        const searchReq = req.body as MemorySearchRequest;
        const results = await this.searchMemories(searchReq);
        res.json({ data: results, count: results.length });
      } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({ error: 'Search failed' });
      }
    });

    // Get all memories
    this.app.get('/api/memories', async (req: Request, res: Response) => {
      try {
        const scope = (req.query.scope as string) || 'repo';
        const types = (req.query.types as string)?.split(',') || [];
        const limit = parseInt(req.query.limit as string) || 50;

        const memories = await this.getMemories(scope, types, limit);
        res.json({ data: memories, count: memories.length });
      } catch (error) {
        console.error('Get memories error:', error);
        res.status(500).json({ error: 'Failed to fetch memories' });
      }
    });

    // Get single memory
    this.app.get('/api/memories/:id', async (req: Request, res: Response) => {
      try {
        const memory = this.memoriesCache.get(req.params.id);
        if (!memory) {
          return res.status(404).json({ error: 'Memory not found' });
        }
        res.json({ data: memory });
      } catch (error) {
        console.error('Get memory error:', error);
        res.status(500).json({ error: 'Failed to fetch memory' });
      }
    });

    // Get memory graph
    this.app.post('/api/memories/graph', async (req: Request, res: Response) => {
      try {
        const graphReq = req.body as MemoryGraphRequest;
        const graph = await this.buildMemoryGraph(graphReq);
        res.json({ data: graph });
      } catch (error) {
        console.error('Graph error:', error);
        res.status(500).json({ error: 'Failed to build graph' });
      }
    });

    // Get affected files map
    this.app.post('/api/memories/files-map', async (req: Request, res: Response) => {
      try {
        const scope = req.body.scope || 'repo';
        const filesMap = await this.buildFilesMap(scope);
        res.json({ data: filesMap });
      } catch (error) {
        console.error('Files map error:', error);
        res.status(500).json({ error: 'Failed to build files map' });
      }
    });

    // Get timeline
    this.app.post('/api/memories/timeline', async (req: Request, res: Response) => {
      try {
        const scope = req.body.scope || 'repo';
        const limit = req.body.limit || 100;
        const timeline = await this.getTimeline(scope, limit);
        res.json({ data: timeline });
      } catch (error) {
        console.error('Timeline error:', error);
        res.status(500).json({ error: 'Failed to fetch timeline' });
      }
    });

    // Get stats
    this.app.post('/api/memories/stats', async (req: Request, res: Response) => {
      try {
        const scope = req.body.scope || 'repo';
        const stats = await this.getStats(scope);
        res.json({ data: stats });
      } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ error: 'Failed to fetch stats' });
      }
    });

    // Serve index.html for all other routes (SPA routing)
    this.app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, '../public/index.html'));
    });
  }

  private async searchMemories(req: MemorySearchRequest): Promise<Memory[]> {
    // This would call the search_project_memory MCP tool
    // For now, return mock data
    console.log('Searching memories:', req.query);
    return [];
  }

  private async getMemories(scope: string, types: string[] = [], limit: number = 50): Promise<Memory[]> {
    // This would call the list_recent_memories MCP tool
    // For now, return mock data with proper structure
    const mockMemories: Memory[] = [
      {
        id: 'mem-1',
        title: 'Memory Graph Visualization',
        type: 'feature',
        layer: 'frontend',
        description: 'Display episodic memories as nodes with edges showing dependencies',
        createdAt: new Date().toISOString(),
        platform: process.platform,
        affectedFiles: ['src/index.ts', 'public/index.html'],
      },
      {
        id: 'mem-2',
        title: 'Session Timeline View',
        type: 'feature',
        layer: 'frontend',
        description: 'Show chronological memory trail with session isolation',
        createdAt: new Date(Date.now() - 86400000).toISOString(),
        platform: process.platform,
        affectedFiles: ['src/index.ts'],
      },
      {
        id: 'mem-3',
        title: 'Phase 1 Git Context Injection',
        type: 'decision',
        layer: 'infrastructure',
        description: 'Git context injection ensures every memory includes branch and commit metadata',
        createdAt: new Date(Date.now() - 172800000).toISOString(),
        platform: process.platform,
      },
    ];

    // Filter by type if specified
    if (types.length > 0) {
      return mockMemories.filter(m => types.includes(m.type)).slice(0, limit);
    }

    return mockMemories.slice(0, limit);
  }

  private async buildMemoryGraph(req: MemoryGraphRequest): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
    const memories = await this.getMemories(req.scope);

    const nodes: GraphNode[] = memories.map(m => ({
      id: m.id,
      title: m.title,
      type: m.type,
    }));

    // Create mock edges based on affected files
    const edges: GraphEdge[] = [];
    for (let i = 0; i < memories.length; i++) {
      for (let j = i + 1; j < memories.length; j++) {
        const m1 = memories[i];
        const m2 = memories[j];

        // Connect if they share affected files
        const shared = (m1.affectedFiles || []).filter(f => (m2.affectedFiles || []).includes(f));
        if (shared.length > 0) {
          edges.push({
            from: m1.id,
            to: m2.id,
            type: 'shares-file',
          });
        }
      }
    }

    return { nodes, edges };
  }

  private async buildFilesMap(scope: string): Promise<{
    files: Array<{ path: string; memoryCount: number; memories: Memory[] }>;
  }> {
    const memories = await this.getMemories(scope);
    const fileMap = new Map<string, Memory[]>();

    // Group memories by affected files
    memories.forEach(memory => {
      (memory.affectedFiles || []).forEach(file => {
        if (!fileMap.has(file)) {
          fileMap.set(file, []);
        }
        fileMap.get(file)!.push(memory);
      });
    });

    const files = Array.from(fileMap.entries())
      .map(([path, mems]) => ({
        path,
        memoryCount: mems.length,
        memories: mems,
      }))
      .sort((a, b) => b.memoryCount - a.memoryCount);

    return { files };
  }

  private async getTimeline(scope: string, limit: number = 100): Promise<Memory[]> {
    const memories = await this.getMemories(scope, [], limit);

    // Sort by creation date descending
    return memories.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  private async getStats(scope: string): Promise<{
    totalMemories: number;
    byType: Record<string, number>;
    byLayer: Record<string, number>;
  }> {
    const memories = await this.getMemories(scope, [], 1000);

    const byType: Record<string, number> = {};
    const byLayer: Record<string, number> = {};

    memories.forEach(m => {
      byType[m.type] = (byType[m.type] || 0) + 1;
      if (m.layer) {
        byLayer[m.layer] = (byLayer[m.layer] || 0) + 1;
      }
    });

    return {
      totalMemories: memories.length,
      byType,
      byLayer,
    };
  }

  public start(): void {
    this.app.listen(this.port, () => {
      console.log(`CodeMem Web Server running on http://localhost:${this.port}`);
    });
  }
}

export { CodeMemWebServer };
