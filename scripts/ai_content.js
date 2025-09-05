require('dotenv').config();
const { OpenAI } = require('openai');
const { Movie, sequelize } = require('../models');
const { Op } = require('sequelize');
const fs = require('fs');
const path = require('path');

const LOG_FILE_PATH = path.join(__dirname, '..', 'ai_content.log');

function loadInitialState(logPath) {
    let logs = [];
    if (fs.existsSync(logPath)) {
        const logData = fs.readFileSync(logPath, 'utf-8');
        logs = logData.split('\n').filter(Boolean).map(line => {
            try { return JSON.parse(line); } catch (e) { return null; }
        }).filter(Boolean);
    }
    return {
        status: 'idle', logs, results: [],
        progress: { processed: 0, total: 0, success: 0, errors: 0 },
        options: {}
    };
}

let contentState = loadInitialState(LOG_FILE_PATH);

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function log(io, message, type = 'info') {
    const logEntry = { type, message, timestamp: new Date().toLocaleTimeString() };
    contentState.logs.push(logEntry);
    fs.appendFileSync(LOG_FILE_PATH, JSON.stringify(logEntry) + '\n');
    console.log(`[AI-CONTENT][${type.toUpperCase()}] ${message}`);
    if (io) io.emit('ai-log', logEntry);
}

async function checkStatus() {
    while (contentState.status === 'paused') await sleep(1000);
    if (contentState.status === 'stopped') throw new Error('AI process stopped by user');
}

const control = {
    start: (io, options) => {
        if (contentState.status === 'running' || contentState.status === 'paused') return;
        if (fs.existsSync(LOG_FILE_PATH)) fs.writeFileSync(LOG_FILE_PATH, '');
        contentState = { status: 'running', logs: [], results: [], progress: { processed: 0, total: 0, success: 0, errors: 0 }, options };
        io.emit('ai-state', contentState);
        log(io, 'BẮT ĐẦU TẠO NỘI DUNG AI');
        startGeneration(io, options);
    },
    pause: (io) => {
        if (contentState.status === 'running') {
            contentState.status = 'paused';
            log(io, 'Tiến trình đã tạm dừng.', 'warning');
            io.emit('ai-state', contentState);
        }
    },
    resume: (io) => {
        if (contentState.status === 'paused') {
            contentState.status = 'running';
            log(io, 'Tiến trình đã tiếp tục.');
            io.emit('ai-state', contentState);
        }
    },
    stop: (io, reason) => {
        if (contentState.status === 'stopped') return;
        contentState.status = 'stopped';
        log(io, reason || 'Tiến trình đã dừng theo yêu cầu.', 'error');
        io.emit('ai-state', contentState);
        io.emit('ai-finished', 'stopped');
    },
    getState: () => contentState,
    clearLog: () => {
        if (fs.existsSync(LOG_FILE_PATH)) fs.writeFileSync(LOG_FILE_PATH, '');
        contentState.logs = [];
    }
};

async function startGeneration(io, options) {
    const { target, concurrency, delay, systemPrompt, userPrompt, apiKeys, model, post_status } = options;
    
    const effectiveApiKeys = apiKeys.length > 0 ? apiKeys : [process.env.OPENAI_API_KEY].filter(Boolean);
    if (effectiveApiKeys.length === 0) {
        return control.stop(io, '❌ Lỗi: Không có OpenAI API Key. Vui lòng cung cấp key trong cài đặt hoặc file .env.');
    }

    let currentKeyIndex = 0;
    try {
        let whereCondition = {};
        if (target === 'empty') {
            whereCondition.ai_content = { [Op.or]: [null, ''] };
        }
        
        log(io, `PHASE 1: Đang tìm phim trong CSDL...`);
        let moviesToProcess = await Movie.findAll({ 
            where: whereCondition, 
            order: target === 'random_10' ? sequelize.random() : [['created_at', 'DESC']],
            limit: target === 'random_10' ? 10 : null
        });

        if (moviesToProcess.length === 0) {
            log(io, 'Không tìm thấy phim nào phù hợp để xử lý.', 'warning');
            contentState.status = 'idle';
            return io.emit('ai-finished', 'completed');
        }

        log(io, `PHASE 1 KẾT THÚC: Tìm thấy ${moviesToProcess.length} phim.`);
        contentState.progress.total = moviesToProcess.length;
        io.emit('ai-start', { total: moviesToProcess.length });

        for (let i = 0; i < moviesToProcess.length; i += concurrency) {
            await checkStatus();
            const batch = moviesToProcess.slice(i, i + concurrency);

            const results = await Promise.all(batch.map(async (movie) => {
                let success = false;
                let result = null;
                while (!success) {
                    if (contentState.status === 'stopped') return null;
                    if (currentKeyIndex >= effectiveApiKeys.length) {
                        throw new Error('Tất cả API key đều không hợp lệ hoặc đã hết hạn mức.');
                    }
                    try {
                        result = await processMovie(movie, systemPrompt, userPrompt, effectiveApiKeys[currentKeyIndex], model, io, post_status);
                        success = true; // Success, exit while loop
                    } catch (error) {
                        // OpenAI v4+ uses error.status directly
                        if (error.status === 401 || error.status === 429) {
                            log(io, `Key API thứ ${currentKeyIndex + 1} gặp lỗi. Thử key tiếp theo...`, 'warning');
                            currentKeyIndex++;
                        } else {
                            // For other errors, re-throw to be caught by the main catch block and stop the process
                            throw error;
                        }
                    }
                }
                return result;
            }));
            
            results.forEach(result => {
                if (result) {
                    contentState.progress.success++;
                    contentState.results.push(result);
                    io.emit('ai-movie-processed', result);
                } else if(contentState.status !== 'stopped') {
                    contentState.progress.errors++;
                }
            });
            
            contentState.progress.processed += batch.length;
            io.emit('ai-progress', contentState.progress);

            if (contentState.status === 'stopped') break; // Exit for loop if stopped

            log(io, `--- Hoàn thành lô ${Math.floor(i / concurrency) + 1} / ${Math.ceil(moviesToProcess.length / concurrency)} ---`);
            if (delay > 0) await sleep(delay);
        }
        
        if (contentState.status !== 'stopped') {
            log(io, '✅ TIẾN TRÌNH HOÀN TẤT!', 'success');
            contentState.status = 'idle';
            io.emit('ai-finished', 'completed');
        }

    } catch (error) {
        if (contentState.status !== 'stopped') {
            const errorMessage = (error && error.message) ? error.message : 'Lỗi không xác định.';
            if (errorMessage !== 'AI process stopped by user') {
                control.stop(io, `❌ Đã xảy ra lỗi nghiêm trọng: ${errorMessage}`);
            }
        }
    }
}

async function processMovie(movie, systemPrompt, userPrompt, apiKey, model, io, post_status) {
    const MAX_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            await checkStatus();
            log(io, `  -> Đang xử lý phim: "${movie.name}" với model: ${model} (Lần thử ${attempt})`);

            const finalUserPrompt = replaceVariablesInPrompt(userPrompt, movie.toJSON());
            
            const openai = new OpenAI({ apiKey });
            const completion = await openai.chat.completions.create({
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: finalUserPrompt }
                ],
                model: model,
                response_format: { "type": "json_object" },
            });
            
            let resultJson = completion.choices[0].message.content;
            if (!resultJson) throw new Error('API không trả về kết quả.');
            
            const updateData = { ai_content: resultJson };
            if (post_status) {
                updateData.status = post_status;
            }

            await Movie.update(updateData, { where: { _id: movie._id } });
            return {
                _id: movie._id,
                name: movie.name,
                status: 'updated',
                ai_content: resultJson 
            };
        } catch (error) {
            // OpenAI v4+ uses error.status directly
            if (error.status === 401 || error.status === 429) {
                throw error; // Re-throw to be caught by the key-switching logic in startGeneration
            }
            
            log(io, `Lỗi xử lý phim "${movie.name}" (lần thử ${attempt}): ${error.message}`, 'warning');
            if (attempt === MAX_RETRIES) {
                log(io, `Bỏ qua phim "${movie.name}" sau ${MAX_RETRIES} lần thử thất bại.`, 'error');
                return null;
            }
            await sleep(2000); // Wait before retrying for non-API key errors
        }
    }
}

function replaceVariablesInPrompt(prompt, movieData) {
    let replacedPrompt = prompt;
    for (const key in movieData) {
        if (Object.hasOwnProperty.call(movieData, key)) {
            const placeholder = `{${key}}`;
            const value = typeof movieData[key] === 'object' ? JSON.stringify(movieData[key]) : String(movieData[key]);
            replacedPrompt = replacedPrompt.split(placeholder).join(value || '');
        }
    }
    return replacedPrompt;
}

module.exports = control;