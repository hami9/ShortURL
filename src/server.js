import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeUrl, hashUrlToBase64, validateCustomAlias, RESERVED_WORDS } from './hasher.js';
import { KeyValueStore } from './kvStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const storeFilePath = path.join(rootDir, 'data', 'store.json');

const PORT = process.env.PORT || 3000;
export const kvStore = new KeyValueStore(storeFilePath);

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(payload, null, 2));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 100 * 1024) {
        reject(new Error('Payload too large (max 100KB).'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(new Error('Invalid JSON payload.'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Creates HTTP server for API and redirects.
 */
export function createServer() {
  return http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      });
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost:3000'}`);
    const pathname = parsedUrl.pathname;
    const clientHost = req.headers.host || `localhost:${PORT}`;
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const baseUrl = `${protocol}://${clientHost}`;

    // 1. POST /api/shorten
    if (req.method === 'POST' && pathname === '/api/shorten') {
      try {
        const body = await parseBody(req);
        const rawUrl = body.url;
        const customAlias = body.customAlias ? body.customAlias.trim() : null;

        if (!rawUrl) {
          sendJson(res, 400, { success: false, error: 'URL is required.' });
          return;
        }

        const normalized = normalizeUrl(rawUrl);
        let shortCode = '';

        if (customAlias) {
          const validation = validateCustomAlias(customAlias);
          if (!validation.valid) {
            sendJson(res, 400, { success: false, error: validation.error });
            return;
          }

          if (kvStore.has(customAlias)) {
            const existing = kvStore.get(customAlias);
            if (existing.originalUrl === normalized) {
              sendJson(res, 200, {
                success: true,
                shortCode: customAlias,
                shortUrl: `${baseUrl}/${customAlias}`,
                record: existing,
                message: 'Custom alias already exists for this URL.'
              });
              return;
            } else {
              sendJson(res, 409, { success: false, error: `Custom alias "${customAlias}" is already taken.` });
              return;
            }
          }

          shortCode = customAlias;
        } else {
          // Check reverse index to reuse code for identical URL
          const existing = kvStore.findByUrl(normalized);
          if (existing) {
            sendJson(res, 200, {
              success: true,
              shortCode: existing.shortCode,
              shortUrl: `${baseUrl}/${existing.shortCode}`,
              record: existing,
              reused: true
            });
            return;
          }

          // Generate short code with collision handling
          let collisionCounter = 0;
          do {
            shortCode = hashUrlToBase64(normalized, 6, collisionCounter > 0 ? String(collisionCounter) : '');
            collisionCounter++;
          } while (kvStore.has(shortCode) && kvStore.get(shortCode).originalUrl !== normalized);
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

        kvStore.set(shortCode, record);

        sendJson(res, 201, {
          success: true,
          shortCode,
          shortUrl: `${baseUrl}/${shortCode}`,
          record
        });
      } catch (err) {
        sendJson(res, 400, { success: false, error: err.message || 'Error processing request.' });
      }
      return;
    }

    // 2. GET /api/urls
    if (req.method === 'GET' && pathname === '/api/urls') {
      const urls = kvStore.getAll();
      const stats = kvStore.getStats();
      sendJson(res, 200, { success: true, urls, stats });
      return;
    }

    // 3. GET /api/stats/:code
    if (req.method === 'GET' && pathname.startsWith('/api/stats/')) {
      const code = pathname.replace('/api/stats/', '').trim();
      const item = kvStore.get(code);
      if (!item) {
        sendJson(res, 404, { success: false, error: 'Short URL not found.' });
        return;
      }
      sendJson(res, 200, { success: true, record: item });
      return;
    }

    // 4. DELETE /api/urls/:code
    if (req.method === 'DELETE' && pathname.startsWith('/api/urls/')) {
      const code = pathname.replace('/api/urls/', '').trim();
      if (!kvStore.has(code)) {
        sendJson(res, 404, { success: false, error: 'Short URL not found.' });
        return;
      }
      kvStore.delete(code);
      sendJson(res, 200, { success: true, message: 'Short URL deleted successfully.' });
      return;
    }

    // 5. GET / - API Info
    if (req.method === 'GET' && pathname === '/') {
      sendJson(res, 200, {
        service: 'ShortURL API',
        status: 'online',
        endpoints: {
          'POST /api/shorten': 'Shorten URL (Body: { "url": "https://...", "customAlias": "optional" })',
          'GET /api/urls': 'List all shortened URLs and analytics',
          'GET /api/stats/:code': 'Get detailed stats for a code',
          'DELETE /api/urls/:code': 'Delete a code',
          'GET /:code': 'HTTP 302 redirect to original destination URL'
        },
        stats: kvStore.getStats()
      });
      return;
    }

    // 6. Redirect route (GET /:code)
    if (req.method === 'GET') {
      const possibleCode = pathname.slice(1);
      if (possibleCode && !possibleCode.includes('/') && !RESERVED_WORDS.has(possibleCode.toLowerCase())) {
        const record = kvStore.get(possibleCode);
        if (record) {
          const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
          kvStore.recordClick(possibleCode, {
            userAgent: req.headers['user-agent'] || 'Unknown',
            referer: req.headers['referer'] || 'Direct',
            ip: Array.isArray(clientIp) ? clientIp[0] : clientIp.split(',')[0].trim()
          });

          res.writeHead(302, {
            'Location': record.originalUrl,
            'Cache-Control': 'no-cache, no-store, must-revalidate'
          });
          res.end();
          return;
        } else {
          sendJson(res, 404, {
            success: false,
            error: `Short URL "${possibleCode}" not found or expired.`
          });
          return;
        }
      }
    }

    sendJson(res, 404, { success: false, error: 'Route not found (404).' });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await kvStore.init();
  const server = createServer();
  server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    console.log(`Base URL: http://localhost:${PORT}`);
  });
}
