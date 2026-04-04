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
        console.log("Launching Puppeteer Stealth Mode...");
        browser = await puppeteer.launch({
            executablePath: '/app/.chrome-for-testing/chrome-linux64/chrome',
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu'
            ]
        });

        const page = await browser.newPage();
        await page.setDefaultNavigationTimeout(90000); // කාලය තවත් වැඩි කරා
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36');

        // Request Interception: ඇඩ් ලෝඩ් වෙන එක නවත්තනවා (Speed එක වැඩි වෙන්න)
        await page.setRequestInterception(true);
        page.on('request', (request) => {
            const url = request.url();
            if (url.includes('google-analytics') || url.includes('doubleclick') || url.includes('adsystem')) {
                request.abort();
            } else {
                request.continue();
            }
        });

        console.log("Navigating to DataNodes...");
        await page.goto(dataNodesUrl, { waitUntil: 'domcontentloaded' });

        // 1. "Start Download" බටන් එක ක්ලික් කිරීම (3 වතාවක් ට්‍රයි කරනවා)
        for (let i = 1; i <= 3; i++) {
            console.log(`Click attempt ${i}...`);
            await page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('button, a'));
                const target = buttons.find(b => 
                    b.innerText.toLowerCase().includes('download') || 
                    b.innerText.toLowerCase().includes('start')
                );
                if (target) target.click();
            });
            await new Promise(r => setTimeout(r, 3000)); // ඇඩ්ස් වහන්න ඉඩ දෙනවා
        }

        // 2. Countdown එක ඉවර වෙනකම් ලොකු වෙලාවක් ඉමු
        console.log("Waiting for generation (25s)...");
        await new Promise(r => setTimeout(r, 25000));

        // 3. ලින්ක් එක හොයනවා (Deep Search)
        const result = await page.evaluate(() => {
            const allLinks = Array.from(document.querySelectorAll('a'));
            
            // dlproxy ලින්ක් එක තියෙනවද බලනවා
            const direct = allLinks.find(a => a.href.includes('dlproxy.uk'));
            if (direct) return { found: true, url: direct.href };

            // නැත්නම් පේජ් එකේ තියෙන හැම ලින්ක් එකක්ම ලැයිස්තුගත කරනවා (Debug වලට)
            return { 
                found: false, 
                links: allLinks.slice(0, 10).map(a => a.href) 
            };
        });

        if (result.found) {
            console.log("Success! Link found.");
            return { success: true, url: result.url };
        } else {
            console.log("Recent Links on page:", result.links);
            throw new Error("Direct link still not visible. Check logs for links.");
        }

    } catch (e) {
        console.error("Puppeteer Error:", e.message);
        return { success: false, error: e.message };
    } finally {
        if (browser) await browser.close();
    }
}
// Routes
app.get('/api/search', async (req, res) => res.json(await searchGames(req.query.q)));
app.get('/api/files', async (req, res) => res.json(await getGameFiles(req.query.url)));
app.get('/api/datanodes', async (req, res) => res.json(await getDirectDownload(req.query.url)));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server on ${PORT}`));
