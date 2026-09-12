import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * @typedef {Object} LinkRecord
 * @property {string} shortCode - Unique short key
 * @property {string} originalUrl - Destination URL
 * @property {string} createdAt - ISO date string
 * @property {number} clicks - Total redirect count
 * @property {string|null} lastAccessedAt - ISO date string or null
 * @property {Array<{ timestamp: string, userAgent?: string, referer?: string, ip?: string }>} accessLogs
 * @property {boolean} [isCustom] - Whether a custom alias was used
 */

export class KeyValueStore {
  /**
   * @param {string} filePath - Path to persistent JSON storage file
   */
  constructor(filePath) {
    this.filePath = filePath;
    /** @type {Map<string, LinkRecord>} */
    this.store = new Map();
    /** @type {Map<string, string>} Reverse index: originalUrl -> shortCode */
    this.urlIndex = new Map();
    this.isDirty = false;
    this.flushTimeout = null;
    this.initialized = false;
  }

  /**
   * Initializes store by loading existing data from disk.
   */
  async init() {
    if (this.initialized) return;

    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });

    try {
      const data = await fs.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && item.shortCode) {
            this.store.set(item.shortCode, item);
            if (!item.isCustom) {
              this.urlIndex.set(item.originalUrl, item.shortCode);
            }
          }
        }
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn('Warning: Failed to parse existing data file:', err.message);
      }
      await this.persistImmediate();
    }

    this.initialized = true;
  }

  /**
   * Retrieves a record by short key.
   * @param {string} key 
   * @returns {LinkRecord|null}
   */
  get(key) {
    return this.store.get(key) || null;
  }

  /**
   * Checks if key exists.
   * @param {string} key 
   * @returns {boolean}
   */
  has(key) {
    return this.store.has(key);
  }

  /**
   * Stores a record in memory and schedules persistence.
   * @param {string} key 
   * @param {LinkRecord} record 
   */
  set(key, record) {
    this.store.set(key, record);
    if (!record.isCustom) {
      this.urlIndex.set(record.originalUrl, key);
    }
    this.schedulePersist();
    return record;
  }

  /**
   * Finds shortCode by original URL (reverse lookup).
   * @param {string} originalUrl 
   * @returns {LinkRecord|null}
   */
  findByUrl(originalUrl) {
    const existingKey = this.urlIndex.get(originalUrl);
    if (existingKey && this.store.has(existingKey)) {
      return this.store.get(existingKey);
    }
    return null;
  }

  /**
   * Records a click event for analytics.
   * @param {string} key 
   * @param {{ userAgent?: string, referer?: string, ip?: string }} meta 
   * @returns {LinkRecord|null}
   */
  recordClick(key, meta = {}) {
    const record = this.store.get(key);
    if (!record) return null;

    record.clicks = (record.clicks || 0) + 1;
    record.lastAccessedAt = new Date().toISOString();

    if (!record.accessLogs) {
      record.accessLogs = [];
    }

    // Retain recent 50 access logs
    record.accessLogs.unshift({
      timestamp: record.lastAccessedAt,
      userAgent: meta.userAgent || 'Unknown',
      referer: meta.referer || 'Direct',
      ip: meta.ip || '127.0.0.1'
    });

    if (record.accessLogs.length > 50) {
      record.accessLogs = record.accessLogs.slice(0, 50);
    }

    this.schedulePersist();
    return record;
  }

  /**
   * Deletes a short URL by key.
   * @param {string} key 
   * @returns {boolean}
   */
  delete(key) {
    const record = this.store.get(key);
    if (!record) return false;

    this.store.delete(key);
    if (this.urlIndex.get(record.originalUrl) === key) {
      this.urlIndex.delete(record.originalUrl);
    }
    this.schedulePersist();
    return true;
  }

  /**
   * Returns all stored records, newest first.
   * @returns {LinkRecord[]}
   */
  getAll() {
    return Array.from(this.store.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  /**
   * Returns summary metrics.
   */
  getStats() {
    let totalClicks = 0;
    for (const item of this.store.values()) {
      totalClicks += item.clicks || 0;
    }
    return {
      totalLinks: this.store.size,
      totalClicks
    };
  }

  /**
   * Debounced persistence to optimize disk I/O.
   */
  schedulePersist() {
    this.isDirty = true;
    if (this.flushTimeout) return;
    this.flushTimeout = setTimeout(() => {
      this.flushTimeout = null;
      this.persistImmediate().catch(err => {
        console.error('Error writing to storage file:', err);
      });
    }, 150);
  }

  /**
   * Atomically writes in-memory store to JSON file.
   */
  async persistImmediate() {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    const data = JSON.stringify(Array.from(this.store.values()), null, 2);
    const tempPath = `${this.filePath}.tmp.${Date.now()}`;
    await fs.writeFile(tempPath, data, 'utf-8');
    await fs.rename(tempPath, this.filePath);
    this.isDirty = false;
  }
}
