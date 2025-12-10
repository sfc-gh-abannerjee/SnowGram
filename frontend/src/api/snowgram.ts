/**
 * SnowGram API Client
 * ====================
 * Client for interacting with the SnowGram backend API
 */

import axios, { AxiosInstance } from 'axios';

// API Base URL (defaults to same origin in production)
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '/api';

interface GenerateDiagramRequest {
  user_query: string;
  diagram_type?: string;
  use_case?: string;
}

interface GenerateDiagramResponse {
  mermaid_code: string;
  explanation: string;
  components_used: string[];
  generation_time_ms: number;
}

interface SaveDiagramRequest {
  diagram_name: string;
  mermaid_code: string;
  excalidraw_json?: any;
  diagram_type?: string;
  tags?: string[];
  project_name?: string;
  is_public?: boolean;
}

interface SaveDiagramResponse {
  diagram_id: string;
  saved_at: string;
  message: string;
}

interface DiagramListItem {
  diagram_id: string;
  diagram_name: string;
  diagram_type: string;
  created_at: string;
  updated_at: string;
  tags: string[];
  project_name?: string;
}

class SnowGramAPI {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      timeout: 30000, // 30 seconds
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response) {
          // Server responded with error status
          console.error('API Error:', error.response.data);
          throw new Error(error.response.data.detail || 'API request failed');
        } else if (error.request) {
          // Request made but no response
          console.error('No response from server');
          throw new Error('No response from server. Please check your connection.');
        } else {
          // Error in request setup
          console.error('Request error:', error.message);
          throw error;
        }
      }
    );
  }

  /**
   * Generate diagram from natural language query
   */
  async generateDiagram(request: GenerateDiagramRequest): Promise<GenerateDiagramResponse> {
    const response = await this.client.post<GenerateDiagramResponse>(
      '/diagram/generate',
      request
    );
    return response.data;
  }

  /**
   * Save diagram to database
   */
  async saveDiagram(request: SaveDiagramRequest): Promise<SaveDiagramResponse> {
    const response = await this.client.post<SaveDiagramResponse>(
      '/diagram/save',
      request
    );
    return response.data;
  }

  /**
   * Load saved diagram by ID
   */
  async loadDiagram(diagramId: string): Promise<any> {
    const response = await this.client.get(`/diagram/load/${diagramId}`);
    return response.data;
  }

  /**
   * List saved diagrams with optional filters
   */
  async listDiagrams(filters?: {
    diagram_type?: string;
    project_name?: string;
    tags?: string[];
    limit?: number;
  }): Promise<DiagramListItem[]> {
    const response = await this.client.get<DiagramListItem[]>('/diagram/list', {
      params: filters,
    });
    return response.data;
  }

  /**
   * Delete saved diagram
   */
  async deleteDiagram(diagramId: string): Promise<void> {
    await this.client.delete(`/diagram/delete/${diagramId}`);
  }

  /**
   * Get list of available icons
   */
  async listIcons(category?: string): Promise<any[]> {
    const response = await this.client.get('/icons/list', {
      params: { category },
    });
    return response.data;
  }

  /**
   * Get icon categories
   */
  async getIconCategories(): Promise<string[]> {
    const response = await this.client.get<string[]>('/icons/categories');
    return response.data;
  }
}

// Export singleton instance
export const snowgramAPI = new SnowGramAPI();

// Export types
export type {
  GenerateDiagramRequest,
  GenerateDiagramResponse,
  SaveDiagramRequest,
  SaveDiagramResponse,
  DiagramListItem,
};

