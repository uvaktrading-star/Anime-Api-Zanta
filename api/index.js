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
const ANIME_BASE = "https://animeheaven.me";

//--------FITGIRL REPACK---------
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
        
        // 1. මුලින්ම පේජ් එකේ තියෙන ImageBan ලින්ක් එක හොයනවා
        let pageImageUrl = $('.entry-content img').first().attr('src') || "";
        let finalImageUrl = pageImageUrl;

        // 2. ඒ ලින්ක් එක imageban.ru වගේ එකක් නම්, ඒක ඇතුළට ගිහින් ඇත්තම image එක හොයමු
        if (pageImageUrl.includes('imageban.ru')) {
            try {
                const imgPage = await axios.get(pageImageUrl);
                const $img = cheerio.load(imgPage.data);
                // ImageBan එකේ ඇත්තම පින්තූරය තියෙන්නේ 'id="img_obj"' කියන එකේ හෝ 'img' tag එකක
                const directImg = $img('#img_obj').attr('src') || $img('img[src*="/out/"]').attr('src');
                if (directImg) finalImageUrl = directImg;
            } catch (err) {
                console.log("Image scraping failed, using page link.");
            }
        }

        // 3. Download ලින්ක්ස් ටික අරගන්නවා
        $('a').each((_, el) => {
            const href = $(el).attr('href');
            if (href && href.includes('datanodes.to')) {
                links.push({ 
                    name: $(el).text().trim() || "Download Part", 
                    url: href 
                });
            }
        });

        return { 
            success: true, 
            image: finalImageUrl, 
            files: links 
        };

    } catch (e) { 
        return { success: false, error: e.message }; 
    }
}

// --- 3. Final Direct Link (Puppeteer for Heroku) ---
async function getDirectDownload(dataNodesUrl) {
    let browser;
    try {
        console.log("Launching Ultimate Sniper Mode...");
        browser = await puppeteer.launch({
            executablePath: '/app/.chrome-for-testing/chrome-linux64/chrome',
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36');

        let capturedUrl = null;

        // 🎯 සයිට් එකේ කොහේ හරි dlproxy ලින්ක් එකක් ගියොත් එවලෙම අල්ලගන්නවා
        page.on('request', request => {
            const url = request.url();
            if (url.includes('dlproxy.uk/download/')) {
                capturedUrl = url;
            }
        });

        // 🛡️ ඇඩ්ස් ආපු ගමන් වහලා මුල් පේජ් එකට ෆෝකස් කරනවා
        browser.on('targetcreated', async (target) => {
            if (target.type() === 'page') {
                const adPage = await target.page();
                if (adPage) {
                    const url = adPage.url();
                    if (!url.includes('datanodes.to')) {
                        await adPage.close().catch(() => {});
                        await page.bringToFront();
                    }
                }
            }
        });

        console.log("Step 1: Loading DataNodes...");
        await page.goto(dataNodesUrl, { waitUntil: 'domcontentloaded' });

        const btnSelector = 'button.bg-blue-600';
        await page.waitForSelector(btnSelector, { timeout: 10000 });

        // --- පියවර 1: Countdown එක පටන් ගන්නකම් ඔබනවා ---
        console.log("Step 2: Clicking to trigger countdown...");
        for (let i = 0; i < 4; i++) {
            await page.evaluate((sel) => document.querySelector(sel).click(), btnSelector);
            await new Promise(r => setTimeout(r, 3000));
            
            const isCounting = await page.evaluate(() => {
                const txt = document.body.innerText.toLowerCase();
                return txt.includes('wait') || txt.includes('seconds');
            });
            if (isCounting) {
                console.log("Countdown detected!");
                break;
            }
        }

        // --- පියවර 2: Countdown එක ඉවර වෙන්න වෙලාව දෙනවා (5s + safe margin) ---
        console.log("Step 3: Waiting for 5s countdown to finish...");
        await new Promise(r => setTimeout(r, 8000));

        // --- පියවර 3: ලින්ක් එක අහුවෙනකම්ම ආයෙත් ඔබනවා (මෙතනයි ඇඩ්ස් වැඩියෙන්ම එන්නේ) ---
        console.log("Step 4: Clicking for final link capture...");
        for (let i = 0; i < 6; i++) {
            if (capturedUrl) break;

            await page.evaluate((sel) => {
                const btn = document.querySelector(sel);
                if (btn) btn.click();
            }, btnSelector);

            console.log(`Final click attempt ${i+1}...`);
            await new Promise(r => setTimeout(r, 3500)); // ඇඩ්ස් ක්ලෝස් වෙන්න වෙලාව
        }

        if (capturedUrl) {
            console.log("🎯 Success! Link Captured:", capturedUrl);
            return { success: true, url: capturedUrl };
        } else {
            throw new Error("Could not capture link. Site protection might be too strong.");
        }

    } catch (e) {
        console.error("Puppeteer Error:", e.message);
        return { success: false, error: e.message };
    } finally {
        if (browser) await browser.close();
    }
}

//-----------ANIME HEAVEN------------
async function searchAnime(query) {
    try {
        const searchUrl = `${ANIME_BASE}/search.php?s=${encodeURIComponent(query)}`;
        const { data } = await axios.get(searchUrl, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36' 
            }
        });
        const $ = cheerio.load(data);
        
        let results = [];

        // image_11a583.jpg අනුව පින්තූරය සහ නම තියෙන ලින්ක් එක කෙලින්ම ගමු
        $('.similarimg').each((_, el) => {
            const anchor = $(el).find('a');
            const imgTag = anchor.find('img');
            
            const title = imgTag.attr('alt'); // පින්තූරයේ alt එකේ නම තියෙනවා
            const url = anchor.attr('href');
            const image = imgTag.attr('src');

            if (url) {
                results.push({
                    title: title ? title.trim() : "No Title",
                    url: `${ANIME_BASE}/${url}`,
                    image: image ? `${ANIME_BASE}/${image}` : null
                });
            }
        });

        return { 
            success: true, 
            count: results.length, 
            results: results 
        };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

// --- පියවර 2: Episode List එක සහ විස්තර ලබා ගැනීම (Cheerio Only) ---
async function getEpisodes(animeUrl) {
    try {
        const { data } = await axios.get(animeUrl, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36' 
            }
        });
        const $ = cheerio.load(data);
        
        let episodes = [];

        // image_11fba1.png එකට අනුව data extract කරමු
        $('.linetitle2 a').each((_, el) => {
            // Episode Number එක තියෙන්නේ 'watch2' class එකේ
            const epNumber = $(el).find('.watch2').text().trim();
            
            // Date එක (1106 d ago) තියෙන්නේ 'watch1' class එකේ දෙවෙනි div එකේ වගේ
            // අපි ඒ tag එකේ තියෙන text එකෙන් 'Episode' කියන කෑල්ල අයින් කරලා ගමු
            let dateAgo = $(el).find('.watch1.bc.c').text().replace('Episode', '').trim();

            if (epNumber) {
                episodes.push({
                    episode: epNumber,
                    uploaded: dateAgo
                });
            }
        });

        // Description එක සාමාන්‍යයෙන් තියෙන්නේ පළවෙනි 'boldtext' class එකේ
        const description = $('.boldtext').first().text().trim();

        // Anime එකේ සම්පූර්ණ නම (Header එකේ තියෙන එක)
        const animeTitle = $('.linetitle').first().text().trim() || $('h1').text().trim();

        return { 
            success: true, 
            title: animeTitle,
            description: description,
            total_episodes: episodes.length,
            episodes: episodes 
        };

    } catch (e) {
        return { success: false, error: e.message };
    }
}

async function getDirectAnimeLink(animeUrl, episodeNum) {
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true, // Display එක නැතුව වැඩ කරන්න
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();

        // --- පියවර 1: අනවශ්‍ය Ads සහ Popups බ්ලොක් කිරීම ---
        await page.setRequestInterception(true);
        page.on('request', (request) => {
            const url = request.url();
            if (url.includes('googleads') || url.includes('doubleclick') || url.includes('adsystem') || url.includes('popads')) {
                request.abort();
            } else {
                request.continue();
            }
        });

        // --- පියවර 2: ඇනිමේ පේජ් එකට යාම ---
        await page.goto(animeUrl, { waitUntil: 'networkidle2' });

        // --- පියවර 3: අදාළ Episode එක සොයා ක්ලික් කිරීම ---
        // 'watch2' class එක ඇතුළේ episode number එක තියෙන a tag එක හොයනවා
        const episodeFound = await page.evaluate((epNum) => {
            const anchors = Array.from(document.querySelectorAll('.linetitle2 a'));
            const target = anchors.find(a => a.querySelector('.watch2')?.innerText.trim() === String(epNum));
            if (target) {
                target.click(); // Episode එක ක්ලික් කරනවා
                return true;
            }
            return false;
        }, episodeNum);

        if (!episodeFound) {
            await browser.close();
            return { success: false, error: "Episode not found!" };
        }

        // පේජ් එක load වෙනකම් පොඩ්ඩක් ඉන්නවා
        await page.waitForNavigation({ waitUntil: 'networkidle2' });

        // --- පියවර 4: Download Button එකෙන් Direct Link එක ගැනීම ---
        // image_1209e9.png එකට අනුව <a href="...video.mp4..."> link එක ගන්නවා
        const directLink = await page.evaluate(() => {
            const downloadBtn = document.querySelector('a[href*="video.mp4"]');
            return downloadBtn ? downloadBtn.href : null;
        });

        await browser.close();

        if (directLink) {
            return { success: true, episode: episodeNum, download_url: directLink };
        } else {
            return { success: false, error: "Direct download link could not be found." };
        }

    } catch (e) {
        if (browser) await browser.close();
        return { success: false, error: e.message };
    }
}

// Routes
app.get('/api/anime/search', async (req, res) => {
    const query = req.query.q;
    if (!query) return res.json({ success: false, error: "Query is required" });
    res.json(await searchAnime(query));
});

// Episodes: http://localhost:5000/api/anime/episodes?url=ANIME_URL
app.get('/api/anime/episodes', async (req, res) => {
    const url = req.query.url;
    if (!url) return res.json({ success: false, error: "Anime URL is required" });
    res.json(await getEpisodes(url));
});

app.get('/api/anime/download', async (req, res) => {
    const { url, ep } = req.query;
    if (!url || !ep) return res.json({ success: false, error: "URL and Episode number required" });
    
    const result = await getDirectAnimeLink(url, ep);
    res.json(result);
});

app.get('/api/search', async (req, res) => res.json(await searchGames(req.query.q)));
app.get('/api/files', async (req, res) => res.json(await getGameFiles(req.query.url)));
app.get('/api/datanodes', async (req, res) => res.json(await getDirectDownload(req.query.url)));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server on ${PORT}`));
