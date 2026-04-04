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
        console.log("Launching Puppeteer Faster Mode...");
        browser = await puppeteer.launch({
            executablePath: '/app/.chrome-for-testing/chrome-linux64/chrome',
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36');

        // ඇඩ් ටැබ් ආවොත් එවලෙම වහන්න (මේක අනිවාර්යයි)
        browser.on('targetcreated', async (target) => {
            if (target.type() === 'page') {
                const adPage = await target.page();
                if (adPage && !adPage.url().includes('datanodes.to')) {
                    await adPage.close().catch(() => {});
                }
            }
        });

        console.log("Navigating...");
        await page.goto(dataNodesUrl, { waitUntil: 'domcontentloaded' });

        const btnSelector = 'button.bg-blue-600';
        await page.waitForSelector(btnSelector, { timeout: 10000 });

        console.log("Starting Click Loop until link appears...");
        let directUrl = null;
        let attempts = 0;
        const maxAttempts = 12; // තත්පර 24ක් උපරිම (Heroku limit එකට යටින්)

        while (!directUrl && attempts < maxAttempts) {
            attempts++;
            
            // 1. බටන් එක ක්ලික් කරනවා
            await page.evaluate((sel) => {
                const btn = document.querySelector(sel);
                if (btn) btn.click();
            }, btnSelector).catch(() => {});

            // 2. තත්පර 2ක් ඉන්නවා ලින්ක් එක ආවද බලන්න
            await new Promise(r => setTimeout(r, 2000));

            // 3. පේජ් එකේ dlproxy ලින්ක් එක තියෙනවද කියලා චෙක් කරනවා
            directUrl = await page.evaluate(() => {
                const anchor = Array.from(document.querySelectorAll('a'))
                                    .find(a => a.href.includes('dlproxy.uk'));
                return anchor ? anchor.href : null;
            });

            if (directUrl) break;
            console.log(`Attempt ${attempts}: Link not found yet, clicking again...`);
        }

        if (directUrl) {
            console.log("Success! Link found.");
            return { success: true, url: directUrl };
        } else {
            throw new Error("Direct link not found within time limit.");
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
