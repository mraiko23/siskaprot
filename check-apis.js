// Check API availability
require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

const GEMINI_API_KEY = 'AIzaSyCf-Hi6MtUyiDdYYkdSYAQP-GW0oFctn1Y';

console.log('🔍 Checking available Gemini models...\n');

async function checkModels() {
    try {
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        
        // Try different model names
        const modelsToTry = [
            'gemini-pro',
            'gemini-1.5-pro',
            'gemini-1.5-flash',
            'gemini-1.5-flash-latest',
            'gemini-2.0-flash-exp'
        ];
        
        for (const modelName of modelsToTry) {
            try {
                console.log(`Testing ${modelName}...`);
                const model = genAI.getGenerativeModel({ model: modelName });
                const result = await model.generateContent('Say hi in 2 words');
                const response = result.response.text();
                console.log(`✅ ${modelName} works! Response: ${response}\n`);
                return modelName;
            } catch (e) {
                console.log(`❌ ${modelName}: ${e.message.substring(0, 100)}\n`);
            }
        }
        
        console.log('❌ No working models found');
        return null;
    } catch (error) {
        console.error('Error:', error.message);
        return null;
    }
}

checkModels();
