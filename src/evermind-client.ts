import axios, { AxiosInstance } from 'axios';

// Interfaces for EverMemOS API

export interface AddMemoryRequest {
  group_id?: string;
  group_name?: string;
  message_id: string;
  create_time: string; // ISO 8601
  sender: string;
  sender_name?: string;
  role?: 'user' | 'assistant';
  content: string;
  refer_list?: string[];
  flush?: boolean;
}

export interface SearchMemoryRequest {
  user_id?: string;
  group_ids?: string[];
  // Note: EverMemOS search only supports 'profile' and 'episodic_memory'.
  // 'foresight' and 'event_log' are silently ignored by the API.
  memory_types?: ('profile' | 'episodic_memory')[];
  query: string;
  retrieve_method?: 'keyword' | 'vector' | 'hybrid' | 'rrf' | 'agentic';
  top_k?: number;
  start_time?: string;
  end_time?: string;
  include_metadata?: boolean;
  radius?: number;
  current_time?: string;
}

export interface GetMemoriesRequest {
  user_id?: string;
  group_ids?: string[];
  memory_type?: 'profile' | 'episodic_memory' | 'foresight' | 'event_log';
  page?: number;
  page_size?: number;
  start_time?: string;
  end_time?: string;
}

export interface DeleteMemoriesRequest {
  memory_id?: string;
  user_id?: string;
  group_id?: string;
  memory_type?: 'profile' | 'episodic_memory' | 'foresight' | 'event_log';
}

export interface GetRequestStatusResponse {
  success: boolean;
  found?: boolean;
  data?: {
    request_id?: string;
    status?: string;
    url?: string;
    method?: string;
    http_code?: number;
    time_ms?: number;
    start_time?: number;
    end_time?: number;
    ttl_seconds?: number;
  } | null;
  message?: string | null;
}

export interface ConversationMetaRequest {
  group_id?: string;
}

export interface ConversationMetaPatchRequest {
  group_id?: string;
  description?: string | null;
  scene_desc?: Record<string, any> | null;
  llm_custom_setting?: {
    boundary?: {
      provider: 'openrouter';
      model: 'qwen/qwen3-235b-a22b-2507' | 'openai/gpt-4.1-mini';
      extra?: Record<string, any> | null;
    } | null;
    extraction?: {
      provider: 'openrouter';
      model: 'qwen/qwen3-235b-a22b-2507' | 'openai/gpt-4.1-mini';
      extra?: Record<string, any> | null;
    } | null;
  } | null;
  tags?: string[] | null;
  user_details?: Record<string, {
    full_name?: string | null;
    role?: 'user' | 'assistant' | null;
    custom_role?: string | null;
    extra?: Record<string, any> | null;
  }> | null;
  default_timezone?: string | null;
}

export interface ConversationMetaCreateRequest {
  group_id?: string;
  scene: 'assistant' | 'group_chat';
  scene_desc?: Record<string, any> | null;
  llm_custom_setting?: ConversationMetaPatchRequest['llm_custom_setting'];
  description?: string | null;
  created_at: string;
  default_timezone?: string | null;
  user_details?: ConversationMetaPatchRequest['user_details'];
  tags?: string[] | null;
}

export class EverMemClient {
  private client: AxiosInstance;

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('EverMemOS API Key is required');
    }
    this.client = axios.create({
      baseURL: 'https://api.evermind.ai',
      timeout: 30000, // 30 second timeout
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Extract memory from a message (POST /api/v0/memories)
   */
  async addMemory(request: AddMemoryRequest) {
    try {
      const response = await this.client.post('/api/v0/memories', request);
      return response.data;
    } catch (error: any) {
      console.error('Error adding memory to EverMemOS:', error.response?.data || error.message);
      throw new Error(`Failed to add memory: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Search for memories (GET /api/v0/memories/search)
   */
  async searchMemories(request: SearchMemoryRequest) {
    try {
      const payload = {
        ...request,
        memory_types: request.memory_types || ['episodic_memory', 'profile'],
        retrieve_method: request.retrieve_method || 'hybrid',
        top_k: request.top_k || 10
      };

      const response = await this.client.request({
        method: 'GET',
        url: '/api/v0/memories/search',
        params: payload
      });
      return response.data;
    } catch (error: any) {
      console.error('Error searching memories in EverMemOS:', error.response?.data || error.message);
      throw new Error(`Failed to search memories: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Get memories with filtering (GET /api/v0/memories)
   */
  async getMemories(request: GetMemoriesRequest) {
    try {
      const payload = {
        ...request,
        memory_type: request.memory_type || 'episodic_memory',
        page: request.page || 1,
        page_size: request.page_size || 20
      };

      const response = await this.client.request({
        method: 'GET',
        url: '/api/v0/memories',
        params: payload
      });
      return response.data;
    } catch (error: any) {
      console.error('Error fetching memories from EverMemOS:', error.response?.data || error.message);
      throw new Error(`Failed to get memories: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Delete memories (DELETE /api/v0/memories)
   */
  async deleteMemories(request: DeleteMemoriesRequest) {
    try {
      const response = await this.client.request({
        method: 'DELETE',
        url: '/api/v0/memories',
        data: request
      });
      return response.data;
    } catch (error: any) {
      console.error('Error deleting memories from EverMemOS:', error.response?.data || error.message);
      throw new Error(`Failed to delete memories: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Query async request processing status (GET /api/v0/status/request)
   */
  async getRequestStatus(request_id: string): Promise<GetRequestStatusResponse> {
    try {
      const response = await this.client.request({
        method: 'GET',
        url: '/api/v0/status/request',
        params: { request_id }
      });
      return response.data;
    } catch (error: any) {
      console.error('Error getting request status from EverMemOS:', error.response?.data || error.message);
      throw new Error(`Failed to get request status: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Retrieve conversation metadata (GET /api/v0/memories/conversation-meta)
   */
  async getConversationMeta(request: ConversationMetaRequest = {}) {
    try {
      const response = await this.client.request({
        method: 'GET',
        url: '/api/v0/memories/conversation-meta',
        params: request.group_id ? { group_id: request.group_id } : undefined
      });
      return response.data;
    } catch (error: any) {
      console.error('Error getting conversation metadata from EverMemOS:', error.response?.data || error.message);
      throw new Error(`Failed to get conversation metadata: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Create conversation metadata (POST /api/v0/memories/conversation-meta)
   */
  async createConversationMeta(request: ConversationMetaCreateRequest) {
    try {
      const response = await this.client.request({
        method: 'POST',
        url: '/api/v0/memories/conversation-meta',
        params: request.group_id ? { group_id: request.group_id } : undefined,
        data: request
      });
      return response.data;
    } catch (error: any) {
      console.error('Error creating conversation metadata in EverMemOS:', error.response?.data || error.message);
      throw new Error(`Failed to create conversation metadata: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Update conversation metadata (PATCH /api/v0/memories/conversation-meta)
   */
  async updateConversationMeta(request: ConversationMetaPatchRequest) {
    const payload = Object.fromEntries(
      Object.entries(request).filter(([, value]) => value !== undefined)
    ) as ConversationMetaPatchRequest;

    try {
      const response = await this.client.request({
        method: 'PATCH',
        url: '/api/v0/memories/conversation-meta',
        params: payload.group_id ? { group_id: payload.group_id } : undefined,
        data: payload
      });
      return response.data;
    } catch (error: any) {
      const status = error.response?.status;
      const message = String(error.response?.data?.message || error.message || '');

      if (
        payload.group_id &&
        (status === 404 || /not found/i.test(message))
      ) {
        return this.createConversationMeta({
          group_id: payload.group_id,
          scene: 'assistant',
          created_at: new Date().toISOString(),
          description: payload.description,
          scene_desc: payload.scene_desc,
          llm_custom_setting: payload.llm_custom_setting,
          default_timezone: payload.default_timezone,
          user_details: payload.user_details,
          tags: payload.tags,
        });
      }

      console.error('Error updating conversation metadata in EverMemOS:', error.response?.data || error.message);
      throw new Error(`Failed to update conversation metadata: ${error.response?.data?.message || error.message}`);
    }
  }
}
