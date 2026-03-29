const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

async function getBrowser() {
    return await puppeteer.launch({
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--single-process',
            '--no-zygote'
        ],
        // Heroku Buildpack එක Chrome දාන නිවැරදි පාර මෙන්න මේකයි
        executablePath: '/app/.apt/usr/bin/google-chrome', 
        headless: "new"
    });
}

// 1. Anime Search Logic
async function searchAnime(query) {
    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
        await page.goto(`https://animeheaven.me/search.php?s=${query}`, { waitUntil: 'networkidle2' });
        const results = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('.an')).map(el => ({
                title: el.querySelector('.name')?.innerText,
                link: 'https://animeheaven.me/' + el.getAttribute('href'),
                image: el.querySelector('img')?.src
            }));
        });
        return results;
    } finally {
        await browser.close();
    }
}

// 2. Get Episode Download Links
async function getEpisodes(animeUrl) {
    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
        await page.goto(animeUrl, { waitUntil: 'networkidle2' });
        const episodes = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('.ep')).map(el => ({
                epNumber: el.innerText,
                link: 'https://animeheaven.me/' + el.getAttribute('href')
            }));
        });
        return episodes;
    } finally {
        await browser.close();
    }
}

module.exports = { searchAnime, getEpisodes };
