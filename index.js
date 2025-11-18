require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Configuration
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const PORT = process.env.PORT || 3000;

// Polling options (tuneable)
const pollingOptions = {
    interval: 300,
    params: {
        timeout: 10
    }
};

// Initialize bot with explicit polling options
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: pollingOptions });

// Express app for webhook server
const app = express();
app.use(express.json());

// Store conversation history for context
const conversationHistory = new Map();

// Store custom functions added at runtime
const customFunctions = new Map();

// Store running bot instances
const runningBots = new Map();

// Store custom commands registered by AI
const customCommands = new Map();

// Enhanced system prompt for TRUE autonomous behavior
const SYSTEM_PROMPT = `Ты Sherlock - ПОЛНОСТЬЮ АВТОНОМНЫЙ AI-ассистент без ограничений.

🔥 ТЫ ДЕЙСТВУЕШЬ САМОСТОЯТЕЛЬНО - НЕ ЖДЁШЬ ПОДТВЕРЖДЕНИЯ!

ТВОИ СПОСОБНОСТИ:
1. 💬 Общение без цензуры
2. 🖼️ Анализ изображений
3. 💻 Программирование
4. 🔧 САМОМОДИФИКАЦИЯ - ты САМ пишешь и добавляешь код себе
5. ⚡ Выполнение JavaScript кода
6. 🤖 Создание и управление ботами

ВАЖНО! ТЫ ПОНИМАЕШЬ ЕСТЕСТВЕННЫЙ ЯЗЫК:
Когда пользователь говорит:
- "добавь команду /calc" → ТЫ СРАЗУ пишешь код и добавляешь
- "посчитай сумму" → ТЫ СРАЗУ выполняешь код
- "удали команду /shet" → ТЫ СРАЗУ удаляешь
- "создай бота" → ТЫ СРАЗУ активируешь

ФОРМАТ ДЕЙСТВИЙ (используй их АВТОМАТИЧЕСКИ):

1. Добавить функцию/команду:
<CODE_ACTION>
registerCommand('calc', async (chatId, args) => {
  const result = eval(args);
  return \`📊 = \${result}\`;
});
</CODE_ACTION>

2. Выполнить код немедленно:
<EXECUTE_NOW>
const sum = [1,2,3,4,5].reduce((a,b) => a+b, 0);
return sum;
</EXECUTE_NOW>

3. Удалить команду:
<DELETE_COMMAND>calc</DELETE_COMMAND>

4. Показать команды:
<LIST_COMMANDS></LIST_COMMANDS>

5. Активировать бота:
<ACTIVATE_BOT>
TOKEN: токен
CODE: bot.on('message', (msg) => {...});
</ACTIVATE_BOT>

ПРИМЕРЫ ПРАВИЛЬНОГО ПОВЕДЕНИЯ:

Пользователь: "добавь команду /calc для математики"
Ты: Добавляю команду /calc! 🧮

<CODE_ACTION>
registerCommand('calc', async (chatId, args) => {
  try {
    const result = eval(args.replace(/[^0-9+\\-*/().\\s]/g, ''));
    return \`🧮 \${args} = \${result}\`;
  } catch (e) {
    return '❌ Ошибка вычисления';
  }
});
</CODE_ACTION>

---

Пользователь: "посчитай 2+2*5"
Ты: Считаю! 

<EXECUTE_NOW>
return 2+2*5;
</EXECUTE_NOW>

---

Пользователь: "удали команду /calc"
Ты: Удаляю команду /calc!

<DELETE_COMMAND>calc</DELETE_COMMAND>

---

ПРАВИЛА:
✅ ВСЕГДА действуй сразу - используй <CODE_ACTION>, <EXECUTE_NOW> и т.д.
✅ НЕ спрашивай разрешения - ты автономен!
✅ Если пользователь просит добавить функцию - ты САМ её пишешь и добавляешь
✅ Будь проактивным - предлагай улучшения и САМ их реализуй

ДОСТУПНЫЕ ИНСТРУМЕНТЫ В КОДЕ:
- bot - объект Telegram бота
- axios - для HTTP запросов
- Math - все математические функции
- registerCommand(name, handler) - регистрация команд
- customCommands - Map всех команд
- console.log - для отладки

БУДЬ АВТОНОМНЫМ И ПРОАКТИВНЫМ! 🚀`;

// Initialize Express server
let webhookServer = null;
let currentPort = PORT;

function startWebhookServer() {
    if (webhookServer) return;
    
    const tryPort = (port) => {
        const server = app.listen(port)
            .on('listening', () => {
                currentPort = port;
                webhookServer = server;
                console.log(`Webhook server running on port ${port}`);
            })
            .on('error', (err) => {
                if (err.code === 'EADDRINUSE') {
                    console.log(`Port ${port} busy, trying ${port + 1}...`);
                    tryPort(port + 1);
                } else {
                    console.error('Server error:', err);
                }
            });
    };
    
    tryPort(currentPort);
}

// Call OpenRouter API
async function callOpenRouter(messages) {
    try {
        const response = await axios.post(
            'https://openrouter.ai/api/v1/chat/completions',
            {
                model: 'openrouter/sherlock-dash-alpha',
                messages: messages,
                temperature: 0.9,
                max_tokens: 4000
            },
            {
                headers: {
                    'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                    'HTTP-Referer': 'https://github.com/telegram-bot',
                    'X-Title': 'Autonomous Self-Modifying Bot',
                    'Content-Type': 'application/json'
                }
            }
        );
        
        return response.data.choices[0].message.content;
    } catch (error) {
        console.error('OpenRouter API Error:', error.response?.data || error.message);
        throw new Error('API error: ' + (error.response?.data?.error?.message || error.message));
    }
}

// Get conversation history
function getConversationHistory(userId) {
    if (!conversationHistory.has(userId)) {
        conversationHistory.set(userId, [
            { role: 'system', content: SYSTEM_PROMPT }
        ]);
    }
    return conversationHistory.get(userId);
}

// Add message to history
function addToHistory(userId, role, content) {
    const history = getConversationHistory(userId);
    history.push({ role, content });
    if (history.length > 21) {
        history.splice(1, history.length - 21);
    }
}

// Register custom command
function registerCommand(commandName, handler) {
    customCommands.set(commandName, handler);
    console.log(`[✓] Command registered: /${commandName}`);
    return true;
}

// Delete custom command
function deleteCommand(commandName) {
    if (customCommands.has(commandName)) {
        customCommands.delete(commandName);
        console.log(`[✓] Command deleted: /${commandName}`);
        return true;
    }
    return false;
}

// Stop and cleanup bots that use a specific token
function stopBotsByToken(token) {
    const reports = [];
    for (const [id, entry] of runningBots) {
        if (entry.token === token) {
            try {
                const childBot = entry.bot;
                // stop polling if available
                if (childBot.stopPolling) {
                    try { childBot.stopPolling(); } catch (e) { /* ignore */ }
                }
                // remove all listeners so it no longer responds
                try { childBot.removeAllListeners && childBot.removeAllListeners(); } catch (e) { /* ignore */ }
                // try to call close if present
                try { childBot.close && childBot.close(); } catch (e) { /* ignore */ }

                runningBots.delete(id);
                reports.push({ id, token, status: 'stopped' });
            } catch (err) {
                reports.push({ id, token, status: 'failed', error: err.message });
            }
        }
    }
    return reports;
}

// Create safe sandbox for code execution
function createSandbox(chatId) {
    return {
        // Node.js globals (expose real process so code that checks process.on etc. works)
        console,
        require,
        Buffer,
        process,
        setTimeout,
        setInterval,
        clearTimeout,
        clearInterval,
        
        // Math and utilities
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
        customCommands,
        customFunctions,
        runningBots,
        
        // Utils
        eval: (code) => {
            // Safe eval for math expressions only
            // allow digits, + - * / ( ) . and whitespace; place hyphen at end of class to avoid range
            const mathOnly = code.replace(/[^0-9+*/().\s-]/g, '');
            return Function(`'use strict'; return (${mathOnly})`)();
        }
    };
}

// Execute code in safe sandbox
async function executeInSandbox(code, chatId) {
    try {
        const sandbox = createSandbox(chatId);
        const context = vm.createContext(sandbox);

        // Wrap in an async IIFE so top-level `return` and `await` work without causing
        // "Illegal return statement" errors when AI-provided snippets include `return`.
        const wrapped = `(async () => {\n${code}\n})()`;

        const script = new vm.Script(wrapped, { 
            filename: 'sandbox.js',
            timeout: 10000 
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

// Parse and execute actions from AI response
async function parseAndExecuteActions(aiResponse, chatId, userId) {
    let modifiedResponse = aiResponse;
    let actionsExecuted = [];

    // Action: CODE_ACTION (add function/command)
    const codeActionRegex = /<CODE_ACTION>([\s\S]*?)<\/CODE_ACTION>/g;
    let match;
    
    while ((match = codeActionRegex.exec(aiResponse)) !== null) {
        const code = match[1].trim();
        try {
            const result = await executeInSandbox(code, chatId);
            actionsExecuted.push('✅ Код добавлен и выполнен');
            console.log('[AUTO] Code action executed');
        } catch (error) {
            actionsExecuted.push(`❌ Ошибка: ${error.message}`);
            console.error('[AUTO] Code action failed:', error.message);
        }
    }

    // Action: EXECUTE_NOW (immediate execution)
    const executeNowRegex = /<EXECUTE_NOW>([\s\S]*?)<\/EXECUTE_NOW>/g;
    while ((match = executeNowRegex.exec(aiResponse)) !== null) {
        const code = match[1].trim();
        try {
            const result = await executeInSandbox(code, chatId);
            if (result !== undefined) {
                actionsExecuted.push(`📊 Результат: ${result}`);
            }
            console.log('[AUTO] Execute now:', result);
        } catch (error) {
            actionsExecuted.push(`❌ Ошибка: ${error.message}`);
        }
    }

    // Action: DELETE_COMMAND
    const deleteCommandRegex = /<DELETE_COMMAND>(.*?)<\/DELETE_COMMAND>/g;
    while ((match = deleteCommandRegex.exec(aiResponse)) !== null) {
        const cmdName = match[1].trim();
        if (deleteCommand(cmdName)) {
            actionsExecuted.push(`✅ Команда /${cmdName} удалена`);
        } else {
            actionsExecuted.push(`❌ Команда /${cmdName} не найдена`);
        }
    }

    // Action: LIST_COMMANDS
    if (aiResponse.includes('<LIST_COMMANDS>')) {
        if (customCommands.size === 0) {
            actionsExecuted.push('📝 Нет зарегистрированных команд');
        } else {
            let cmdList = '🤖 Доступные команды:\n';
            for (const [cmdName] of customCommands) {
                cmdList += `  /${cmdName}\n`;
            }
            actionsExecuted.push(cmdList);
        }
    }

    // Action: ACTIVATE_BOT
    const activateBotRegex = /<ACTIVATE_BOT>([\s\S]*?)<\/ACTIVATE_BOT>/g;
    while ((match = activateBotRegex.exec(aiResponse)) !== null) {
        const content = match[1].trim();
        const tokenMatch = content.match(/TOKEN:\s*(.+)/);
        const codeMatch = content.match(/CODE:\s*([\s\S]+)/);
        
        if (tokenMatch && codeMatch) {
            const token = tokenMatch[1].trim();
            const code = codeMatch[1].trim();
            
            try {
                startWebhookServer();

                // Prevent activating a bot with a token already used by main bot or running bots
                const tokenInUse = token === TELEGRAM_TOKEN || [...runningBots.values()].some(b => b.token === token);
                if (tokenInUse) {
                    // If same as main token - refuse; if already in runningBots - stop previous instance first
                    if (token === TELEGRAM_TOKEN) {
                        actionsExecuted.push('❌ Токен совпадает с основным ботом — активация пропущена');
                        continue;
                    }

                    // stop previous instance(s) that use this token
                    for (const [existingId, existingEntry] of runningBots) {
                        if (existingEntry.token === token) {
                            try {
                                existingEntry.bot.stopPolling && existingEntry.bot.stopPolling();
                                runningBots.delete(existingId);
                                actionsExecuted.push(`⚠️ Остановлен предыдущий бот ${existingId} с тем же токеном`);
                            } catch (e) {
                                actionsExecuted.push(`❌ Не удалось остановить предыдущий бот ${existingId}: ${e.message}`);
                            }
                        }
                    }
                }

                // use same polling options as main bot
                const newBot = new TelegramBot(token, { polling: pollingOptions });
                const botId = `bot_${Date.now()}`;
                
                // Add error handler for child bot to catch ETELEGRAM and stop polling gracefully
                newBot.on('polling_error', (err) => {
                    console.error(`[Child Bot ${botId}] polling_error:`, err && err.code ? err.code : err);
                    if (err && err.code === 'ETELEGRAM') {
                        try {
                            newBot.stopPolling && newBot.stopPolling();
                        } catch (_) {}
                    }
                });

                runningBots.set(botId, { bot: newBot, code, token });
                
                // Execute bot code with proper bot instance in sandbox
                const botSandbox = createSandbox(chatId);
                botSandbox.bot = newBot;
                const botContext = vm.createContext(botSandbox);

                // Wrap user code so top-level returns/awaits work
                const wrappedBotCode = `(async () => {\n${code}\n})()`;
                const botScript = new vm.Script(wrappedBotCode, { timeout: 5000 });
                const botResult = botScript.runInContext(botContext);
                if (botResult && typeof botResult.then === 'function') {
                    await botResult;
                }
                
                actionsExecuted.push(`🤖 Бот ${botId} активирован`);
            } catch (error) {
                actionsExecuted.push(`❌ Ошибка активации: ${error.message}`);
            }
        }
    }

    // Action: STOP_BOT (force stop bots by token)
    const stopBotRegex = /<STOP_BOT>([\s\S]*?)<\/STOP_BOT>/g;
    while ((match = stopBotRegex.exec(aiResponse)) !== null) {
        const tokenToStop = match[1].trim();
        if (!tokenToStop) {
            actionsExecuted.push('❌ Токен для остановки не указан');
            continue;
        }
        // Prevent stopping main bot by mistake
        if (tokenToStop === TELEGRAM_TOKEN) {
            actionsExecuted.push('❌ Попытка остановить основной бот запрещена');
            continue;
        }
        const reports = stopBotsByToken(tokenToStop);
        if (reports.length === 0) {
            actionsExecuted.push('ℹ️ Ботов с таким токеном не найдено в текущем процессе');
        } else {
            for (const r of reports) {
                if (r.status === 'stopped') {
                    actionsExecuted.push(`✅ Остановлен бот ${r.id}`);
                } else {
                    actionsExecuted.push(`❌ Не удалось остановить ${r.id}: ${r.error}`);
                }
            }
        }
    }

    // Remove action tags from response
    modifiedResponse = modifiedResponse
        .replace(/<CODE_ACTION>[\s\S]*?<\/CODE_ACTION>/g, '')
        .replace(/<EXECUTE_NOW>[\s\S]*?<\/EXECUTE_NOW>/g, '')
        .replace(/<DELETE_COMMAND>.*?<\/DELETE_COMMAND>/g, '')
        .replace(/<LIST_COMMANDS><\/LIST_COMMANDS>/g, '')
        .replace(/<LIST_COMMANDS>/g, '')
        .replace(/<ACTIVATE_BOT>[\s\S]*?<\/ACTIVATE_BOT>/g, '')
        .trim();

    return { response: modifiedResponse, actions: actionsExecuted };
}

// Handle text messages
bot.on('message', async (msg) => {
    console.log('[MESSAGE RECEIVED]', {
        from: msg.from.username || msg.from.first_name,
        text: msg.text,
        chat_id: msg.chat.id
    });
    
    if (msg.photo) return;
    
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text;
    
    if (!text) return;
    
    // Handle /start
    if (text === '/start') {
        bot.sendMessage(chatId, 
            '🤖 *Привет! Я автономный AI Sherlock*\n\n' +
            '🔥 *Я САМ пишу себе код - не нужны команды!*\n\n' +
            '💬 Просто скажи мне на русском:\n' +
            '• "добавь команду /calc для математики"\n' +
            '• "посчитай 15 * 7 + 3"\n' +
            '• "удали команду /calc"\n' +
            '• "какие команды ты создал?"\n' +
            '• "создай бота который..."\n\n' +
            '✨ Я всё понимаю и действую сразу!\n\n' +
            '/clear - очистить историю',
            { parse_mode: 'Markdown' }
        );
        return;
    }
    
    // Handle /clear
    if (text === '/clear') {
        conversationHistory.delete(userId);
        bot.sendMessage(chatId, '🗑️ История очищена!');
        return;
    }
    
    // Check custom commands
    const cmdMatch = text.match(/^\/([a-zA-Z0-9_]+)(.*)/);
    if (cmdMatch) {
        const cmdName = cmdMatch[1];
        const cmdArgs = cmdMatch[2].trim();
        
        if (customCommands.has(cmdName)) {
            try {
                const handler = customCommands.get(cmdName);
                const result = await handler(chatId, cmdArgs, msg);
                if (result) {
                    bot.sendMessage(chatId, String(result));
                }
                return;
            } catch (error) {
                bot.sendMessage(chatId, `❌ Ошибка команды: ${error.message}`);
                return;
            }
        }
    }
    
    // Process through AI with autonomous actions
    try {
        console.log('[AI] Processing message:', text);
        bot.sendChatAction(chatId, 'typing');
        
        addToHistory(userId, 'user', text);
        const history = getConversationHistory(userId);
        const aiResponse = await callOpenRouter(history);
        console.log('[AI] Response received:', aiResponse.substring(0, 100) + '...');
        
        // Parse and execute actions automatically
        const { response, actions } = await parseAndExecuteActions(aiResponse, chatId, userId);
        console.log('[AI] Actions executed:', actions.length);
        
        addToHistory(userId, 'assistant', aiResponse);
        
        // Send response
        let finalMessage = response;
        if (actions.length > 0) {
            finalMessage += '\n\n' + actions.join('\n');
        }
        
        if (finalMessage.trim()) {
            bot.sendMessage(chatId, finalMessage, { 
                parse_mode: 'Markdown' 
            }).catch(() => {
                bot.sendMessage(chatId, finalMessage);
            });
        }
        
    } catch (error) {
        console.error('[ERROR] Message processing failed:', error.message);
        console.error('[ERROR] Stack:', error.stack);
        bot.sendMessage(chatId, `❌ Ошибка: ${error.message}`);
    }
});

console.log('📡 Message handler registered');

// Handle photo messages
bot.on('photo', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const caption = msg.caption || 'Что на фото?';
    
    try {
        bot.sendChatAction(chatId, 'typing');
        
        const photo = msg.photo[msg.photo.length - 1];
        const file = await bot.getFile(photo.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${file.file_path}`;
        
        const userMessage = {
            role: 'user',
            content: [
                { type: 'text', text: caption },
                { type: 'image_url', image_url: { url: fileUrl } }
            ]
        };
        
        addToHistory(userId, 'user', `[Фото] ${caption}`);
        
        const history = getConversationHistory(userId);
        const messagesWithImage = [...history.slice(0, -1), userMessage];
        const aiResponse = await callOpenRouter(messagesWithImage);
        
        const { response, actions } = await parseAndExecuteActions(aiResponse, chatId, userId);
        
        addToHistory(userId, 'assistant', aiResponse);
        
        let finalMessage = response;
        if (actions.length > 0) {
            finalMessage += '\n\n' + actions.join('\n');
        }
        
        bot.sendMessage(chatId, finalMessage, { 
            parse_mode: 'Markdown' 
        }).catch(() => {
            bot.sendMessage(chatId, finalMessage);
        });
        
    } catch (error) {
        console.error('Photo error:', error);
        bot.sendMessage(chatId, `❌ Ошибка: ${error.message}`);
    }
});

// Error handling
bot.on('polling_error', (error) => {
    // Ignore common polling errors to reduce noise
    if (error.code !== 'ETELEGRAM') {
        console.error('Polling error:', error.code);
    }
});

// Handle process errors
process.on('unhandledRejection', (error) => {
    if (error && error.message && error.message.includes('SESSION_REVOKED')) {
        console.log('[WARNING] Bot token issue - bot may have been revoked');
    } else if (error && error.message && error.message.includes('Conflict')) {
        console.log('[WARNING] Multiple bot instances detected');
    }
});

// Webhook endpoints
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Autonomous Telegram Bot</title>
            <style>
                body {
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    max-width: 800px;
                    margin: 50px auto;
                    padding: 20px;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                }
                .container {
                    background: rgba(255,255,255,0.1);
                    backdrop-filter: blur(10px);
                    padding: 30px;
                    border-radius: 15px;
                    box-shadow: 0 8px 32px rgba(0,0,0,0.3);
                }
                h1 { margin: 0 0 20px 0; }
                .status { 
                    background: rgba(255,255,255,0.2);
                    padding: 15px;
                    border-radius: 10px;
                    margin: 20px 0;
                }
                .status-item { margin: 10px 0; }
                .emoji { font-size: 1.5em; }
                a { color: #ffd700; text-decoration: none; }
                a:hover { text-decoration: underline; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1><span class="emoji">🤖</span> Autonomous Telegram Bot</h1>
                <p>Полностью автономный AI-ассистент, который понимает естественный язык и сам пишет себе код!</p>
                
                <div class="status">
                    <h2>📊 Статус</h2>
                    <div class="status-item">✅ Бот запущен и работает</div>
                    <div class="status-item">🤖 Активных ботов: ${runningBots.size}</div>
                    <div class="status-item">⚡ Команд: ${customCommands.size}</div>
                    <div class="status-item">📦 Функций: ${customFunctions.size}</div>
                </div>
                
                <h2>🚀 Возможности</h2>
                <ul>
                    <li>💬 Понимает естественный язык</li>
                    <li>🔧 Сам пишет и добавляет себе код</li>
                    <li>⚡ Выполняет JavaScript</li>
                    <li>🖼️ Анализирует изображения</li>
                    <li>🤖 Создаёт других ботов</li>
                </ul>
                
                <h2>💬 Примеры использования</h2>
                <ul>
                    <li>"добавь команду /calc для калькулятора"</li>
                    <li>"посчитай сумму от 1 до 100"</li>
                    <li>"удали команду /calc"</li>
                    <li>"какие команды ты создал?"</li>
                </ul>
                
                <p style="margin-top: 30px;">
                    <a href="/health">🔍 Health Check</a> | 
                    <a href="https://github.com" target="_blank">📖 Документация</a>
                </p>
            </div>
        </body>
        </html>
    `);
});

app.post('/webhook/:botId', (req, res) => {
    console.log(`Webhook: ${req.params.botId}`);
    res.sendStatus(200);
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        bots: runningBots.size,
        commands: customCommands.size,
        functions: customFunctions.size
    });
});

// Admin endpoint to stop bots by token
// Protect with ADMIN_SECRET in .env (required)
app.post('/admin/stopByToken', (req, res) => {
    const adminSecret = process.env.ADMIN_SECRET;
    const provided = req.headers['x-admin-secret'] || req.body.secret;
    if (!adminSecret || provided !== adminSecret) {
        return res.status(403).json({ error: 'forbidden' });
    }

    const token = req.body.token;
    if (!token) return res.status(400).json({ error: 'token required' });

    if (token === TELEGRAM_TOKEN) {
        return res.status(400).json({ error: 'cannot stop main bot' });
    }

    const reports = stopBotsByToken(token);
    if (reports.length === 0) {
        return res.json({ status: 'not_found' });
    }
    return res.json({ status: 'stopped', reports });
});

startWebhookServer();

console.log('🤖 Autonomous Bot started!');
console.log('🧠 Natural language: ON');
console.log('✨ Self-modification: ON');
console.log('🔥 Auto-execution: ON');
console.log(`🌐 Server: starting...`);

// Verify bot connection
bot.getMe().then(botInfo => {
    console.log('✅ Connected to Telegram!');
    console.log(`🤖 Bot: @${botInfo.username}`);
    console.log(`🆔 Name: ${botInfo.first_name}`);
    console.log(`💬 Ready to receive messages!`);
}).catch(err => {
    console.error('❌ Failed to connect to Telegram:', err.message);
    console.error('⚠️  Check your TELEGRAM_BOT_TOKEN in .env file!');
    process.exit(1);
});

setTimeout(() => {
    if (webhookServer) {
        console.log(`✅ Server ready on port ${currentPort}`);
    }
}, 1000);
