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
const CARTOONS_BASE = "https://cartoons.lk";
const HEROKU_CHROME_PATH = '/app/.chrome-for-testing/chrome-linux64/chrome';


//----------CINESUBS-----------

async function getCineSubzDownloadPage(movieUrl) {
    let browser;
    try {
        console.log(`🎬 CineSubz: Loading movie page...`);
        
        browser = await puppeteer.launch({
            executablePath: HEROKU_CHROME_PATH,
            headless: true,
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled'
            ]
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36');
        
        // Set extra headers to avoid detection
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': CINESUBZ_BASE
        });

        let downloadPageUrl = null;
        let adPageClosed = false;

        // --- Close any popup ads automatically ---
        browser.on('targetcreated', async (target) => {
            const newPage = await target.page();
            if (newPage) {
                const url = newPage.url();
                // Close any page that is not the main domain (ads)
                if (!url.includes('cinesubz.lk') && !url.includes('sonic-cloud.online')) {
                    console.log(`🛑 Closing ad page: ${url.substring(0, 50)}...`);
                    await newPage.close().catch(() => {});
                    adPageClosed = true;
                }
            }
        });

        // --- Intercept requests to capture the download page link ---
        await page.setRequestInterception(true);
        page.on('request', (request) => {
            const url = request.url();
            // Allow main requests, block ads
            if (url.includes('googleads') || url.includes('doubleclick') || url.includes('popads')) {
                request.abort();
            } else {
                request.continue();
            }
        });

        // Navigate to the movie page
        await page.goto(movieUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        
        // Wait for the download button to appear
        await page.waitForSelector('#link', { timeout: 15000 }).catch(() => {
            console.log("⏳ Waiting for #link selector...");
        });

        // Get the href from the "Go to Download Page" button
        downloadPageUrl = await page.evaluate(() => {
            const linkElement = document.querySelector('#link');
            if (linkElement && linkElement.href) {
                return linkElement.href;
            }
            return null;
        });

        if (!downloadPageUrl) {
            // Try alternative selector
            downloadPageUrl = await page.evaluate(() => {
                const link = Array.from(document.querySelectorAll('a')).find(a => 
                    a.innerText.includes('Go to Download Page') || 
                    a.innerText.includes('Download Page')
                );
                return link ? link.href : null;
            });
        }

        if (!downloadPageUrl) {
            throw new Error("Could not find 'Go to Download Page' button");
        }

        console.log(`✅ Found download page URL: ${downloadPageUrl}`);
        return { success: true, downloadPageUrl: downloadPageUrl };

    } catch (error) {
        console.error("CineSubz Step 1 Error:", error.message);
        return { success: false, error: error.message };
    } finally {
        if (browser) await browser.close();
    }
}

// --- Step 2: Extract the final direct download link from the sonic-cloud page ---
async function extractDirectLinkFromSonicCloud(sonicUrl) {
    let browser;
    try {
        console.log(`☁️ Sonic-Cloud: Extracting direct link from ${sonicUrl}`);
        
        browser = await puppeteer.launch({
            executablePath: HEROKU_CHROME_PATH,
            headless: true,
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled'
            ]
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36');
        
        let finalDirectLink = null;
        let directButtonClicked = false;

        // --- Close popup ads ---
        browser.on('targetcreated', async (target) => {
            const newPage = await target.page();
            if (newPage && newPage.url() !== sonicUrl) {
                const url = newPage.url();
                if (!url.includes('sonic-cloud.online')) {
                    console.log(`🛑 Closing popup: ${url.substring(0, 60)}...`);
                    await newPage.close().catch(() => {});
                }
            }
        });

        // --- Intercept responses to capture the final MP4 link ---
        await page.setRequestInterception(true);
        page.on('response', async (response) => {
            const url = response.url();
            // Capture MP4 files
            if (url.includes('.mp4') || url.includes('.mkv') || url.includes('.webm')) {
                finalDirectLink = url;
                console.log(`🎯 Captured direct link: ${url}`);
            }
        });

        // Navigate to the sonic-cloud page
        await page.goto(sonicUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        
        // Wait for content to load
        await page.waitForTimeout(3000);
        
        // Check for "Direct Download" button and click it
        const hasDirectButton = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('a, button'));
            const directBtn = buttons.find(btn => 
                btn.innerText.toLowerCase().includes('direct download') ||
                btn.innerText.toLowerCase().includes('download now') ||
                btn.innerText.toLowerCase().includes('download')
            );
            return !!directBtn;
        });

        if (hasDirectButton) {
            console.log("🔘 Clicking 'Direct Download' button...");
            
            // Click the button and wait for new page/tab
            const [newPage] = await Promise.all([
                new Promise(resolve => browser.once('targetcreated', async (target) => {
                    const newPageTarget = await target.page();
                    resolve(newPageTarget);
                })),
                page.evaluate(() => {
                    const buttons = Array.from(document.querySelectorAll('a, button'));
                    const directBtn = buttons.find(btn => 
                        btn.innerText.toLowerCase().includes('direct download') ||
                        btn.innerText.toLowerCase().includes('download now')
                    );
                    if (directBtn) directBtn.click();
                })
            ]);
            
            directButtonClicked = true;
            
            if (newPage) {
                await newPage.waitForTimeout(2000);
                const newPageUrl = newPage.url();
                if (newPageUrl.includes('.mp4') || newPageUrl.includes('download')) {
                    finalDirectLink = newPageUrl;
                }
                await newPage.close().catch(() => {});
            }
        }
        
        // If direct link not captured yet, try to extract from page source
        if (!finalDirectLink) {
            finalDirectLink = await page.evaluate(() => {
                // Look for video source
                const video = document.querySelector('video');
                if (video && video.src) return video.src;
                
                // Look for download links
                const links = Array.from(document.querySelectorAll('a'));
                const downloadLink = links.find(l => 
                    l.href && (l.href.includes('.mp4') || l.href.includes('download'))
                );
                if (downloadLink) return downloadLink.href;
                
                // Look for iframe sources
                const iframe = document.querySelector('iframe');
                if (iframe && iframe.src) return iframe.src;
                
                return null;
            });
        }

        // If still no link, try to wait for redirect
        if (!finalDirectLink) {
            console.log("⏳ Waiting for redirect or link generation...");
            await page.waitForTimeout(8000);
            
            finalDirectLink = await page.evaluate(() => {
                // Check if page redirected
                if (window.location.href.includes('.mp4')) return window.location.href;
                
                // Check all anchor tags again
                const allLinks = Array.from(document.querySelectorAll('a'));
                for (const link of allLinks) {
                    if (link.href && (link.href.includes('.mp4') || link.href.includes('download'))) {
                        return link.href;
                    }
                }
                return null;
            });
        }

        if (finalDirectLink) {
            console.log(`✅ Final direct link captured: ${finalDirectLink}`);
            return { success: true, downloadUrl: finalDirectLink };
        } else {
            // If we couldn't capture, return the sonic page URL as fallback
            return { 
                success: true, 
                downloadUrl: sonicUrl,
                note: "Direct link not found, but you can try opening this URL in browser"
            };
        }

    } catch (error) {
        console.error("Sonic-Cloud Extraction Error:", error.message);
        return { success: false, error: error.message };
    } finally {
        if (browser) await browser.close();
    }
}

// --- Main CineSubz Download Function ---
async function downloadFromCineSubz(cinesubzUrl) {
    try {
        // Step 1: Get the intermediate download page URL
        const step1 = await getCineSubzDownloadPage(cinesubzUrl);
        if (!step1.success) {
            return { success: false, error: step1.error };
        }
        
        // Step 2: Extract direct link from sonic-cloud page
        const step2 = await extractDirectLinkFromSonicCloud(step1.downloadPageUrl);
        
        return {
            success: step2.success,
            originalUrl: cinesubzUrl,
            downloadPageUrl: step1.downloadPageUrl,
            directDownloadUrl: step2.downloadUrl || null,
            error: step2.error || null
        };
        
    } catch (error) {
        console.error("CineSubz Main Error:", error.message);
        return { success: false, error: error.message };
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

app.get('/api/cinesubz/download', async (req, res) => {
    const url = req.query.url;
    if (!url) {
        return res.json({ success: false, error: "URL parameter required" });
    }
    
    // Validate URL
    if (!url.includes('cinesubz.lk')) {
        return res.json({ success: false, error: "Invalid CineSubz URL" });
    }
    
    console.log(`📥 CineSubz Download Request: ${url}`);
    const result = await downloadFromCineSubz(url);
    res.json(result);
});


app.get('/api/anime/search', async (req, res) => res.json(await searchAnime(req.query.q)));
app.get('/api/anime/episodes', async (req, res) => res.json(await getEpisodes(req.query.url)));
app.get('/api/anime/download', async (req, res) => res.json(await getDirectAnimeLink(req.query.url, req.query.ep)));
app.get('/api/search', async (req, res) => res.json(await searchGames(req.query.q)));
app.get('/api/search', async (req, res) => res.json(await searchGames(req.query.q)));
app.get('/api/files', async (req, res) => res.json(await getGameFiles(req.query.url)));
app.get('/api/datanodes', async (req, res) => res.json(await getDirectDownload(req.query.url)));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server on ${PORT}`));
