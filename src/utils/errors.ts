/**
 * Base error for all claude-memory errors.
 */
export class MemoryError extends Error {
  readonly code: string;
  readonly recoverable: boolean;
  readonly context?: Record<string, unknown>;

  constructor(
    message: string,
    code: string,
    recoverable = true,
    context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'MemoryError';
    this.code = code;
    this.recoverable = recoverable;
    this.context = context;
  }
}

/**
 * Storage/database related errors.
 */
export class StorageError extends MemoryError {
  constructor(message: string, code: string, context?: Record<string, unknown>) {
    super(message, `STORAGE_${code}`, true, context);
    this.name = 'StorageError';
  }
}

/**
 * Input validation errors.
 */
export class ValidationError extends MemoryError {
  readonly field?: string;

  constructor(message: string, field?: string, context?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', true, { ...context, field });
    this.name = 'ValidationError';
    this.field = field;
  }
}

/**
 * Configuration errors.
 */
export class ConfigError extends MemoryError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'CONFIG_ERROR', true, context);
    this.name = 'ConfigError';
  }
}

/**
 * File system operation errors.
 */
export class FileSystemError extends MemoryError {
  readonly path: string;

  constructor(message: string, path: string, context?: Record<string, unknown>) {
    super(message, 'FS_ERROR', true, { ...context, path });
    this.name = 'FileSystemError';
    this.path = path;
  }
}

/**
 * Embedding generation errors.
 */
export class EmbeddingError extends MemoryError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'EMBEDDING_ERROR', true, context);
    this.name = 'EmbeddingError';
  }
}
