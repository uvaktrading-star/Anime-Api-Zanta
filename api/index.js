const axios = require('axios');
const cheerio = require('cheerio');
const { wrapper } = require('axios-cookiejar-support'); // මේක අනිවාර්යයි
const { CookieJar } = require('tough-cookie');
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());

const BASE_URL = "https://fitgirl-repacks.site";

const jar = new CookieJar();
const client = wrapper(axios.create({
    jar,
    withCredentials: true,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Origin': 'https://datanodes.to',
        'Referer': 'https://datanodes.to/'
    }
}));

// --- පියවර 1: Game එකක් Search කිරීම ---
async function searchGames(query) {
    try {
        const searchUrl = `${BASE_URL}/?s=${encodeURIComponent(query)}`;
        const { data } = await axios.get(searchUrl);
        const $ = cheerio.load(data);
        
        let results = [];

        // Image එකේ විදිහට 'article' tags search කරනවා
        $('article').each((_, el) => {
            const titleElement = $(el).find('h1.entry-title a');
            const title = titleElement.text().trim();
            const url = titleElement.attr('href');

            if (title && url) {
                results.push({
                    title: title,
                    url: url
                });
            }
        });

        return { success: true, results };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

// --- පියවර 2: තෝරාගත් Game එකේ DataNodes File List එක විතරක් ගැනීම ---
async function getGameFiles(gameUrl) {
    try {
        const { data } = await axios.get(gameUrl);
        const $ = cheerio.load(data);
        
        let datanodesLinks = [];

        // FitGirl එකේ සාමාන්‍යයෙන් download links තියෙන්නේ 'su-spoiler-content' හෝ 'ul' tags ඇතුළේ
        // අපි මුලින්ම 'a' tags ඔක්කොම scan කරලා 'datanodes.to' තියෙන ඒවා විතරක් ගමු
        $('a').each((_, el) => {
            const href = $(el).attr('href');
            const text = $(el).text().trim();

            // Check if link is from datanodes.to
            if (href && href.includes('datanodes.to')) {
                // ගොඩක් වෙලාවට rar parts තියෙන්නේ "Filehoster: DataNodes" වගේ ඒවත් එක්ක
                // නැත්නම් කෙලින්ම part නම තියෙන ඒවත් එක්ක
                datanodesLinks.push({
                    partName: text || "Download Part",
                    downloadUrl: href
                });
            }
        });

        // Duplicate links අයින් කරමු (සමහර වෙලාවට එකම link එක තැන් දෙකක තියෙන්න පුළුවන්)
        const uniqueLinks = datanodesLinks.filter((v, i, a) => 
            a.findIndex(t => (t.downloadUrl === v.downloadUrl)) === i
        );

        if (uniqueLinks.length === 0) {
            return { success: false, error: "No DataNodes links found for this game." };
        }

        return { 
            success: true, 
            total_parts: uniqueLinks.length,
            files: uniqueLinks 
        };

    } catch (e) {
        return { success: false, error: e.message };
    }
}

async function getDirectDownload(dataNodesUrl) {
    try {
        // 1. Landing page එකට ගිහින් hidden fields ටික ගන්නවා
        const res = await client.get(dataNodesUrl);
        const $ = cheerio.load(res.data);
        
        const formData = new URLSearchParams();
        
        // Form එකේ තියෙන ඔක්කොම input values ගන්නවා
        $('form input').each((_, el) => {
            const name = $(el).attr('name');
            const value = $(el).attr('value') || "";
            if (name) formData.append(name, value);
        });

        // 💡 වැදගත්: සමහර විට මෙතන 'op', 'id', 'rand' වගේ fields තියෙන්න පුළුවන්
        // ඒවා තමයි countdown එක bypass කරන්න ඕනේ වෙන්නේ.

        // 2. තත්පර 15 ක් ඉන්නේ නැතුව කෙලින්ම POST කරලා බලමු
        const postRes = await client.post(dataNodesUrl, formData.toString(), {
            headers: { 
                'Content-Type': 'application/x-www-form-urlencoded',
                'Referer': dataNodesUrl 
            }
        });

        const $post = cheerio.load(postRes.data);
        let directLink = "";

        $post('a').each((_, el) => {
            const href = $post(el).attr('href');
            if (href && href.includes('dlproxy.uk')) {
                directLink = href;
            }
        });

        if (directLink) return { success: true, direct_url: directLink };

        // 3. වැඩේ හරිගියේ නැත්නම්, සමහරවිට request එක යවන්න කලින් තත්පර 15ක් ඉන්නම වෙනවා
        return { success: false, error: "Bypass failed. Timer or Captcha is active." };

    } catch (e) {
        return { success: false, error: e.message };
    }
}
// API Endpoint එක
// http://localhost:5000/api/datanodes?url=DATANODES_URL
app.get('/api/datanodes', async (req, res) => {
    const url = req.query.url;
    if (!url) return res.json({ success: false, error: "URL is required" });
    res.json(await getDirectDownload(url));
});

// File List Endpoint
app.get('/api/files', async (req, res) => {
    const url = req.query.url;
    if (!url) return res.json({ success: false, error: "Game URL required" });
    res.json(await getGameFiles(url));
});

// Search Endpoint
app.get('/api/search', async (req, res) => {
    const query = req.query.q;
    if (!query) return res.json({ success: false, error: "Search query required" });
    res.json(await searchGames(query));
});

app.listen(5000, () => console.log("🚀 API started on port 5000"));