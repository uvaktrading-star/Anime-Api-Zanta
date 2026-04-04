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
        console.log("Launching Puppeteer...");
        browser = await puppeteer.launch({
            executablePath: '/app/.chrome-for-testing/chrome-linux64/chrome',
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--gpu-sandbox-allow-sys-calls'
            ]
        });

        const page = await browser.newPage();
        await page.setDefaultNavigationTimeout(60000);
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        // 1. Ads/New Tabs වළක්වන ලොජික් එක
        browser.on('targetcreated', async (target) => {
            if (target.type() === 'page') {
                const newPage = await target.page();
                if (newPage) {
                    const url = newPage.url();
                    // මේන් සයිට් එක නෙවෙයි නම් වහලා දානවා
                    if (!url.includes('datanodes.to') && url !== 'about:blank') {
                        console.log("Closing Ad Tab:", url);
                        await newPage.close();
                    }
                }
            }
        });

        console.log("Navigating to DataNodes...");
        await page.goto(dataNodesUrl, { waitUntil: 'networkidle2' });

        const btnSelector = 'button.bg-blue-600';
        await page.waitForSelector(btnSelector, { timeout: 15000 });

        // --- පියවර 1: පළවෙනි ක්ලික් එක (ඇඩ් එක එන එක) ---
        console.log("First Click (Handling potential ad)...");
        await page.evaluate((sel) => {
            document.querySelector(sel).click();
        }, btnSelector);

        // පොඩි වෙලාවක් ඉමු ඇඩ් එක ඕපන් වෙලා ක්ලෝස් වෙනකම්
        await new Promise(r => setTimeout(r, 2000));

        // --- පියවර 2: දෙවැනි ක්ලික් එක (Countdown එක පටන් ගන්න) ---
        console.log("Second Click (Starting countdown)...");
        try {
            await page.evaluate((sel) => {
                document.querySelector(sel).click();
            }, btnSelector);
        } catch (e) {
            console.log("Second click attempted...");
        }

        // --- පියවර 3: තත්පර 5ක Countdown එක ඉවර වෙනකම් ඉමු ---
        console.log("Waiting for short countdown (7s)...");
        await new Promise(r => setTimeout(r, 7000));

        // --- පියවර 4: තෙවැනි ක්ලික් එක (Download ලින්ක් එක Generate කරන්න) ---
        console.log("Third Click (Requesting final link)...");
        await page.evaluate((sel) => {
            const btn = document.querySelector(sel);
            if (btn) btn.click();
        }, btnSelector);

        // අවසාන ලින්ක් එක ලෝඩ් වෙන්න ටිකක් ඉමු
        console.log("Waiting for final link (12s)...");
        await new Promise(r => setTimeout(r, 12000));

        // --- පියවර 5: Final Link එක අරගන්න ලොජික් එක ---
        const directUrl = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a'));
            
            // 1. dlproxy ලින්ක් එක තිබේදැයි බැලීම
            const dlproxy = links.find(a => a.href.includes('dlproxy.uk'));
            if (dlproxy) return dlproxy.href;

            // 2. "Download Now" බටන් එක සොයමු
            const downloadBtn = links.find(a => 
                a.innerText.toLowerCase().includes('download now') || 
                a.classList.contains('bg-green-600')
            );
            if (downloadBtn) return downloadBtn.href;

            return null;
        });

        if (!directUrl || directUrl.includes('datanodes.to/download')) {
            throw new Error("Direct link not found after multiple steps.");
        }

        console.log("Success! Link found.");
        return { success: true, url: directUrl };

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
