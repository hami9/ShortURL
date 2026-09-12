import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { normalizeUrl, hashUrlToBase64, validateCustomAlias, RESERVED_WORDS } from '../src/hasher.js';
import { KeyValueStore } from '../src/kvStore.js';
import { createServer } from '../src/server.js';
import { UrlShortenerService } from '../src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testDataPath = path.join(__dirname, 'test_store.json');

console.log('Running automated tests for ShortURL...');

async function runTests() {
  try {
    await fs.unlink(testDataPath);
  } catch {}

  // 1. Hasher Tests
  console.log('1. Testing URL normalization and validation...');
  {
    const u1 = normalizeUrl('google.com');
    assert.equal(u1, 'https://google.com/');

    const u2 = normalizeUrl('http://example.com/test?query=1#hash');
    assert.equal(u2, 'http://example.com/test?query=1#hash');

    assert.throws(() => normalizeUrl(''), /cannot be empty/i);
    assert.throws(() => normalizeUrl('invalid-url-without-domain'), /invalid domain/i);
  }

  // 2. Base64 Hashing Tests
  console.log('2. Testing SHA-256 and Base64URL hashing...');
  {
    const url = 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/302';
    const code1 = hashUrlToBase64(url);
    const code2 = hashUrlToBase64(url);

    assert.equal(code1, code2, 'Hash generation must be deterministic');
    assert.equal(code1.length, 8, 'Code length must be exactly 8 characters');
    assert.match(code1, /^[a-zA-Z0-9_-]{8}$/, 'Code must contain only URL-safe characters');

    const saltedCode = hashUrlToBase64(url, 6, '1');
    assert.notEqual(code1, saltedCode, 'Salted hash must produce a different code');
  }

  // 3. Custom Alias Validation Tests
  console.log('3. Testing custom alias validation...');
  {
    assert.equal(validateCustomAlias('my-cool-link').valid, true);
    assert.equal(validateCustomAlias('api').valid, false, 'Reserved word must be rejected');
    assert.equal(validateCustomAlias('ab').valid, false, 'Aliases under 3 chars must be rejected');
    assert.equal(validateCustomAlias('invalid@alias!').valid, false, 'Special characters must be rejected');
  }

  // 4. Key-Value Store Tests
  console.log('4. Testing KeyValueStore operations and persistence...');
  {
    const store = new KeyValueStore(testDataPath);
    await store.init();

    const record = {
      shortCode: 'testKey1',
      originalUrl: 'https://github.com',
      createdAt: new Date().toISOString(),
      clicks: 0,
      lastAccessedAt: null,
      accessLogs: [],
      isCustom: false
    };
    store.set('testKey1', record);

    assert.equal(store.has('testKey1'), true);
    assert.equal(store.get('testKey1').originalUrl, 'https://github.com');

    const found = store.findByUrl('https://github.com');
    assert.ok(found);
    assert.equal(found.shortCode, 'testKey1');

    store.recordClick('testKey1', { userAgent: 'MochaTest', ip: '127.0.0.1' });
    assert.equal(store.get('testKey1').clicks, 1);
    assert.equal(store.get('testKey1').accessLogs.length, 1);

    await store.persistImmediate();

    const store2 = new KeyValueStore(testDataPath);
    await store2.init();
    assert.equal(store2.has('testKey1'), true);
    assert.equal(store2.get('testKey1').clicks, 1);

    store2.delete('testKey1');
    assert.equal(store2.has('testKey1'), false);
    assert.equal(store2.findByUrl('https://github.com'), null);
  }

  // 5. Server Endpoints & HTTP Redirect Tests
  console.log('5. Testing API routes and HTTP 302 redirects...');
  {
    const testServer = createServer();
    await new Promise(resolve => testServer.listen(0, resolve));
    const port = testServer.address().port;

    function makeRequest(method, path, body = null) {
      return new Promise((resolve, reject) => {
        const req = http.request({
          hostname: '127.0.0.1',
          port,
          path,
          method,
          headers: body ? { 'Content-Type': 'application/json' } : {}
        }, res => {
          let data = '';
          res.on('data', c => data += c);
          res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
      });
    }

    const shortenRes = await makeRequest('POST', '/api/shorten', {
      url: 'https://en.wikipedia.org/wiki/URL_shortening'
    });
    assert.equal(shortenRes.status, 201);
    const parsed = JSON.parse(shortenRes.body);
    assert.equal(parsed.success, true);
    assert.ok(parsed.shortCode);
    const createdCode = parsed.shortCode;

    const redirectRes = await makeRequest('GET', `/${createdCode}`);
    assert.equal(redirectRes.status, 302, 'Redirect must return 302');
    assert.equal(redirectRes.headers.location, 'https://en.wikipedia.org/wiki/URL_shortening');

    const notFoundRes = await makeRequest('GET', '/nonexistent99');
    assert.equal(notFoundRes.status, 404);

    const urlsRes = await makeRequest('GET', '/api/urls');
    assert.equal(urlsRes.status, 200);
    const urlsData = JSON.parse(urlsRes.body);
    assert.ok(urlsData.urls.length > 0);

    const delRes = await makeRequest('DELETE', `/api/urls/${createdCode}`);
    assert.equal(delRes.status, 200);

    await new Promise(resolve => testServer.close(resolve));
  }

  // 6. Programmatic UrlShortenerService Tests
  console.log('6. Testing modular UrlShortenerService...');
  {
    const service = new UrlShortenerService(testDataPath);
    const item = await service.shorten('https://nodejs.org/api/crypto.html');
    assert.ok(item.shortCode);
    assert.equal(item.originalUrl, 'https://nodejs.org/api/crypto.html');

    const resolved = service.resolve(item.shortCode, { userAgent: 'LibTest' });
    assert.equal(resolved.clicks, 1);

    const all = service.getAll();
    assert.ok(all.length >= 1);

    service.delete(item.shortCode);
    assert.equal(service.resolve(item.shortCode), null);
  }

  try {
    await fs.unlink(testDataPath);
  } catch {}

  console.log('All tests passed successfully (100%).\n');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
