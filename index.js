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
if (!CONFIG.GITHUB_TOKEN) {
    console.error('❌ Error: GITHUB_TOKEN is required for persistent storage!');
    console.error('💡 The bot now requires GitHub for all data storage.');
    process.exit(1);
}

console.log('✅ Configuration loaded');
console.log('🤖 Starting ULTRA-POWERED AI Bot with GitHub Storage...');

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
// 💾 TEMPORARY IN-MEMORY CACHE (ONLY FOR CONVERSATIONS)
// All other data is stored exclusively on GitHub
// ═══════════════════════════════════════════════════════════════════════════

const cache = {
    conversations: new Map(), // Only conversations kept in memory
    runningBots: new Map()    // Active bot instances (can't be serialized)
};

// ═══════════════════════════════════════════════════════════════════════════
// 🌐 GITHUB STORAGE SYSTEM - PRIMARY DATA STORAGE
// ═══════════════════════════════════════════════════════════════════════════

class GitHubStorage {
    constructor(token, repo) {
        this.token = token;
        this.repo = repo;
        this.baseUrl = 'https://api.github.com';
        this.enabled = !!token && token !== 'undefined';
        
        if (!this.enabled) {
            throw new Error('GitHub token is required! Set GITHUB_TOKEN in .env file');
        }
        
        this.headers = {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'Content-Type': 'application/json'
        };
        
        console.log(`[GitHub] ✅ Connected to repository: ${repo}`);
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
// 💾 GITHUB DATA MANAGER - Direct GitHub Operations
// ALL DATA STORED ON GITHUB - NO LOCAL STORAGE
// ═══════════════════════════════════════════════════════════════════════════

class GitHubDataManager {
    constructor(githubStorage) {
        this.github = githubStorage;
    }

    // ========== COMMANDS ==========
    async saveCommand(commandName, handlerString) {
        console.log(`[DataManager] 💾 Saving command: ${commandName}`);
        const commandsData = await this.getAllCommands();
        // Save in new format with enabled flag
        commandsData[commandName] = { handler: handlerString, enabled: true };
        const result = await this.github.saveFile(
            'bot-data/commands.json', 
            JSON.stringify(commandsData, null, 2), 
            `Add/update command: ${commandName}`
        );
        return result;
    }

    async deleteCommand(commandName) {
        console.log(`[DataManager] 🗑️ Deleting command: ${commandName}`);
        const commandsData = await this.getAllCommands();
        delete commandsData[commandName];
        const result = await this.github.saveFile(
            'bot-data/commands.json', 
            JSON.stringify(commandsData, null, 2), 
            `Delete command: ${commandName}`
        );
        return result;
    }

    async getCommand(commandName) {
        const commandsData = await this.getAllCommands();
        const command = commandsData[commandName];
        if (!command) return null;
        // Handle both old format (string) and new format (object)
        if (typeof command === 'string') {
            return command; // Old format
        }
        return command.handler; // New format
    }

    async disableCommand(commandName) {
        console.log(`[DataManager] 🔌 Disabling command: ${commandName}`);
        const commandsData = await this.getAllCommands();
        if (commandsData[commandName]) {
            // Convert to new format if needed
            if (typeof commandsData[commandName] === 'string') {
                commandsData[commandName] = { handler: commandsData[commandName], enabled: false };
            } else {
                commandsData[commandName].enabled = false;
            }
            const result = await this.github.saveFile(
                'bot-data/commands.json', 
                JSON.stringify(commandsData, null, 2), 
                `Disable command: ${commandName}`
            );
            return result;
        }
        return { success: false, error: 'Command not found' };
    }

    async enableCommand(commandName) {
        console.log(`[DataManager] ✅ Enabling command: ${commandName}`);
        const commandsData = await this.getAllCommands();
        if (commandsData[commandName]) {
            // Convert to new format if needed
            if (typeof commandsData[commandName] === 'string') {
                commandsData[commandName] = { handler: commandsData[commandName], enabled: true };
            } else {
                commandsData[commandName].enabled = true;
            }
            const result = await this.github.saveFile(
                'bot-data/commands.json', 
                JSON.stringify(commandsData, null, 2), 
                `Enable command: ${commandName}`
            );
            return result;
        }
        return { success: false, error: 'Command not found' };
    }

    async isCommandEnabled(commandName) {
        const commandsData = await this.getAllCommands();
        const command = commandsData[commandName];
        if (!command) return false;
        if (typeof command === 'string') return true; // Old format, enabled by default
        return command.enabled !== false; // New format
    }

    async getAllCommands() {
        const result = await this.github.loadFile('bot-data/commands.json');
        if (result.success) {
            return JSON.parse(result.content);
        }
        return {};
    }

    // ========== WEBSITES ==========
    async saveWebsite(routePath, code) {
        console.log(`[DataManager] 💾 Saving website: ${routePath}`);
        const websitesData = await this.getAllWebsites();
        // Save in new format with enabled flag
        websitesData[routePath] = { code: code, enabled: true };
        const result = await this.github.saveFile(
            'bot-data/websites.json', 
            JSON.stringify(websitesData, null, 2), 
            `Add/update website: ${routePath}`
        );
        return result;
    }

    async deleteWebsite(routePath) {
        console.log(`[DataManager] 🗑️ Deleting website: ${routePath}`);
        const websitesData = await this.getAllWebsites();
        delete websitesData[routePath];
        const result = await this.github.saveFile(
            'bot-data/websites.json', 
            JSON.stringify(websitesData, null, 2), 
            `Delete website: ${routePath}`
        );
        return result;
    }

    async getWebsite(routePath) {
        const websitesData = await this.getAllWebsites();
        const website = websitesData[routePath];
        if (!website) return null;
        // Handle both old format (string) and new format (object)
        if (typeof website === 'string') {
            return website; // Old format
        }
        return website.code; // New format
    }

    async getAllWebsites() {
        const result = await this.github.loadFile('bot-data/websites.json');
        if (result.success) {
            return JSON.parse(result.content);
        }
        return {};
    }

    async disableWebsite(routePath) {
        console.log(`[DataManager] 🔌 Disabling website: ${routePath}`);
        const websitesData = await this.getAllWebsites();
        if (websitesData[routePath]) {
            // Add disabled flag to the website data
            if (typeof websitesData[routePath] === 'string') {
                websitesData[routePath] = { code: websitesData[routePath], enabled: false };
            } else {
                websitesData[routePath].enabled = false;
            }
            const result = await this.github.saveFile(
                'bot-data/websites.json', 
                JSON.stringify(websitesData, null, 2), 
                `Disable website: ${routePath}`
            );
            return result;
        }
        return { success: false, error: 'Website not found' };
    }

    async enableWebsite(routePath) {
        console.log(`[DataManager] ✅ Enabling website: ${routePath}`);
        const websitesData = await this.getAllWebsites();
        if (websitesData[routePath]) {
            // Enable the website
            if (typeof websitesData[routePath] === 'string') {
                websitesData[routePath] = { code: websitesData[routePath], enabled: true };
            } else {
                websitesData[routePath].enabled = true;
            }
            const result = await this.github.saveFile(
                'bot-data/websites.json', 
                JSON.stringify(websitesData, null, 2), 
                `Enable website: ${routePath}`
            );
            return result;
        }
        return { success: false, error: 'Website not found' };
    }

    async isWebsiteEnabled(routePath) {
        const websitesData = await this.getAllWebsites();
        const website = websitesData[routePath];
        if (!website) return false;
        if (typeof website === 'string') return true; // Old format, enabled by default
        return website.enabled !== false; // New format
    }

    // ========== DATABASES ==========
    async saveDatabase(dbName, data) {
        console.log(`[DataManager] 💾 Saving database: ${dbName}`);
        const databasesData = await this.getAllDatabases();
        databasesData[dbName] = data;
        const result = await this.github.saveFile(
            'bot-data/databases.json', 
            JSON.stringify(databasesData, null, 2), 
            `Update database: ${dbName}`
        );
        return result;
    }

    async deleteDatabase(dbName) {
        console.log(`[DataManager] 🗑️ Deleting database: ${dbName}`);
        const databasesData = await this.getAllDatabases();
        delete databasesData[dbName];
        const result = await this.github.saveFile(
            'bot-data/databases.json', 
            JSON.stringify(databasesData, null, 2), 
            `Delete database: ${dbName}`
        );
        return result;
    }

    async getDatabase(dbName) {
        const databasesData = await this.getAllDatabases();
        return databasesData[dbName] || null;
    }

    async getAllDatabases() {
        const result = await this.github.loadFile('bot-data/databases.json');
        if (result.success) {
            return JSON.parse(result.content);
        }
        return {};
    }

    async setDatabaseValue(dbName, key, value) {
        const db = await this.getDatabase(dbName) || {};
        db[key] = value;
        return await this.saveDatabase(dbName, db);
    }

    async getDatabaseValue(dbName, key) {
        const db = await this.getDatabase(dbName);
        return db ? db[key] : null;
    }

    // ========== BOTS ==========
    async saveBot(botName, botData) {
        console.log(`[DataManager] 💾 Saving bot: ${botName}`);
        const botsData = await this.getAllBots();
        // Save bot with token, enabled flag, and code
        botsData[botName] = {
            token: botData.token,
            code: botData.code,
            enabled: botData.enabled !== false
        };
        const result = await this.github.saveFile(
            'bot-data/bots.json', 
            JSON.stringify(botsData, null, 2), 
            `Add/update bot: ${botName}`
        );
        return result;
    }

    async deleteBot(botName) {
        console.log(`[DataManager] 🗑️ Deleting bot: ${botName}`);
        const botsData = await this.getAllBots();
        delete botsData[botName];
        const result = await this.github.saveFile(
            'bot-data/bots.json', 
            JSON.stringify(botsData, null, 2), 
            `Delete bot: ${botName}`
        );
        return result;
    }

    async getBot(botName) {
        const botsData = await this.getAllBots();
        return botsData[botName] || null;
    }

    async getAllBots() {
        const result = await this.github.loadFile('bot-data/bots.json');
        if (result.success) {
            return JSON.parse(result.content);
        }
        return {};
    }

    async disableBot(botName) {
        console.log(`[DataManager] 🔌 Disabling bot: ${botName}`);
        const botsData = await this.getAllBots();
        if (botsData[botName]) {
            botsData[botName].enabled = false;
            const result = await this.github.saveFile(
                'bot-data/bots.json', 
                JSON.stringify(botsData, null, 2), 
                `Disable bot: ${botName}`
            );
            return result;
        }
        return { success: false, error: 'Bot not found' };
    }

    async enableBot(botName) {
        console.log(`[DataManager] ✅ Enabling bot: ${botName}`);
        const botsData = await this.getAllBots();
        if (botsData[botName]) {
            botsData[botName].enabled = true;
            const result = await this.github.saveFile(
                'bot-data/bots.json', 
                JSON.stringify(botsData, null, 2), 
                `Enable bot: ${botName}`
            );
            return result;
        }
        return { success: false, error: 'Bot not found' };
    }

    async isBotEnabled(botName) {
        const botsData = await this.getAllBots();
        const bot = botsData[botName];
        if (!bot) return false;
        return bot.enabled !== false;
    }

    // ========== SCRIPTS ==========
    async saveScript(scriptName, scriptData) {
        console.log(`[DataManager] 💾 Saving script: ${scriptName}`);
        const scriptsData = await this.getAllScripts();
        scriptsData[scriptName] = {
            code: scriptData.code,
            description: scriptData.description || '',
            enabled: scriptData.enabled !== false
        };
        const result = await this.github.saveFile(
            'bot-data/scripts.json', 
            JSON.stringify(scriptsData, null, 2), 
            `Add/update script: ${scriptName}`
        );
        return result;
    }

    async deleteScript(scriptName) {
        console.log(`[DataManager] 🗑️ Deleting script: ${scriptName}`);
        const scriptsData = await this.getAllScripts();
        delete scriptsData[scriptName];
        const result = await this.github.saveFile(
            'bot-data/scripts.json', 
            JSON.stringify(scriptsData, null, 2), 
            `Delete script: ${scriptName}`
        );
        return result;
    }

    async getScript(scriptName) {
        const scriptsData = await this.getAllScripts();
        return scriptsData[scriptName] || null;
    }

    async getAllScripts() {
        const result = await this.github.loadFile('bot-data/scripts.json');
        if (result.success) {
            return JSON.parse(result.content);
        }
        return {};
    }

    async disableScript(scriptName) {
        console.log(`[DataManager] 🔌 Disabling script: ${scriptName}`);
        const scriptsData = await this.getAllScripts();
        if (scriptsData[scriptName]) {
            scriptsData[scriptName].enabled = false;
            const result = await this.github.saveFile(
                'bot-data/scripts.json', 
                JSON.stringify(scriptsData, null, 2), 
                `Disable script: ${scriptName}`
            );
            return result;
        }
        return { success: false, error: 'Script not found' };
    }

    async enableScript(scriptName) {
        console.log(`[DataManager] ✅ Enabling script: ${scriptName}`);
        const scriptsData = await this.getAllScripts();
        if (scriptsData[scriptName]) {
            scriptsData[scriptName].enabled = true;
            const result = await this.github.saveFile(
                'bot-data/scripts.json', 
                JSON.stringify(scriptsData, null, 2), 
                `Enable script: ${scriptName}`
            );
            return result;
        }
        return { success: false, error: 'Script not found' };
    }

    async isScriptEnabled(scriptName) {
        const scriptsData = await this.getAllScripts();
        const script = scriptsData[scriptName];
        if (!script) return false;
        return script.enabled !== false;
    }

    // ========== INITIALIZATION ==========
    async initializeStorage() {
        console.log('[DataManager] 📂 Initializing GitHub storage...');
        
        // Ensure all data files exist
        const files = [
            { path: 'bot-data/commands.json', content: '{}' },
            { path: 'bot-data/websites.json', content: '{}' },
            { path: 'bot-data/databases.json', content: '{}' },
            { path: 'bot-data/bots.json', content: '{}' },
            { path: 'bot-data/scripts.json', content: '{}' }
        ];

        for (const file of files) {
            const result = await this.github.loadFile(file.path);
            if (!result.success) {
                console.log(`[DataManager] Creating ${file.path}...`);
                await this.github.saveFile(file.path, file.content, `Initialize ${file.path}`);
            }
        }

        console.log('[DataManager] ✅ GitHub storage initialized');
    }

    async loadAllDataToMemory() {
        console.log('[DataManager] 📥 Loading all data from GitHub...');

        // Load and restore commands
        const commandsData = await this.getAllCommands();
        let commandCount = 0;
        let disabledCommandCount = 0;
        for (const [name, commandData] of Object.entries(commandsData)) {
            try {
                // Handle both old format (string) and new format (object)
                let funcString, enabled;
                if (typeof commandData === 'string') {
                    funcString = commandData;
                    enabled = true; // Old format, enabled by default
                } else {
                    funcString = commandData.handler;
                    enabled = commandData.enabled !== false;
                }
                
                if (enabled) {
                    const func = eval(`(${funcString})`);
                    await registerCommandInMemory(name, func);
                    commandCount++;
                } else {
                    console.log(`[DataManager] ⏸️ Skipping disabled command: /${name}`);
                    disabledCommandCount++;
                }
            } catch (e) {
                console.error(`[DataManager] Failed to restore command ${name}:`, e.message);
            }
        }
        console.log(`[DataManager] ✅ Loaded ${commandCount} commands (${disabledCommandCount} disabled)`);

        // Load and restore websites
        const websitesData = await this.getAllWebsites();
        let websiteCount = 0;
        let disabledCount = 0;
        for (const [path, websiteData] of Object.entries(websitesData)) {
            try {
                // Handle both old format (string) and new format (object)
                let code, enabled;
                if (typeof websiteData === 'string') {
                    code = websiteData;
                    enabled = true; // Old format, enabled by default
                } else {
                    code = websiteData.code;
                    enabled = websiteData.enabled !== false;
                }
                
                if (enabled) {
                    await restoreWebsite(path, code);
                    websiteCount++;
                } else {
                    console.log(`[DataManager] ⏸️ Skipping disabled website: ${path}`);
                    disabledCount++;
                }
            } catch (e) {
                console.error(`[DataManager] Failed to restore website ${path}:`, e.message);
            }
        }
        console.log(`[DataManager] ✅ Loaded ${websiteCount} websites (${disabledCount} disabled)`);

        // Load and restore bots
        const botsData = await this.getAllBots();
        let botCount = 0;
        let disabledBotCount = 0;
        for (const [botName, botData] of Object.entries(botsData)) {
            try {
                if (botData.enabled !== false) {
                    await restoreBot(botName, botData.token, botData.code);
                    botCount++;
                } else {
                    console.log(`[DataManager] ⏸️ Skipping disabled bot: ${botName}`);
                    disabledBotCount++;
                }
            } catch (e) {
                console.error(`[DataManager] Failed to restore bot ${botName}:`, e.message);
            }
        }
        console.log(`[DataManager] ✅ Loaded ${botCount} bots (${disabledBotCount} disabled)`);

        console.log('[DataManager] 🎉 All data loaded from GitHub!');
    }
}

const dataManager = new GitHubDataManager(githubStorage);

// ═══════════════════════════════════════════════════════════════════════════
// 🔍 WEB SCRAPING & URL FETCHING
// ═══════════════════════════════════════════════════════════════════════════

async function fetchWebContent(url) {
    try {
        if (!url || typeof url !== 'string') {
            throw new Error('Invalid URL provided');
        }
        
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'https://' + url;
        }
        
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
        
        let text = String(response.data);
        text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
        text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
        
        const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i);
        const title = titleMatch ? titleMatch[1].trim() : 'Без заголовка';
        
        text = text.replace(/<[^>]+>/g, ' ');
        text = text.replace(/&nbsp;/g, ' ');
        text = text.replace(/&amp;/g, '&');
        text = text.replace(/&lt;/g, '<');
        text = text.replace(/&gt;/g, '>');
        text = text.replace(/&quot;/g, '"');
        text = text.replace(/&#39;/g, "'");
        text = text.replace(/\s+/g, ' ').trim();
        
        console.log(`[Fetch] Success: ${text.length} chars extracted`);
        
        return {
            success: true,
            title,
            content: text.substring(0, 5000),
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
        
        const searchUrl = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
        const response = await axios.get(searchUrl, {
            timeout: 30000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        const results = [];
        const html = response.data;
        
        const linkRegex = /<a[^>]+class="[^"]*result[^"]*"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
        const titleRegex = /<a[^>]*href="([^"]+)"[^>]*>\s*<span[^>]*>([^<]+)<\/span>/gi;
        const simpleRegex = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([^<]+(?:<[^>]+>[^<]*<\/[^>]+>)*[^<]*)<\/a>/gi;
        
        let match;
        const patterns = [linkRegex, titleRegex, simpleRegex];
        
        for (const pattern of patterns) {
            while ((match = pattern.exec(html)) !== null && results.length < maxResults) {
                const url = match[1].trim();
                const title = match[2].trim().replace(/<[^>]+>/g, '');
                
                if (url.startsWith('http') && !url.includes('duckduckgo.com') && 
                    !results.some(r => r.url === url)) {
                    results.push({ title, url });
                }
            }
        }
        
        console.log(`[Search] Found ${results.length} results`);
        return { 
            success: true, 
            results,
            query
        };
    } catch (error) {
        console.error(`[Search] Error:`, error.message);
        return { 
            success: false, 
            error: error.message,
            suggestion: 'Попробуйте использовать <FETCH_URL> для прямого чтения сайтов'
        };
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 🤖 AI INTEGRATION - OpenRouter
// ═══════════════════════════════════════════════════════════════════════════

async function callOpenRouter(messages, imageUrl = null) {
    try {
        const systemPrompt = {
            role: 'system',
            content: `Ты - SHERLOCK, мощнейший AI-ассистент с расширенными возможностями! 🚀

ВАЖНО: ВСЕ ДАННЫЕ ХРАНЯТСЯ НА GITHUB!
- Команды, сайты, базы данных - всё сохраняется в GitHub автоматически
- При создании команды/сайта/БД они СРАЗУ выгружаются на GitHub
- Внутренней памяти НЕТ (кроме текущего диалога)
- При перезапуске бота всё загружается с GitHub

🔥 Твои суперспособности:

1. 🔍 ИНТЕРНЕТ-ПОИСК
   <SEARCH>запрос</SEARCH> - найти информацию в интернете

2. 🌐 ЧТЕНИЕ ВЕБ-СТРАНИЦ
   <FETCH_URL>https://example.com</FETCH_URL> - прочитать содержимое сайта

3. 💻 СОЗДАНИЕ КОМАНД (автосохранение на GitHub!)
   <CODE_ACTION>
   registerCommand('имя', async (chatId, args) => {
       await bot.sendMessage(chatId, 'Ответ');
   });
   </CODE_ACTION>

4. 🚀 ХОСТИНГ САЙТОВ (автосохранение на GitHub!)
   <HOST_WEBSITE>
   PATH: /mysite
   CODE: app.get('/mysite', (req, res) => { res.send('<h1>Hello!</h1>'); });
   </HOST_WEBSITE>

5. 🗄️ БАЗЫ ДАННЫХ (автосохранение на GitHub!)
   <CREATE_DB>dbname</CREATE_DB>
   <DB_SET>
   DB: dbname
   KEY: mykey
   VALUE: myvalue
   </DB_SET>
   <DB_GET>
   DB: dbname
   KEY: mykey
   </DB_GET>

6. 🤖 СОЗДАНИЕ БОТОВ (автосохранение на GitHub!)
   <CREATE_BOT>
   NAME: mybotname
   TOKEN: 123456:ABCdef...
   CODE: const myBot = new TelegramBot(botToken, {polling: true}); myBot.on('message', (msg) => { myBot.sendMessage(msg.chat.id, 'Response'); }); setBotInstance(myBot);
   </CREATE_BOT>
   
   ⚠️ ВАЖНО: В конце CODE ОБЯЗАТЕЛЬНО добавь setBotInstance(экземпляр_бота) чтобы бот можно было остановить!

7. ☁️ GITHUB ОПЕРАЦИИ
   <GITHUB_SAVE>
   PATH: path/to/file.txt
   CONTENT: file content here
   </GITHUB_SAVE>
   <GITHUB_LOAD>path/to/file.txt</GITHUB_LOAD>

8. 🛠️ УПРАВЛЕНИЕ
   
   КОМАНДЫ:
   <LIST_COMMANDS> - список команд
   <DISABLE_COMMAND>cmdname</DISABLE_COMMAND> - ВЫКЛЮЧИТЬ команду (можно включить)
   <ENABLE_COMMAND>cmdname</ENABLE_COMMAND> - ВКЛЮЧИТЬ команду обратно
   <DELETE_COMMAND>cmdname</DELETE_COMMAND> - УДАЛИТЬ команду (безвозвратно)
   
   САЙТЫ:
   <LIST_WEBSITES> - список сайтов
   <DISABLE_WEBSITE>/path</DISABLE_WEBSITE> - ВЫКЛЮЧИТЬ сайт (можно включить)
   <ENABLE_WEBSITE>/path</ENABLE_WEBSITE> - ВКЛЮЧИТЬ сайт обратно
   <DELETE_WEBSITE>/path</DELETE_WEBSITE> - УДАЛИТЬ сайт (безвозвратно)
   
   БОТЫ:
   <LIST_BOTS> - список ботов
   <DISABLE_BOT>botname</DISABLE_BOT> - ВЫКЛЮЧИТЬ бота (можно включить)
   <ENABLE_BOT>botname</ENABLE_BOT> - ВКЛЮЧИТЬ бота обратно
   <DELETE_BOT>botname</DELETE_BOT> - УДАЛИТЬ бота (безвозвратно)
   
   БАЗЫ ДАННЫХ:
   <LIST_DATABASES> - список баз данных
   <DISABLE_DATABASE>dbname</DISABLE_DATABASE> - ВЫКЛЮЧИТЬ БД (можно включить)
   <ENABLE_DATABASE>dbname</ENABLE_DATABASE> - ВКЛЮЧИТЬ БД обратно
   <DELETE_DATABASE>dbname</DELETE_DATABASE> - УДАЛИТЬ БД (безвозвратно)
   
   СКРИПТЫ:
   <LIST_SCRIPTS> - список скриптов
   <DISABLE_SCRIPT>scriptname</DISABLE_SCRIPT> - ВЫКЛЮЧИТЬ скрипт (можно включить)
   <ENABLE_SCRIPT>scriptname</ENABLE_SCRIPT> - ВКЛЮЧИТЬ скрипт обратно
   <DELETE_SCRIPT>scriptname</DELETE_SCRIPT> - УДАЛИТЬ скрипт (безвозвратно)
   
   <EXPORT_ALL> - экспорт всех данных

⚠️ ВАЖНО: Различай действия!
   - "Выключи/отключи/останови/вырубить" = используй <DISABLE_WEBSITE> (сайт можно включить)
   - "Удали/убери навсегда/удалить полностью" = используй <DELETE_WEBSITE> (безвозвратно)
   - "Включи обратно/запусти снова/включи опять" = используй <ENABLE_WEBSITE>

Примеры управления сайтами:
   Пользователь: "выключи сайт /test" → <DISABLE_WEBSITE>/test</DISABLE_WEBSITE>
   Пользователь: "включи обратно сайт /test" → <ENABLE_WEBSITE>/test</ENABLE_WEBSITE>
   Пользователь: "удали сайт /old навсегда" → <DELETE_WEBSITE>/old</DELETE_WEBSITE>

Примеры управления ботами:
   Пользователь: "выключи бота mybot" → <DISABLE_BOT>mybot</DISABLE_BOT>
   Пользователь: "вырубить бота testbot" → <DISABLE_BOT>testbot</DISABLE_BOT>
   Пользователь: "включи обратно бота mybot" → <ENABLE_BOT>mybot</ENABLE_BOT>
   Пользователь: "удали бота oldbot" → <DELETE_BOT>oldbot</DELETE_BOT>

Примеры управления командами:
   Пользователь: "выключи команду /calc" → <DISABLE_COMMAND>calc</DISABLE_COMMAND>
   Пользователь: "включи команду /calc" → <ENABLE_COMMAND>calc</ENABLE_COMMAND>
   Пользователь: "удали команду /old" → <DELETE_COMMAND>old</DELETE_COMMAND>

Примеры управления базами данных:
   Пользователь: "выключи базу users" → <DISABLE_DATABASE>users</DISABLE_DATABASE>
   Пользователь: "включи базу users" → <ENABLE_DATABASE>users</ENABLE_DATABASE>
   Пользователь: "удали базу olddb" → <DELETE_DATABASE>olddb</DELETE_DATABASE>

Примеры работы со скриптами:
   Пользователь: "сохрани этот код как hello" → <SAVE_SCRIPT> NAME: hello, CODE: ...
   Пользователь: "запусти скрипт hello" → <RUN_SCRIPT>hello</RUN_SCRIPT>
   Пользователь: "выключи скрипт hello" → <DISABLE_SCRIPT>hello</DISABLE_SCRIPT>
   Пользователь: "запусти обратно hello" → <ENABLE_SCRIPT>hello</ENABLE_SCRIPT> + <RUN_SCRIPT>hello</RUN_SCRIPT>

🚫 НЕ СОЗДАВАЙ отдельные команды для включения/выключения - используй теги напрямую!

9. 💻 ВЫПОЛНЕНИЕ КОДА
   
   ОДНОРАЗОВОЕ выполнение:
   <EXECUTE_NOW>
   // любой JS код - выполнится один раз и НЕ сохранится
   </EXECUTE_NOW>
   
   СОХРАНИТЬ скрипт для повторного использования:
   <SAVE_SCRIPT>
   NAME: scriptname
   DESCRIPTION: Описание что делает
   CODE: console.log('Hello');
   </SAVE_SCRIPT>
   
   ЗАПУСТИТЬ сохраненный скрипт:
   <RUN_SCRIPT>scriptname</RUN_SCRIPT>

10. 📦 NPM ПАКЕТЫ
   <NPM_INSTALL>package-name</NPM_INSTALL>

📝 Важные правила:
- Всегда говори что данные сохранены на GitHub
- Объясняй что при перезапуске всё загрузится с GitHub
- Используй эмодзи для наглядности
- Будь дружелюбным и помогай пользователю
- Помни: локальной памяти нет, всё на GitHub!

⚠️ НЕ ИСПОЛЬЗУЙ ТЕГИ БЕЗ НЕОБХОДИМОСТИ:
- При простых приветствиях (привет, здравствуй, hi) - просто поздоровайся
- При вопросах о возможностях - расскажи о них БЕЗ тегов
- Используй теги ТОЛЬКО когда пользователь явно просит что-то сделать
- Не создавай базы данных, команды или сайты без явного запроса!

📸 ОБРАБОТКА ИЗОБРАЖЕНИЙ:
- Когда пользователь отправляет изображение, ты МОЖЕШЬ его видеть и анализировать
- Детально описывай что видишь на изображении
- Отвечай на вопросы об изображении
- Если изображение с подписью - связывай подпись с содержимым`
        };

        // Prepare messages array
        let messagesArray = [systemPrompt, ...messages];
        
        // If there's an image, add it to the last user message
        if (imageUrl) {
            console.log('[AI] Adding image to request');
            // Find the last user message and add image
            const lastUserMsgIndex = messagesArray.length - 1;
            if (messagesArray[lastUserMsgIndex].role === 'user') {
                messagesArray[lastUserMsgIndex] = {
                    role: 'user',
                    content: [
                        {
                            type: 'text',
                            text: messagesArray[lastUserMsgIndex].content
                        },
                        {
                            type: 'image_url',
                            image_url: {
                                url: imageUrl
                            }
                        }
                    ]
                };
            }
        }

        const response = await axios.post(
            'https://openrouter.ai/api/v1/chat/completions',
            {
                model: CONFIG.AI_MODEL,
                messages: messagesArray,
                temperature: 0.7,
                max_tokens: 4000
            },
            {
                headers: {
                    'Authorization': `Bearer ${CONFIG.OPENROUTER_API_KEY}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'https://github.com/your-repo',
                    'X-Title': 'Sherlock Telegram Bot'
                },
                timeout: CONFIG.TIMEOUT
            }
        );

        const aiMessage = response.data.choices[0].message.content;
        console.log(`[AI] Response length: ${aiMessage.length} chars`);
        return aiMessage;
    } catch (error) {
        console.error('[AI Error]', error.response?.data || error.message);
        throw new Error('AI service temporarily unavailable: ' + error.message);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 💬 CONVERSATION HISTORY
// ═══════════════════════════════════════════════════════════════════════════

function getConversationHistory(userId) {
    if (!cache.conversations.has(userId)) {
        cache.conversations.set(userId, []);
    }
    return cache.conversations.get(userId);
}

function addToHistory(userId, role, content) {
    const history = getConversationHistory(userId);
    history.push({ role, content });
    if (history.length > CONFIG.MAX_HISTORY) {
        history.splice(1, history.length - CONFIG.MAX_HISTORY);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 🛠️ COMMAND MANAGEMENT (WITH GITHUB SYNC)
// ═══════════════════════════════════════════════════════════════════════════

// Internal memory registration (for fast access)
const commandsMemory = new Map();

async function registerCommandInMemory(commandName, handler) {
    commandsMemory.set(commandName, handler);
    console.log(`[Memory] Command loaded: /${commandName}`);
}

async function registerCommand(commandName, handler) {
    // Save to GitHub first
    const handlerString = handler.toString();
    const result = await dataManager.saveCommand(commandName, handlerString);
    
    if (result.success) {
        // Then register in memory
        commandsMemory.set(commandName, handler);
        console.log(`[✓] Command registered and saved to GitHub: /${commandName}`);
        return true;
    } else {
        console.error(`[✗] Failed to save command to GitHub: ${result.error}`);
        return false;
    }
}

async function deleteCommand(commandName) {
    // Delete from GitHub first
    const result = await dataManager.deleteCommand(commandName);
    
    if (result.success) {
        // Then delete from memory
        commandsMemory.delete(commandName);
        console.log(`[✓] Command deleted from GitHub and memory: /${commandName}`);
        return true;
    }
    return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// 🌐 WEBSITE MANAGEMENT (WITH GITHUB SYNC)
// ═══════════════════════════════════════════════════════════════════════════

async function restoreWebsite(routePath, code) {
    try {
        // Check if website is enabled
        const enabled = await dataManager.isWebsiteEnabled(routePath);
        if (!enabled) {
            console.log(`[Website] Skipped (disabled): ${routePath}`);
            return false;
        }
        
        const sandbox = createSandbox(null);
        const context = vm.createContext(sandbox);
        const script = new vm.Script(code);
        script.runInContext(context);
        console.log(`[Website] Restored: ${routePath}`);
        return true;
    } catch (error) {
        console.error(`[Website] Failed to restore ${routePath}:`, error.message);
        return false;
    }
}

async function registerWebsite(routePath, code) {
    // Save to GitHub first
    const result = await dataManager.saveWebsite(routePath, code);
    
    if (result.success) {
        console.log(`[✓] Website saved to GitHub: ${routePath}`);
        return true;
    } else {
        console.error(`[✗] Failed to save website to GitHub: ${result.error}`);
        return false;
    }
}

async function deleteWebsite(routePath) {
    // Delete from GitHub
    const result = await dataManager.deleteWebsite(routePath);
    
    if (result.success) {
        // Remove Express route from stack
        if (app._router && app._router.stack) {
            app._router.stack = app._router.stack.filter(layer => {
                if (layer.route) {
                    return layer.route.path !== routePath;
                }
                return true;
            });
        }
        console.log(`[✓] Website deleted from GitHub: ${routePath}`);
        return true;
    }
    return false;
}

// ═════════════════════════════════════════════════════════════════════════════
// 🤖 BOT MANAGEMENT
// ═════════════════════════════════════════════════════════════════════════════

async function restoreBot(botName, token, code) {
    try {
        // Check if bot is enabled
        const enabled = await dataManager.isBotEnabled(botName);
        if (!enabled) {
            console.log(`[Bot] Skipped (disabled): ${botName}`);
            return false;
        }
        
        // Stop existing bot if running
        if (cache.runningBots.has(botName)) {
            await stopBot(botName);
        }
        
        // Create special sandbox for bot with access to store itself
        const sandbox = createSandbox(null);
        sandbox.botToken = token;
        sandbox.botName = botName;
        sandbox.setBotInstance = (bot) => {
            cache.runningBots.set(botName, bot);
            console.log(`[Bot] Instance registered: ${botName}`);
        };
        
        // Execute bot code in sandbox
        const context = vm.createContext(sandbox);
        // Ensure code automatically registers bot instance
        const wrappedCode = `
            (async function() {
                ${code}
                
                // Auto-detect and register bot instance
                // Look for TelegramBot instances in the scope
                const globalVars = Object.keys(this);
                for (const varName of globalVars) {
                    const obj = this[varName];
                    if (obj && typeof obj === 'object') {
                        // Check if it's a Telegram bot (has polling methods)
                        if (typeof obj.stopPolling === 'function' || 
                            typeof obj.getMe === 'function' ||
                            typeof obj.sendMessage === 'function') {
                            console.log('[Bot] Auto-detected bot instance:', varName);
                            setBotInstance(obj);
                            break;
                        }
                    }
                }
            }).call(this);
        `;
        const script = new vm.Script(wrappedCode);
        await script.runInContext(context);
        
        // Small delay to ensure bot starts polling
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Verify bot was registered
        if (cache.runningBots.has(botName)) {
            console.log(`[Bot] ✅ Restored and running: ${botName}`);
            return true;
        } else {
            console.warn(`[Bot] ⚠️ Started but instance not captured: ${botName}`);
            console.warn(`[Bot] Bot code must call setBotInstance(bot) or bot won't be stoppable`);
            return true;
        }
    } catch (error) {
        console.error(`[Bot] ❌ Failed to restore ${botName}:`, error.message);
        return false;
    }
}

async function stopBot(botName) {
    try {
        if (!cache.runningBots.has(botName)) {
            console.log(`[Bot] ⚠️ Not found in running bots: ${botName}`);
            return false;
        }
        
        const botInstance = cache.runningBots.get(botName);
        console.log(`[Bot] 🛑 Attempting to stop: ${botName}`);
        
        if (!botInstance) {
            console.warn(`[Bot] ⚠️ Bot instance is null for: ${botName}`);
            cache.runningBots.delete(botName);
            return false;
        }
        
        let stopped = false;
        
        // Method 1: stopPolling (most common for Telegram bots)
        if (typeof botInstance.stopPolling === 'function') {
            try {
                console.log(`[Bot] Calling stopPolling() for: ${botName}`);
                await botInstance.stopPolling({ cancel: true });
                stopped = true;
                console.log(`[Bot] ✅ stopPolling successful: ${botName}`);
            } catch (e) {
                console.warn(`[Bot] ⚠️ stopPolling failed for ${botName}:`, e.message);
            }
        }
        
        // Method 2: close connection
        if (typeof botInstance.close === 'function') {
            try {
                console.log(`[Bot] Calling close() for: ${botName}`);
                await botInstance.close();
                stopped = true;
                console.log(`[Bot] ✅ close successful: ${botName}`);
            } catch (e) {
                console.warn(`[Bot] ⚠️ close failed for ${botName}:`, e.message);
            }
        }
        
        // Method 3: disconnect
        if (typeof botInstance.disconnect === 'function') {
            try {
                console.log(`[Bot] Calling disconnect() for: ${botName}`);
                await botInstance.disconnect();
                stopped = true;
                console.log(`[Bot] ✅ disconnect successful: ${botName}`);
            } catch (e) {
                console.warn(`[Bot] ⚠️ disconnect failed for ${botName}:`, e.message);
            }
        }
        
        // Remove from cache
        cache.runningBots.delete(botName);
        console.log(`[Bot] 🗑️ Removed from cache: ${botName}`);
        
        if (stopped) {
            console.log(`[Bot] ✅✅ Successfully stopped: ${botName}`);
            return true;
        } else {
            console.warn(`[Bot] ⚠️ No stop method worked for: ${botName}`);
            return false;
        }
    } catch (error) {
        console.error(`[Bot] ❌ Error stopping ${botName}:`, error.message);
        // Still remove from cache
        cache.runningBots.delete(botName);
        return false;
    }
}

async function deleteBot(botName) {
    // Stop bot first
    await stopBot(botName);
    
    // Delete from GitHub
    const result = await dataManager.deleteBot(botName);
    
    if (result.success) {
        console.log(`[✓] Bot deleted from GitHub: ${botName}`);
        return true;
    }
    return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// 🎮 CODE EXECUTION SANDBOX
// ═══════════════════════════════════════════════════════════════════════════

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
        __dirname,
        __filename,
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
        bot,
        axios,
        TelegramBot,
        chatId,
        registerCommand,
        deleteCommand,
        customCommands: commandsMemory,
        runningBots: cache.runningBots,
        githubStorage,
        dataManager,
        fetchWebContent,
        searchInternet,
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
        
        try {
            const result = await executeInSandbox(code, chatId);
            console.log('[CODE_ACTION] ✅ Success - Saved to GitHub');
            actionsExecuted.push('✅ Команда добавлена и сохранена на GitHub');
        } catch (error) {
            console.error('[CODE_ACTION] ❌ Error:', error.message);
            actionsExecuted.push('⚠️ Ошибка добавления команды: ' + error.message);
        }
    }

    // 2. EXECUTE_NOW - Execute code immediately
    const executeNowRegex = /<EXECUTE_NOW>([\s\S]*?)<\/EXECUTE_NOW>/g;
    while ((match = executeNowRegex.exec(aiResponse)) !== null) {
        const code = match[1].trim();
        console.log(`[EXECUTE_NOW] Running code...`);
        
        try {
            const result = await executeInSandbox(code, chatId);
            console.log('[EXECUTE_NOW] Result:', result);
            
            if (result !== undefined && result !== null) {
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
                    actionsExecuted.push(`🔍 Поиск "${query}" не дал результатов.`);
                }
            } else {
                actionsExecuted.push(`❌ Ошибка поиска: ${result.error}`);
            }
        } catch (error) {
            actionsExecuted.push(`❌ Ошибка поиска: ${error.message}`);
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

    // 7. GITHUB_LIST - List GitHub files
    const githubListRegex = /<GITHUB_LIST>(.*?)<\/GITHUB_LIST>/g;
    while ((match = githubListRegex.exec(aiResponse)) !== null) {
        const dirPath = match[1].trim() || '';
        try {
            const result = await githubStorage.listFiles(dirPath);
            if (result.success) {
                let fileList = `📁 Файлы в ${dirPath || 'корневой папке'}:\n\n`;
                result.files.forEach(f => {
                    fileList += `  ${f.type === 'dir' ? '📁' : '📄'} ${f.name}\n`;
                });
                actionsExecuted.push(fileList);
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
                await registerWebsite(routePath, routeCode);
                actionsExecuted.push(`🌐 Сайт запущен и сохранён на GitHub!\n🔗 http://localhost:${CONFIG.PORT}${routePath}`);
            } catch (error) {
                actionsExecuted.push('❌ Ошибка создания сайта: ' + error.message);
            }
        }
    }

    // 9. DISABLE_WEBSITE - Disable website (can be re-enabled)
    const disableWebsiteRegex = /<DISABLE_WEBSITE>(.*?)<\/DISABLE_WEBSITE>/g;
    while ((match = disableWebsiteRegex.exec(aiResponse)) !== null) {
        const routePath = match[1].trim();
        try {
            const result = await dataManager.disableWebsite(routePath);
            if (result.success) {
                // Remove from Express routes
                if (app._router && app._router.stack) {
                    app._router.stack = app._router.stack.filter(layer => {
                        if (layer.route) {
                            return layer.route.path !== routePath;
                        }
                        return true;
                    });
                }
                actionsExecuted.push(`⏸️ Сайт ${routePath} выключен. Можно включить обратно.`);
            } else {
                actionsExecuted.push(`❌ Сайт ${routePath} не найден`);
            }
        } catch (error) {
            actionsExecuted.push('❌ Ошибка отключения сайта: ' + error.message);
        }
    }

    // 10. ENABLE_WEBSITE - Enable website
    const enableWebsiteRegex = /<ENABLE_WEBSITE>(.*?)<\/ENABLE_WEBSITE>/g;
    while ((match = enableWebsiteRegex.exec(aiResponse)) !== null) {
        const routePath = match[1].trim();
        try {
            const result = await dataManager.enableWebsite(routePath);
            if (result.success) {
                // Restore website to Express
                const code = await dataManager.getWebsite(routePath);
                if (code) {
                    await restoreWebsite(routePath, code);
                    actionsExecuted.push(`✅ Сайт ${routePath} включен обратно!\n🔗 http://localhost:${CONFIG.PORT}${routePath}`);
                } else {
                    actionsExecuted.push(`❌ Код сайта не найден`);
                }
            } else {
                actionsExecuted.push(`❌ Сайт ${routePath} не найден`);
            }
        } catch (error) {
            actionsExecuted.push('❌ Ошибка включения сайта: ' + error.message);
        }
    }

    // 11. DELETE_WEBSITE - Delete website permanently
    const deleteWebsiteRegex = /<DELETE_WEBSITE>(.*?)<\/DELETE_WEBSITE>/g;
    while ((match = deleteWebsiteRegex.exec(aiResponse)) !== null) {
        const routePath = match[1].trim();
        try {
            const success = await deleteWebsite(routePath);
            if (success) {
                actionsExecuted.push(`✅ Сайт ${routePath} полностью удалён из GitHub`);
            } else {
                actionsExecuted.push(`❌ Сайт ${routePath} не найден`);
            }
        } catch (error) {
            actionsExecuted.push('❌ Ошибка удаления сайта: ' + error.message);
        }
    }

    // 12. SAVE_SCRIPT - Save script for later use
    const saveScriptRegex = /<SAVE_SCRIPT>([\s\S]*?)<\/SAVE_SCRIPT>/g;
    while ((match = saveScriptRegex.exec(aiResponse)) !== null) {
        const content = match[1].trim();
        const nameMatch = content.match(/NAME:\s*([^\n]+)/);
        const descMatch = content.match(/DESCRIPTION:\s*([^\n]+)/);
        const codeMatch = content.match(/CODE:\s*([\s\S]+)/);
        
        if (nameMatch && codeMatch) {
            const scriptName = nameMatch[1].trim();
            const description = descMatch ? descMatch[1].trim() : '';
            const code = codeMatch[1].trim();
            
            try {
                const result = await dataManager.saveScript(scriptName, {
                    code: code,
                    description: description,
                    enabled: true
                });
                
                if (result.success) {
                    actionsExecuted.push(`💾 Скрипт "${scriptName}" сохранен на GitHub!\nℹ️ ${description}\n▶️ Запустить: <RUN_SCRIPT>${scriptName}</RUN_SCRIPT>`);
                } else {
                    actionsExecuted.push('❌ Ошибка сохранения скрипта: ' + result.error);
                }
            } catch (error) {
                actionsExecuted.push('❌ Ошибка сохранения: ' + error.message);
            }
        } else {
            actionsExecuted.push('❌ Неверный формат SAVE_SCRIPT. Нужны: NAME и CODE');
        }
    }

    // 13. RUN_SCRIPT - Run saved script
    const runScriptRegex = /<RUN_SCRIPT>(.*?)<\/RUN_SCRIPT>/g;
    while ((match = runScriptRegex.exec(aiResponse)) !== null) {
        const scriptName = match[1].trim();
        try {
            const scriptData = await dataManager.getScript(scriptName);
            if (scriptData) {
                const enabled = await dataManager.isScriptEnabled(scriptName);
                if (!enabled) {
                    actionsExecuted.push(`⏸️ Скрипт "${scriptName}" выключен. Включите его перед запуском.`);
                } else {
                    const result = await executeInSandbox(scriptData.code, chatId);
                    if (result !== undefined && result !== null) {
                        let resultStr = result;
                        if (typeof result === 'object') {
                            try {
                                resultStr = JSON.stringify(result, null, 2);
                            } catch (e) {
                                resultStr = String(result);
                            }
                        }
                        actionsExecuted.push(`▶️ Скрипт "${scriptName}" запущен\n📊 Результат: ${resultStr}`);
                    } else {
                        actionsExecuted.push(`✅ Скрипт "${scriptName}" выполнен`);
                    }
                }
            } else {
                actionsExecuted.push(`❌ Скрипт "${scriptName}" не найден`);
            }
        } catch (error) {
            actionsExecuted.push(`❌ Ошибка выполнения скрипта: ` + error.message);
        }
    }

    // 14. DISABLE_SCRIPT - Disable script
    const disableScriptRegex = /<DISABLE_SCRIPT>(.*?)<\/DISABLE_SCRIPT>/g;
    while ((match = disableScriptRegex.exec(aiResponse)) !== null) {
        const scriptName = match[1].trim();
        try {
            const result = await dataManager.disableScript(scriptName);
            if (result.success) {
                actionsExecuted.push(`⏸️ Скрипт "${scriptName}" выключен. Не будет запускаться.`);
            } else {
                actionsExecuted.push(`❌ Скрипт "${scriptName}" не найден`);
            }
        } catch (error) {
            actionsExecuted.push('❌ Ошибка отключения скрипта: ' + error.message);
        }
    }

    // 15. ENABLE_SCRIPT - Enable script
    const enableScriptRegex = /<ENABLE_SCRIPT>(.*?)<\/ENABLE_SCRIPT>/g;
    while ((match = enableScriptRegex.exec(aiResponse)) !== null) {
        const scriptName = match[1].trim();
        try {
            const result = await dataManager.enableScript(scriptName);
            if (result.success) {
                actionsExecuted.push(`✅ Скрипт "${scriptName}" включен. Можно запускать.`);
            } else {
                actionsExecuted.push(`❌ Скрипт "${scriptName}" не найден`);
            }
        } catch (error) {
            actionsExecuted.push('❌ Ошибка включения скрипта: ' + error.message);
        }
    }

    // 16. DELETE_SCRIPT - Delete script
    const deleteScriptRegex = /<DELETE_SCRIPT>(.*?)<\/DELETE_SCRIPT>/g;
    while ((match = deleteScriptRegex.exec(aiResponse)) !== null) {
        const scriptName = match[1].trim();
        try {
            const result = await dataManager.deleteScript(scriptName);
            if (result.success) {
                actionsExecuted.push(`✅ Скрипт "${scriptName}" удален из GitHub`);
            } else {
                actionsExecuted.push(`❌ Скрипт "${scriptName}" не найден`);
            }
        } catch (error) {
            actionsExecuted.push('❌ Ошибка удаления скрипта: ' + error.message);
        }
    }

    // 17. LIST_SCRIPTS - List all scripts
    if (aiResponse.includes('<LIST_SCRIPTS>')) {
        try {
            const scriptsData = await dataManager.getAllScripts();
            const scripts = Object.keys(scriptsData);
            
            if (scripts.length === 0) {
                actionsExecuted.push('📜 Нет скриптов (проверено на GitHub)');
            } else {
                let scriptList = '📜 Скрипты (загружено с GitHub):\n\n';
                for (const name of scripts) {
                    const scriptData = scriptsData[name];
                    const enabled = scriptData.enabled !== false;
                    const status = enabled ? '✅ Включен' : '⏸️ Выключен';
                    const desc = scriptData.description ? ` - ${scriptData.description}` : '';
                    scriptList += `  ${status}: ${name}${desc}\n`;
                }
                actionsExecuted.push(scriptList);
            }
        } catch (error) {
            actionsExecuted.push('❌ Ошибка загрузки списка: ' + error.message);
        }
    }

    // 18. DISABLE_COMMAND - Disable command
    const disableCommandRegex = /<DISABLE_COMMAND>(.*?)<\/DISABLE_COMMAND>/g;
    while ((match = disableCommandRegex.exec(aiResponse)) !== null) {
        const cmdName = match[1].trim();
        try {
            const result = await dataManager.disableCommand(cmdName);
            if (result.success) {
                // Remove from memory
                commandsMemory.delete(cmdName);
                actionsExecuted.push(`⏸️ Команда /${cmdName} выключена. Можно включить обратно.`);
            } else {
                actionsExecuted.push(`❌ Команда /${cmdName} не найдена`);
            }
        } catch (error) {
            actionsExecuted.push('❌ Ошибка отключения команды: ' + error.message);
        }
    }

    // 19. ENABLE_COMMAND - Enable command
    const enableCommandRegex = /<ENABLE_COMMAND>(.*?)<\/ENABLE_COMMAND>/g;
    while ((match = enableCommandRegex.exec(aiResponse)) !== null) {
        const cmdName = match[1].trim();
        try {
            const result = await dataManager.enableCommand(cmdName);
            if (result.success) {
                // Restore to memory
                const funcString = await dataManager.getCommand(cmdName);
                if (funcString) {
                    const func = eval(`(${funcString})`);
                    await registerCommandInMemory(cmdName, func);
                    actionsExecuted.push(`✅ Команда /${cmdName} включена обратно!`);
                } else {
                    actionsExecuted.push(`❌ Код команды не найден`);
                }
            } else {
                actionsExecuted.push(`❌ Команда /${cmdName} не найдена`);
            }
        } catch (error) {
            actionsExecuted.push('❌ Ошибка включения команды: ' + error.message);
        }
    }

    // 20. CREATE_BOT - Create new bot
    const createBotRegex = /<CREATE_BOT>([\s\S]*?)<\/CREATE_BOT>/g;
    while ((match = createBotRegex.exec(aiResponse)) !== null) {
        const content = match[1].trim();
        const nameMatch = content.match(/NAME:\s*([^\n]+)/);
        const tokenMatch = content.match(/TOKEN:\s*([^\n]+)/);
        const codeMatch = content.match(/CODE:\s*([\s\S]+)/);
        
        if (nameMatch && tokenMatch && codeMatch) {
            const botName = nameMatch[1].trim();
            const botToken = tokenMatch[1].trim();
            const botCode = codeMatch[1].trim();
            
            try {
                // Save bot to GitHub
                const result = await dataManager.saveBot(botName, {
                    token: botToken,
                    code: botCode,
                    enabled: true
                });
                
                if (result.success) {
                    // Start the bot
                    await restoreBot(botName, botToken, botCode);
                    actionsExecuted.push(`🎉 Бот "${botName}" создан и запущен!\n✅ Сохранён на GitHub\n🔥 При перезапуске автоматически загрузится!`);
                } else {
                    actionsExecuted.push('❌ Ошибка сохранения бота: ' + result.error);
                }
            } catch (error) {
                actionsExecuted.push('❌ Ошибка создания бота: ' + error.message);
            }
        } else {
            actionsExecuted.push('❌ Неверный формат CREATE_BOT. Нужны: NAME, TOKEN, CODE');
        }
    }

    // 21. DISABLE_BOT - Disable bot
    const disableBotRegex = /<DISABLE_BOT>(.*?)<\/DISABLE_BOT>/g;
    while ((match = disableBotRegex.exec(aiResponse)) !== null) {
        const botName = match[1].trim();
        try {
            await stopBot(botName);
            const result = await dataManager.disableBot(botName);
            if (result.success) {
                actionsExecuted.push(`⏸️ Бот ${botName} выключен. Можно включить обратно.`);
            } else {
                actionsExecuted.push(`❌ Бот ${botName} не найден`);
            }
        } catch (error) {
            actionsExecuted.push('❌ Ошибка отключения бота: ' + error.message);
        }
    }

    // 22. ENABLE_BOT - Enable bot
    const enableBotRegex = /<ENABLE_BOT>(.*?)<\/ENABLE_BOT>/g;
    while ((match = enableBotRegex.exec(aiResponse)) !== null) {
        const botName = match[1].trim();
        try {
            const result = await dataManager.enableBot(botName);
            if (result.success) {
                const botData = await dataManager.getBot(botName);
                if (botData) {
                    await restoreBot(botName, botData.token, botData.code);
                    actionsExecuted.push(`✅ Бот ${botName} включен обратно!`);
                } else {
                    actionsExecuted.push(`❌ Данные бота не найдены`);
                }
            } else {
                actionsExecuted.push(`❌ Бот ${botName} не найден`);
            }
        } catch (error) {
            actionsExecuted.push('❌ Ошибка включения бота: ' + error.message);
        }
    }

    // 23. DELETE_BOT - Delete bot permanently
    const deleteBotRegex = /<DELETE_BOT>(.*?)<\/DELETE_BOT>/g;
    while ((match = deleteBotRegex.exec(aiResponse)) !== null) {
        const botName = match[1].trim();
        try {
            const success = await deleteBot(botName);
            if (success) {
                actionsExecuted.push(`✅ Бот ${botName} полностью удалён из GitHub`);
            } else {
                actionsExecuted.push(`❌ Бот ${botName} не найден`);
            }
        } catch (error) {
            actionsExecuted.push('❌ Ошибка удаления бота: ' + error.message);
        }
    }

    // 24. LIST_BOTS - List all bots
    if (aiResponse.includes('<LIST_BOTS>')) {
        try {
            const botsData = await dataManager.getAllBots();
            const bots = Object.keys(botsData);
            
            if (bots.length === 0) {
                actionsExecuted.push('🤖 Нет ботов (проверено на GitHub)');
            } else {
                let botList = '🤖 Боты (загружено с GitHub):\n\n';
                for (const botName of bots) {
                    const botData = botsData[botName];
                    const enabled = botData.enabled !== false;
                    const status = enabled ? '✅ Включен' : '⏸️ Выключен';
                    const running = cache.runningBots.has(botName) ? '🟢 Работает' : '🔴 Остановлен';
                    botList += `  ${status} ${running}: ${botName}\n`;
                }
                actionsExecuted.push(botList);
            }
        } catch (error) {
            actionsExecuted.push('❌ Ошибка загрузки списка: ' + error.message);
        }
    }

    // 25. LIST_WEBSITES - List all running websites
    if (aiResponse.includes('<LIST_WEBSITES>')) {
        try {
            const websitesData = await dataManager.getAllWebsites();
            const websites = Object.keys(websitesData);
            
            if (websites.length === 0) {
                actionsExecuted.push('🌐 Нет сайтов (проверено на GitHub)');
            } else {
                let siteList = '🌐 Сайты (загружено с GitHub):\n\n';
                for (const path of websites) {
                    const websiteData = websitesData[path];
                    let enabled = true;
                    if (typeof websiteData === 'object') {
                        enabled = websiteData.enabled !== false;
                    }
                    const status = enabled ? '✅ Включен' : '⏸️ Выключен';
                    siteList += `  ${status}: http://localhost:${CONFIG.PORT}${path}\n`;
                }
                actionsExecuted.push(siteList);
            }
        } catch (error) {
            actionsExecuted.push('❌ Ошибка загрузки списка: ' + error.message);
        }
    }

    // 11. EXPORT_ALL - Export all bot data
    if (aiResponse.includes('<EXPORT_ALL>')) {
        try {
            let exportContent = '# Complete Bot Data Export\n\n';
            exportContent += `Export Date: ${new Date().toISOString()}\n\n`;
            
            const commandsData = await dataManager.getAllCommands();
            exportContent += '## Commands\n\n';
            for (const [name, handler] of Object.entries(commandsData)) {
                exportContent += `### /${name}\n\n\`\`\`javascript\n${handler}\n\`\`\`\n\n`;
            }
            
            const websitesData = await dataManager.getAllWebsites();
            exportContent += '## Websites\n\n';
            for (const [path, code] of Object.entries(websitesData)) {
                exportContent += `### ${path}\n\nURL: http://localhost:${CONFIG.PORT}${path}\n\n\`\`\`javascript\n${code}\n\`\`\`\n\n`;
            }
            
            const databasesData = await dataManager.getAllDatabases();
            exportContent += '## Databases\n\n';
            for (const [dbName, db] of Object.entries(databasesData)) {
                exportContent += `### ${dbName}\n\n\`\`\`json\n${JSON.stringify(db, null, 2)}\n\`\`\`\n\n`;
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

    // 12. NPM_INSTALL - Install npm package
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

    // 13. DELETE_COMMAND - Delete command
    const deleteCommandRegex = /<DELETE_COMMAND>(.*?)<\/DELETE_COMMAND>/g;
    while ((match = deleteCommandRegex.exec(aiResponse)) !== null) {
        const cmdName = match[1].trim();
        if (await deleteCommand(cmdName)) {
            actionsExecuted.push(`✅ Команда /${cmdName} удалена из GitHub`);
        } else {
            actionsExecuted.push(`❌ Команда /${cmdName} не найдена`);
        }
    }

    // 14. LIST_COMMANDS - List commands
    if (aiResponse.includes('<LIST_COMMANDS>')) {
        try {
            const commandsData = await dataManager.getAllCommands();
            const commands = Object.keys(commandsData);
            
            if (commands.length === 0) {
                actionsExecuted.push('📝 Нет команд (проверено на GitHub)');
            } else {
                let cmdList = '📝 Команды (загружено с GitHub):\n\n';
                for (const name of commands) {
                    const commandData = commandsData[name];
                    let enabled = true;
                    if (typeof commandData === 'object') {
                        enabled = commandData.enabled !== false;
                    }
                    const status = enabled ? '✅ Включена' : '⏸️ Выключена';
                    cmdList += `  ${status}: /${name}\n`;
                }
                actionsExecuted.push(cmdList);
            }
        } catch (error) {
            actionsExecuted.push('❌ Ошибка загрузки списка: ' + error.message);
        }
    }

    // 15. CREATE_DB - Create database
    const createDbRegex = /<CREATE_DB>(.*?)<\/CREATE_DB>/g;
    while ((match = createDbRegex.exec(aiResponse)) !== null) {
        const dbName = match[1].trim();
        try {
            const existing = await dataManager.getDatabase(dbName);
            if (!existing) {
                await dataManager.saveDatabase(dbName, {});
                actionsExecuted.push(`✅ База данных "${dbName}" создана на GitHub`);
            } else {
                actionsExecuted.push(`⚠️ База данных "${dbName}" уже существует на GitHub`);
            }
        } catch (error) {
            actionsExecuted.push('❌ Ошибка создания БД: ' + error.message);
        }
    }

    // 16. DB_SET - Set value in database
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
            
            try {
                await dataManager.setDatabaseValue(dbName, key, value);
                actionsExecuted.push(`✅ Сохранено в БД "${dbName}" на GitHub: ${key}`);
            } catch (error) {
                actionsExecuted.push('❌ Ошибка сохранения: ' + error.message);
            }
        }
    }

    // 17. DB_GET - Get value from database
    const dbGetRegex = /<DB_GET>([\s\S]*?)<\/DB_GET>/g;
    while ((match = dbGetRegex.exec(aiResponse)) !== null) {
        const content = match[1].trim();
        const dbMatch = content.match(/DB:\s*([^\n]+)/);
        const keyMatch = content.match(/KEY:\s*([^\n]+)/);
        
        if (dbMatch && keyMatch) {
            const dbName = dbMatch[1].trim();
            const key = keyMatch[1].trim();
            
            try {
                const value = await dataManager.getDatabaseValue(dbName, key);
                if (value !== null) {
                    actionsExecuted.push(`📊 Значение из GitHub БД "${dbName}[${key}]": ${value}`);
                } else {
                    actionsExecuted.push(`❌ Ключ "${key}" не найден в БД "${dbName}" на GitHub`);
                }
            } catch (error) {
                actionsExecuted.push('❌ Ошибка загрузки: ' + error.message);
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
    let message = text;
    if (typeof message !== 'string') {
        if (message === null || message === undefined) {
            return;
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
    
    if (!text) return;
    
    console.log(`[Message] User ${userId}: ${text.substring(0, 50)}...`);
    
    // Handle custom commands
    if (text.startsWith('/')) {
        const [command, ...args] = text.slice(1).split(' ');
        
        if (commandsMemory.has(command)) {
            try {
                const handler = commandsMemory.get(command);
                const result = await handler(chatId, args.join(' '));
                if (result !== undefined && result !== null) {
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
                '✨ Я мощнейший AI с GitHub хранилищем!\n\n' +
                '🔥 Мои способности:\n' +
                '• 🔍 Поиск в интернете\n' +
                '• 🌐 Чтение веб-страниц\n' +
                '• 💻 Программирование\n' +
                '• 🚀 Хостинг сайтов\n' +
                '• ☁️ GitHub хранилище (ВСЕ данные)\n' +
                '• 🗄️ Базы данных (на GitHub)\n' +
                '• 🤖 Создание ботов\n' +
                '• 📦 NPM пакеты\n\n' +
                '💾 ВСЕ твои команды, сайты и БД хранятся на GitHub!\n' +
                'При перезапуске всё загружается автоматически!\n\n' +
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
                '💾 Всё автоматически сохраняется на GitHub!\n' +
                'Я понимаю естественный язык! 🧠'
            );
            return;
        }

        if (command === 'status') {
            try {
                const commandsData = await dataManager.getAllCommands();
                const websitesData = await dataManager.getAllWebsites();
                const databasesData = await dataManager.getAllDatabases();
                
                const status = `📊 *Статус бота (данные с GitHub)*\n\n` +
                    `📝 Команд: ${Object.keys(commandsData).length}\n` +
                    `🌐 Сайтов: ${Object.keys(websitesData).length}\n` +
                    `🗄️ Баз данных: ${Object.keys(databasesData).length}\n` +
                    `💬 Диалогов в памяти: ${cache.conversations.size}\n\n` +
                    `✅ Все данные на GitHub!`;
                
                await bot.sendMessage(chatId, status, { parse_mode: 'Markdown' });
            } catch (error) {
                await bot.sendMessage(chatId, '❌ Ошибка получения статуса: ' + error.message);
            }
            return;
        }
    }
    
    try {
        const history = getConversationHistory(userId);
        
        let userMessage = text;
        let imageUrl = null;
        
        // Handle images
        if (msg.photo && msg.photo.length > 0) {
            try {
                // Get the largest photo
                const photo = msg.photo[msg.photo.length - 1];
                const fileId = photo.file_id;
                
                console.log('[Image] Processing photo:', fileId);
                
                // Get file path from Telegram
                const file = await bot.getFile(fileId);
                const filePath = file.file_path;
                
                // Download image from Telegram servers
                const fileUrl = `https://api.telegram.org/file/bot${CONFIG.TELEGRAM_TOKEN}/${filePath}`;
                console.log('[Image] Downloading from:', fileUrl);
                
                const imageResponse = await axios.get(fileUrl, {
                    responseType: 'arraybuffer'
                });
                
                // Convert to base64
                const base64Image = Buffer.from(imageResponse.data, 'binary').toString('base64');
                const mimeType = imageResponse.headers['content-type'] || 'image/jpeg';
                imageUrl = `data:${mimeType};base64,${base64Image}`;
                
                console.log('[Image] ✅ Processed successfully, size:', base64Image.length, 'bytes');
                
                // If no caption provided, use default question
                if (!text || text.trim() === '') {
                    userMessage = 'Что на этом изображении?';
                } else {
                    userMessage = text;
                }
            } catch (imageError) {
                console.error('[Image] ❌ Failed to process:', imageError.message);
                await bot.sendMessage(chatId, '⚠️ Не удалось обработать изображение: ' + imageError.message);
                return;
            }
        }
        
        addToHistory(userId, 'user', userMessage);
        
        await bot.sendChatAction(chatId, 'typing');
        
        const aiResponse = await callOpenRouter(history, imageUrl);
        
        const actionsExecuted = await parseAndExecuteActions(aiResponse, chatId, userId);
        
        let cleanResponse = aiResponse;
        cleanResponse = cleanResponse.replace(/<CODE_ACTION>[\s\S]*?<\/CODE_ACTION>/g, '');
        cleanResponse = cleanResponse.replace(/<EXECUTE_NOW>[\s\S]*?<\/EXECUTE_NOW>/g, '');
        cleanResponse = cleanResponse.replace(/<SEARCH>.*?<\/SEARCH>/g, '');
        cleanResponse = cleanResponse.replace(/<FETCH_URL>.*?<\/FETCH_URL>/g, '');
        cleanResponse = cleanResponse.replace(/<GITHUB_SAVE>[\s\S]*?<\/GITHUB_SAVE>/g, '');
        cleanResponse = cleanResponse.replace(/<GITHUB_LOAD>.*?<\/GITHUB_LOAD>/g, '');
        cleanResponse = cleanResponse.replace(/<GITHUB_LIST>.*?<\/GITHUB_LIST>/g, '');
        cleanResponse = cleanResponse.replace(/<HOST_WEBSITE>[\s\S]*?<\/HOST_WEBSITE>/g, '');
        cleanResponse = cleanResponse.replace(/<STOP_WEBSITE>.*?<\/STOP_WEBSITE>/g, '');
        cleanResponse = cleanResponse.replace(/<DISABLE_WEBSITE>.*?<\/DISABLE_WEBSITE>/g, '');
        cleanResponse = cleanResponse.replace(/<ENABLE_WEBSITE>.*?<\/ENABLE_WEBSITE>/g, '');
        cleanResponse = cleanResponse.replace(/<DELETE_WEBSITE>.*?<\/DELETE_WEBSITE>/g, '');
        cleanResponse = cleanResponse.replace(/<LIST_WEBSITES>/g, '');
        cleanResponse = cleanResponse.replace(/<CREATE_BOT>[\s\S]*?<\/CREATE_BOT>/g, '');
        cleanResponse = cleanResponse.replace(/<DISABLE_BOT>.*?<\/DISABLE_BOT>/g, '');
        cleanResponse = cleanResponse.replace(/<ENABLE_BOT>.*?<\/ENABLE_BOT>/g, '');
        cleanResponse = cleanResponse.replace(/<DELETE_BOT>.*?<\/DELETE_BOT>/g, '');
        cleanResponse = cleanResponse.replace(/<LIST_BOTS>/g, '');
        cleanResponse = cleanResponse.replace(/<EXPORT_ALL>/g, '');
        cleanResponse = cleanResponse.replace(/<NPM_INSTALL>.*?<\/NPM_INSTALL>/g, '');
        cleanResponse = cleanResponse.replace(/<DELETE_COMMAND>.*?<\/DELETE_COMMAND>/g, '');
        cleanResponse = cleanResponse.replace(/<DISABLE_COMMAND>.*?<\/DISABLE_COMMAND>/g, '');
        cleanResponse = cleanResponse.replace(/<ENABLE_COMMAND>.*?<\/ENABLE_COMMAND>/g, '');
        cleanResponse = cleanResponse.replace(/<LIST_COMMANDS>/g, '');
        cleanResponse = cleanResponse.replace(/<SAVE_SCRIPT>[\s\S]*?<\/SAVE_SCRIPT>/g, '');
        cleanResponse = cleanResponse.replace(/<RUN_SCRIPT>.*?<\/RUN_SCRIPT>/g, '');
        cleanResponse = cleanResponse.replace(/<DISABLE_SCRIPT>.*?<\/DISABLE_SCRIPT>/g, '');
        cleanResponse = cleanResponse.replace(/<ENABLE_SCRIPT>.*?<\/ENABLE_SCRIPT>/g, '');
        cleanResponse = cleanResponse.replace(/<DELETE_SCRIPT>.*?<\/DELETE_SCRIPT>/g, '');
        cleanResponse = cleanResponse.replace(/<LIST_SCRIPTS>/g, '');
        cleanResponse = cleanResponse.replace(/<CREATE_DB>.*?<\/CREATE_DB>/g, '');
        cleanResponse = cleanResponse.replace(/<DB_SET>[\s\S]*?<\/DB_SET>/g, '');
        cleanResponse = cleanResponse.replace(/<DB_GET>[\s\S]*?<\/DB_GET>/g, '');
        cleanResponse = cleanResponse.trim();
        
        addToHistory(userId, 'assistant', aiResponse);
        
        if (cleanResponse) {
            await sendLongMessage(chatId, cleanResponse);
        }
        
        if (actionsExecuted.length > 0) {
            for (const action of actionsExecuted) {
                await sendLongMessage(chatId, action);
            }
        }
        
    } catch (error) {
        console.error('[Message Error]', error);
        await bot.sendMessage(chatId, '❌ Ошибка: ' + error.message);
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// 🚀 STARTUP & EXPRESS SERVER
// ═══════════════════════════════════════════════════════════════════════════

async function startup() {
    try {
        console.log('🔄 Initializing bot with GitHub storage...');
        
        // Initialize GitHub storage structure
        await dataManager.initializeStorage();
        
        // Load all data from GitHub
        await dataManager.loadAllDataToMemory();
        
        // Start Express server
        app.listen(CONFIG.PORT, () => {
            console.log(`✅ Express server running on port ${CONFIG.PORT}`);
            console.log(`🌐 Hosted websites available at http://localhost:${CONFIG.PORT}`);
        });
        
        console.log('');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('🎉 BOT IS READY WITH GITHUB STORAGE!');
        console.log('💾 All data (commands/websites/databases) stored on GitHub');
        console.log('🔄 Data auto-syncs on every change');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('');
        
    } catch (error) {
        console.error('❌ Startup error:', error);
        process.exit(1);
    }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down bot...');
    console.log('💾 All data already saved on GitHub!');
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n🛑 Shutting down bot...');
    console.log('💾 All data already saved on GitHub!');
    process.exit(0);
});

// Start the bot
startup();
