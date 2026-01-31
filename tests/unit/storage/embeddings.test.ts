import { describe, it, expect, beforeAll } from 'vitest';
import { EmbeddingService } from '../../../src/storage/embeddings';

describe('EmbeddingService', () => {
  let service: EmbeddingService;

  beforeAll(async () => {
    service = new EmbeddingService();
    await service.initialize();
  }, 120000); // Allow time for model download

  it('returns 384-dimension vectors', async () => {
    const embedding = await service.embed('Test content');
    expect(embedding).toHaveLength(384);
  });

  it('returns consistent embeddings for same input', async () => {
    const emb1 = await service.embed('Hello world');
    const emb2 = await service.embed('Hello world');
    expect(emb1).toEqual(emb2);
  });

  it('handles batch embedding', async () => {
    const texts = ['First text', 'Second text', 'Third text'];
    const embeddings = await service.embedBatch(texts);
    expect(embeddings).toHaveLength(3);
    embeddings.forEach((emb) => expect(emb).toHaveLength(384));
  });
});
