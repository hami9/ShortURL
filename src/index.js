import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeUrl, hashUrlToBase64, validateCustomAlias, RESERVED_WORDS } from './hasher.js';
import { KeyValueStore } from './kvStore.js';
import { createServer, kvStore as defaultStore } from './server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const defaultStorePath = path.join(rootDir, 'data', 'store.json');

/**
 * Modular URL Shortener Service instance.
 */
export class UrlShortenerService {
  constructor(storePath = defaultStorePath) {
    this.store = new KeyValueStore(storePath);
  }

  async init() {
    await this.store.init();
    return this;
  }

  /**
   * Shortens a URL using SHA-256 and URL-Safe Base64 encoding.
   * 
   * @param {string} rawUrl 
   * @param {Object} [options]
   * @param {string} [options.customAlias] 
   * @returns {Promise<import('./kvStore.js').LinkRecord>}
   */
  async shorten(rawUrl, options = {}) {
    await this.init();

    const normalized = normalizeUrl(rawUrl);
    const customAlias = options.customAlias ? options.customAlias.trim() : null;
    let shortCode = '';

    if (customAlias) {
      const validation = validateCustomAlias(customAlias);
      if (!validation.valid) {
        throw new Error(validation.error);
      }

      if (this.store.has(customAlias)) {
        const existing = this.store.get(customAlias);
        if (existing.originalUrl === normalized) {
          return existing;
        }
        throw new Error(`Custom alias "${customAlias}" is already in use.`);
      }

      shortCode = customAlias;
    } else {
      const existing = this.store.findByUrl(normalized);
      if (existing) {
        return existing;
      }

      let counter = 0;
      do {
        shortCode = hashUrlToBase64(normalized, 6, counter > 0 ? String(counter) : '');
        counter++;
      } while (this.store.has(shortCode) && this.store.get(shortCode).originalUrl !== normalized);
    }

    const record = {
      shortCode,
      originalUrl: normalized,
      createdAt: new Date().toISOString(),
      clicks: 0,
      lastAccessedAt: null,
      accessLogs: [],
      isCustom: Boolean(customAlias)
    };

    this.store.set(shortCode, record);
    return record;
  }

  /**
   * Resolves a short code and increments click count.
   * 
   * @param {string} shortCode 
   * @param {Object} [metadata] 
   * @returns {import('./kvStore.js').LinkRecord|null}
   */
  resolve(shortCode, metadata = {}) {
    const record = this.store.get(shortCode);
    if (!record) return null;
    return this.store.recordClick(shortCode, metadata);
  }

  /**
   * Deletes a short code.
   */
  delete(shortCode) {
    return this.store.delete(shortCode);
  }

  /**
   * Retrieves all stored records.
   */
  getAll() {
    return this.store.getAll();
  }

  /**
   * Returns store metrics.
   */
  getStats() {
    return this.store.getStats();
  }
}

export {
  normalizeUrl,
  hashUrlToBase64,
  validateCustomAlias,
  RESERVED_WORDS,
  KeyValueStore,
  createServer,
  defaultStore
};
