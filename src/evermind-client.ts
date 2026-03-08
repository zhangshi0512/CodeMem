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
        data: payload
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
        data: payload
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
}
