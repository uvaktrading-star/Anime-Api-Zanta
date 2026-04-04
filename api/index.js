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
        console.log("Launching Final Boss Mode...");
        browser = await puppeteer.launch({
            executablePath: '/app/.chrome-for-testing/chrome-linux64/chrome',
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36');

        // ඇඩ් ටැබ් ආවොත් වහන්න
        browser.on('targetcreated', async (target) => {
            if (target.type() === 'page') {
                const adPage = await target.page();
                if (adPage && !adPage.url().includes('datanodes.to')) {
                    await adPage.close().catch(() => {});
                }
            }
        });

        console.log("Step 1: Navigating to page...");
        await page.goto(dataNodesUrl, { waitUntil: 'domcontentloaded' });

        // --- පියවර 1: "Free Download" බටන් එක ක්ලික් කිරීම ---
        console.log("Step 2: Clicking Free Download...");
        const btnSelector = 'button.bg-blue-600';
        await page.waitForSelector(btnSelector, { timeout: 10000 });
        
        // පේජ් එක refresh වෙනකම් බලන් ඉන්න ගමන් click කරනවා
        await Promise.all([
            page.click(btnSelector),
            page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => console.log("Navigation timeout or not needed"))
        ]);

        // --- පියවර 2: Countdown එක එනකම් ඉඳලා ආයෙත් ක්ලික් කිරීම ---
        console.log("Step 3: Waiting for countdown/next button...");
        await new Promise(r => setTimeout(r, 10000)); // තත්පර 10ක් ඉමු

        // දැන් පේජ් එකේ තියෙන බටන් එක ආයෙත් ක්ලික් කරමු
        await page.evaluate((sel) => {
            const btn = document.querySelector(sel);
            if (btn) btn.click();
        }, btnSelector).catch(() => {});

        // --- පියවර 3: අවසාන ලින්ක් එක එනකම් තත්පර 10ක් බලන් ඉමු ---
        console.log("Step 4: Waiting for final direct link...");
        await new Promise(r => setTimeout(r, 10000));

        // --- පියවර 4: ලින්ක් එක අරගැනීම ---
        const directUrl = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a'));
            const target = links.find(a => a.href.includes('dlproxy.uk'));
            return target ? target.href : null;
        });

        if (directUrl) {
            console.log("Success! Link found.");
            return { success: true, url: directUrl };
        } else {
            // ලින්ක් එක නැත්නම්, දැනට පේජ් එකේ තියෙන එකම කොළ පාට ලින්ක් එක හරි ගමු
            const backupUrl = await page.evaluate(() => {
                const greenBtn = document.querySelector('a.bg-green-600');
                return greenBtn ? greenBtn.href : null;
            });
            if (backupUrl) return { success: true, url: backupUrl };
            
            throw new Error("Link still hidden. Site protection might be too high.");
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
