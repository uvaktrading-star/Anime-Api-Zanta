const express = require('express');
const { searchAnime, getEpisodes } = require('./scraper');
const app = express();

app.get('/search', async (req, res) => {
    const query = req.query.q;
    if (!query) return res.status(400).json({ error: "Query required" });
    const data = await searchAnime(query);
    res.json(data);
});

app.get('/episodes', async (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: "URL required" });
    const data = await getEpisodes(url);
    res.json(data);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));