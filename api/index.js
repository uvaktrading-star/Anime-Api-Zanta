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
        console.log("Launching Super-Targeted Mode...");
        browser = await puppeteer.launch({
            executablePath: '/app/.chrome-for-testing/chrome-linux64/chrome',
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36');

        // 1. ඇඩ් ටැබ් එකක් ආපු ගමන් ඒක වහලා මුල් පේජ් එකටම එනවා
        browser.on('targetcreated', async (target) => {
            if (target.type() === 'page') {
                const adPage = await target.page();
                if (adPage) {
                    const url = adPage.url();
                    if (!url.includes('datanodes.to')) {
                        console.log("Ad Blocked & Closing:", url);
                        await adPage.close().catch(() => {});
                        await page.bringToFront(); // බලෙන්ම මුල් පේජ් එක ඉස්සරහට ගන්නවා
                    }
                }
            }
        });

        console.log("Step 1: Loading DataNodes...");
        await page.goto(dataNodesUrl, { waitUntil: 'domcontentloaded' });

        const btnSelector = 'button.bg-blue-600';
        await page.waitForSelector(btnSelector, { timeout: 10000 });

        // 2. මෙන්න මෙතන තමයි සෙල්ලම තියෙන්නේ
        // අපි බටන් එක ඔබනවා පේජ් එකේ "Countdown" එක පේනකම්ම
        console.log("Step 2: Clicking until countdown starts...");
        let countdownStarted = false;
        let clickLimit = 5; // උපරිම 5 පාරක් ට්‍රයි කරනවා

        for (let i = 0; i < clickLimit; i++) {
            console.log(`Clicking button (Attempt ${i + 1})...`);
            await page.evaluate((sel) => {
                const btn = document.querySelector(sel);
                if (btn) btn.click();
            }, btnSelector);

            await new Promise(r => setTimeout(r, 3000)); // ඇඩ් එක ඕපන් වෙලා වහන්න වෙලාව දෙනවා

            // පේජ් එකේ Countdown එක හරි "Download Now" හරි පේනවාද බලනවා
            countdownStarted = await page.evaluate(() => {
                const bodyText = document.body.innerText.toLowerCase();
                // තත්පර ගණන පේනවා නම් හෝ Download Now ලින්ක් එක ඇවිත් නම් loop එක නවත්තනවා
                return bodyText.includes('wait') || bodyText.includes('seconds') || !!document.querySelector('a.bg-green-600');
            });

            if (countdownStarted) {
                console.log("Countdown detected! Waiting...");
                break;
            }
        }

        // 3. Countdown එකටයි Final Link එකටයි වෙලාව දෙමු
        console.log("Step 3: Waiting for final link generation (15s)...");
        await new Promise(r => setTimeout(r, 15000));

        // 4. අන්තිම පාරටත් බටන් එක ඔබනවා (Countdown ඉවර වුණාම එන එක)
        await page.evaluate((sel) => {
            const btn = document.querySelector(sel);
            if (btn) btn.click();
        }, btnSelector).catch(() => {});

        await new Promise(r => setTimeout(r, 5000)); // ලින්ක් එක load වෙන්න වෙලාව

        // 5. ලින්ක් එක අරගන්නවා
        const directUrl = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a'));
            const target = links.find(a => a.href.includes('dlproxy.uk'));
            return target ? target.href : null;
        });

        if (directUrl) {
            console.log("Success! Link found.");
            return { success: true, url: directUrl };
        } else {
            throw new Error("Could not capture the link. Possible bot protection.");
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
