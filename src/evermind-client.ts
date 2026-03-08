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
  memory_types?: ('profile' | 'episodic_memory' | 'foresight' | 'event_log')[];
  query: string;
  retrieve_method?: 'keyword' | 'vector' | 'hybrid' | 'rrf' | 'agentic';
  top_k?: number;
}

export class EverMemClient {
  private client: AxiosInstance;

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('EverMemOS API Key is required');
    }
    this.client = axios.create({
      baseURL: 'https://api.evermind.ai',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Extract memory from a message
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
   * Search for memories
   */
  async searchMemories(request: SearchMemoryRequest) {
    try {
      // Setup defaults
      const payload = {
        ...request,
        memory_types: request.memory_types || ['episodic_memory', 'event_log', 'profile'],
        retrieve_method: request.retrieve_method || 'hybrid',
        top_k: request.top_k || 10
      };

      const response = await this.client.get('/api/v0/memories/search', {
        data: payload // axios uses 'data' for GET body in this specific setup if supported, or we might need to send it as post if the api changed, but according to docs it's GET with body (though unusual, let's follow the doc)
      });
      return response.data;
    } catch (error: any) {
      console.error('Error searching memories in EverMemOS:', error.response?.data || error.message);
      throw new Error(`Failed to search memories: ${error.response?.data?.message || error.message}`);
    }
  }
}
