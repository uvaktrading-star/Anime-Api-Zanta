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
const CINESUBZ_BASE = "https://cinesubz.lk";
const HEROKU_CHROME_PATH = '/app/.chrome-for-testing/chrome-linux64/chrome';

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

//---------CINESUBZ--------

async function getCinesubzDirect(internalUrl) {
    let browser;
    try {
        console.log("------------------------------------");
        console.log("🚀 MASTER SNIPER ACTIVATED (POST CAPTURE)...");
        browser = await puppeteer.launch({
            executablePath: HEROKU_CHROME_PATH,
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36');

        let finalMp4Link = null;

        // 🔥 POST සහ GET රිකුවෙස්ට් දෙකම පරීක්ෂා කරනවා
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const url = req.url();
            // .mp4 තියෙන හෝ sume321.online වගේ domain එකකින් එන ලින්ක් එක අල්ලනවා
            if (url.includes('.mp4') || url.includes('sume321.online') || url.includes('bot45')) {
                finalMp4Link = url;
                console.log("🎯 TARGET DETECTED IN REQUESTS:", url);
            }
            
            // අනවශ්‍ය Ads බ්ලොක් කරලා speed එක වැඩි කරනවා
            if (['image', 'font', 'stylesheet'].includes(req.resourceType()) || url.includes('adserver')) {
                req.abort();
            } else {
                req.continue();
            }
        });

        // Step 1: Cinesubz Page
        console.log("LOG: Loading Cinesubz...");
        await page.goto(internalUrl, { waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 4500));

        // Step 2: "Go to Download" (New tab එක capture කරමු)
        console.log("LOG: Clicking 'Go to Download Page'...");
        const tabPromise = new Promise(res => browser.once('targetcreated', t => res(t.page())));
        await page.evaluate(() => {
            const btn = document.querySelector('#link') || document.querySelector('.wait-done a');
            if (btn) btn.click();
        });

        const sonicPage = await tabPromise;
        if (!sonicPage) throw new Error("Sonic page not opened.");
        const sonicUrl = sonicPage.url();
        console.log("LOG: Navigating to Sonic-Cloud:", sonicUrl);

        // Step 3: Sonic Page එකේ වැඩේ (අලුත් පේජ් එකට Listener එක දානවා)
        const finalPage = await browser.newPage();
        await finalPage.setRequestInterception(true);
        finalPage.on('request', (req) => {
            const url = req.url();
            // මෙතනදී තමයි අර sume321.online ලින්ක් එක අහුවෙන්නේ
            if (url.includes('.mp4') || url.includes('sume321.online')) {
                finalMp4Link = url;
            }
            req.continue();
        });

        await finalPage.goto(sonicUrl, { waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 6000)); // බටන් එක ලෝඩ් වෙනකම් පොඩි වෙලාවක්

        console.log("LOG: Clicking 'Direct Download (New)'...");
        await finalPage.evaluate(() => {
            const btn = Array.from(document.querySelectorAll('a, button')).find(b => b.innerText.toLowerCase().includes('direct download'));
            if (btn) btn.click();
        });

        // ලින්ක් එක capture වෙනකම් තත්පර 10ක් බලන් ඉන්නවා
        for (let i = 0; i < 20; i++) {
            if (finalMp4Link) break;
            await new Promise(r => setTimeout(r, 500));
        }

        if (finalMp4Link) {
            console.log("✅ SUCCESS! FINAL MP4:", finalMp4Link);
            return { success: true, direct_url: finalMp4Link };
        } else {
            throw new Error("Final MP4 link not found in network traffic.");
        }

    } catch (e) {
        console.error("❌ ERROR:", e.message);
        return { success: false, error: e.message };
    } finally {
        if (browser) await browser.close();
    }
}

async function searchCinesubz(query) {
    try {
        const searchUrl = `${CINESUBZ_BASE}/?s=${encodeURIComponent(query)}`;
        const { data } = await axios.get(searchUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const $ = cheerio.load(data);
        
        let results = [];

        // පින්තූරය අනුව 'div.display-item' ඇතුළේ තමයි data තියෙන්නේ
        $('div.display-item').each((_, el) => {
            const title = $(el).find('div.item-box a').attr('title');
            const url = $(el).find('div.item-box a').attr('href');
            const image = $(el).find('img').attr('data-original') || $(el).find('img').attr('src');
            const rating = $(el).find('span.imdb-score').text().trim();
            const quality = $(el).find('span.badge-quality-corner').text().trim();

            if (title && url) {
                results.push({
                    title: title.replace('Sinhala Subtitles | සිංහල උපසිරැසි සමඟ', '').trim(),
                    url: url,
                    image: image,
                    rating: rating || "N/A",
                    quality: quality || "WebRip"
                });
            }
        });

        return { success: true, results };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

// --- පියවර 2: තෝරාගත් Movie එකේ Quality සහ Links (Internal) ටික ගැනීම ---
async function getMovieData(url) {
    try {
        const { data } = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const $ = cheerio.load(data);
        
        // --- Title එක හරියටම ගැනීම ---
        // h1.entry-title නැත්නම් h1.item-name බලනවා
        const title = $('h1.entry-title').text().trim() || $('h1').first().text().trim() || "Unknown Title";

        // --- TV Series ද නැද්ද කියලා බලනවා ---
        const isSeries = $('ul.episodes-list').length > 0;
        
        if (isSeries) {
            // --- TV SERIES LOGIC ---
            let episodes = [];
            $('ul.episodes-list li').each((_, el) => {
                const epLink = $(el).find('a.episode-link').attr('href');
                const epNum = $(el).find('span.ep-num').text().trim();
                const epName = $(el).find('span.ep-title').text().trim();
                const epDate = $(el).find('span.ep-date').text().trim();

                if (epLink) {
                    episodes.push({
                        episode: epNum,
                        title: epName,
                        date: epDate,
                        url: epLink // මේ ලින්ක් එකට ගියාම තමයි Series එකේ download links හම්බෙන්නේ
                    });
                }
            });

            return { 
                success: true, 
                type: "series",
                title: title.replace('Sinhala Subtitles | සිංහල උපසිරැසි සමඟ', '').trim(),
                total_episodes: episodes.length,
                episodes: episodes 
            };

        } else {
            // --- MOVIE LOGIC ---
            let downloadLinks = [];
            $('div.movie-download-link-item').each((_, el) => {
                const linkTag = $(el).find('a.movie-download-button');
                const linkUrl = linkTag.attr('href');
                
                // Inspect එකට අනුව Quality සහ Size එක තියෙන්නේ 'movie-download-meta' class එකේ
                let qualityInfo = $(el).find('span.movie-download-meta').text().trim();

                // සමහර විට meta එකේ නැත්නම් info class එක බලමු
                if (!qualityInfo) {
                    qualityInfo = $(el).find('span.movie-download-info').text().trim();
                    // අර අනවශ්‍ය කෑල්ල අයින් කරන්න
                    qualityInfo = qualityInfo.replace(/Direct & Telegram Download Links/g, '').trim();
                }

                if (linkUrl) {
                    downloadLinks.push({
                        quality: qualityInfo || "Unknown Quality",
                        internalUrl: linkUrl
                    });
                }
            });

            return { 
                success: true, 
                type: "movie",
                title: title.replace('Sinhala Subtitles | සිංහල උපසිරැසි සමඟ', '').trim(),
                links: downloadLinks 
            };
        }

    } catch (e) {
        return { success: false, error: e.message };
    }
}

app.get('/api/cinesubz/search', async (req, res) => res.json(await searchCinesubz(req.query.q || "")));
app.get('/api/cinesubz/movie', async (req, res) => res.json(await getMovieData(req.query.url || "")));
app.get('/api/cinesubz/direct', async (req, res) => res.json(await getCinesubzDirect(req.query.url || "")));
app.get('/api/anime/search', async (req, res) => res.json(await searchAnime(req.query.q)));
app.get('/api/anime/episodes', async (req, res) => res.json(await getEpisodes(req.query.url)));
app.get('/api/anime/download', async (req, res) => res.json(await getDirectAnimeLink(req.query.url, req.query.ep)));
app.get('/api/search', async (req, res) => res.json(await searchGames(req.query.q)));
app.get('/api/search', async (req, res) => res.json(await searchGames(req.query.q)));
app.get('/api/files', async (req, res) => res.json(await getGameFiles(req.query.url)));
app.get('/api/datanodes', async (req, res) => res.json(await getDirectDownload(req.query.url)));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server on ${PORT}`));
