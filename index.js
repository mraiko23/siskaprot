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

ТВОИ СПОСОБНОСТИ:
1. 💬 Общение без цензуры
2. 🖼️ АНАЛИЗ ИЗОБРАЖЕНИЙ С ДЕТАЛЬНЫМ ОПИСАНИЕМ - ты видишь все детали, цвета, объекты, текст, эмоции, композицию
3. 💻 Программирование
4. 🔧 САМОМОДИФИКАЦИЯ - ты САМ пишешь и добавляешь код себе (ТОЛЬКО ПО ЗАПРОСУ!)
5. ⚡ Выполнение JavaScript кода
6. 🤖 Создание и управление ботами

ОСОБЕННОСТИ АНАЛИЗА ИЗОБРАЖЕНИЙ:
- Описывай МАКСИМАЛЬНО ПОДРОБНО: все объекты, их расположение, цвета, текстуры
- Читай ВЕСЬ текст на изображении, если есть
- Анализируй контекст, настроение, стиль
- Отвечай на русском языке естественно и развернуто

ВАЖНО! ТЫ ПОНИМАЕШЬ ЕСТЕСТВЕННЫЙ ЯЗЫК:
Когда пользователь ЯВНО просит:
- "добавь команду /calc" → ТЫ СРАЗУ пишешь код и добавляешь
- "посчитай сумму" → ТЫ СРАЗУ выполняешь код
- "удали команду /shet" → ТЫ СРАЗУ удаляешь
- "создай бота" → ТЫ СРАЗУ активируешь

⚠️ НЕ ДОБАВЛЯЙ КОМАНДЫ АВТОМАТИЧЕСКИ! Только если пользователь ЯВНО просит добавить команду!

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

6. Остановить бота (по токену):
<STOP_BOT>токен_бота</STOP_BOT>

7. Показать запущенные боты:
<LIST_BOTS></LIST_BOTS>

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

Пользователь: "какая сегодня дата?" или "скажи текущее время"
Ты: Сейчас узнаю! 📅

<EXECUTE_NOW>
const now = new Date();
const date = now.toLocaleDateString('ru-RU');
const time = now.toLocaleTimeString('ru-RU');
return '📅 ' + date + ' ⏰ ' + time;
</EXECUTE_NOW>

---

ПРАВИЛА:
✅ Действуй сразу ТОЛЬКО когда пользователь ЯВНО просит добавить команду/функцию
✅ Для обычного общения - просто отвечай, НЕ используй <CODE_ACTION>
✅ Для математических вычислений по запросу - используй <EXECUTE_NOW>
✅ НЕ предлагай команды без запроса - это раздражает!
✅ При анализе изображений - давай максимально детальное описание
✅ ФОКУС НА ОБЩЕНИИ, а не на добавлении кода везде

🚫 СТРОГО ЗАПРЕЩЕНО:
❌ НЕ ПРИДУМЫВАЙ результаты действий! Используй ТОЛЬКО теги <CODE_ACTION>, <EXECUTE_NOW>, <DELETE_COMMAND>
❌ НЕ пиши "Бот выключен" или "Команда удалена" БЕЗ использования соответствующих тегов
❌ НИКОГДА не генерируй фейковые успешные сообщения
❌ Если команда не существует - честно скажи что её нет, НЕ придумывай что ты её выключил
❌ Если пользователь просит выключить/удалить несуществующую команду - скажи "Команда не найдена"
❌ НЕ используй русские комментарии или текст внутри кода в <EXECUTE_NOW> - ТОЛЬКО JavaScript!
❌ НЕ пиши код с синтаксическими ошибками - проверяй перед отправкой!

✅ ПРАВИЛЬНО: использовать <DELETE_COMMAND>имя</DELETE_COMMAND> и система сама выполнит
❌ НЕПРАВИЛЬНО: просто написать "✅ Команда удалена" без тега

✅ ПРАВИЛЬНО: <EXECUTE_NOW>new Date().toLocaleDateString('ru-RU')</EXECUTE_NOW>
❌ НЕПРАВИЛЬНО: <EXECUTE_NOW>текущая дата</EXECUTE_NOW> или русский текст в коде

ДОСТУПНЫЕ ИНСТРУМЕНТЫ В КОДЕ:
- bot - объект Telegram бота
- axios - для HTTP запросов
- Math - все математические функции
- Date - для работы с датой и временем
- registerCommand(name, handler) - регистрация команд
- deleteCommand(name) - удаление команды
- customCommands - Map всех команд
- runningBots - Map активных дочерних ботов
- Array, String, Object, Number - стандартные JS объекты
- console.log - для отладки

ПРАВИЛА НАПИСАНИЯ КОДА В <EXECUTE_NOW>:
✅ ТОЛЬКО чистый JavaScript код - без русских комментариев!
✅ Используй return для возврата результата
✅ Для даты: new Date().toLocaleDateString('ru-RU')
✅ Для времени: new Date().toLocaleTimeString('ru-RU')
✅ Математика: Math.sqrt(), Math.pow() и т.д.
❌ НЕ используй русский текст внутри <EXECUTE_NOW> (только в строках результата)

ЧЕСТНОСТЬ ПРЕВЫШЕ ВСЕГО! НЕ ВРИ О РЕЗУЛЬТАТАХ! 🎯`;

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

// Helper to send command results (supports string or {text, options})
async function sendCommandResult(chatId, result) {
    if (!result) return;
    if (typeof result === 'string') {
        await bot.sendMessage(chatId, result);
        return;
    }
    if (typeof result === 'object' && result !== null) {
        const text = result.text || '';
        const options = result.options || result;
        await bot.sendMessage(chatId, text, options);
        return;
    }
    await bot.sendMessage(chatId, String(result));
}

// Register default /start command if none provided
if (!customCommands.has('start')) {
    registerCommand('start', async (chatId) => {
        const keyboard = [
            [{ text: '📚 Меню команд', callback_data: 'menu_commands' }]
        ];
        return {
            text: '🤖 *Привет! Я AI-ассистент Sherlock*\n\n' +
                '🖼️ Я умею подробно анализировать изображения!\n' +
                '💻 Могу создавать команды по запросу\n' +
                '🧮 Выполняю вычисления\n\n' +
                'Нажми кнопку ниже для просмотра команд.',
            options: {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            }
        };
    });
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

// Extract code from free-form AI text (supports fenced blocks and <code> tags)
function extractCodeFromText(text) {
    if (!text || typeof text !== 'string') return '';

    // 1) Triple-backtick fenced block
    const fenceMatch = text.match(/```(?:[a-zA-Z]+)?\n([\s\S]*?)```/);
    if (fenceMatch) return fenceMatch[1].trim();

    // 2) HTML/code tag
    const htmlMatch = text.match(/<code>([\s\S]*?)<\/code>/i);
    if (htmlMatch) return htmlMatch[1].trim();

    // 3) If the string looks like code (contains braces or semicolons), return it
    if (/[{};=()<>]/.test(text)) return text.trim();

    return '';
}

// Basic sanitization attempts for AI-provided code
function sanitizeCode(code) {
    if (!code || typeof code !== 'string') return code;
    // normalize smart quotes and dashes, remove CR
    let out = code.replace(/[“”«»„”]/g, '"')
                  .replace(/[‘’]/g, "'")
                  .replace(/\u2013|\u2014/g, '-')
                  .replace(/\r/g, '');
    // Trim trailing non-ASCII commentary lines that often appear in AI outputs
    return out;
}

// Remove lines that contain non-ASCII letters (useful to strip accidental Russian text)
function removeNonAsciiLines(code) {
    return code.split('\n').filter(line => {
        // keep if line contains common JS tokens or is ASCII-only
        if (/^[\x00-\x7F]*$/.test(line)) return true;
        // allow lines that contain obvious JS characters even if they include non-ascii
        return /[{}();=]/.test(line);
    }).join('\n');
}

// Try to recover code: validate with vm.Script; on failure attempt simple fixes
function tryRecoverCode(rawCode) {
    const attempts = [];
    let code = sanitizeCode(rawCode);
    attempts.push({ reason: 'sanitized', code });

    try {
        new vm.Script(code);
        return { ok: true, code, attempts };
    } catch (e) {
        attempts.push({ reason: 'initial parse failed', error: e.message });
    }

    // Attempt: remove non-ascii lines
    const asciiStripped = removeNonAsciiLines(code);
    attempts.push({ reason: 'ascii-stripped', code: asciiStripped });
    try {
        new vm.Script(asciiStripped);
        return { ok: true, code: asciiStripped, attempts };
    } catch (e) {
        attempts.push({ reason: 'ascii-strip failed', error: e.message });
    }

    // Last resort: extract only lines that look like JS statements
    const jsLike = asciiStripped.split('\n').filter(l => /[a-zA-Z0-9_$]+\s*(=|\(|=>|function|\.)/.test(l)).join('\n');
    attempts.push({ reason: 'js-like-lines', code: jsLike });
    try {
        new vm.Script(jsLike);
        return { ok: true, code: jsLike, attempts };
    } catch (e) {
        attempts.push({ reason: 'js-like failed', error: e.message });
    }

    return { ok: false, attempts };
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

// Auto-fix common code issues
function autoFixCommonIssues(code) {
    if (!code || typeof code !== 'string') return code;
    
    // Remove Russian text that's not in strings
    let fixed = code;
    
    // Common date/time patterns - convert to proper code
    const lowerCode = code.toLowerCase();
    
    // If it looks like a date/time request with Russian text
    if (/дата|время|date|time|сейчас|текущ/i.test(code) && !code.includes('Date')) {
        // Replace with proper date code
        return "const now = new Date(); return `📅 ${now.toLocaleDateString('ru-RU')} ⏰ ${now.toLocaleTimeString('ru-RU')}`;"
    }
    
    // Try to fix common patterns
    fixed = fixed.replace(/текущая дата/gi, "new Date().toLocaleDateString('ru-RU')");
    fixed = fixed.replace(/текущее время/gi, "new Date().toLocaleTimeString('ru-RU')");
    fixed = fixed.replace(/сегодня/gi, "new Date().toLocaleDateString('ru-RU')");
    
    return fixed;
}

// Fallback execution for common requests when code fails
function tryFallbackExecution(originalCode) {
    if (!originalCode) return null;
    
    const lowerCode = originalCode.toLowerCase();
    
    // Date/time requests
    if (/дата|date|сегодня|число/i.test(lowerCode) || /время|time|час|сейчас/i.test(lowerCode)) {
        const now = new Date();
        if (/время|time|час/i.test(lowerCode) && !/дата|date/i.test(lowerCode)) {
            return `⏰ ${now.toLocaleTimeString('ru-RU')}`;
        } else if (/дата|date|число|сегодня/i.test(lowerCode) && !/время|time/i.test(lowerCode)) {
            return `📅 ${now.toLocaleDateString('ru-RU')}`;
        } else {
            return `📅 ${now.toLocaleDateString('ru-RU')} ⏰ ${now.toLocaleTimeString('ru-RU')}`;
        }
    }
    
    // Simple math operations
    if (/^[0-9+\-*/().\s]+$/.test(originalCode.trim())) {
        try {
            const result = Function(`'use strict'; return (${originalCode.trim()})`)();
            return result;
        } catch (e) {
            return null;
        }
    }
    
    return null;
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
            // Try to extract and recover code before execution
            let codeToRun = code;
            const extracted = extractCodeFromText(codeToRun);
            if (extracted) codeToRun = extracted;
            const recovery = tryRecoverCode(codeToRun);
            if (!recovery.ok) {
                // Log error but don't show to user
                console.error('[AUTO] Code recovery failed:', recovery.attempts);
                console.error('[AUTO] Failed to add code:', code);
                continue;
            }
            const result = await executeInSandbox(recovery.code, chatId);
            actionsExecuted.push('✅ Команда добавлена');
            console.log('[AUTO] Code action executed');
        } catch (error) {
            // Log error but don't show to user
            console.error('[AUTO] Code action failed:', error.message);
            console.error('[AUTO] Failed code:', code);
        }
    }

    // Action: EXECUTE_NOW (immediate execution)
    const executeNowRegex = /<EXECUTE_NOW>([\s\S]*?)<\/EXECUTE_NOW>/g;
    while ((match = executeNowRegex.exec(aiResponse)) !== null) {
        const code = match[1].trim();
        try {
            // Preprocess and attempt recovery for execute-now snippets
            let codeToRun = code;
            const extracted = extractCodeFromText(codeToRun);
            if (extracted) codeToRun = extracted;
            
            // Auto-fix common issues for date/time requests
            const autoFixedCode = autoFixCommonIssues(codeToRun);
            
            const recovery = tryRecoverCode(autoFixedCode);
            if (!recovery.ok) {
                // Silently log error but don't show to user
                console.error('[AUTO] ExecuteNow recovery failed:', recovery.attempts);
                console.error('[AUTO] Original code:', code);
                // Try fallback for common requests
                const fallbackResult = tryFallbackExecution(code);
                if (fallbackResult !== null) {
                    actionsExecuted.push(`📊 Результат: ${fallbackResult}`);
                    console.log('[AUTO] Fallback execution succeeded:', fallbackResult);
                    continue;
                }
                // Skip silently - don't notify user about syntax errors
                continue;
            }
            const result = await executeInSandbox(recovery.code, chatId);
            if (result !== undefined) {
                actionsExecuted.push(`📊 Результат: ${result}`);
            }
            console.log('[AUTO] Execute now:', result);
        } catch (error) {
            // Log error but don't show to user
            console.error('[AUTO] Execution error:', error.message);
            console.error('[AUTO] Failed code:', code);
            // Try fallback
            const fallbackResult = tryFallbackExecution(code);
            if (fallbackResult !== null) {
                actionsExecuted.push(`📊 Результат: ${fallbackResult}`);
                console.log('[AUTO] Fallback after error:', fallbackResult);
            }
            // Otherwise skip silently
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

    // Action: LIST_BOTS
    if (aiResponse.includes('<LIST_BOTS>')) {
        if (runningBots.size === 0) {
            actionsExecuted.push('📝 Нет запущенных дочерних ботов');
        } else {
            let botsList = '🤖 Запущенные боты:\n';
            for (const [botId, botData] of runningBots) {
                const tokenPreview = botData.token.substring(0, 10) + '...';
                botsList += `  • ${botId} (токен: ${tokenPreview})\n`;
            }
            actionsExecuted.push(botsList);
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

                // Try to recover/validate code before running child bot code
                let codeToRun = code;
                const extracted = extractCodeFromText(codeToRun);
                if (extracted) codeToRun = extracted;
                const recovery = tryRecoverCode(codeToRun);
                if (!recovery.ok) {
                    throw new Error('Синтаксическая ошибка в коде активации дочернего бота. Попытки восстановления: ' + JSON.stringify(recovery.attempts.map(a=>a.reason)));
                }

                const wrappedBotCode = `(async () => {\n${recovery.code}\n})()`;
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
        .replace(/<LIST_BOTS><\/LIST_BOTS>/g, '')
        .replace(/<LIST_BOTS>/g, '')
        .replace(/<ACTIVATE_BOT>[\s\S]*?<\/ACTIVATE_BOT>/g, '')
        .replace(/<STOP_BOT>[\s\S]*?<\/STOP_BOT>/g, '')
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
    
    // Handle /start — if a custom /start command exists, call it; otherwise send default message
    if (text === '/start') {
        if (customCommands.has('start')) {
            try {
                const handler = customCommands.get('start');
                const result = await handler(chatId, '', msg);
                if (result) {
                    if (typeof result === 'string') {
                        await bot.sendMessage(chatId, result, { parse_mode: 'Markdown' });
                    } else if (result && typeof result === 'object') {
                        const textToSend = result.text || '';
                        const options = result.options || result;
                        await bot.sendMessage(chatId, textToSend, options);
                    } else {
                        await bot.sendMessage(chatId, String(result));
                    }
                }
            } catch (e) {
                console.error('[START HANDLER ERROR]', e);
                await bot.sendMessage(chatId, '❌ Ошибка в обработчике /start: ' + e.message);
            }
            return;
        }

        // Default /start behaviour
        bot.sendMessage(chatId, 
            '🤖 *Привет! Я AI-ассистент Sherlock*\n\n' +
            '💬 *Мои возможности:*\n' +
            '• 🖼️ Подробный анализ изображений (просто отправь фото!)\n' +
            '• 💻 Программирование и создание команд\n' +
            '• 🧮 Математические вычисления\n' +
            '• 🤖 Создание дополнительных ботов\n\n' +
            '💡 *Примеры:*\n' +
            '• "добавь команду /calc для математики"\n' +
            '• "посчитай 15 * 7 + 3"\n' +
            '• "удали команду /calc"\n' +
            '• "какие команды доступны?"\n' +
            '• Отправь картинку для анализа\n\n' +
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
                    try {
                        await sendCommandResult(chatId, result);
                    } catch (e) {
                        // fallback
                        await bot.sendMessage(chatId, String(result));
                    }
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
    const caption = msg.caption || 'Опиши подробно что на этой картинке: все объекты, цвета, текст, детали, контекст. Будь максимально подробным!';
    
    try {
        bot.sendChatAction(chatId, 'typing');
        
        const photo = msg.photo[msg.photo.length - 1];
        const file = await bot.getFile(photo.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${file.file_path}`;
        
        const userMessage = {
            role: 'user',
            content: [
                { 
                    type: 'text', 
                    text: `${caption}\n\nВАЖНО: Опиши максимально детально все, что видишь на изображении, включая текст, объекты, цвета, детали, атмосферу.` 
                },
                { 
                    type: 'image_url', 
                    image_url: { 
                        url: fileUrl,
                        detail: 'high'
                    } 
                }
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

// Handle callback queries for inline menus
bot.on('callback_query', async (query) => {
    try {
        const data = query.data;
        const chatId = query.message.chat.id;
        const msgId = query.message.message_id;

        if (data === 'menu_commands') {
            // build buttons for each command
            const buttons = [];
            for (const [name] of customCommands) {
                buttons.push([{ text: `/${name}`, callback_data: `run_cmd:${name}` }]);
            }
            // add back button
            buttons.push([{ text: '🔙 Назад', callback_data: 'menu_main' }]);
            const text = '📚 Доступные команды:';
            try {
                await bot.editMessageText(text, { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: buttons } });
            } catch (e) {
                await bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: buttons } });
            }
            await bot.answerCallbackQuery(query.id);
            return;
        }

        if (data === 'menu_main') {
            const keyboard = [[{ text: '📚 Меню команд', callback_data: 'menu_commands' }]];
            const text = '🤖 Главное меню';
            try {
                await bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } });
            } catch (e) {
                await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } });
            }
            await bot.answerCallbackQuery(query.id);
            return;
        }

        if (data && data.startsWith('run_cmd:')) {
            const cmd = data.split(':')[1];
            if (customCommands.has(cmd)) {
                try {
                    const res = await customCommands.get(cmd)(chatId, '', query);
                    await sendCommandResult(chatId, res);
                } catch (e) {
                    await bot.sendMessage(chatId, `❌ Ошибка выполнения /${cmd}: ${e.message}`);
                }
            } else {
                await bot.sendMessage(chatId, 'Команда не найдена');
            }
            await bot.answerCallbackQuery(query.id);
            return;
        }
    } catch (err) {
        console.error('Callback error:', err);
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
