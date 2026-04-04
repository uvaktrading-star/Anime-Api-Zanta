const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');
const cheerio = require('cheerio');
const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');

const app = express();
app.use(cors());

const jar = new CookieJar();
const client = wrapper(axios.create({ jar }));
const BASE_URL = "https://fitgirl-repacks.site";

// --- 1. Search Games ---
async function searchGames(query) {
    try {
        const { data } = await axios.get(`${BASE_URL}/?s=${encodeURIComponent(query)}`);
        const $ = cheerio.load(data);
        let results = [];
        $('article').each((_, el) => {
            const a = $(el).find('h1.entry-title a');
            if (a.text()) results.push({ title: a.text().trim(), url: a.attr('href') });
        });
        return { success: true, results };
    } catch (e) { return { success: false, error: e.message }; }
}

// --- 2. Get DataNodes Links ---
async function getGameFiles(gameUrl) {
    try {
        const { data } = await axios.get(gameUrl);
        const $ = cheerio.load(data);
        let links = [];
        $('a').each((_, el) => {
            const href = $(el).attr('href');
            if (href && href.includes('datanodes.to')) {
                links.push({ name: $(el).text().trim() || "Download Part", url: href });
            }
        });
        return { success: true, files: links };
    } catch (e) { return { success: false, error: e.message }; }
}

// --- 3. Final Direct Link (Puppeteer for Heroku) ---
async function getDirectDownload(dataNodesUrl) {
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage', // Heroku වල memory limits වලට හොඳයි
                '--gpu-sandbox-allow-sys-calls'
            ]
        });
        const page = await browser.newPage();
        
        // Timeout එක වැඩි කරන්න
        await page.setDefaultNavigationTimeout(60000); 

        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
        
        console.log("Navigating to DataNodes...");
        await page.goto(dataNodesUrl, { waitUntil: 'networkidle2' });
        
        const btn = 'button.bg-blue-600';
        // Button එක එනකම් තත්පර 15ක් බලන් ඉමු
        await page.waitForSelector(btn, { timeout: 15000 });
        await page.click(btn);
        
        console.log("Waiting for countdown (18s)...");
        await new Promise(r => setTimeout(r, 18000)); 

        const directUrl = await page.evaluate(() => {
            const a = Array.from(document.querySelectorAll('a'))
                         .find(el => el.href.includes('dlproxy.uk') || el.href.includes('/download/'));
            return a ? a.href : null;
        });

        if (!directUrl) {
            // Error එකක් ආවොත් ලොග් එකේ බලාගන්න screenshot එකක් ගමු (Debugging වලට ලේසියි)
            console.log("Link not found on page.");
            return { success: false, error: "Direct link not found after countdown." };
        }

        return { success: true, url: directUrl };

    } catch (e) { 
        console.error("Puppeteer Error:", e.message);
        return { success: false, error: e.message }; 
    }
    finally { 
        if (browser) await browser.close(); 
    }
}

// Routes
app.get('/api/search', async (req, res) => res.json(await searchGames(req.query.q)));
app.get('/api/files', async (req, res) => res.json(await getGameFiles(req.query.url)));
app.get('/api/datanodes', async (req, res) => res.json(await getDirectDownload(req.query.url)));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server on ${PORT}`));
