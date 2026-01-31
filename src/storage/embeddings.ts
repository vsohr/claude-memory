import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import { EmbeddingError } from '../utils/errors';
import { logger } from '../utils/logger';

const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
const EMBEDDING_DIMENSION = 384;

export class EmbeddingService {
  private pipeline: FeatureExtractionPipeline | null = null;
  private initializing: Promise<void> | null = null;

  async initialize(): Promise<void> {
    if (this.pipeline) return;
    if (this.initializing) return this.initializing;

    this.initializing = this.loadPipeline();
    await this.initializing;
  }

  private async loadPipeline(): Promise<void> {
    try {
      logger.info(`Loading embedding model: ${MODEL_NAME}`);
      this.pipeline = await pipeline('feature-extraction', MODEL_NAME, {
        dtype: 'fp32',
      });
      logger.info('Embedding model loaded successfully');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new EmbeddingError(`Failed to load embedding model: ${message}`, {
        model: MODEL_NAME,
      });
    }
  }

  isReady(): boolean {
    return this.pipeline !== null;
  }

  async embed(text: string): Promise<number[]> {
    if (!this.pipeline) {
      await this.initialize();
    }

    if (!this.pipeline) {
      throw new EmbeddingError('Embedding pipeline not initialized');
    }

    try {
      const output = await this.pipeline(text, {
        pooling: 'mean',
        normalize: true,
      });

      // Extract the embedding array from the tensor output
      const embedding = Array.from(output.data as Float32Array);
      return embedding.slice(0, EMBEDDING_DIMENSION);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new EmbeddingError(`Failed to generate embedding: ${message}`, {
        textLength: text.length,
      });
    }
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const embeddings: number[][] = [];
    for (const text of texts) {
      const embedding = await this.embed(text);
      embeddings.push(embedding);
    }
    return embeddings;
  }

  getDimensions(): number {
    return EMBEDDING_DIMENSION;
  }

  getModelName(): string {
    return MODEL_NAME;
  }
}

// Singleton instance
let embeddingService: EmbeddingService | null = null;

export function getEmbeddingService(): EmbeddingService {
  if (!embeddingService) {
    embeddingService = new EmbeddingService();
  }
  return embeddingService;
}
