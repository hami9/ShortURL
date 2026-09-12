# ShortURL

A lightweight, zero-dependency URL shortener engine built with Node.js. It hashes long URLs using SHA-256, encodes a 6-byte slice into URL-safe Base64 (8 characters), and stores mappings in a persistent in-memory Key-Value store with atomic file persistence.

## Features

- Zero external dependencies (uses native Node.js crypto, fs, and http).
- Deterministic 8-character URL-safe Base64 slug generation.
- Automatic hash collision handling via salting.
- O(1) in-memory Key-Value store with atomic disk persistence.
- Reverse indexing to prevent duplicate mappings for identical URLs.
- HTTP redirect service (302 Found) with click analytics tracking.
- Modular architecture (usable as an HTTP API or as an imported module).

## Getting Started

### Requirements
- Node.js v18 or later

### Installation
No dependencies are required. Clone the repository and run:

```bash
# Run test suite
npm test

# Start the API server
npm start
```

Default port is `3000` (configurable via `PORT` environment variable).

## API Reference

### 1. Shorten URL
`POST /api/shorten`

Request:
```json
{
  "url": "https://example.com/very/long/url",
  "customAlias": "custom-slug"
}
```

Response (201 Created):
```json
{
  "success": true,
  "shortCode": "custom-slug",
  "shortUrl": "http://localhost:3000/custom-slug",
  "record": {
    "shortCode": "custom-slug",
    "originalUrl": "https://example.com/very/long/url",
    "createdAt": "2026-09-12T08:21:56.662Z",
    "clicks": 0,
    "lastAccessedAt": null,
    "accessLogs": [],
    "isCustom": true
  }
}
```

### 2. List All URLs
`GET /api/urls`

Returns all stored links and total statistics.

### 3. Get URL Stats
`GET /api/stats/:code`

Returns analytics, click count, and recent access logs for the specified code.

### 4. Delete URL
`DELETE /api/urls/:code`

Deletes the specified short URL mapping.

### 5. Redirect
`GET /:code`

Performs an HTTP 302 redirect to the original destination URL and increments click count.

## Programmatic Usage

```javascript
import { UrlShortenerService } from './src/index.js';

const shortener = new UrlShortenerService();

// Shorten a URL
const record = await shortener.shorten('https://nodejs.org');
console.log(record.shortCode);

// Resolve and track click
const resolved = shortener.resolve(record.shortCode);
console.log(resolved.originalUrl);
```

## Documentation

For full architectural breakdown and Persian documentation, see `whatamibuild.md`.

## License

MIT
