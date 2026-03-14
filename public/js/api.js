/**
 * CodeMem API Client
 * Handles communication with the CodeMem backend
 */

class CodeMemAPI {
  constructor(baseURL = '/api') {
    this.baseURL = baseURL;
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Search memories with filters
   */
  async searchMemories(query, options = {}) {
    return this.request('/memories/search', {
      method: 'POST',
      body: JSON.stringify({
        query,
        scope: options.scope || 'repo',
        filters: {
          types: options.types || [],
          layers: options.layers || [],
          files: options.files || [],
          dateRange: options.dateRange || null,
        },
        limit: options.limit || 50,
      }),
    });
  }

  /**
   * Get all memories with optional filters
   */
  async getMemories(options = {}) {
    const params = new URLSearchParams();
    if (options.scope) params.append('scope', options.scope);
    if (options.types?.length) params.append('types', options.types.join(','));
    if (options.layers?.length) params.append('layers', options.layers.join(','));
    if (options.limit) params.append('limit', options.limit);

    return this.request(`/memories?${params.toString()}`);
  }

  /**
   * Get a specific memory by ID
   */
  async getMemory(id) {
    return this.request(`/memories/${id}`);
  }

  /**
   * Get memory relationships and graph
   */
  async getMemoryGraph(options = {}) {
    return this.request('/memories/graph', {
      method: 'POST',
      body: JSON.stringify({
        scope: options.scope || 'repo',
        includeRelations: options.includeRelations !== false,
        maxDepth: options.maxDepth || 2,
      }),
    });
  }

  /**
   * Get affected files and their memory relationships
   */
  async getAffectedFilesMap(options = {}) {
    return this.request('/memories/files-map', {
      method: 'POST',
      body: JSON.stringify({
        scope: options.scope || 'repo',
      }),
    });
  }

  /**
   * Get memory timeline
   */
  async getTimeline(options = {}) {
    return this.request('/memories/timeline', {
      method: 'POST',
      body: JSON.stringify({
        scope: options.scope || 'repo',
        limit: options.limit || 100,
        sortBy: options.sortBy || 'createdAt',
      }),
    });
  }

  /**
   * Get memory statistics
   */
  async getStats(options = {}) {
    return this.request('/memories/stats', {
      method: 'POST',
      body: JSON.stringify({
        scope: options.scope || 'repo',
      }),
    });
  }

  /**
   * Get session information
   */
  async getSessionInfo() {
    return this.request('/session/info');
  }
}

// Create global API instance
const api = new CodeMemAPI();
