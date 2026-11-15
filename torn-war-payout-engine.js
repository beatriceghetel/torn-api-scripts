// ==UserScript==
// @name         Torn Faction-Filtered War & Chain Payout Engine
// @namespace    http://tampermonkey.net/
// @version      3.0.4
// @description  Pulls exact Ranked War & Chain reports by ID, strictly filtering and paying only members of your own faction.
// @author       beatrice
// @license      MIT
// @match        https://www.torn.com/factions.php*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      api.torn.com
// ==/UserScript==

(function() {
    'use strict';

    const styles = `
        .war-payout-wrap { background: #222; color: #fff; padding: 15px; margin: 10px 0; border-radius: 5px; border: 1px solid #444; font-family: Arial, sans-serif; }
        .war-payout-title { font-size: 16px; font-weight: bold; margin-bottom: 10px; color: #ffca28; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }
        .war-payout-table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 13px; }
        .war-payout-table th, .war-payout-table td { border: 1px solid #444; padding: 8px; text-align: center; }
        .war-payout-table th { background-color: #333; color: #aaa; font-size: 12px; }
        .war-payout-table td:first-child, .war-payout-table td:last-child { text-align: left; }
        .war-payout-table tr:nth-child(even) { background-color: #2a2a2a; }
        .war-payout-table td strong, .war-payout-table td { color: #ffffff !important; }

        .wp-btn { background: #4caf50; color: white; border: none; padding: 6px 12px; cursor: pointer; border-radius: 3px; font-size: 12px; font-weight: bold; margin-right: 5px; }
        .wp-btn:hover { background: #45a049; }
        .wp-btn.scan { background: #2196f3; color: white; }
        .wp-btn.scan:hover { background: #1976d2; }
        .wp-btn.secondary { background: #444; color: #ccc; }
        .wp-btn.secondary:hover { background: #555; color: #fff; }
        .wp-btn.config { background: #ff9800; color: #111; }
        .wp-btn.config:hover { background: #e68900; }
        .wp-btn.export { background: #007acc; }
        .wp-btn.export:hover { background: #0062a3; }

        .wp-panel { display: none; background: #1a1a1a; border: 1px solid #333; padding: 12px; margin-bottom: 15px; border-radius: 4px; }
        .wp-input { padding: 6px; background: #111; border: 1px solid #444; color: #fff; border-radius: 3px; font-size: 12px; width: 100%; box-sizing: border-box; }
        .wp-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(175px, 1fr)); gap: 10px; margin-bottom: 12px; }
        .wp-field { display: flex; flex-direction: column; font-size: 12px; color: #bbb; }
        .wp-field label { margin-bottom: 4px; }
        .wp-summary-bar { background: #181818; border: 1px solid #333; padding: 10px; border-radius: 4px; margin-bottom: 10px; font-size: 12px; display: flex; flex-wrap: wrap; gap: 15px; justify-content: space-between; }
        .wp-id-bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; background: #1a1a1a; padding: 10px; border-radius: 4px; border: 1px solid #333; margin-bottom: 10px; }
    `;
    const styleSheet = document.createElement("style");
    styleSheet.innerText = styles;
    document.head.appendChild(styleSheet);

    let compiledMemberStats = {};

    function apiGet(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: url,
                onload: res => {
                    try {
                        const data = JSON.parse(res.responseText);
                        if (data.error) reject(`API Error (${data.error.code}):${data.error.error}`);
                        else resolve(data);
                    } catch (e) {
                        reject("Invalid JSON response from Torn API.");
                    }
                },
                onerror: () => reject("Network connection failed.")
            });
        });
    }

    function detectIdsFromUrl() {
        const full = (window.location.hash || '') + '&' + (window.location.search || '');
        const rankMatch = full.match(/rankID=(\d+)/i);
        const chainMatch = full.match(/chain(?:ID)?[=/](\d+)/i);
        return {
            rankId: rankMatch ? rankMatch[1] : '',
            chainId: chainMatch ? chainMatch[1] : ''
        };
    }

    function appendChainIdToInput(newId) {
        if (!newId) return;
        const input = document.getElementById('wp-chain-ids');
        if (!input) return;
        const existing = input.value.split(',').map(s => s.trim()).filter(Boolean);
        if (!existing.includes(newId)) {
            existing.push(newId);
            input.value = existing.join(', ');
            GM_setValue('wp_chain_ids', input.value);
        }
    }

    function injectDashboard() {
        if (document.getElementById('war-payout-dashboard')) return;

        const target = document.querySelector('.content-wrapper');
        if (!target) return;

        const dashboard = document.createElement('div');
        dashboard.id = 'war-payout-dashboard';
        dashboard.className = 'war-payout-wrap';

        const savedKey = GM_getValue('wp_torn_api_key', '');
        const detected = detectIdsFromUrl();
        const savedRankId = detected.rankId || GM_getValue('wp_rank_id', '');
        let savedChainIds = GM_getValue('wp_chain_ids', '');

        if (detected.chainId) {
            const list = savedChainIds.split(',').map(s => s.trim()).filter(Boolean);
            if (!list.includes(detected.chainId)) {
                list.push(detected.chainId);
                savedChainIds = list.join(', ');
                GM_setValue('wp_chain_ids', savedChainIds);
            }
        }

        const cfg = {
            pool: GM_getValue('wp_pool', '1000000000'),
            warHit: GM_getValue('wp_war_hit', '1000000'),
            chainHit: GM_getValue('wp_chain_hit', '120000'),
            retal: GM_getValue('wp_retal', '10000'),
            assist: GM_getValue('wp_assist', '25000'),
            respectRate: GM_getValue('wp_respect_rate', '0'),
            splitBasis: GM_getValue('wp_split_basis', 'score')
        };

        dashboard.innerHTML = `
            <div class="war-payout-title">
                <span>⚔️ Faction-Filtered War & Chain Engine</span>
                <div>
                    <button id="wp-run-btn" class="wp-btn scan">🚀 Calculate Payslips</button>
                    <button id="wp-toggle-payout-btn" class="wp-btn config">💰 Payout Rates</button>
                    <button id="wp-toggle-settings-btn" class="wp-btn secondary">⚙️ API Key</button>
                    <button id="wp-export-btn" class="wp-btn export" style="display: none;">📥 Export CSV</button>
                </div>
            </div>

            <!-- ID Input Bar -->
            <div class="wp-id-bar">
                <div style="flex: 1; min-width: 150px;">
                    <label style="font-size:11px; color:#aaa; display:block; margin-bottom:3px;">Ranked War ID (<code>rankID</code>):</label>
                    <input type="text" id="wp-quick-rankid" class="wp-input" value="\${savedRankId}" placeholder="e.g. 12345 (optional)">
                </div>
                <div style="flex: 2; min-width: 240px;">
                    <label style="font-size:11px; color:#aaa; display:block; margin-bottom:3px;">Chain IDs (comma-separated):</label>
                    <div style="display:flex; gap:5px;">
                        <input type="text" id="wp-chain-ids" class="wp-input" value="\${savedChainIds}" placeholder="e.g. 4189201, 4189450">
                        <button id="wp-auto-chains-btn" class="wp-btn secondary" style="white-space:nowrap; margin:0;" title="Fetch recent Chain IDs">Auto-Find</button>
                        <button id="wp-clear-chains-btn" class="wp-btn secondary" style="white-space:nowrap; margin:0;" title="Clear">Clear</button>
                    </div>
                </div>
            </div>

            <!-- Payout Config Panel -->
            <div id="wp-payout-panel" class="wp-panel">
                <div class="wp-grid">
                    <div class="wp-field">
                        <label>Total Reward Pool (\$):</label>
                        <input type="number" id="wp-pool" class="wp-input" value="\${cfg.pool}">
                    </div>
                    <div class="wp-field">
                        <label>Pay per War Hit (\$):</label>
                        <input type="number" id="wp-war-hit" class="wp-input" value="\${cfg.warHit}">
                    </div>
                    <div class="wp-field">
                        <label>Pay per Chain Hit (\$):</label>
                        <input type="number" id="wp-chain-hit" class="wp-input" value="\${cfg.chainHit}">
                    </div>
                    <div class="wp-field">
                        <label>Bonus per Retal (\$):</label>
                        <input type="number" id="wp-retal" class="wp-input" value="\${cfg.retal}">
                    </div>
                    <div class="wp-field">
                        <label>Bonus per Assist (\$):</label>
                        <input type="number" id="wp-assist" class="wp-input" value="\${cfg.assist}">
                    </div>
                    <div class="wp-field">
                        <label>Fixed \$/Respect (Optional):</label>
                        <input type="number" id="wp-respect-rate" class="wp-input" value="\${cfg.respectRate}">
                    </div>
                    <div class="wp-field">
                        <label>Remaining Pool Split By:</label>
                        <select id="wp-split-basis" class="wp-input">
                            <option value="score" \${cfg.splitBasis === 'score' ? 'selected' : ''}>War Score (Scoreboard)</option>
                            <option value="respect" \${cfg.splitBasis === 'respect' ? 'selected' : ''}>Chain Respect Gained</option>
                            <option value="none" \${cfg.splitBasis === 'none' ? 'selected' : ''}>Do Not Split Remainder</option>
                        </select>
                    </div>
                </div>
                <div style="text-align:right;">
                    <button id="wp-recalc-btn" class="wp-btn">Save & Recalculate</button>
                </div>
            </div>

            <!-- API Settings Panel -->
            <div id="wp-settings-panel" class="wp-panel">
                <p style="font-size:12px; margin-top:0; margin-bottom:8px; color:#aaa;">Enter your Torn API Key:</p>
                <div style="display:flex; gap:8px; max-width: 450px;">
                    <input type="password" id="wp-api-input" class="wp-input" value="\${savedKey}" placeholder="Paste API Key...">
                    <button id="wp-save-settings-btn" class="wp-btn">Save Key</button>
                </div>
                <div id="wp-key-status" style="margin-top: 6px; font-size: 12px;"></div>
            </div>

            <div id="wp-results">
                \${savedKey ? 
                  '<p style="color: #aaa; font-size:12px;">Enter your War ID and/or Chain IDs above, then click <b>🚀 Calculate Payslips</b>.</p>' : 
                  '<p style="color: #ff9800; font-size:12px;">⚠️ API Key missing. Click <b>⚙️ API Key</b> above to set it up.</p>'}
            </div>
        `;

        target.insertBefore(dashboard, target.firstChild);

        const panels = {
            payout: document.getElementById('wp-payout-panel'),
            settings: document.getElementById('wp-settings-panel')
        };

        function togglePanel(key) {
            Object.keys(panels).forEach(k => {
                panels[k].style.display = (k === key && panels[k].style.display !== 'block') ? 'block' : 'none';
            });
        }

        document.getElementById('wp-toggle-payout-btn').addEventListener('click', () => togglePanel('payout'));
        document.getElementById('wp-toggle-settings-btn').addEventListener('click', () => togglePanel('settings'));

        document.getElementById('wp-save-settings-btn').addEventListener('click', () => {
            GM_setValue('wp_torn_api_key', document.getElementById('wp-api-input').value.trim());
            const status = document.getElementById('wp-key-status');
            status.style.color = '#4caf50';
            status.innerText = '✅ API Key saved!';
            setTimeout(() => { status.innerText = ''; panels.settings.style.display = 'none'; }, 1200);
        });

        document.getElementById('wp-clear-chains-btn').addEventListener('click', () => {
            document.getElementById('wp-chain-ids').value = '';
            GM_setValue('wp_chain_ids', '');
        });

        document.getElementById('wp-auto-chains-btn').addEventListener('click', async () => {
            const apiKey = GM_getValue('wp_torn_api_key', '');
            if (!apiKey) {
                alert('Please configure your API Key first.');
                togglePanel('settings');
                return;
            }
            const resultsEl = document.getElementById('wp-results');
            try {
                resultsEl.innerHTML = `<p style="color:#ffca28;">Querying faction chain history...</p>`;
                const data = await apiGet(`https://api.torn.com/faction/?selections=chains&key=\${apiKey}`);
                const chains = data.chains || {};
                const recentIds = Object.keys(chains).slice(-10);
                if (recentIds.length === 0) {
                    resultsEl.innerHTML = `<p style="color:#aaa;">No recent chains returned.</p>`;
                    return;
                }
                document.getElementById('wp-chain-ids').value = recentIds.join(', ');
                GM_setValue('wp_chain_ids', recentIds.join(', '));
                resultsEl.innerHTML = `<p style="color:#4caf50; font-size:12px;">✅ Loaded \${recentIds.length} recent Chain IDs!</p>`;
            } catch (err) {
                resultsEl.innerHTML = `<p style="color:#ff980
