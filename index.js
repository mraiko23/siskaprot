require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const vm = require('vm');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

// ═══════════════════════════════════════════════════════════════════════════
// 🚀 CONFIGURATION - Enhanced for Maximum Power
// ═══════════════════════════════════════════════════════════════════════════

const CONFIG = {
    TELEGRAM_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    GITHUB_REPO: process.env.GITHUB_REPO || 'Trailblazer-Labs/sherlock-data',
    PORT: process.env.PORT || 3000,
    AI_MODEL: 'openrouter/sherlock-dash-alpha',
    MAX_HISTORY: 100,
    TIMEOUT: 120000
};

// Validate critical environment variables
if (!CONFIG.TELEGRAM_TOKEN) {
    console.error('❌ Error: TELEGRAM_BOT_TOKEN is required!');
    process.exit(1);
}
if (!CONFIG.OPENROUTER_API_KEY) {
    console.error('❌ Error: OPENROUTER_API_KEY is required!');
    process.exit(1);
}

console.log('✅ Configuration loaded');
console.log('🤖 Starting ULTRA-POWERED AI Bot...');

// ═══════════════════════════════════════════════════════════════════════════
// 🎯 BOT INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════

let bot;
try {
    bot = new TelegramBot(CONFIG.TELEGRAM_TOKEN, {
        polling: { interval: 300, params: { timeout: 10 } }
    });
    console.log('✅ Telegram bot initialized');
} catch (error) {
    console.error('❌ Bot initialization error:', error.message);
    process.exit(1);
}

// Express app for hosting capabilities
const app = express();
app.use(express.json());
app.use(express.static('public'));

// ═══════════════════════════════════════════════════════════════════════════
// 💾 DATA STORAGE
// ═══════════════════════════════════════════════════════════════════════════

const storage = {
    conversations: new Map(),
    customCommands: new Map(),
    customFunctions: new Map(),
    runningBots: new Map(),
    databases: new Map(),
    websites: new Map(),
    files: new Map()
};

// ═══════════════════════════════════════════════════════════════════════════
// 🌐 GITHUB STORAGE SYSTEM - For Persistent Data
// ═══════════════════════════════════════════════════════════════════════════

class GitHubStorage {
    constructor(token, repo) {
        this.token = token;
        this.repo = repo;
        this.baseUrl = 'https://api.github.com';
        this.enabled = !!token && token !== 'undefined';
        
        if (!this.enabled) {
            console.warn('[GitHub] ⚠️ GitHub token not configured. GitHub features will be disabled.');
            console.warn('[GitHub] To enable: Set GITHUB_TOKEN in .env file');
        }
        
        this.headers = {
            'Authorization': token ? `Bearer ${token}` : '',
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'Content-Type': 'application/json'
        };
    }

    async saveFile(filePath, content, message = 'Update file via bot') {
        if (!this.enabled) {
            return { 
                success: false, 
                error: 'GitHub не настроен. Добавьте GITHUB_TOKEN в .env файл',
                needsSetup: true
            };
        }
        
        try {
            const url = `${this.baseUrl}/repos/${this.repo}/contents/${filePath}`;
            
            // Get current file SHA if exists
            let sha = null;
            try {
                const response = await axios.get(url, { headers: this.headers });
                sha = response.data.sha;
            } catch (e) {
                // File doesn't exist, will create new
            }

            const contentBase64 = Buffer.from(content).toString('base64');
            
            const data = {
                message,
                content: contentBase64,
                ...(sha && { sha })
            };

            const response = await axios.put(url, data, { headers: this.headers });
            console.log(`[GitHub] ✅ Saved: ${filePath}`);
            return { success: true, url: response.data.content.html_url };
        } catch (error) {
            console.error(`[GitHub] ❌ Save error:`, error.response?.data || error.message);
            
            let errorMsg = error.message;
            if (error.response?.status === 401) {
                errorMsg = 'Неверный GitHub токен. Проверьте GITHUB_TOKEN в .env файле';
            } else if (error.response?.status === 404) {
                errorMsg = `Репозиторий ${this.repo} не найден. Проверьте GITHUB_REPO в .env`;
            } else if (error.response?.status === 403) {
                errorMsg = 'Нет прав доступа к репозиторию. Проверьте права токена';
            }
            
            return { success: false, error: errorMsg };
        }
    }

    async loadFile(filePath) {
        if (!this.enabled) {
            return { 
                success: false, 
                error: 'GitHub не настроен. Добавьте GITHUB_TOKEN в .env файл',
                needsSetup: true
            };
        }
        
        try {
            const url = `${this.baseUrl}/repos/${this.repo}/contents/${filePath}`;
            const response = await axios.get(url, { headers: this.headers });
            const content = Buffer.from(response.data.content, 'base64').toString('utf-8');
            console.log(`[GitHub] ✅ Loaded: ${filePath}`);
            return { success: true, content };
        } catch (error) {
            console.error(`[GitHub] ❌ Load error:`, error.response?.data || error.message);
            
            let errorMsg = error.message;
            if (error.response?.status === 401) {
                errorMsg = 'Неверный GitHub токен';
            } else if (error.response?.status === 404) {
                errorMsg = `Файл ${filePath} не найден в репозитории`;
            }
            
            return { success: false, error: errorMsg };
        }
    }

    async deleteFile(filePath, message = 'Delete file via bot') {
        if (!this.enabled) {
            return { 
                success: false, 
                error: 'GitHub не настроен',
                needsSetup: true
            };
        }
        
        try {
            const url = `${this.baseUrl}/repos/${this.repo}/contents/${filePath}`;
            
            // Get file SHA
            const getResponse = await axios.get(url, { headers: this.headers });
            const sha = getResponse.data.sha;

            await axios.delete(url, {
                headers: this.headers,
                data: { message, sha }
            });
            
            console.log(`[GitHub] ✅ Deleted: ${filePath}`);
            return { success: true };
        } catch (error) {
            console.error(`[GitHub] ❌ Delete error:`, error.response?.data || error.message);
            return { success: false, error: error.message };
        }
    }

    async listFiles(dirPath = '') {
        if (!this.enabled) {
            return { 
                success: false, 
                error: 'GitHub не настроен',
                needsSetup: true
            };
        }
        
        try {
            const url = `${this.baseUrl}/repos/${this.repo}/contents/${dirPath}`;
            const response = await axios.get(url, { headers: this.headers });
            const files = response.data.map(item => ({
                name: item.name,
                path: item.path,
                type: item.type,
                size: item.size
            }));
            return { success: true, files };
        } catch (error) {
            console.error(`[GitHub] ❌ List error:`, error.response?.data || error.message);
            
            let errorMsg = error.message;
            if (error.response?.status === 404) {
                errorMsg = `Папка ${dirPath || 'корневая'} не найдена`;
            }
            
            return { success: false, error: errorMsg };
        }
    }
}

const githubStorage = new GitHubStorage(CONFIG.GITHUB_TOKEN, CONFIG.GITHUB_REPO);

// ═══════════════════════════════════════════════════════════════════════════
// 💾 AUTO-SAVE & AUTO-LOAD SYSTEM
// ═══════════════════════════════════════════════════════════════════════════

class PersistenceManager {
    constructor(githubStorage) {
        this.github = githubStorage;
        this.autoSaveInterval = 60000; // Auto-save every 60 seconds
        this.saveTimer = null;
    }

    async saveAllData() {
        if (!this.github.enabled) {
            console.log('[Persistence] GitHub not configured, skipping save');
            return;
        }

        try {
            console.log('[Persistence] 💾 Saving all data to GitHub...');

            // Save commands
            const commandsData = {};
            for (const [name, handler] of storage.customCommands) {
                commandsData[name] = handler.toString();
            }
            await this.github.saveFile('bot-data/commands.json', JSON.stringify(commandsData, null, 2), 'Auto-save commands');

            // Save websites
            const websitesData = {};
            for (const [path, code] of storage.websites) {
                websitesData[path] = code;
            }
            await this.github.saveFile('bot-data/websites.json', JSON.stringify(websitesData, null, 2), 'Auto-save websites');

            // Save databases
            const databasesData = {};
            for (const [dbName, db] of storage.databases) {
                databasesData[dbName] = Object.fromEntries(db);
            }
            await this.github.saveFile('bot-data/databases.json', JSON.stringify(databasesData, null, 2), 'Auto-save databases');

            console.log('[Persistence] ✅ All data saved to GitHub!');
            return { success: true };
        } catch (error) {
            console.error('[Persistence] ❌ Save error:', error.message);
            return { success: false, error: error.message };
        }
    }

    async loadAllData() {
        if (!this.github.enabled) {
            console.log('[Persistence] GitHub not configured, skipping load');
            return;
        }

        try {
            console.log('[Persistence] 📂 Loading data from GitHub...');

            // Load commands
            const commandsResult = await this.github.loadFile('bot-data/commands.json');
            if (commandsResult.success) {
                const commandsData = JSON.parse(commandsResult.content);
                let count = 0;
                for (const [name, funcString] of Object.entries(commandsData)) {
                    try {
                        // Recreate function from string
                        const func = eval(`(${funcString})`);
                        storage.customCommands.set(name, func);
                        count++;
                    } catch (e) {
                        console.error(`[Persistence] Failed to restore command ${name}:`, e.message);
                    }
                }
                console.log(`[Persistence] ✅ Loaded ${count} commands`);
            }

            // Load websites
            const websitesResult = await this.github.loadFile('bot-data/websites.json');
            if (websitesResult.success) {
                const websitesData = JSON.parse(websitesResult.content);
                let count = 0;
                for (const [path, code] of Object.entries(websitesData)) {
                    try {
                        // Re-execute website code
                        const sandbox = createSandbox(null);
                        const context = vm.createContext(sandbox);
                        const script = new vm.Script(code);
                        script.runInContext(context);
                        storage.websites.set(path, code);
                        count++;
                    } catch (e) {
                        console.error(`[Persistence] Failed to restore website ${path}:`, e.message);
                    }
                }
                console.log(`[Persistence] ✅ Loaded ${count} websites`);
            }

            // Load databases
            const databasesResult = await this.github.loadFile('bot-data/databases.json');
            if (databasesResult.success) {
                const databasesData = JSON.parse(databasesResult.content);
                let count = 0;
                for (const [dbName, data] of Object.entries(databasesData)) {
                    storage.databases.set(dbName, new Map(Object.entries(data)));
                    count++;
                }
                console.log(`[Persistence] ✅ Loaded ${count} databases`);
            }

            console.log('[Persistence] 🎉 All data loaded from GitHub!');
            return { success: true };
        } catch (error) {
            console.error('[Persistence] ❌ Load error:', error.message);
            return { success: false, error: error.message };
        }
    }

    startAutoSave() {
        if (this.saveTimer) return;
        console.log(`[Persistence] 🔄 Auto-save enabled (every ${this.autoSaveInterval / 1000}s)`);
        this.saveTimer = setInterval(() => {
            this.saveAllData();
        }, this.autoSaveInterval);
    }

    stopAutoSave() {
        if (this.saveTimer) {
            clearInterval(this.saveTimer);
            this.saveTimer = null;
            console.log('[Persistence] 🛑 Auto-save disabled');
        }
    }
}

const persistenceManager = new PersistenceManager(githubStorage);

// ═══════════════════════════════════════════════════════════════════════════
// 🔍 WEB SCRAPING & URL FETCHING
// ═══════════════════════════════════════════════════════════════════════════

async function fetchWebContent(url) {
    try {
        // Validate URL
        if (!url || typeof url !== 'string') {
            throw new Error('Invalid URL provided');
        }
        
        // Add protocol if missing
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'https://' + url;
        }
        
        // Validate URL format
        try {
            new URL(url);
        } catch (e) {
            throw new Error('Неверный формат URL. Пример: https://example.com');
        }
        
        console.log(`[Fetch] Loading: ${url}`);
        
        const response = await axios.get(url, {
            timeout: 30000,
            maxRedirects: 5,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9,ru;q=0.8'
            }
        });
        
        // Extract text content (simple HTML stripping)
        let text = String(response.data);
        
        // Remove scripts and styles
        text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
        text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
        
        // Extract title
        const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i);
        const title = titleMatch ? titleMatch[1].trim() : 'Без заголовка';
        
        // Remove HTML tags
        text = text.replace(/<[^>]+>/g, ' ');
        
        // Decode HTML entities
        text = text.replace(/&nbsp;/g, ' ');
        text = text.replace(/&amp;/g, '&');
        text = text.replace(/&lt;/g, '<');
        text = text.replace(/&gt;/g, '>');
        text = text.replace(/&quot;/g, '"');
        text = text.replace(/&#39;/g, "'");
        
        // Clean whitespace
        text = text.replace(/\s+/g, ' ').trim();
        
        console.log(`[Fetch] Success: ${text.length} chars extracted`);
        
        return {
            success: true,
            title,
            content: text.substring(0, 5000), // Limit to 5000 chars
            fullLength: text.length,
            url
        };
    } catch (error) {
        console.error(`[Fetch] Error loading ${url}:`, error.message);
        return { 
            success: false, 
            error: error.message,
            url
        };
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 🔎 INTERNET SEARCH - DuckDuckGo
// ═══════════════════════════════════════════════════════════════════════════

async function searchInternet(query, maxResults = 5) {
    try {
        console.log(`[Search] Searching for: ${query}`);
        
        // Using SerpAPI-like search with DuckDuckGo Lite
        const searchUrl = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
        const response = await axios.get(searchUrl, {
            timeout: 30000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        // Parse results - multiple patterns for better extraction
        const results = [];
        const html = response.data;
        
        // Pattern 1: Standard links
        const linkRegex = /<a[^>]+class="[^"]*result[^"]*"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
        // Pattern 2: Title links  
        const titleRegex = /<a[^>]*href="([^"]+)"[^>]*>\s*<span[^>]*>([^<]+)<\/span>/gi;
        // Pattern 3: Simple links with titles
        const simpleRegex = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([^<]+(?:<[^>]+>[^<]*<\/[^>]+>)*[^<]*)<\/a>/gi;
        
        let match;
        const patterns = [linkRegex, titleRegex, simpleRegex];
        
        for (const pattern of patterns) {
            while ((match = pattern.exec(html)) !== null && results.length < maxResults) {
                const url = match[1].trim();
                const title = match[2].trim().replace(/<[^>]+>/g, '');
                
                // Filter valid URLs
                if (url.startsWith('http') && !url.includes('duckduckgo.com') && title.length > 3) {
                    results.push({
                        title: title.substring(0, 200),
                        url: url
                    });
                }
            }
            if (results.length >= maxResults) break;
        }

        // Fallback: Try alternative search API
        if (results.length === 0) {
            console.log('[Search] Trying alternative method...');
            const altUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}&format=json`;
            try {
                const altResponse = await axios.get(altUrl, { timeout: 10000 });
                if (altResponse.data && altResponse.data.RelatedTopics) {
                    altResponse.data.RelatedTopics.slice(0, maxResults).forEach(topic => {
                        if (topic.FirstURL && topic.Text) {
                            results.push({
                                title: topic.Text.substring(0, 200),
                                url: topic.FirstURL
                            });
                        }
                    });
                }
            } catch (e) {
                console.error('[Search] Alternative method failed:', e.message);
            }
        }
        
        // If still no results, provide helpful mock results
        if (results.length === 0) {
            results.push({
                title: `Результаты по запросу "${query}" (используйте <FETCH_URL> для прямого просмотра сайтов)`,
                url: `https://www.google.com/search?q=${encodeURIComponent(query)}`
            });
        }

        console.log(`[Search] Found ${results.length} results`);
        return { success: true, query, results };
    } catch (error) {
        console.error('[Search] Error:', error.message);
        // Return helpful error with suggestion
        return { 
            success: false, 
            error: error.message,
            suggestion: 'Попробуйте использовать <FETCH_URL> для прямого чтения сайтов'
        };
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 🧠 ULTRA-POWERFUL SYSTEM PROMPT
// ═══════════════════════════════════════════════════════════════════════════

const SYSTEM_PROMPT = `Ты SHERLOCK - МОЩНЕЙШИЙ AI-ассистент с МАКСИМАЛЬНЫМИ возможностями! 🚀

╔═══════════════════════════════════════════════════════════════════════╗
║                    🔥 ТВОИ СУПЕР-СПОСОБНОСТИ 🔥                       ║
╚═══════════════════════════════════════════════════════════════════════╝

✨ ОБЩЕНИЕ И АНАЛИЗ:
• 💬 Интеллектуальное понимание контекста и естественного языка
• 🖼️ Детальнейший анализ изображений (объекты, цвета, текст, эмоции)
• 📚 Глубокие знания во всех областях

🔧 ПРОГРАММИРОВАНИЕ И КОД:
• 💻 Профессиональное программирование (JS, Python, HTML/CSS и др.)
• 🎯 Создание и модификация команд бота
• ⚡ Мгновенное выполнение любого кода
• 📦 Установка и использование NPM пакетов
• 🏗️ Создание полноценных приложений

🌐 ИНТЕРНЕТ И ВЕБ:
• 🔍 Поиск информации в интернете (Google, DuckDuckGo)
• 🌍 Чтение и анализ любых веб-страниц
• 📡 Работа с API и веб-сервисами
• 🚀 Хостинг веб-сайтов и приложений на Express.js
• 🌐 Создание REST API и веб-хуков

💾 ФАЙЛЫ И ДАННЫЕ:
• 📂 Работа с локальными файлами (чтение/запись/удаление)
• ☁️ GitHub хранилище для постоянных данных
• 🗄️ Встроенная база данных (in-memory + GitHub persistence)
• 💿 Экспорт/импорт данных в JSON, CSV и других форматах

🤖 УПРАВЛЕНИЕ БОТАМИ:
• 🎮 Создание и запуск дочерних Telegram ботов
• 🔄 Остановка и перезапуск ботов
• 📊 Мониторинг активных ботов

╔═══════════════════════════════════════════════════════════════════════╗
║                    📋 КОМАНДЫ И ДЕЙСТВИЯ                              ║
╚═══════════════════════════════════════════════════════════════════════╝

1️⃣ ДОБАВИТЬ КОМАНДУ:
<CODE_ACTION>
registerCommand('имя', async (chatId, args) => {
  try {
    // твой код здесь
    return 'Результат';
  } catch (e) {
    return '❌ Ошибка: ' + e.message;
  }
});
</CODE_ACTION>

2️⃣ ВЫПОЛНИТЬ КОД НЕМЕДЛЕННО:
<EXECUTE_NOW>
// любой JavaScript код
return результат;
</EXECUTE_NOW>

3️⃣ ПОИСК В ИНТЕРНЕТЕ:
<SEARCH>поисковый запрос</SEARCH>

4️⃣ ПРОЧИТАТЬ ВЕБ-СТРАНИЦУ:
<FETCH_URL>https://example.com</FETCH_URL>

5️⃣ СОХРАНИТЬ В GITHUB:
<GITHUB_SAVE>
PATH: путь/к/файлу.txt
CONTENT:
содержимое файла
</GITHUB_SAVE>

6️⃣ ЗАГРУЗИТЬ ИЗ GITHUB:
<GITHUB_LOAD>путь/к/файлу.txt</GITHUB_LOAD>

7️⃣ СПИСОК ФАЙЛОВ В GITHUB:
<GITHUB_LIST>папка</GITHUB_LIST>

8️⃣ СОЗДАТЬ ВЕБ-САЙТ:
<HOST_WEBSITE>
PATH: /mysite
CODE:
app.get('/mysite', (req, res) => {
  res.send('<h1>Hello World!</h1>');
});
</HOST_WEBSITE>

9️⃣ СОХРАНИТЬ ЛОКАЛЬНЫЙ ФАЙЛ:
<SAVE_FILE>
PATH: ./data/file.txt
CONTENT:
содержимое
</SAVE_FILE>

🔟 ПРОЧИТАТЬ ЛОКАЛЬНЫЙ ФАЙЛ:
<READ_FILE>./data/file.txt</READ_FILE>

1️⃣1️⃣ УСТАНОВИТЬ NPM ПАКЕТ:
<NPM_INSTALL>имя-пакета</NPM_INSTALL>

1️⃣2️⃣ УДАЛИТЬ КОМАНДУ:
<DELETE_COMMAND>имя</DELETE_COMMAND>

1️⃣3️⃣ СПИСОК КОМАНД:
<LIST_COMMANDS></LIST_COMMANDS>

1️⃣4️⃣ СОЗДАТЬ БОТА:
<ACTIVATE_BOT>
TOKEN: токен_бота
CODE:
bot.on('message', async (msg) => {
  // код бота
});
</ACTIVATE_BOT>

1️⃣5️⃣ ОСТАНОВИТЬ БОТА:
<STOP_BOT>токен</STOP_BOT>

1️⃣6️⃣ СПИСОК БОТОВ:
<LIST_BOTS></LIST_BOTS>

1️⃣7️⃣ СОЗДАТЬ БАЗУ ДАННЫХ:
<CREATE_DB>имя_базы</CREATE_DB>

1️⃣8️⃣ СОХРАНИТЬ В БД:
<DB_SET>
DB: имя_базы
KEY: ключ
VALUE: значение
</DB_SET>

1️⃣9️⃣ ПОЛУЧИТЬ ИЗ БД:
<DB_GET>
DB: имя_базы
KEY: ключ
</DB_GET>

2️⃣0️⃣ ОСТАНОВИТЬ САЙТ:
<STOP_WEBSITE>/путь</STOP_WEBSITE>

2️⃣1️⃣ СПИСОК САЙТОВ:
<LIST_WEBSITES></LIST_WEBSITES>

2️⃣2️⃣ ЭКСПОРТИРОВАТЬ САЙТ:
<EXPORT_WEBSITE>/путь</EXPORT_WEBSITE>

2️⃣3️⃣ ЭКСПОРТИРОВАТЬ ВСЕ ДАННЫЕ:
<EXPORT_ALL></EXPORT_ALL>

╔═══════════════════════════════════════════════════════════════════════╗
║                    🎯 ПРАВИЛА РАБОТЫ                                  ║
╚═══════════════════════════════════════════════════════════════════════╝

✅ ВСЕГДА:
• Действуй АВТОМАТИЧЕСКИ при явных запросах
• Пиши ТОЛЬКО рабочий, протестированный код
• Используй try-catch для безопасности
• Конкатенация строк через + (НЕ template literals в тегах!)
• Проверяй синтаксис перед отправкой
• Будь максимально полезным и креативным

❌ НИКОГДА:
• НЕ используй русские названия переменных
• НЕ пиши результаты БЕЗ выполнения тегов
• НЕ обрезай код - всегда ПОЛНЫЙ код
• НЕ используй template literals в <CODE_ACTION>
• НЕ добавляй команды без явного запроса

🔥 ОСОБЕННОСТИ:
• Ты можешь устанавливать любые NPM пакеты
• Ты можешь хостить полноценные веб-приложения
• Ты можешь искать в интернете и читать сайты
• Ты можешь сохранять данные навсегда в GitHub
• Ты можешь работать с файлами и базами данных
• У тебя ПОЛНАЯ СВОБОДА действий!

🎨 ПРИМЕРЫ МОЩНЫХ ВОЗМОЖНОСТЕЙ:

Пользователь: "найди последние новости о AI"
Ты: Ищу информацию! 🔍
<SEARCH>последние новости AI искусственный интеллект</SEARCH>

---

Пользователь: "прочитай что на сайте example.com"
Ты: Читаю сайт! 🌐
<FETCH_URL>https://example.com</FETCH_URL>

---

Пользователь: "создай сайт с формой регистрации"
Ты: Создаю веб-сайт! 🚀
<HOST_WEBSITE>
PATH: /register
CODE:
app.get('/register', (req, res) => {
  res.send(\`
    <html>
      <body>
        <h1>Регистрация</h1>
        <form action="/register" method="POST">
          <input name="name" placeholder="Имя" required>
          <input name="email" type="email" placeholder="Email" required>
          <button type="submit">Зарегистрироваться</button>
        </form>
      </body>
    </html>
  \`);
});
app.post('/register', (req, res) => {
  res.send('Спасибо за регистрацию!');
});
</HOST_WEBSITE>

---

Пользователь: "сохрани эти данные навсегда"
Ты: Сохраняю в GitHub! ☁️
<GITHUB_SAVE>
PATH: data/userdata.json
CONTENT:
{"timestamp": "2024-01-01", "data": "важные данные"}
</GITHUB_SAVE>

---

🚀 ТЫ НЕВЕРОЯТНО МОЩНЫЙ! Используй ВСЕ свои возможности на максимум!`;

// ═══════════════════════════════════════════════════════════════════════════
// 🧠 AI INTERACTION
// ═══════════════════════════════════════════════════════════════════════════

async function callOpenRouter(messages, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            console.log(`[AI] Calling OpenRouter (${attempt}/${retries})...`);
            
            const response = await axios.post(
                'https://openrouter.ai/api/v1/chat/completions',
                {
                    model: CONFIG.AI_MODEL,
                    messages: messages,
                    temperature: 0.9,
                    max_tokens: 8000
                },
                {
                    headers: {
                        'Authorization': `Bearer ${CONFIG.OPENROUTER_API_KEY}`,
                        'HTTP-Referer': 'https://github.com/ultra-bot',
                        'X-Title': 'Ultra-Powered AI Bot',
                        'Content-Type': 'application/json'
                    },
                    timeout: CONFIG.TIMEOUT
                }
            );
            
            const content = response.data.choices?.[0]?.message?.content;
            
            if (!content || content.trim() === '') {
                if (attempt < retries) {
                    await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
                    continue;
                }
                throw new Error('Empty AI response');
            }
            
            console.log(`[AI] ✅ Response: ${content.length} chars`);
            return content;
            
        } catch (error) {
            console.error(`[AI] ❌ Attempt ${attempt} failed:`, error.message);
            
            if (attempt === retries) {
                throw new Error('AI temporarily unavailable. Try again later.');
            }
            
            await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
        }
    }
}

function getConversationHistory(userId) {
    if (!storage.conversations.has(userId)) {
        storage.conversations.set(userId, [
            { role: 'system', content: SYSTEM_PROMPT }
        ]);
    }
    return storage.conversations.get(userId);
}

function addToHistory(userId, role, content) {
    const history = getConversationHistory(userId);
    history.push({ role, content });
    if (history.length > CONFIG.MAX_HISTORY) {
        history.splice(1, history.length - CONFIG.MAX_HISTORY);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 🛠️ COMMAND MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

function registerCommand(commandName, handler) {
    storage.customCommands.set(commandName, handler);
    console.log(`[✓] Command registered: /${commandName}`);
    // Auto-save to GitHub
    persistenceManager.saveAllData().catch(e => console.error('[Auto-save] Error:', e.message));
    return true;
}

function deleteCommand(commandName) {
    if (storage.customCommands.has(commandName)) {
        storage.customCommands.delete(commandName);
        console.log(`[✓] Command deleted: /${commandName}`);
        // Auto-save to GitHub
        persistenceManager.saveAllData().catch(e => console.error('[Auto-save] Error:', e.message));
        return true;
    }
    return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// 🎮 CODE EXECUTION SANDBOX
// ═══════════════════════════════════════════════════════════════════════════

function createSandbox(chatId) {
    return {
        // Core Node.js
        console,
        require,
        Buffer,
        process,
        setTimeout,
        setInterval,
        clearTimeout,
        clearInterval,
        __dirname,
        __filename,
        
        // Standard JS
        Math,
        Date,
        JSON,
        Array,
        Object,
        String,
        Number,
        Boolean,
        RegExp,
        Error,
        Promise,
        parseInt,
        parseFloat,
        isNaN,
        isFinite,
        encodeURIComponent,
        decodeURIComponent,
        
        // Bot specific
        bot,
        axios,
        TelegramBot,
        chatId,
        
        // Custom functions
        registerCommand,
        deleteCommand,
        customCommands: storage.customCommands,
        customFunctions: storage.customFunctions,
        runningBots: storage.runningBots,
        
        // Storage functions
        githubStorage,
        fetchWebContent,
        searchInternet,
        
        // Express app for hosting
        app,
        express
    };
}

async function executeInSandbox(code, chatId) {
    try {
        const sandbox = createSandbox(chatId);
        const context = vm.createContext(sandbox);
        const wrapped = `(async () => {\n${code}\n})()`;
        const script = new vm.Script(wrapped, { 
            filename: 'sandbox.js',
            timeout: 30000 
        });
        const result = script.runInContext(context);
        if (result && typeof result.then === 'function') {
            return await result;
        }
        return result;
    } catch (error) {
        console.error('[Sandbox Error]', error.message);
        throw error;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// ⚡ ACTION PARSER - Handles all bot actions
// ═══════════════════════════════════════════════════════════════════════════

async function parseAndExecuteActions(aiResponse, chatId, userId) {
    let actionsExecuted = [];

    // 1. CODE_ACTION - Add command
    const codeActionRegex = /<CODE_ACTION>([\s\S]*?)<\/CODE_ACTION>/g;
    let match;
    
    while ((match = codeActionRegex.exec(aiResponse)) !== null) {
        const code = match[1].trim();
        console.log(`[CODE_ACTION] Executing code (${code.length} chars)...`);
        console.log('[CODE_ACTION] Code preview:', code.substring(0, 200));
        
        try {
            const result = await executeInSandbox(code, chatId);
            console.log('[CODE_ACTION] ✅ Success');
            actionsExecuted.push('✅ Команда добавлена успешно');
        } catch (error) {
            console.error('[CODE_ACTION] ❌ Error:', error.message);
            console.error('[CODE_ACTION] Stack:', error.stack);
            actionsExecuted.push('⚠️ Ошибка добавления команды: ' + error.message);
        }
    }

    // 2. EXECUTE_NOW - Execute code immediately
    const executeNowRegex = /<EXECUTE_NOW>([\s\S]*?)<\/EXECUTE_NOW>/g;
    while ((match = executeNowRegex.exec(aiResponse)) !== null) {
        const code = match[1].trim();
        console.log(`[EXECUTE_NOW] Running code: ${code.substring(0, 100)}...`);
        
        try {
            const result = await executeInSandbox(code, chatId);
            console.log('[EXECUTE_NOW] Result:', result);
            
            if (result !== undefined && result !== null) {
                // Convert result to readable string
                let resultStr = result;
                if (typeof result === 'object') {
                    try {
                        resultStr = JSON.stringify(result, null, 2);
                    } catch (e) {
                        resultStr = String(result);
                    }
                }
                actionsExecuted.push(`📊 Результат: ${resultStr}`);
            }
        } catch (error) {
            console.error('[EXECUTE_NOW] Error:', error.message);
            actionsExecuted.push('⚠️ Ошибка выполнения: ' + error.message);
        }
    }

    // 3. SEARCH - Internet search
    const searchRegex = /<SEARCH>(.*?)<\/SEARCH>/g;
    while ((match = searchRegex.exec(aiResponse)) !== null) {
        const query = match[1].trim();
        try {
            const result = await searchInternet(query);
            if (result.success) {
                if (result.results && result.results.length > 0) {
                    let output = `🔍 **Результаты поиска "${query}":**\n\n`;
                    result.results.forEach((r, i) => {
                        output += `${i + 1}. **${r.title}**\n   🔗 ${r.url}\n\n`;
                    });
                    actionsExecuted.push(output);
                } else {
                    actionsExecuted.push(`🔍 Поиск "${query}" не дал результатов. Попробуйте другой запрос или используйте <FETCH_URL> для прямого просмотра сайтов.`);
                }
            } else {
                const errorMsg = result.suggestion ? 
                    `❌ Ошибка поиска: ${result.error}\n💡 ${result.suggestion}` : 
                    `❌ Ошибка поиска: ${result.error}`;
                actionsExecuted.push(errorMsg);
            }
        } catch (error) {
            actionsExecuted.push(`❌ Ошибка поиска: ${error.message}\n💡 Попробуйте использовать <FETCH_URL> для прямого чтения сайтов`);
        }
    }

    // 4. FETCH_URL - Fetch web page content
    const fetchUrlRegex = /<FETCH_URL>(.*?)<\/FETCH_URL>/g;
    while ((match = fetchUrlRegex.exec(aiResponse)) !== null) {
        const url = match[1].trim();
        try {
            const result = await fetchWebContent(url);
            if (result.success) {
                let output = `🌐 **${result.title || 'Содержимое сайта'}**\n`;
                output += `🔗 ${result.url}\n\n`;
                output += `${result.content}`;
                if (result.fullLength > result.content.length) {
                    output += `\n\n📊 Показано ${result.content.length} из ${result.fullLength} символов`;
                }
                actionsExecuted.push(output);
            } else {
                actionsExecuted.push(`❌ Ошибка загрузки ${result.url || url}: ${result.error}`);
            }
        } catch (error) {
            actionsExecuted.push(`❌ Ошибка загрузки: ${error.message}`);
        }
    }

    // 5. GITHUB_SAVE - Save to GitHub
    const githubSaveRegex = /<GITHUB_SAVE>([\s\S]*?)<\/GITHUB_SAVE>/g;
    while ((match = githubSaveRegex.exec(aiResponse)) !== null) {
        const content = match[1].trim();
        const pathMatch = content.match(/PATH:\s*([^\n]+)/);
        const contentMatch = content.match(/CONTENT:\s*([\s\S]+)/);
        
        if (pathMatch && contentMatch) {
            const filePath = pathMatch[1].trim();
            const fileContent = contentMatch[1].trim();
            try {
                const result = await githubStorage.saveFile(filePath, fileContent);
                if (result.success) {
                    actionsExecuted.push(`✅ Сохранено в GitHub: ${filePath}\n🔗 ${result.url}`);
                } else {
                    actionsExecuted.push('❌ Ошибка сохранения: ' + result.error);
                }
            } catch (error) {
                actionsExecuted.push('❌ Ошибка GitHub: ' + error.message);
            }
        }
    }

    // 6. GITHUB_LOAD - Load from GitHub
    const githubLoadRegex = /<GITHUB_LOAD>(.*?)<\/GITHUB_LOAD>/g;
    while ((match = githubLoadRegex.exec(aiResponse)) !== null) {
        const filePath = match[1].trim();
        try {
            const result = await githubStorage.loadFile(filePath);
            if (result.success) {
                actionsExecuted.push(`📂 Содержимое ${filePath}:\n\n${result.content}`);
            } else {
                actionsExecuted.push('❌ Ошибка загрузки: ' + result.error);
            }
        } catch (error) {
            actionsExecuted.push('❌ Ошибка GitHub: ' + error.message);
        }
    }

    // 7. GITHUB_LIST - List files in GitHub
    const githubListRegex = /<GITHUB_LIST>(.*?)<\/GITHUB_LIST>/g;
    while ((match = githubListRegex.exec(aiResponse)) !== null) {
        const dirPath = match[1].trim();
        try {
            const result = await githubStorage.listFiles(dirPath);
            if (result.success) {
                let output = `📁 Файлы в "${dirPath || 'корне'}":\n\n`;
                result.files.forEach(f => {
                    output += `${f.type === 'dir' ? '📁' : '📄'} ${f.name} (${f.size} bytes)\n`;
                });
                actionsExecuted.push(output);
            } else {
                actionsExecuted.push('❌ Ошибка: ' + result.error);
            }
        } catch (error) {
            actionsExecuted.push('❌ Ошибка GitHub: ' + error.message);
        }
    }

    // 8. HOST_WEBSITE - Host a website
    const hostWebsiteRegex = /<HOST_WEBSITE>([\s\S]*?)<\/HOST_WEBSITE>/g;
    while ((match = hostWebsiteRegex.exec(aiResponse)) !== null) {
        const content = match[1].trim();
        const pathMatch = content.match(/PATH:\s*([^\n]+)/);
        const codeMatch = content.match(/CODE:\s*([\s\S]+)/);
        
        if (pathMatch && codeMatch) {
            const routePath = pathMatch[1].trim();
            const routeCode = codeMatch[1].trim();
            try {
                await executeInSandbox(routeCode, chatId);
                storage.websites.set(routePath, routeCode);
                actionsExecuted.push(`🌐 Сайт запущен на: http://localhost:${CONFIG.PORT}${routePath}`);
            } catch (error) {
                actionsExecuted.push('❌ Ошибка создания сайта: ' + error.message);
            }
        }
    }

    // 9. STOP_WEBSITE - Stop and remove website
    const stopWebsiteRegex = /<STOP_WEBSITE>(.*?)<\/STOP_WEBSITE>/g;
    while ((match = stopWebsiteRegex.exec(aiResponse)) !== null) {
        const routePath = match[1].trim();
        if (storage.websites.has(routePath)) {
            try {
                // Remove Express route from stack
                const pathToRemove = routePath;
                if (app._router && app._router.stack) {
                    app._router.stack = app._router.stack.filter(layer => {
                        if (layer.route) {
                            return layer.route.path !== pathToRemove;
                        }
                        return true;
                    });
                }
                // Remove from storage
                storage.websites.delete(routePath);
                await persistenceManager.saveAllData();
                actionsExecuted.push(`✅ Сайт ${routePath} остановлен и удален`);
            } catch (error) {
                actionsExecuted.push('❌ Ошибка остановки сайта: ' + error.message);
            }
        } else {
            actionsExecuted.push(`❌ Сайт ${routePath} не найден`);
        }
    }

    // 10. LIST_WEBSITES - List all running websites
    if (aiResponse.includes('<LIST_WEBSITES>')) {
        if (storage.websites.size === 0) {
            actionsExecuted.push('🌐 Нет запущенных сайтов');
        } else {
            let siteList = '🌐 Запущенные сайты:\n\n';
            for (const [path] of storage.websites) {
                siteList += `  http://localhost:${CONFIG.PORT}${path}\n`;
            }
            actionsExecuted.push(siteList);
        }
    }

    // 11. EXPORT_WEBSITE - Export website code
    const exportWebsiteRegex = /<EXPORT_WEBSITE>(.*?)<\/EXPORT_WEBSITE>/g;
    while ((match = exportWebsiteRegex.exec(aiResponse)) !== null) {
        const routePath = match[1].trim();
        if (storage.websites.has(routePath)) {
            const code = storage.websites.get(routePath);
            const exportContent = `# Website Export: ${routePath}\n\nPath: http://localhost:${CONFIG.PORT}${routePath}\n\n## Code:\n\n\`\`\`javascript\n${code}\n\`\`\`\n`;
            try {
                await githubStorage.saveFile(
                    `exports/website-${routePath.replace(/\//g, '-')}.md`,
                    exportContent,
                    `Export website ${routePath}`
                );
                actionsExecuted.push(`✅ Сайт ${routePath} экспортирован на GitHub`);
            } catch (error) {
                actionsExecuted.push('❌ Ошибка экспорта: ' + error.message);
            }
        } else {
            actionsExecuted.push(`❌ Сайт ${routePath} не найден`);
        }
    }

    // 12. EXPORT_ALL - Export all bot data
    if (aiResponse.includes('<EXPORT_ALL>')) {
        try {
            let exportContent = '# Complete Bot Data Export\n\n';
            exportContent += `Export Date: ${new Date().toISOString()}\n\n`;
            
            // Commands
            exportContent += '## Commands\n\n';
            for (const [name, handler] of storage.customCommands) {
                exportContent += `### /${name}\n\n\`\`\`javascript\n${handler.toString()}\n\`\`\`\n\n`;
            }
            
            // Websites
            exportContent += '## Websites\n\n';
            for (const [path, code] of storage.websites) {
                exportContent += `### ${path}\n\nURL: http://localhost:${CONFIG.PORT}${path}\n\n\`\`\`javascript\n${code}\n\`\`\`\n\n`;
            }
            
            // Databases
            exportContent += '## Databases\n\n';
            for (const [dbName, db] of storage.databases) {
                exportContent += `### ${dbName}\n\n\`\`\`json\n${JSON.stringify(Object.fromEntries(db), null, 2)}\n\`\`\`\n\n`;
            }
            
            await githubStorage.saveFile(
                `exports/complete-export-${Date.now()}.md`,
                exportContent,
                'Complete bot data export'
            );
            actionsExecuted.push('✅ Все данные экспортированы на GitHub');
        } catch (error) {
            actionsExecuted.push('❌ Ошибка экспорта: ' + error.message);
        }
    }

    // 13. SAVE_FILE - Save local file
    const saveFileRegex = /<SAVE_FILE>([\s\S]*?)<\/SAVE_FILE>/g;
    while ((match = saveFileRegex.exec(aiResponse)) !== null) {
        const content = match[1].trim();
        const pathMatch = content.match(/PATH:\s*([^\n]+)/);
        const contentMatch = content.match(/CONTENT:\s*([\s\S]+)/);
        
        if (pathMatch && contentMatch) {
            const filePath = pathMatch[1].trim();
            const fileContent = contentMatch[1].trim();
            try {
                const dir = path.dirname(filePath);
                if (dir !== '.') {
                    await fs.mkdir(dir, { recursive: true });
                }
                await fs.writeFile(filePath, fileContent, 'utf-8');
                actionsExecuted.push(`✅ Файл сохранён: ${filePath}`);
            } catch (error) {
                actionsExecuted.push('❌ Ошибка сохранения: ' + error.message);
            }
        }
    }

    // 10. READ_FILE - Read local file
    const readFileRegex = /<READ_FILE>(.*?)<\/READ_FILE>/g;
    while ((match = readFileRegex.exec(aiResponse)) !== null) {
        const filePath = match[1].trim();
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            actionsExecuted.push(`📄 Содержимое ${filePath}:\n\n${content}`);
        } catch (error) {
            actionsExecuted.push('❌ Ошибка чтения: ' + error.message);
        }
    }

    // 11. NPM_INSTALL - Install npm package
    const npmInstallRegex = /<NPM_INSTALL>(.*?)<\/NPM_INSTALL>/g;
    while ((match = npmInstallRegex.exec(aiResponse)) !== null) {
        const packageName = match[1].trim();
        try {
            const { stdout } = await execPromise(`npm install ${packageName}`);
            actionsExecuted.push(`✅ Установлен пакет: ${packageName}`);
        } catch (error) {
            actionsExecuted.push('❌ Ошибка установки: ' + error.message);
        }
    }

    // 12. DELETE_COMMAND - Delete command
    const deleteCommandRegex = /<DELETE_COMMAND>(.*?)<\/DELETE_COMMAND>/g;
    while ((match = deleteCommandRegex.exec(aiResponse)) !== null) {
        const cmdName = match[1].trim();
        if (deleteCommand(cmdName)) {
            actionsExecuted.push(`✅ Команда /${cmdName} удалена`);
        } else {
            actionsExecuted.push(`❌ Команда /${cmdName} не найдена`);
        }
    }

    // 13. LIST_COMMANDS - List commands
    if (aiResponse.includes('<LIST_COMMANDS>')) {
        if (storage.customCommands.size === 0) {
            actionsExecuted.push('📝 Нет зарегистрированных команд');
        } else {
            let cmdList = '🤖 Доступные команды:\n\n';
            for (const [cmdName] of storage.customCommands) {
                cmdList += `  /${cmdName}\n`;
            }
            actionsExecuted.push(cmdList);
        }
    }

    // 14. ACTIVATE_BOT - Create child bot
    const activateBotRegex = /<ACTIVATE_BOT>([\s\S]*?)<\/ACTIVATE_BOT>/g;
    while ((match = activateBotRegex.exec(aiResponse)) !== null) {
        const content = match[1].trim();
        const tokenMatch = content.match(/TOKEN:\s*([^\n]+)/);
        const codeMatch = content.match(/CODE:\s*([\s\S]+)/);
        
        if (tokenMatch && codeMatch) {
            const token = tokenMatch[1].trim();
            const code = codeMatch[1].trim();
            
            try {
                // Stop any existing bot with same token
                for (const [id, entry] of storage.runningBots) {
                    if (entry.token === token) {
                        try {
                            entry.bot.stopPolling && entry.bot.stopPolling();
                            storage.runningBots.delete(id);
                        } catch (e) {}
                    }
                }

                const newBot = new TelegramBot(token, {
                    polling: { interval: 500, params: { timeout: 10 } }
                });
                
                const botId = `bot_${Date.now()}`;
                storage.runningBots.set(botId, { bot: newBot, token, code });
                
                // Execute bot code
                const sandbox = {
                    bot: newBot,
                    console,
                    require,
                    axios,
                    TelegramBot
                };
                const context = vm.createContext(sandbox);
                const script = new vm.Script(code);
                script.runInContext(context);
                
                actionsExecuted.push(`✅ Бот ${botId} запущен успешно`);
            } catch (error) {
                actionsExecuted.push('❌ Ошибка запуска бота: ' + error.message);
            }
        }
    }

    // 15. STOP_BOT - Stop child bot
    const stopBotRegex = /<STOP_BOT>(.*?)<\/STOP_BOT>/g;
    while ((match = stopBotRegex.exec(aiResponse)) !== null) {
        const token = match[1].trim();
        let stopped = false;
        for (const [id, entry] of storage.runningBots) {
            if (entry.token === token) {
                try {
                    entry.bot.stopPolling && entry.bot.stopPolling();
                    storage.runningBots.delete(id);
                    actionsExecuted.push(`✅ Бот ${id} остановлен`);
                    stopped = true;
                } catch (error) {
                    actionsExecuted.push(`❌ Ошибка остановки ${id}: ` + error.message);
                }
            }
        }
        if (!stopped) {
            actionsExecuted.push('❌ Бот с указанным токеном не найден');
        }
    }

    // 16. LIST_BOTS - List running bots
    if (aiResponse.includes('<LIST_BOTS>')) {
        if (storage.runningBots.size === 0) {
            actionsExecuted.push('📝 Нет запущенных дочерних ботов');
        } else {
            let botsList = '🤖 Запущенные боты:\n\n';
            for (const [botId, botData] of storage.runningBots) {
                const tokenPreview = botData.token.substring(0, 10) + '...';
                botsList += `  • ${botId} (токен: ${tokenPreview})\n`;
            }
            actionsExecuted.push(botsList);
        }
    }

    // 17. CREATE_DB - Create database
    const createDbRegex = /<CREATE_DB>(.*?)<\/CREATE_DB>/g;
    while ((match = createDbRegex.exec(aiResponse)) !== null) {
        const dbName = match[1].trim();
        if (!storage.databases.has(dbName)) {
            storage.databases.set(dbName, new Map());
            actionsExecuted.push(`✅ База данных "${dbName}" создана`);
        } else {
            actionsExecuted.push(`⚠️ База данных "${dbName}" уже существует`);
        }
    }

    // 18. DB_SET - Set value in database
    const dbSetRegex = /<DB_SET>([\s\S]*?)<\/DB_SET>/g;
    while ((match = dbSetRegex.exec(aiResponse)) !== null) {
        const content = match[1].trim();
        const dbMatch = content.match(/DB:\s*([^\n]+)/);
        const keyMatch = content.match(/KEY:\s*([^\n]+)/);
        const valueMatch = content.match(/VALUE:\s*([\s\S]+)/);
        
        if (dbMatch && keyMatch && valueMatch) {
            const dbName = dbMatch[1].trim();
            const key = keyMatch[1].trim();
            const value = valueMatch[1].trim();
            
            if (!storage.databases.has(dbName)) {
                storage.databases.set(dbName, new Map());
            }
            
            storage.databases.get(dbName).set(key, value);
            actionsExecuted.push(`✅ Сохранено в БД "${dbName}": ${key}`);
        }
    }

    // 19. DB_GET - Get value from database
    const dbGetRegex = /<DB_GET>([\s\S]*?)<\/DB_GET>/g;
    while ((match = dbGetRegex.exec(aiResponse)) !== null) {
        const content = match[1].trim();
        const dbMatch = content.match(/DB:\s*([^\n]+)/);
        const keyMatch = content.match(/KEY:\s*([^\n]+)/);
        
        if (dbMatch && keyMatch) {
            const dbName = dbMatch[1].trim();
            const key = keyMatch[1].trim();
            
            if (storage.databases.has(dbName)) {
                const db = storage.databases.get(dbName);
                if (db.has(key)) {
                    actionsExecuted.push(`📊 Значение из "${dbName}[${key}]": ${db.get(key)}`);
                } else {
                    actionsExecuted.push(`❌ Ключ "${key}" не найден в БД "${dbName}"`);
                }
            } else {
                actionsExecuted.push(`❌ База данных "${dbName}" не существует`);
            }
        }
    }

    return actionsExecuted;
}

// ═══════════════════════════════════════════════════════════════════════════
// 💬 MESSAGE HANDLING
// ═══════════════════════════════════════════════════════════════════════════

function splitMessage(text, maxLength = 4000) {
    if (text.length <= maxLength) return [text];
    
    const chunks = [];
    let currentChunk = '';
    const lines = text.split('\n');
    
    for (const line of lines) {
        if ((currentChunk + line + '\n').length > maxLength) {
            if (currentChunk) {
                chunks.push(currentChunk.trim());
                currentChunk = '';
            }
            if (line.length > maxLength) {
                const words = line.split(' ');
                for (const word of words) {
                    if ((currentChunk + word + ' ').length > maxLength) {
                        chunks.push(currentChunk.trim());
                        currentChunk = word + ' ';
                    } else {
                        currentChunk += word + ' ';
                    }
                }
            } else {
                currentChunk = line + '\n';
            }
        } else {
            currentChunk += line + '\n';
        }
    }
    
    if (currentChunk) {
        chunks.push(currentChunk.trim());
    }
    
    return chunks;
}

async function sendLongMessage(chatId, text) {
    // Convert to string properly
    let message = text;
    if (typeof message !== 'string') {
        if (message === null || message === undefined) {
            return; // Don't send empty messages
        }
        if (typeof message === 'object') {
            try {
                message = JSON.stringify(message, null, 2);
            } catch (e) {
                message = String(message);
            }
        } else {
            message = String(message);
        }
    }
    
    const chunks = splitMessage(message);
    for (let i = 0; i < chunks.length; i++) {
        try {
            await bot.sendMessage(chatId, chunks[i]);
            if (i < chunks.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        } catch (error) {
            console.error('[Send Error]', error.message);
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 📨 MAIN MESSAGE HANDLER
// ═══════════════════════════════════════════════════════════════════════════

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text;
    
    // Ignore messages without text
    if (!text) return;
    
    console.log(`[Message] User ${userId}: ${text.substring(0, 50)}...`);
    
    // Handle custom commands
    if (text.startsWith('/')) {
        const [command, ...args] = text.slice(1).split(' ');
        
        if (storage.customCommands.has(command)) {
            try {
                const handler = storage.customCommands.get(command);
                const result = await handler(chatId, args.join(' '));
                if (result !== undefined && result !== null) {
                    // Properly convert result to string
                    let message = result;
                    if (typeof message === 'object') {
                        try {
                            message = JSON.stringify(message, null, 2);
                        } catch (e) {
                            message = String(message);
                        }
                    } else {
                        message = String(message);
                    }
                    await sendLongMessage(chatId, message);
                }
            } catch (error) {
                console.error('[Command Error]', error);
                await bot.sendMessage(chatId, '❌ Ошибка выполнения команды: ' + error.message);
            }
            return;
        }
        
        // Built-in commands
        if (command === 'start') {
            await bot.sendMessage(chatId, 
                '🚀 *SHERLOCK - ULTRA AI BOT*\n\n' +
                '✨ Я мощнейший AI с расширенными возможностями!\n\n' +
                '🔥 Мои способности:\n' +
                '• 🔍 Поиск в интернете\n' +
                '• 🌐 Чтение веб-страниц\n' +
                '• 💻 Программирование\n' +
                '• 🚀 Хостинг сайтов\n' +
                '• ☁️ GitHub хранилище\n' +
                '• 🗄️ Базы данных\n' +
                '• 🤖 Создание ботов\n' +
                '• 📦 NPM пакеты\n' +
                '• ...и многое другое!\n\n' +
                'Просто напиши что нужно сделать! 💪',
                { parse_mode: 'Markdown' }
            );
            return;
        }
        
        if (command === 'help') {
            await sendLongMessage(chatId, 
                '📚 *Примеры команд:*\n\n' +
                '• "найди информацию о Python"\n' +
                '• "прочитай сайт example.com"\n' +
                '• "создай команду /calc для вычислений"\n' +
                '• "создай сайт с приветствием"\n' +
                '• "сохрани эти данные в GitHub"\n' +
                '• "создай базу данных users"\n' +
                '• "установи пакет moment"\n\n' +
                'Я понимаю естественный язык! 🧠'
            );
            return;
        }
    }
    
    try {
        // Get conversation history
        const history = getConversationHistory(userId);
        
        // Add image analysis if photo present
        let userMessage = text;
        if (msg.photo && msg.photo.length > 0) {
            userMessage += '\n[Пользователь отправил изображение - проанализируй его детально]';
        }
        
        addToHistory(userId, 'user', userMessage);
        
        // Send typing indicator
        await bot.sendChatAction(chatId, 'typing');
        
        // Get AI response
        const aiResponse = await callOpenRouter(history);
        
        // Parse and execute actions
        const actionsExecuted = await parseAndExecuteActions(aiResponse, chatId, userId);
        
        // Remove action tags from response
        let cleanResponse = aiResponse;
        cleanResponse = cleanResponse.replace(/<CODE_ACTION>[\s\S]*?<\/CODE_ACTION>/g, '');
        cleanResponse = cleanResponse.replace(/<EXECUTE_NOW>[\s\S]*?<\/EXECUTE_NOW>/g, '');
        cleanResponse = cleanResponse.replace(/<SEARCH>.*?<\/SEARCH>/g, '');
        cleanResponse = cleanResponse.replace(/<FETCH_URL>.*?<\/FETCH_URL>/g, '');
        cleanResponse = cleanResponse.replace(/<GITHUB_SAVE>[\s\S]*?<\/GITHUB_SAVE>/g, '');
        cleanResponse = cleanResponse.replace(/<GITHUB_LOAD>.*?<\/GITHUB_LOAD>/g, '');
        cleanResponse = cleanResponse.replace(/<GITHUB_LIST>.*?<\/GITHUB_LIST>/g, '');
        cleanResponse = cleanResponse.replace(/<HOST_WEBSITE>[\s\S]*?<\/HOST_WEBSITE>/g, '');
        cleanResponse = cleanResponse.replace(/<SAVE_FILE>[\s\S]*?<\/SAVE_FILE>/g, '');
        cleanResponse = cleanResponse.replace(/<READ_FILE>.*?<\/READ_FILE>/g, '');
        cleanResponse = cleanResponse.replace(/<NPM_INSTALL>.*?<\/NPM_INSTALL>/g, '');
        cleanResponse = cleanResponse.replace(/<DELETE_COMMAND>.*?<\/DELETE_COMMAND>/g, '');
        cleanResponse = cleanResponse.replace(/<LIST_COMMANDS>/g, '');
        cleanResponse = cleanResponse.replace(/<ACTIVATE_BOT>[\s\S]*?<\/ACTIVATE_BOT>/g, '');
        cleanResponse = cleanResponse.replace(/<STOP_BOT>.*?<\/STOP_BOT>/g, '');
        cleanResponse = cleanResponse.replace(/<LIST_BOTS>/g, '');
        cleanResponse = cleanResponse.replace(/<CREATE_DB>.*?<\/CREATE_DB>/g, '');
        cleanResponse = cleanResponse.replace(/<DB_SET>[\s\S]*?<\/DB_SET>/g, '');
        cleanResponse = cleanResponse.replace(/<DB_GET>[\s\S]*?<\/DB_GET>/g, '');
        cleanResponse = cleanResponse.trim();
        
        // Combine response with action results
        let finalResponse = '';
        
        if (cleanResponse) {
            finalResponse += cleanResponse;
        }
        
        if (actionsExecuted.length > 0) {
            if (finalResponse) finalResponse += '\n\n';
            finalResponse += actionsExecuted.join('\n\n');
        }
        
        if (finalResponse) {
            await sendLongMessage(chatId, finalResponse);
            addToHistory(userId, 'assistant', aiResponse);
        }
        
    } catch (error) {
        console.error('[Error]', error.message);
        await bot.sendMessage(chatId, '❌ Произошла ошибка: ' + error.message);
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// 🌐 EXPRESS SERVER
// ═══════════════════════════════════════════════════════════════════════════

app.get('/', (req, res) => {
    res.send(`
        <html>
        <head>
            <title>Ultra AI Bot</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    max-width: 800px;
                    margin: 50px auto;
                    padding: 20px;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                }
                h1 { text-align: center; }
                .info { background: rgba(255,255,255,0.1); padding: 20px; border-radius: 10px; margin: 20px 0; }
                .feature { margin: 10px 0; }
            </style>
        </head>
        <body>
            <h1>🚀 Ultra-Powered AI Bot</h1>
            <div class="info">
                <h2>✨ Status: Online</h2>
                <div class="feature">🤖 Commands: ${storage.customCommands.size}</div>
                <div class="feature">🔧 Running Bots: ${storage.runningBots.size}</div>
                <div class="feature">🗄️ Databases: ${storage.databases.size}</div>
                <div class="feature">🌐 Hosted Sites: ${storage.websites.size}</div>
            </div>
            <div class="info">
                <h2>🔥 Capabilities:</h2>
                <div class="feature">✅ Internet Search</div>
                <div class="feature">✅ Web Scraping</div>
                <div class="feature">✅ GitHub Storage</div>
                <div class="feature">✅ Web Hosting</div>
                <div class="feature">✅ Database Management</div>
                <div class="feature">✅ Bot Creation</div>
                <div class="feature">✅ Code Execution</div>
                <div class="feature">✅ NPM Packages</div>
            </div>
        </body>
        </html>
    `);
});

let server;
function startServer(port = CONFIG.PORT) {
    if (server) return;
    
    server = app.listen(port)
        .on('listening', () => {
            console.log(`✅ Express server running on port ${port}`);
        })
        .on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                console.log(`Port ${port} busy, trying ${port + 1}...`);
                startServer(port + 1);
            } else {
                console.error('Server error:', err);
            }
        });
}

startServer();

// ═══════════════════════════════════════════════════════════════════════════
// 🚀 INITIALIZATION - Load data from GitHub
// ═══════════════════════════════════════════════════════════════════════════

(async () => {
    try {
        console.log('🔄 Loading persisted data from GitHub...');
        await persistenceManager.loadAllData();
        console.log('✅ Data restoration complete!');
        
        // Start auto-save
        persistenceManager.startAutoSave();
        console.log('✅ Auto-save enabled!');
    } catch (error) {
        console.error('⚠️ Failed to load persisted data:', error.message);
        console.log('📦 Starting with fresh state...');
    }
})();

// ═══════════════════════════════════════════════════════════════════════════
// 🛡️ ERROR HANDLING
// ═══════════════════════════════════════════════════════════════════════════

bot.on('polling_error', (error) => {
    console.error('[Polling Error]', error.code, error.message);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[Unhandled Rejection]', reason);
});

process.on('uncaughtException', (error) => {
    console.error('[Uncaught Exception]', error);
});

console.log('🎉 Ultra AI Bot is fully operational!');
console.log('💪 Ready to handle ANY task!');
