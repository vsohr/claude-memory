import { describe, it, expect } from 'vitest';
import {
  MemoryError,
  ValidationError,
  StorageError,
  ConfigError,
} from '../../../src/utils/errors';

describe('MemoryError', () => {
  it('has code and recoverable properties', () => {
    const error = new MemoryError('Test error', 'TEST_CODE', true, { foo: 'bar' });
    expect(error.message).toBe('Test error');
    expect(error.code).toBe('TEST_CODE');
    expect(error.recoverable).toBe(true);
    expect(error.context).toEqual({ foo: 'bar' });
  });
});

describe('ValidationError', () => {
  it('includes field information', () => {
    const error = new ValidationError('Invalid input', 'content');
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.field).toBe('content');
  });
});

describe('StorageError', () => {
  it('prefixes code with STORAGE_', () => {
    const error = new StorageError('Connection failed', 'CONNECTION');
    expect(error.code).toBe('STORAGE_CONNECTION');
  });
});
