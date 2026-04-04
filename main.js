const { ytdl } = require('./ytdl'); // උඩ ෆයිල් එක import කරගන්න

async function startDownload() {
    console.log("🚀 Downloading...");
    
    const result = await ytdl('https://youtu.be/WVl0eohFnhc', 'mp3', '128k');
    
    if (result.status) {
        console.log("✅ සාර්ථකයි:", result.title);
        console.log("🔗 ලින්ක් එක:", result.downloadUrl);
    } else {
        console.log("❌ වැඩේ අවුල්:", result.error);
    }
}

startDownload();