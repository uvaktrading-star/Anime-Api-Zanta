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
const CARTOONS_BASE = "https://cartoons.lk";
const HEROKU_CHROME_PATH = '/app/.chrome-for-testing/chrome-linux64/chrome';

//------G-DRIVE LINK-------
async function sniperGDrive(driveUrl) {
    let browser;
    try {
        console.log(`[${new Date().toISOString()}] 🚀 Advanced Token Sniping Started...`);
        
        browser = await puppeteer.launch({
            executablePath: HEROKU_CHROME_PATH,
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36');

        // URL එකේ අන්තිම අකුරු ටික හරියට තියෙනවද බලමු
        let targetUrl = driveUrl.includes('confirm=t') ? driveUrl : driveUrl + "&confirm=t";

        await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });

        // 🎯 පියවර 1: 'at' token එක ලැබෙනකම් උපරිම තත්පර 5ක් බලාගෙන ඉන්නවා
        console.log("Waiting for hidden tokens to appear...");
        let tokenData = null;

        for (let i = 0; i < 10; i++) {
            tokenData = await page.evaluate(() => {
                const atInput = document.querySelector('input[name="at"]');
                const form = document.querySelector('form[action*="download"]');
                
                if (atInput && atInput.value) {
                    const data = {};
                    const inputs = form.querySelectorAll('input');
                    inputs.forEach(ins => { if(ins.name) data[ins.name] = ins.value; });
                    
                    return {
                        action: form.getAttribute('action'),
                        params: data
                    };
                }
                return null;
            });

            if (tokenData) break;
            await new Promise(r => setTimeout(r, 500)); // මිලි තත්පර 500ක් ඉන්නවා
        }

        if (tokenData && tokenData.params.at) {
            // 🎯 පියවර 2: ඔක්කොම tokens එකතු කරලා final link එක හදනවා
            const finalUrl = new URL(tokenData.action);
            Object.keys(tokenData.params).forEach(key => {
                finalUrl.searchParams.set(key, tokenData.params[key]);
            });

            console.log("✅ Success! Token Sniped: " + tokenData.params.at.substring(0, 10) + "...");
            return { 
                success: true, 
                download_url: finalUrl.toString() 
            };
        } else {
            // බැරිම වුණොත් පේජ් එකේ screenshot එකක් ගන්නත් පුළුවන් debug කරන්න
            throw new Error("Could not find the 'at' security token. Google might be blocking the request.");
        }

    } catch (e) {
        console.error("❌ ERROR:", e.message);
        return { success: false, error: e.message };
    } finally {
        if (browser) await browser.close();
    }
}
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
        console.log(`🚀 Sniping Episode ${episodeNum} (Anime)...`);
        browser = await puppeteer.launch({
            executablePath: HEROKU_CHROME_PATH,
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36');

        let capturedMp4 = null;
        await page.setRequestInterception(true);
        page.on('request', (request) => {
            const url = request.url();
            if (url.includes('video.mp4') || url.endsWith('.mp4')) {
                capturedMp4 = url;
            }
            if (url.includes('googleads') || url.includes('popads')) request.abort();
            else request.continue();
        });

        browser.on('targetcreated', async (target) => {
            const newPage = await target.page();
            if (newPage && !newPage.url().includes('animeheaven.me')) {
                await newPage.close().catch(() => {});
                await page.bringToFront();
            }
        });

        await page.goto(animeUrl, { waitUntil: 'domcontentloaded' });

        // FitGirl Logic: Repeat click on Episode until link captured
        for (let i = 0; i < 5; i++) {
            if (capturedMp4) break;
            await page.evaluate((ep) => {
                const anchors = Array.from(document.querySelectorAll('.linetitle2 a'));
                const target = anchors.find(a => a.querySelector('.watch2')?.innerText.trim() === String(ep));
                if (target) target.click();
            }, episodeNum);
            await new Promise(r => setTimeout(r, 4000));
        }

        if (capturedMp4) return { success: true, episode: episodeNum, download_url: capturedMp4 };
        else throw new Error("Could not capture MP4 link.");

    } catch (e) { return { success: false, error: e.message }; }
    finally { if (browser) await browser.close(); }
}

//-------------------CARTOONS--------------------
async function searchCartoons(query) {
    try {
        const searchUrl = `${CARTOONS_BASE}/?s=${encodeURIComponent(query)}`;
        const { data } = await axios.get(searchUrl, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36' 
            }
        });
        const $ = cheerio.load(data);
        
        let results = [];

        // පින්තූරයේ (image_98edea.jpg) පේන විදියට 'article.item-list' ඇතුළේ තමයි data තියෙන්නේ
        $('article.item-list').each((_, el) => {
            const titleElement = $(el).find('h2.post-box-title a');
            const title = titleElement.text().trim();
            const url = titleElement.attr('href');
            
            // Image එක thumbnail එකෙන් ගන්නවා
            const image = $(el).find('div.post-thumbnail img').attr('src');
            
            // පෝස්ට් එක දාපු දවස
            const date = $(el).find('span.post-meta span.date').text().trim();

            if (title && url) {
                results.push({
                    title: title.replace('Sinhala Dubbed | සිංහල හඬකැවූ', '').trim(),
                    url: url,
                    image: image,
                    date: date || "Unknown"
                });
            }
        });

        return { success: true, count: results.length, results };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

async function getCartoonDownload(inputUrl) {
    let browser;
    try {
        // 🛠️ URL එක ඇතුළේ තියෙන Episode Number එක වෙන් කරගන්නවා
        let cartoonUrl = inputUrl;
        let epNum = null;

        if (inputUrl.includes(',')) {
            const parts = inputUrl.split(',');
            cartoonUrl = parts[0].trim();
            epNum = parseInt(parts[1].trim());
        }

        browser = await puppeteer.launch({
            executablePath: HEROKU_CHROME_PATH,
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36');

        let capturedUrl = null;

        // 🎯 REDIRECT SNIFFER
        page.on('response', async (response) => {
            const url = response.url();
            if (url.includes('download-proxy')) {
                const status = response.status();
                if (status >= 300 && status <= 308) {
                    const headers = response.headers();
                    if (headers['location']) capturedUrl = headers['location'];
                }
            }
            if (url.includes('.mp4') || url.includes('files.cartoons.lk')) {
                capturedUrl = url;
            }
        });

        // 🛡️ AD-TAB CLOSER
        browser.on('targetcreated', async (target) => {
            const adPage = await target.page();
            if (adPage && !adPage.url().includes('cartoons.lk')) {
                await adPage.close().catch(() => {});
            }
        });

        await page.goto(cartoonUrl, { waitUntil: 'networkidle2', timeout: 35000 });

        // --- 1. බලනවා මේකේ තියෙන්නේ Episode List එකක්ද කියලා ---
        const isSeries = await page.evaluate(() => {
            const btn = Array.from(document.querySelectorAll('button, span, .download-btn')).find(el => 
                el.innerText.toLowerCase().includes('select episode')
            );
            return !!btn;
        });

        if (isSeries && !epNum) {
            console.log("📺 Series detected. Extracting list...");
            await page.evaluate(() => {
                const btn = Array.from(document.querySelectorAll('button, .download-btn')).find(b => 
                    b.innerText.toLowerCase().includes('select episode')
                );
                if (btn) btn.click();
            });

            await page.waitForSelector('.episode-popup-item', { timeout: 15000 });

            const episodes = await page.evaluate(() => {
                const items = Array.from(document.querySelectorAll('.episode-popup-item'));
                return items.map((item, index) => ({
                    episode_index: index + 1,
                    name: item.querySelector('h4')?.innerText.trim() || `Episode ${index + 1}`,
                    info: item.querySelector('.episode-popup-info')?.innerText.trim() || ""
                }));
            });
            return { success: true, type: 'series', results: episodes };
        }

        // --- 2. එපිසෝඩ් එකක් ඉල්ලුවොත් ඒක Sniper කරනවා ---
        if (isSeries && epNum) {
            console.log(`🎯 Sniping Episode ${epNum}...`);
            await page.evaluate(() => {
                const btn = Array.from(document.querySelectorAll('button, .download-btn')).find(b => 
                    b.innerText.toLowerCase().includes('select episode')
                );
                if (btn) btn.click();
            });

            await page.waitForSelector('.episode-popup-item', { timeout: 15000 });

            const clicked = await page.evaluate((targetNo) => {
                const items = document.querySelectorAll('.episode-popup-item');
                const target = items[targetNo - 1]?.querySelector('button.episode-popup-btn');
                if (target) {
                    target.click();
                    return true;
                }
                return false;
            }, epNum);

            if (!clicked) return { success: false, error: "Episode not found in popup." };
        } 
        
        // --- 3. මූවී එකක් නම් ---
        else {
            console.log("🎬 Movie detected. Sniping...");
            await page.evaluate(() => {
                const btn = Array.from(document.querySelectorAll('button, .download-btn')).find(b => 
                    b.innerText.toLowerCase().includes('download') && 
                    !b.innerText.toLowerCase().includes('select')
                );
                if (btn) btn.click();
            });
        }

        // 🔄 ලින්ක් එක එනකම් ඉන්නවා
        for (let i = 0; i < 12; i++) {
            if (capturedUrl) break;
            await new Promise(r => setTimeout(r, 2500));
            
            // Re-click if needed
            if (i % 3 === 0 && !capturedUrl) {
                await page.evaluate((isS, eN) => {
                    if (isS && eN) {
                        const items = document.querySelectorAll('.episode-popup-item');
                        items[eN - 1]?.querySelector('button.episode-popup-btn')?.click();
                    } else {
                        const btn = Array.from(document.querySelectorAll('button, .download-btn')).find(b => 
                            b.innerText.toLowerCase().includes('download') && !b.innerText.toLowerCase().includes('select')
                        );
                        if (btn) btn.click();
                    }
                }, isSeries, epNum);
            }
        }

        if (capturedUrl) {
            return { success: true, type: 'direct', download_url: capturedUrl };
        } else {
            return { success: false, error: "Link capture timed out. Processing page was too slow." };
        }

    } catch (e) {
        return { success: false, error: e.message };
    } finally {
        if (browser) await browser.close();
    }
}

// Search: http://localhost:5000/api/cartoons/search?q=harry+potter
app.get('/api/cartoons/search', async (req, res) => {
    const query = req.query.q;
    if (!query) return res.json({ success: false, error: "Search query required" });
    res.json(await searchCartoons(query));
});

app.get('/api/cartoons/download', async (req, res) => {
    const url = req.query.url;
    if (!url) return res.json({ success: false, error: "Cartoon URL required" });
    res.json(await getCartoonDownload(url));
});

app.get('/api/gdrive/bypass', async (req, res) => {
    const driveUrl = req.query.url;
    if (!driveUrl) return res.json({ success: false, error: "Drive URL is required" });
    
    const result = await sniperGDrive(driveUrl);
    res.json(result);
});


app.get('/api/anime/search', async (req, res) => res.json(await searchAnime(req.query.q)));
app.get('/api/anime/episodes', async (req, res) => res.json(await getEpisodes(req.query.url)));
app.get('/api/anime/download', async (req, res) => res.json(await getDirectAnimeLink(req.query.url, req.query.ep)));
app.get('/api/search', async (req, res) => res.json(await searchGames(req.query.q)));
app.get('/api/search', async (req, res) => res.json(await searchGames(req.query.q)));
app.get('/api/files', async (req, res) => res.json(await getGameFiles(req.query.url)));
app.get('/api/datanodes', async (req, res) => res.json(await getDirectDownload(req.query.url)));

// ==================== SERVER START ====================
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => console.log(`🚀 Server on ${PORT}`));
server.timeout = 120000; // ✅ දැන් හරි

// For Vercel serverless (export app)
module.exports = app;
