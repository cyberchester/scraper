import express from 'express';
import scraper from './scraper.js';

const app = express();
const responseCache = new Map();
const responseCacheTtlMs = 1_000;

app.get('/', async (request, response) => {
    const cacheKey = `${request.method}:${request.path}`;
    const cached = responseCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
        return response.json(cached.data);
    }
    responseCache.delete(cacheKey);

    const data = await scraper.getData();

    if (data === null) {
        return response.status(502).json({ error: 'Unable to fetch market data' });
    }

    responseCache.set(cacheKey, {
        data,
        expiresAt: Date.now() + responseCacheTtlMs,
    });

    return response.json(data);
});

const port = Number(process.env.PORT) || 3000;

app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});
