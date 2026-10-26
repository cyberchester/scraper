import express from 'express';
import scraper from './scraper.js';

const app = express();

app.get('/', async (_request, response) => {
    const data = await scraper.getData();

    if (data === null) {
        return response.status(502).json({ error: 'Unable to fetch market data' });
    }

    return response.json(data);
});

const port = Number(process.env.PORT) || 3000;

app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});
