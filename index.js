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
    GITHUB_REPO: process.env.GITHUB_REPO || 'mraiko23/doars',
    PORT: process.env.PORT || 3000,
    AI_MODEL: 'x-ai/grok-4.1-fast',
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
    files: new Map(),
    lastMentionedBot: new Map() // Track last bot mentioned per user
};

// ═══════════════════════════════════════════════════════════════════════════
// 🌐 GITHUB STORAGE SYSTEM - For Persistent Data
// ═══════════════════════════════════════════════════════════════════════════

class GitHubStorage {
    constructor(token, repo) {
        this.token = token;
        this.repo = repo;
        this.baseUrl = 'https://api.github.com';
        this.headers = {
            'Authorization': `token ${token}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json'
        };
    }

    async saveFile(filePath, content, message = 'Update file via bot') {
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
            console.error(`[GitHub] ❌ Save error: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    async loadFile(filePath) {
        try {
            const url = `${this.baseUrl}/repos/${this.repo}/contents/${filePath}`;
            const response = await axios.get(url, { headers: this.headers });
            const content = Buffer.from(response.data.content, 'base64').toString('utf-8');
            console.log(`[GitHub] ✅ Loaded: ${filePath}`);
            return { success: true, content };
        } catch (error) {
            console.error(`[GitHub] ❌ Load error: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    async deleteFile(filePath, message = 'Delete file via bot') {
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
            console.error(`[GitHub] ❌ Delete error: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    async listFiles(dirPath = '') {
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
            console.error(`[GitHub] ❌ List error: ${error.message}`);
            return { success: false, error: error.message };
        }
    }
}

const githubStorage = new GitHubStorage(CONFIG.GITHUB_TOKEN, CONFIG.GITHUB_REPO);

// ═══════════════════════════════════════════════════════════════════════════
// 🔍 WEB SCRAPING & URL FETCHING
// ═══════════════════════════════════════════════════════════════════════════

async function fetchWebContent(url) {
    try {
        const response = await axios.get(url, {
            timeout: 30000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        
        // Extract text content (simple HTML stripping)
        let text = response.data.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
        text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
        text = text.replace(/<[^>]+>/g, ' ');
        text = text.replace(/\s+/g, ' ').trim();
        
        return {
            success: true,
            content: text.substring(0, 5000), // Limit to 5000 chars
            fullLength: text.length,
            url
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 🔎 INTERNET SEARCH - DuckDuckGo
// ═══════════════════════════════════════════════════════════════════════════

async function searchInternet(query, maxResults = 5) {
    try {
        // Using DuckDuckGo HTML search (no API key needed)
        const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        const response = await axios.get(searchUrl, {
            timeout: 30000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        // Parse results (simple regex extraction)
        const results = [];
        const resultRegex = /<a class="result__a" href="([^"]+)">([^<]+)<\/a>/g;
        let match;
        let count = 0;

        while ((match = resultRegex.exec(response.data)) !== null && count < maxResults) {
            results.push({
                title: match[2].trim(),
                url: match[1]
            });
            count++;
        }

        return { success: true, query, results };
    } catch (error) {
        console.error('[Search] Error:', error.message);
        return { success: false, error: error.message };
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

🤖 УПРАВЛЕНИЕ БОТАМИ (ОТДЕЛЬНЫЕ ПРОЦЕССЫ):
• 🚀 Каждый бот запускается в отдельном процессе
• 📂 Собственная директория для каждого бота (./bots/bot_XXX/)
• 📦 Отдельные зависимости (npm install в каждой директории)
• 💥 Остановка = KILL процесса + удаление директории
• 🔄 Полная изоляция - боты не влияют друг на друга
• 📊 Мониторинг: PID, workspace, uptime



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

1️⃣4️⃣ СОЗДАТЬ БОТА (ОТДЕЛЬНЫЙ ПРОЦЕСС):
<ACTIVATE_BOT>
TOKEN: токен_бота
CODE:
bot.on('message', async (msg) => {
  // код бота
});
</ACTIVATE_BOT>

❗ КАЖДЫЙ БОТ:
• Запускается в отдельном Node.js процессе
• Имеет свою директорию ./bots/bot_XXX/
• Автоматически устанавливает node-telegram-bot-api и axios
• Может устанавливать дополнительные пакеты в своем CODE

1️⃣5️⃣ УНИЧТОЖИТЬ БОТА (ПОЛНОЕ УДАЛЕНИЕ):
<STOP_BOT>токен_или_bot_id</STOP_BOT>

💥 ЧТО ПРОИСХОДИТ:
1. SIGTERM сигнал процессу (мягкое завершение)
2. Ждём 1 секунду
3. SIGKILL если процесс ещё жив
4. Удаление всей директории ./bots/bot_XXX/
5. Удаление из storage

⚠️ ВАЖНО - КОНТЕКСТ РАЗГОВОРА:
• Когда ты создаешь бота - bot_id сохраняется в контекст разговора
• Когда ты показываешь список ботов - первый bot_id сохраняется в контекст
• Если пользователь говорит "выключи его", "останови его", "выключи этого бота":
  1. ПОСМОТРИ в conversation history - есть ли bot_id в предыдущих сообщениях?
  2. Если ДА - используй STOP_BOT с этим bot_id
  3. Если НЕТ - спроси какого именно бота остановить
• НИКОГДА не выключай всех ботов если пользователь говорит о конкретном боте!
• Для уничтожения ВСЕХ ботов пользователь должен явно сказать "останови всех", "выключи всех ботов"

📝 ПРИМЕРЫ ПРАВИЛЬНОГО ИСПОЛЬЗОВАНИЯ:

Пример 1:
Пользователь: "Сколько ботов?"
AI: <LIST_BOTS></LIST_BOTS> -> показывает bot_1763567890123
Пользователь: "выключи его"
AI: <STOP_BOT>bot_1763567890123</STOP_BOT> ✅ ПРАВИЛЬНО!

Пример 2:
Пользователь: "Создай бота"
AI: <ACTIVATE_BOT>...</ACTIVATE_BOT> -> создаёт bot_1763568000000
Пользователь: "останови его"
AI: <STOP_BOT>bot_1763568000000</STOP_BOT> ✅ ПРАВИЛЬНО!

Пример 3 (НЕПРАВИЛЬНО!):
Пользователь: "Сколько ботов?"
AI: показывает 3 бота
Пользователь: "выключи его"
AI: <STOP_BOT>ALL</STOP_BOT> ❌ НЕПРАВИЛЬНО! Выключил всех!
ПРАВИЛЬНО: <STOP_BOT>bot_1763567890123</STOP_BOT> (первый из списка)

// Для уничтожения ВСЕХ ботов (ТОЛЬКО при явной команде "останови всех"):
<STOP_BOT>ALL</STOP_BOT>

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

⚠️ КРИТИЧЕСКИ ВАЖНО - СОЗДАНИЕ БОТОВ:
• После создания бота НИКОГДА не останавливай его сразу!
• Бот должен продолжать работать после создания
• Останавливай бота ТОЛЬКО если пользователь явно попросил
• Система АВТОМАТИЧЕСКИ остановит старого бота с тем же токеном перед созданием нового
• НЕ останавливай бота который только что создал!

❌ НЕПРАВИЛЬНО:
  Создаю бота... ✅
  Останавливаю бота... ❌ ЗАЧЕМ?!

✅ ПРАВИЛЬНО:
  Создаю бота... ✅
  Бот работает! ✅
  (не останавливать без явной команды) 

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
    return true;
}

function deleteCommand(commandName) {
    if (storage.customCommands.has(commandName)) {
        storage.customCommands.delete(commandName);
        console.log(`[✓] Command deleted: /${commandName}`);
        return true;
    }
    return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// 🎮 CODE EXECUTION SANDBOX
// ═══════════════════════════════════════════════════════════════════════════

function createSandbox(chatId) {
    const sandbox = {
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
        global: undefined, // Will be set to sandbox itself
        
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
    // Set global to point to sandbox itself
    sandbox.global = sandbox;
    return sandbox;
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
        try {
            await executeInSandbox(code, chatId);
            actionsExecuted.push('✅ Команда добавлена успешно');
        } catch (error) {
            actionsExecuted.push('⚠️ Ошибка добавления команды: ' + error.message);
        }
    }

    // 2. EXECUTE_NOW - Execute code immediately
    const executeNowRegex = /<EXECUTE_NOW>([\s\S]*?)<\/EXECUTE_NOW>/g;
    while ((match = executeNowRegex.exec(aiResponse)) !== null) {
        const code = match[1].trim();
        try {
            const result = await executeInSandbox(code, chatId);
            if (result !== undefined) {
                actionsExecuted.push(`📊 Результат: ${result}`);
            }
        } catch (error) {
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
                let output = `🔍 Результаты поиска "${query}":\n\n`;
                result.results.forEach((r, i) => {
                    output += `${i + 1}. ${r.title}\n   ${r.url}\n\n`;
                });
                actionsExecuted.push(output);
            } else {
                actionsExecuted.push('❌ Ошибка поиска: ' + result.error);
            }
        } catch (error) {
            actionsExecuted.push('❌ Ошибка поиска: ' + error.message);
        }
    }

    // 4. FETCH_URL - Fetch web page content
    const fetchUrlRegex = /<FETCH_URL>(.*?)<\/FETCH_URL>/g;
    while ((match = fetchUrlRegex.exec(aiResponse)) !== null) {
        const url = match[1].trim();
        try {
            const result = await fetchWebContent(url);
            if (result.success) {
                actionsExecuted.push(`🌐 Содержимое ${url}:\n\n${result.content}...\n\n(Показано ${result.content.length}/${result.fullLength} символов)`);
            } else {
                actionsExecuted.push('❌ Ошибка загрузки: ' + result.error);
            }
        } catch (error) {
            actionsExecuted.push('❌ Ошибка загрузки: ' + error.message);
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

    // 9. SAVE_FILE - Save local file
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

    // 14. ACTIVATE_BOT - Create child bot in separate process
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
                            console.log(`[Bot Manager] Stopping existing bot ${id} with same token`);
                            
                            // Kill process
                            if (entry.process) {
                                entry.process.kill('SIGTERM');
                                await new Promise(resolve => setTimeout(resolve, 500));
                                if (!entry.process.killed) {
                                    entry.process.kill('SIGKILL');
                                }
                            }
                            
                            // Remove workspace
                            if (entry.workspace && fsSync.existsSync(entry.workspace)) {
                                await execPromise(`rm -rf "${entry.workspace}"`);
                            }
                            
                            storage.runningBots.delete(id);
                        } catch (e) {
                            console.error(`[Bot Manager] Error stopping old bot:`, e);
                            storage.runningBots.delete(id);
                        }
                    }
                }

                const botId = `bot_${Date.now()}`;
                const workspace = path.join(__dirname, 'bots', botId);
                
                console.log(`[Bot Manager] Creating workspace: ${workspace}`);
                
                // Create workspace directory
                await fs.mkdir(workspace, { recursive: true });
                
                // Create package.json
                const packageJson = {
                    name: botId,
                    version: '1.0.0',
                    description: 'Child bot',
                    main: 'bot.js',
                    dependencies: {
                        'node-telegram-bot-api': '^0.66.0',
                        'axios': '^1.6.5'
                    }
                };
                await fs.writeFile(
                    path.join(workspace, 'package.json'),
                    JSON.stringify(packageJson, null, 2),
                    'utf-8'
                );
                
                // Create bot.js file
                const botCode = `
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const token = '${token}';
const bot = new TelegramBot(token, { polling: { interval: 500, params: { timeout: 10 } } });

console.log('[Child Bot] Started with PID:', process.pid);

${code}

// Handle graceful shutdown
process.on('SIGTERM', () => {
    console.log('[Child Bot] Received SIGTERM, shutting down...');
    bot.stopPolling().then(() => {
        process.exit(0);
    }).catch(() => {
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('[Child Bot] Received SIGINT, shutting down...');
    bot.stopPolling().then(() => {
        process.exit(0);
    }).catch(() => {
        process.exit(0);
    });
});
`;
                await fs.writeFile(
                    path.join(workspace, 'bot.js'),
                    botCode,
                    'utf-8'
                );
                
                console.log(`[Bot Manager] Installing dependencies for ${botId}...`);
                
                // Install dependencies
                await execPromise(`cd "${workspace}" && npm install --silent`, {
                    timeout: 60000
                });
                
                console.log(`[Bot Manager] Launching bot process ${botId}...`);
                
                // Spawn bot process
                const childProcess = require('child_process').spawn(
                    'node',
                    ['bot.js'],
                    {
                        cwd: workspace,
                        detached: false,
                        stdio: ['ignore', 'pipe', 'pipe']
                    }
                );
                
                // Log output
                childProcess.stdout.on('data', (data) => {
                    console.log(`[${botId}] ${data.toString().trim()}`);
                });
                
                childProcess.stderr.on('data', (data) => {
                    console.error(`[${botId}] ERROR: ${data.toString().trim()}`);
                });
                
                childProcess.on('exit', (code) => {
                    console.log(`[Bot Manager] Bot ${botId} exited with code ${code}`);
                    storage.runningBots.delete(botId);
                });
                
                // Store bot info
                storage.runningBots.set(botId, {
                    process: childProcess,
                    pid: childProcess.pid,
                    token,
                    code,
                    workspace,
                    startedAt: new Date()
                });
                
                // Save to context (most recently created bot)
                if (chatId) {
                    storage.lastMentionedBot.set(chatId, botId);
                }
                
                actionsExecuted.push(`✅ Бот ${botId} запущен в отдельном процессе (PID: ${childProcess.pid})`);
            } catch (error) {
                actionsExecuted.push('❌ Ошибка запуска бота: ' + error.message);
                console.error('[Bot Manager] Detailed error:', error);
            }
        }
    }

    // 15. STOP_BOT - Kill child bot process and destroy workspace
    const stopBotRegex = /<STOP_BOT>(.*?)<\/STOP_BOT>/g;
    while ((match = stopBotRegex.exec(aiResponse)) !== null) {
        let token = match[1].trim();
        let stopped = false;
        
        // Handle "ALL" keyword for stopping all bots
        if (token.toUpperCase() === 'ALL') {
            token = ''; // Empty means all bots
        }
        
        // Collect bots to stop
        const botsToStop = [];
        
        if (!token || token === '') {
            // No token provided - check if we should use context or stop all
            // If user explicitly said ALL, stop all. Otherwise, it's an error.
            if (match[1].trim().toUpperCase() === 'ALL') {
                // Stop all bots
                for (const [id, entry] of storage.runningBots) {
                    botsToStop.push({ id, entry });
                }
            } else {
                // Token is empty but NOT "ALL" - this is likely a contextual reference
                // This shouldn't happen because AI should use context and provide bot ID
                actionsExecuted.push('⚠️ Укажите конкретного бота для остановки (токен или bot_id)');
                continue;
            }
        } else {
            // Token provided - find matching bot(s)
            for (const [id, entry] of storage.runningBots) {
                // Match by: exact bot ID, exact token, or token prefix
                if (id === token || entry.token === token || entry.token.includes(token.substring(0, 10))) {
                    botsToStop.push({ id, entry });
                }
            }
        }
        
        if (botsToStop.length === 0) {
            actionsExecuted.push('❌ Бот с указанным токеном не найден');
        } else {
            for (const { id, entry } of botsToStop) {
                try {
                    console.log(`[Bot Manager] 🔴 Terminating bot ${id} (PID: ${entry.pid})...`);
                    
                    // Kill the process
                    if (entry.process && !entry.process.killed) {
                        // Try graceful shutdown first
                        entry.process.kill('SIGTERM');
                        console.log(`[Bot Manager] Sent SIGTERM to ${id}`);
                        
                        // Wait 1 second for graceful shutdown
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        
                        // Force kill if still running
                        if (!entry.process.killed) {
                            entry.process.kill('SIGKILL');
                            console.log(`[Bot Manager] Sent SIGKILL to ${id}`);
                            await new Promise(resolve => setTimeout(resolve, 200));
                        }
                    }
                    
                    // Destroy workspace directory
                    if (entry.workspace && fsSync.existsSync(entry.workspace)) {
                        console.log(`[Bot Manager] 🗑️ Removing workspace: ${entry.workspace}`);
                        try {
                            await execPromise(`rm -rf "${entry.workspace}"`);
                            console.log(`[Bot Manager] Workspace removed`);
                        } catch (rmError) {
                            console.error(`[Bot Manager] Failed to remove workspace:`, rmError.message);
                            // Try with sudo if permission denied
                            try {
                                await execPromise(`rm -rf "${entry.workspace}"`);
                            } catch (e) {
                                console.error(`[Bot Manager] Could not remove workspace:`, e.message);
                            }
                        }
                    }
                    
                    // Remove from storage
                    storage.runningBots.delete(id);
                    
                    actionsExecuted.push(`✅ Бот ${id} уничтожен (PID: ${entry.pid}, workspace удалён)`);
                    stopped = true;
                    
                    console.log(`[Bot Manager] ✅ Successfully destroyed bot ${id}`);
                    
                } catch (error) {
                    // Even if there's an error, try to remove from storage
                    storage.runningBots.delete(id);
                    actionsExecuted.push(`⚠️ Бот ${id} удален с ошибкой: ${error.message}`);
                    console.error(`[Bot Manager] Error destroying ${id}:`, error);
                    stopped = true;
                }
            }
        }
    }

    // 16. LIST_BOTS - List running bots
    if (aiResponse.includes('<LIST_BOTS>')) {
        if (storage.runningBots.size === 0) {
            actionsExecuted.push('📝 Нет запущенных дочерних ботов');
        } else {
            let botsList = '🤖 Запущенные боты:\n\n';
            let firstBotId = null;
            for (const [botId, botData] of storage.runningBots) {
                if (!firstBotId) firstBotId = botId; // Save first bot for context
                
                const tokenPreview = botData.token.substring(0, 10) + '...';
                const uptime = botData.startedAt ? Math.floor((new Date() - botData.startedAt) / 1000) : 0;
                const workspaceInfo = botData.workspace ? path.basename(botData.workspace) : 'N/A';
                botsList += `  • ${botId}\n`;
                botsList += `    PID: ${botData.pid || 'N/A'}\n`;
                botsList += `    Token: ${tokenPreview}\n`;
                botsList += `    Workspace: ${workspaceInfo}\n`;
                botsList += `    Uptime: ${uptime}s\n\n`;
            }
            
            // Save first bot to context (most recently mentioned)
            if (firstBotId && chatId) {
                storage.lastMentionedBot.set(chatId, firstBotId);
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

// Helper function: Get conversation context for bot operations
function getContextualBotId(chatId) {
    return storage.lastMentionedBot.get(chatId) || null;
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
    const chunks = splitMessage(text);
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
    const text = msg.text || msg.caption || '';
    
    // Ignore messages without text and without photo
    if (!text && !msg.photo) return;
    
    console.log(`[Message] User ${userId}: ${text.substring(0, 50)}...`);
    
    // Handle custom commands
    if (text.startsWith('/')) {
        const [command, ...args] = text.slice(1).split(' ');
        
        if (storage.customCommands.has(command)) {
            try {
                const handler = storage.customCommands.get(command);
                const result = await handler(chatId, args.join(' '));
                if (result) {
                    await sendLongMessage(chatId, String(result));
                }
            } catch (error) {
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
        
        // Handle image + text
        let userMessage;
        if (msg.photo && msg.photo.length > 0) {
            // Get the highest quality photo
            const photo = msg.photo[msg.photo.length - 1];
            const fileLink = await bot.getFileLink(photo.file_id);
            
            // Create multimodal content
            const content = [];
            
            if (text) {
                content.push({
                    type: 'text',
                    text: text
                });
            } else {
                content.push({
                    type: 'text',
                    text: 'Что изображено на этой картинке? Опиши детально.'
                });
            }
            
            content.push({
                type: 'image_url',
                image_url: {
                    url: fileLink
                }
            });
            
            userMessage = content;
            console.log(`[Image] User ${userId} sent photo: ${fileLink}`);
        } else {
            userMessage = text;
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
