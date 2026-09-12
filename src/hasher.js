import crypto from 'node:crypto';

/**
 * Normalizes and validates an input URL.
 * Ensures proper protocol and syntactical validity.
 * 
 * @param {string} rawUrl 
 * @returns {string} Normalized URL string
 * @throws {Error} If URL is invalid or protocol is unsupported
 */
export function normalizeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new Error('URL cannot be empty.');
  }

  let trimmed = rawUrl.trim();

  // Default to https if protocol is missing
  if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = `https://${trimmed}`;
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch (err) {
    throw new Error(`Invalid URL: "${rawUrl}"`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS protocols are supported.');
  }

  if (!parsed.hostname || !parsed.hostname.includes('.')) {
    throw new Error('Invalid domain name (e.g. example.com).');
  }

  return parsed.toString();
}

/**
 * Hashes a URL and converts the digest into a URL-Safe Base64 short code.
 * 
 * 1. Compute SHA-256 digest of (url + salt).
 * 2. Slice the first `byteLength` bytes (default 6 bytes = 48 bits).
 * 3. Encode to Base64URL (RFC 4648 §5): replace '+' with '-', '/' with '_', and strip '='.
 * 4. Yields a deterministic 8-character slug.
 * 
 * @param {string} url - Normalized URL
 * @param {number} [byteLength=6] - Number of bytes to sample (6 bytes = 8 Base64 chars)
 * @param {string} [salt=''] - Salt/counter for collision resolution
 * @returns {string} Safe 8-char slug
 */
export function hashUrlToBase64(url, byteLength = 6, salt = '') {
  const hash = crypto.createHash('sha256');
  hash.update(url + (salt ? `::${salt}` : ''));
  const digestBuffer = hash.digest();
  
  const slice = digestBuffer.subarray(0, byteLength);

  return slice
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Reserved system routes.
 */
export const RESERVED_WORDS = new Set([
  'api',
  'assets',
  'favicon.ico',
  'robots.txt',
  'sitemap.xml',
  'stats',
  'urls',
  'shorten',
  'health',
  'whatamibuild.md'
]);

/**
 * Validates a user-supplied custom alias.
 * 
 * @param {string} alias 
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateCustomAlias(alias) {
  if (!alias) return { valid: true };
  const trimmed = alias.trim();

  if (RESERVED_WORDS.has(trimmed.toLowerCase())) {
    return { valid: false, error: `"${trimmed}" is a reserved keyword.` };
  }

  if (trimmed.length < 3 || trimmed.length > 30) {
    return { valid: false, error: 'Custom alias must be between 3 and 30 characters.' };
  }

  const validRegex = /^[a-zA-Z0-9_-]+$/;
  if (!validRegex.test(trimmed)) {
    return { valid: false, error: 'Custom alias may only contain letters, numbers, hyphens, and underscores.' };
  }

  return { valid: true };
}
