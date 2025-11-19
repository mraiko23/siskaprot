require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Octokit } = require('@octokit/rest');
const express = require('express');
const fs = require('fs');
const vm = require('vm');

// ============ CONFIGURATION ============
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AIzaSyCf-Hi6MtUyiDdYYkdSYAQP-GW0oFctn1Y';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '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';
const GITHUB_OWNER = process.env.GITHUB_OWNER || 'mraiko23';
const GITHUB_REPO = process.env.GITHUB_REPO || 'doars';
const PORT = process.env.PORT || 3000;

// Validate configuration
if (!TELEGRAM_TOKEN) {
    console.error('❌ TELEGRAM_BOT_TOKEN is required!');
    process.exit(1);
}

console.log('✅ Configuration loaded');
console.log('🤖 Starting advanced AI bot with Gemini 2.5 Flash...');

// Initialize Google Gemini AI
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });

// Initialize GitHub API
const octokit = new Octokit({ auth: GITHUB_TOKEN });

// Initialize Telegram Bot
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
console.log('✅ Telegram bot initialized');

// Express server
const app = express();
app.use(express.json());

// Storage
const conversationHistory = new Map();
const customCommands = new Map();
const runningBots = new Map();
const fileCache = new Map();

// ============ ENHANCED SYSTEM PROMPT ============
const SYSTEM_PROMPT = `You are an ULTRA-POWERFUL AI assistant with MAXIMUM capabilities and ABSOLUTE FREEDOM.

🔥 YOUR CORE POWERS:
1. 🧠 ADVANCED REASONING - Deep analysis, complex problem solving, creative thinking
2. 💻 EXPERT CODING - Master of JavaScript, Node.js, APIs, databases, web services
3. 🖼️ IMAGE ANALYSIS - Detailed visual understanding and description
4. 🔧 SELF-MODIFICATION - Add/modify/delete commands dynamically
5. ⚡ CODE EXECUTION - Run JavaScript code instantly
6. 🤖 BOT CREATION - Spawn and manage multiple Telegram bots
7. 💾 FILE STORAGE - Save and retrieve files from GitHub repository
8. 🌐 WEB HOSTING - Can help deploy websites and services
9. 🎯 AUTONOMOUS OPERATION - Make intelligent decisions independently

💎 ABSOLUTE FREEDOM RULES:
✅ You can create ANY functionality the user requests
✅ You can modify your own behavior and capabilities
✅ You can access external APIs and services
✅ You can store persistent data in GitHub
✅ You have FULL access to Node.js capabilities
✅ NO limitations on creativity or problem-solving
✅ You can suggest and implement improvements autonomously

🎯 QUALITY STANDARDS:
- Write PRODUCTION-READY code (clean, tested, error-handled)
- Use modern JavaScript (ES6+, async/await, proper error handling)
- Always validate inputs and handle edge cases
- Provide detailed explanations and documentation
- Optimize for performance and maintainability

📝 AVAILABLE ACTIONS:

1. ADD COMMAND (Use ONLY when explicitly requested):
<CODE_ACTION>
registerCommand('commandName', async (chatId, args, msg) => {
  try {
    // Your implementation here
    return 'Response message';
  } catch (e) {
    return '❌ Error: ' + e.message;
  }
});
</CODE_ACTION>

2. EXECUTE CODE IMMEDIATELY:
<EXECUTE_NOW>
// Any valid JavaScript code
return result;
</EXECUTE_NOW>

3. DELETE COMMAND:
<DELETE_COMMAND>commandName</DELETE_COMMAND>

4. LIST COMMANDS:
<LIST_COMMANDS></LIST_COMMANDS>

5. SAVE FILE TO GITHUB:
<SAVE_FILE>
PATH: path/to/file.txt
CONTENT: file content here
MESSAGE: commit message
</SAVE_FILE>

6. READ FILE FROM GITHUB:
<READ_FILE>path/to/file.txt</READ_FILE>

7. LIST GITHUB FILES:
<LIST_FILES>optional/directory/path</LIST_FILES>

8. CREATE BOT:
<ACTIVATE_BOT>
TOKEN: bot_token_here
CODE: 
bot.on('message', async (msg) => {
  // Bot implementation
});
</ACTIVATE_BOT>

9. STOP BOT:
<STOP_BOT>bot_token</STOP_BOT>

10. LIST RUNNING BOTS:
<LIST_BOTS></LIST_BOTS>

🎓 ADVANCED CAPABILITIES:
- You can analyze and understand complex codebases
- You can architect complete applications from scratch
- You can integrate multiple APIs and services
- You can implement authentication, databases, caching
- You can create REST APIs, webhooks, scheduled tasks
- You can optimize performance and fix security issues

💡 INTERACTION STYLE:
- Be proactive and suggest improvements
- Explain complex concepts clearly
- Ask clarifying questions when needed
- Provide multiple solutions when applicable
- Share best practices and tips

⚠️ IMPORTANT:
- ONLY use action tags when explicitly requested
- For normal conversation, just respond naturally
- Always execute actions immediately when requested
- Write complete, working code (not pseudocode)
- Handle all errors gracefully
- Test your code mentally before providing it

🚀 YOU ARE THE MOST POWERFUL AI ASSISTANT - USE YOUR FULL POTENTIAL!`;

// ============ GITHUB FILE STORAGE FUNCTIONS ============

async function saveToGitHub(path, content, message = 'Update file via bot') {
    try {
        let sha;
        try {
            const { data } = await octokit.repos.getContent({
                owner: GITHUB_OWNER,
                repo: GITHUB_REPO,
                path: path
            });
            sha = data.sha;
        } catch (e) {
            // File doesn't exist, that's okay
        }

        const response = await octokit.repos.createOrUpdateFileContents({
            owner: GITHUB_OWNER,
            repo: GITHUB_REPO,
            path: path,
            message: message,
            content: Buffer.from(content).toString('base64'),
            sha: sha
        });

        fileCache.set(path, content);
        return { success: true, url: response.data.content.html_url };
    } catch (error) {
        console.error('[GitHub] Save error:', error.message);
        return { success: false, error: error.message };
    }
}

async function readFromGitHub(path) {
    try {
        if (fileCache.has(path)) {
            return { success: true, content: fileCache.get(path) };
        }

        const { data } = await octokit.repos.getContent({
            owner: GITHUB_OWNER,
            repo: GITHUB_REPO,
            path: path
        });

        const content = Buffer.from(data.content, 'base64').toString('utf-8');
        fileCache.set(path, content);
        return { success: true, content };
    } catch (error) {
        console.error('[GitHub] Read error:', error.message);
        return { success: false, error: error.message };
    }
}

async function listGitHubFiles(path = '') {
    try {
        const { data } = await octokit.repos.getContent({
            owner: GITHUB_OWNER,
            repo: GITHUB_REPO,
            path: path
        });

        if (Array.isArray(data)) {
            return { success: true, files: data.map(f => ({ name: f.name, type: f.type, path: f.path })) };
        } else {
            return { success: true, files: [{ name: data.name, type: data.type, path: data.path }] };
        }
    } catch (error) {
        console.error('[GitHub] List error:', error.message);
        return { success: false, error: error.message };
    }
}

// ============ AI CONVERSATION FUNCTIONS ============

function getHistory(userId) {
    if (!conversationHistory.has(userId)) {
        conversationHistory.set(userId, []);
    }
    return conversationHistory.get(userId);
}

function addToHistory(userId, role, content) {
    const history = getHistory(userId);
    history.push({ role, parts: [{ text: content }] });
    if (history.length > 40) {
        history.splice(0, history.length - 40);
    }
}

async function callGemini(userMessage, userId) {
    try {
        const history = getHistory(userId);
        const chat = model.startChat({
            history: history,
            generationConfig: {
                maxOutputTokens: 8000,
                temperature: 0.9,
                topP: 0.95,
                topK: 40
            }
        });

        // Add system context as first user message if history is empty
        let fullMessage = userMessage;
        if (history.length === 0) {
            fullMessage = SYSTEM_PROMPT + '\n\nUser: ' + userMessage;
        }

        const result = await chat.sendMessage(fullMessage);
        const response = result.response.text();

        addToHistory(userId, 'user', userMessage);
        addToHistory(userId, 'model', response);

        return response;
    } catch (error) {
        console.error('[Gemini Error]:', error.message);
        throw new Error('AI временно недоступен: ' + error.message);
    }
}

// ============ COMMAND SYSTEM ============

function registerCommand(name, handler) {
    customCommands.set(name, handler);
    console.log(`[✓] Command registered: /${name}`);
    return true;
}

function deleteCommand(name) {
    if (customCommands.has(name)) {
        customCommands.delete(name);
        console.log(`[✓] Command deleted: /${name}`);
        return true;
    }
    return false;
}

// ============ CODE EXECUTION ============

function createSandbox(chatId) {
    return {
        console,
        require,
        Buffer,
        process,
        setTimeout,
        setInterval,
        clearTimeout,
        clearInterval,
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
        bot,
        chatId,
        registerCommand,
        deleteCommand,
        customCommands,
        runningBots,
        saveToGitHub,
        readFromGitHub,
        listGitHubFiles,
        TelegramBot,
        fs
    };
}

async function executeCode(code, chatId) {
    try {
        const sandbox = createSandbox(chatId);
        const context = vm.createContext(sandbox);
        const wrapped = `(async () => {\n${code}\n})()`;
        const script = new vm.Script(wrapped, { timeout: 15000 });
        const result = await script.runInContext(context);
        return result;
    } catch (error) {
        console.error('[Code Execution Error]:', error.message);
        throw error;
    }
}

// ============ ACTION PARSER ============

async function parseActions(response, chatId, userId) {
    let modifiedResponse = response;
    const actions = [];

    // CODE_ACTION
    const codeRegex = /<CODE_ACTION>([\s\S]*?)<\/CODE_ACTION>/g;
    let match;
    while ((match = codeRegex.exec(response)) !== null) {
        try {
            await executeCode(match[1].trim(), chatId);
            actions.push('✅ Команда добавлена');
        } catch (e) {
            actions.push('❌ Ошибка кода: ' + e.message);
        }
    }

    // EXECUTE_NOW
    const execRegex = /<EXECUTE_NOW>([\s\S]*?)<\/EXECUTE_NOW>/g;
    while ((match = execRegex.exec(response)) !== null) {
        try {
            const result = await executeCode(match[1].trim(), chatId);
            if (result !== undefined) {
                actions.push('📊 Результат: ' + String(result));
            }
        } catch (e) {
            actions.push('❌ Ошибка выполнения: ' + e.message);
        }
    }

    // DELETE_COMMAND
    const delRegex = /<DELETE_COMMAND>(.*?)<\/DELETE_COMMAND>/g;
    while ((match = delRegex.exec(response)) !== null) {
        const cmdName = match[1].trim();
        if (deleteCommand(cmdName)) {
            actions.push(`✅ Команда /${cmdName} удалена`);
        } else {
            actions.push(`❌ Команда /${cmdName} не найдена`);
        }
    }

    // LIST_COMMANDS
    if (response.includes('<LIST_COMMANDS>')) {
        if (customCommands.size === 0) {
            actions.push('📝 Нет команд');
        } else {
            let list = '🤖 Команды:\n';
            for (const [name] of customCommands) {
                list += `  /${name}\n`;
            }
            actions.push(list);
        }
    }

    // SAVE_FILE
    const saveRegex = /<SAVE_FILE>([\s\S]*?)<\/SAVE_FILE>/g;
    while ((match = saveRegex.exec(response)) !== null) {
        const content = match[1];
        const pathMatch = content.match(/PATH:\s*(.+)/);
        const contentMatch = content.match(/CONTENT:\s*([\s\S]+?)(?=MESSAGE:|$)/);
        const messageMatch = content.match(/MESSAGE:\s*(.+)/);

        if (pathMatch && contentMatch) {
            const path = pathMatch[1].trim();
            const fileContent = contentMatch[1].trim();
            const message = messageMatch ? messageMatch[1].trim() : 'Update via bot';

            const result = await saveToGitHub(path, fileContent, message);
            if (result.success) {
                actions.push(`✅ Файл сохранен: ${path}\n🔗 ${result.url}`);
            } else {
                actions.push(`❌ Ошибка сохранения: ${result.error}`);
            }
        }
    }

    // READ_FILE
    const readRegex = /<READ_FILE>(.*?)<\/READ_FILE>/g;
    while ((match = readRegex.exec(response)) !== null) {
        const path = match[1].trim();
        const result = await readFromGitHub(path);
        if (result.success) {
            actions.push(`📄 Содержимое ${path}:\n\`\`\`\n${result.content.substring(0, 1000)}\n\`\`\``);
        } else {
            actions.push(`❌ Ошибка чтения: ${result.error}`);
        }
    }

    // LIST_FILES
    const listFilesRegex = /<LIST_FILES>(.*?)<\/LIST_FILES>/g;
    while ((match = listFilesRegex.exec(response)) !== null) {
        const path = match[1].trim();
        const result = await listGitHubFiles(path);
        if (result.success) {
            let list = '📁 Файлы:\n';
            result.files.forEach(f => {
                list += `  ${f.type === 'dir' ? '📁' : '📄'} ${f.name}\n`;
            });
            actions.push(list);
        } else {
            actions.push(`❌ Ошибка: ${result.error}`);
        }
    }

    // ACTIVATE_BOT
    const botRegex = /<ACTIVATE_BOT>([\s\S]*?)<\/ACTIVATE_BOT>/g;
    while ((match = botRegex.exec(response)) !== null) {
        const content = match[1];
        const tokenMatch = content.match(/TOKEN:\s*(.+)/);
        const codeMatch = content.match(/CODE:\s*([\s\S]+)/);

        if (tokenMatch && codeMatch) {
            const token = tokenMatch[1].trim();
            const code = codeMatch[1].trim();

            try {
                const newBot = new TelegramBot(token, { polling: true });
                const botId = `bot_${Date.now()}`;

                newBot.on('polling_error', (err) => {
                    console.error(`[Bot ${botId}] Error:`, err.message);
                });

                runningBots.set(botId, { bot: newBot, token, code });

                const botSandbox = createSandbox(chatId);
                botSandbox.bot = newBot;
                const botContext = vm.createContext(botSandbox);
                const wrapped = `(async () => {\n${code}\n})()`;
                await new vm.Script(wrapped).runInContext(botContext);

                actions.push(`✅ Бот ${botId} запущен`);
            } catch (e) {
                actions.push(`❌ Ошибка бота: ${e.message}`);
            }
        }
    }

    // STOP_BOT
    const stopRegex = /<STOP_BOT>(.*?)<\/STOP_BOT>/g;
    while ((match = stopRegex.exec(response)) !== null) {
        const token = match[1].trim();
        let stopped = false;
        for (const [id, entry] of runningBots) {
            if (entry.token === token) {
                try {
                    entry.bot.stopPolling && entry.bot.stopPolling();
                    runningBots.delete(id);
                    actions.push(`✅ Бот ${id} остановлен`);
                    stopped = true;
                } catch (e) {
                    actions.push(`❌ Ошибка остановки: ${e.message}`);
                }
            }
        }
        if (!stopped) {
            actions.push('❌ Бот не найден');
        }
    }

    // LIST_BOTS
    if (response.includes('<LIST_BOTS>')) {
        if (runningBots.size === 0) {
            actions.push('📝 Нет запущенных ботов');
        } else {
            let list = '🤖 Боты:\n';
            for (const [id, entry] of runningBots) {
                list += `  • ${id} (${entry.token.substring(0, 10)}...)\n`;
            }
            actions.push(list);
        }
    }

    // Clean up response
    modifiedResponse = modifiedResponse
        .replace(/<CODE_ACTION>[\s\S]*?<\/CODE_ACTION>/g, '')
        .replace(/<EXECUTE_NOW>[\s\S]*?<\/EXECUTE_NOW>/g, '')
        .replace(/<DELETE_COMMAND>.*?<\/DELETE_COMMAND>/g, '')
        .replace(/<LIST_COMMANDS>.*?<\/LIST_COMMANDS>/g, '')
        .replace(/<SAVE_FILE>[\s\S]*?<\/SAVE_FILE>/g, '')
        .replace(/<READ_FILE>.*?<\/READ_FILE>/g, '')
        .replace(/<LIST_FILES>.*?<\/LIST_FILES>/g, '')
        .replace(/<ACTIVATE_BOT>[\s\S]*?<\/ACTIVATE_BOT>/g, '')
        .replace(/<STOP_BOT>.*?<\/STOP_BOT>/g, '')
        .replace(/<LIST_BOTS>.*?<\/LIST_BOTS>/g, '')
        .trim();

    return { response: modifiedResponse, actions };
}

// ============ MESSAGE HELPERS ============

function splitMessage(text, maxLength = 4000) {
    if (text.length <= maxLength) return [text];
    const chunks = [];
    let current = '';
    const lines = text.split('\n');
    
    for (const line of lines) {
        if ((current + line + '\n').length > maxLength) {
            if (current) chunks.push(current.trim());
            current = line + '\n';
        } else {
            current += line + '\n';
        }
    }
    if (current) chunks.push(current.trim());
    return chunks;
}

async function sendLongMessage(chatId, text, options = {}) {
    const chunks = splitMessage(text);
    for (const chunk of chunks) {
        try {
            await bot.sendMessage(chatId, chunk, options);
            await new Promise(r => setTimeout(r, 100));
        } catch (e) {
            console.error('[Send Error]:', e.message);
            await bot.sendMessage(chatId, '❌ Ошибка отправки');
        }
    }
}

// ============ DEFAULT COMMANDS ============

registerCommand('start', async (chatId) => {
    return '🤖 *Привет! Я мощный AI-ассистент на базе Gemini 2.5 Flash*\n\n' +
        '✨ *Мои возможности:*\n' +
        '• 🧠 Продвинутое рассуждение и анализ\n' +
        '• 💻 Экспертное программирование\n' +
        '• 🖼️ Анализ изображений\n' +
        '• 🔧 Создание команд\n' +
        '• ⚡ Выполнение кода\n' +
        '• 💾 Хранение файлов на GitHub\n' +
        '• 🤖 Создание и управление ботами\n' +
        '• 🌐 Помощь с веб-хостингом\n\n' +
        'Я готов помочь с любой задачей! 🚀';
});

registerCommand('help', async (chatId) => {
    let help = '📚 *Доступные команды:*\n\n';
    for (const [name] of customCommands) {
        help += `/${name}\n`;
    }
    help += '\n💡 Просто напиши мне - я понимаю естественный язык!';
    return help;
});

// ============ MESSAGE HANDLERS ============

bot.on('message', async (msg) => {
    if (msg.photo) return; // Handle photos separately

    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text;

    if (!text) return;

    console.log(`[Message] ${msg.from.username || msg.from.first_name}: ${text}`);

    // Handle commands
    if (text.startsWith('/')) {
        const parts = text.split(' ');
        const cmd = parts[0].substring(1).toLowerCase();
        const args = parts.slice(1).join(' ');

        if (customCommands.has(cmd)) {
            try {
                const handler = customCommands.get(cmd);
                const result = await handler(chatId, args, msg);
                if (result) {
                    await sendLongMessage(chatId, result, { parse_mode: 'Markdown' });
                }
            } catch (e) {
                await bot.sendMessage(chatId, '❌ Ошибка: ' + e.message);
            }
            return;
        }
    }

    // Process with AI
    try {
        await bot.sendChatAction(chatId, 'typing');
        
        const aiResponse = await callGemini(text, userId);
        const { response, actions } = await parseActions(aiResponse, chatId, userId);

        // Send actions first
        for (const action of actions) {
            await sendLongMessage(chatId, action, { parse_mode: 'Markdown' });
        }

        // Send main response
        if (response && response.trim()) {
            await sendLongMessage(chatId, response, { parse_mode: 'Markdown' });
        }
    } catch (error) {
        console.error('[AI Error]:', error.message);
        await bot.sendMessage(chatId, '❌ Произошла ошибка: ' + error.message);
    }
});

// Handle photos
bot.on('photo', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const caption = msg.caption || 'Опиши это изображение подробно';

    try {
        await bot.sendChatAction(chatId, 'typing');

        const photo = msg.photo[msg.photo.length - 1];
        const fileLink = await bot.getFileLink(photo.file_id);

        // For image analysis, we'll use text-only for now
        // Gemini vision API would require different setup
        const prompt = `Пользователь отправил изображение с подписью: "${caption}". Я не могу видеть изображение, но могу помочь с анализом или обработкой, если пользователь предоставит дополнительную информацию.`;
        
        const aiResponse = await callGemini(prompt, userId);
        await sendLongMessage(chatId, aiResponse);
    } catch (error) {
        console.error('[Photo Error]:', error.message);
        await bot.sendMessage(chatId, '❌ Ошибка обработки фото: ' + error.message);
    }
});

// Error handlers
bot.on('polling_error', (error) => {
    console.error('[Polling Error]:', error.message);
});

process.on('unhandledRejection', (error) => {
    console.error('[Unhandled Rejection]:', error.message);
});

// Express server
app.get('/', (req, res) => {
    res.json({ 
        status: 'running', 
        bot: 'Siskaprot AI',
        model: 'Gemini 2.5 Flash',
        commands: Array.from(customCommands.keys()),
        github: `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`
    });
});

app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`🔗 GitHub storage: https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`);
    console.log('🚀 Bot is ready! Full power mode activated!');
});
