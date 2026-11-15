// ==UserScript==
// @name         Torn Faction Full War & Payout Engine
// @namespace    http://tampermonkey.net/
// @version      2.0.0
// @description  Deep-paginating faction war, chain, retal, and assist tracker with automated payout calculations and CSV export.
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

    const MAX_CHUNKS = 60; // Up to 6,000 attacks deep scan

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
    `;
    const styleSheet = document.createElement("style");
    styleSheet.innerText = styles;
    document.head.appendChild(styleSheet);

    let compiledMemberStats = {};

    function injectDashboard() {
        if (document.getElementById('war-payout-dashboard')) return;

        const target = document.querySelector('.content-wrapper');
        if (!target) return;

        const dashboard = document.createElement('div');
        dashboard.id = 'war-payout-dashboard';
        dashboard.className = 'war-payout-wrap';

        const savedKey = GM_getValue('wp_torn_api_key', '');
        const cfg = {
            pool: GM_getValue('wp_pool', '1000000000'),
            warHit: GM_getValue('wp_war_hit', '1000000'),
            chainHit: GM_getValue('wp_chain_hit', '120000'),
            nonWarHit: GM_getValue('wp_non_war_hit', '50000'),
            retal: GM_getValue('wp_retal', '10000'),
            assist: GM_getValue('wp_assist', '25000'),
            respectRate: GM_getValue('wp_respect_rate', '0'),
            splitRemainder: GM_getValue('wp_split_remainder', true)
        };

        dashboard.innerHTML = `
            <div class="war-payout-title">
                <span>⚔️ Faction Full War & Payout Engine</span>
                <div>
                    <button id="wp-run-btn" class="wp-btn scan">🚀 Run Deep Attack Scan</button>
                    <button id="wp-toggle-payout-btn" class="wp-btn config">💰 Payout Rates</button>
                    <button id="wp-toggle-dates-btn" class="wp-btn secondary">📅 War Window</button>
                    <button id="wp-toggle-settings-btn" class="wp-btn secondary">⚙️ API Key</button>
                    <button id="wp-export-btn" class="wp-btn export" style="display: none;">📥 Export Payslips</button>
                </div>
            </div>

            <!-- Payout Config Panel -->
            <div id="wp-payout-panel" class="wp-panel">
                <div class="wp-grid">
                    <div class="wp-field">
                        <label>Total Reward Pool ($):</label>
                        <input type="number" id="wp-pool" class="wp-input" value="${cfg.pool}">
                    </div>
                    <div class="wp-field">
                        <label>War Hit Pay ($):</label>
                        <input type="number" id="wp-war-hit" class="wp-input" value="${cfg.warHit}">
                    </div>
                    <div class="wp-field">
                        <label>Chain Hit Pay ($):</label>
                        <input type="number" id="wp-chain-hit" class="wp-input" value="${cfg.chainHit}">
                    </div>
                    <div class="wp-field">
                        <label>Non-War / Outside Hit ($):</label>
                        <input type="number" id="wp-non-war-hit" class="wp-input" value="${cfg.nonWarHit}">
                    </div>
                    <div class="wp-field">
                        <label>Retaliation Bonus ($):</label>
                        <input type="number" id="wp-retal" class="wp-input" value="${cfg.retal}">
                    </div>
                    <div class="wp-field">
                        <label>Assist Bonus ($):</label>
                        <input type="number" id="wp-assist" class="wp-input" value="${cfg.assist}">
                    </div>
                    <div class="wp-field">
                        <label>Fixed $/Respect (Optional):</label>
                        <input type="number" id="wp-respect-rate" class="wp-input" value="${cfg.respectRate}">
                    </div>
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
                    <label style="font-size:12px; color:#ffca28; cursor:pointer;">
                        <input type="checkbox" id="wp-split-remainder" ${cfg.splitRemainder ? 'checked' : ''}> 
                        Auto-split remaining Reward Pool proportionally by <b>Respect Gained</b>
                    </label>
                    <button id="wp-recalc-btn" class="wp-btn">Save & Recalculate</button>
                </div>
            </div>

            <!-- Date Window Panel -->
            <div id="wp-dates-panel" class="wp-panel">
                <p style="font-size:12px; color:#aaa; margin-top:0;">Set start and end time for the war scan (defaults to past 7 days if blank):</p>
                <div class="wp-grid" style="max-width: 500px; margin-bottom: 0;">
                    <div class="wp-field">
                        <label>Window Start:</label>
                        <input type="datetime-local" id="wp-start-date" class="wp-input">
                    </div>
                    <div class="wp-field">
                        <label>Window End:</label>
                        <input type="datetime-local" id="wp-end-date" class="wp-input">
                    </div>
                </div>
            </div>

            <!-- API Settings Panel -->
            <div id="wp-settings-panel" class="wp-panel">
                <p style="font-size:12px; margin-top:0; margin-bottom:8px; color:#aaa;">Enter your Faction-Enabled API Key:</p>
                <div style="display:flex; gap:8px; max-width: 450px;">
                    <input type="password" id="wp-api-input" class="wp-input" value="${savedKey}" placeholder="Paste API Key...">
                    <button id="wp-save-key-btn" class="wp-btn">Save</button>
                </div>
                <div id="wp-key-status" style="margin-top: 6px; font-size: 12px;"></div>
            </div>

            <div id="wp-results">
                ${savedKey ? 
                  '<p style="color: #aaa; font-size:12px;">Click <b>🚀 Run Deep Attack Scan</b> to pull all historical war hits, chains, retals, and assists directly from Torn!</p>' : 
                  '<p style="color: #ff9800; font-size:12px;">⚠️ API Key missing. Click <b>⚙️ API Key</b> above to configure it.</p>'}
            </div>
        `;

        target.insertBefore(dashboard, target.firstChild);

        const panels = {
            payout: document.getElementById('wp-payout-panel'),
            dates: document.getElementById('wp-dates-panel'),
            settings: document.getElementById('wp-settings-panel')
        };

        function togglePanel(key) {
            Object.keys(panels).forEach(k => {
                panels[k].style.display = (k === key && panels[k].style.display !== 'block') ? 'block' : 'none';
            });
        }

        document.getElementById('wp-toggle-payout-btn').addEventListener('click', () => togglePanel('payout'));
        document.getElementById('wp-toggle-dates-btn').addEventListener('click', () => togglePanel('dates'));
        document.getElementById('wp-toggle-settings-btn').addEventListener('click', () => togglePanel('settings'));

        document.getElementById('wp-save-key-btn').addEventListener('click', () => {
            const val = document.getElementById('wp-api-input').value.trim();
            GM_setValue('wp_torn_api_key', val);
            const status = document.getElementById('wp-key-status');
            status.style.color = '#4caf50';
            status.innerText = '✅ API Key saved!';
            setTimeout(() => { status.innerText = ''; panels.settings.style.display = 'none'; }, 1200);
        });

        document.getElementById('wp-recalc-btn').addEventListener('click', () => {
            GM_setValue('wp_pool', document.getElementById('wp-pool').value);
            GM_setValue('wp_war_hit', document.getElementById('wp-war-hit').value);
            GM_setValue('wp_chain_hit', document.getElementById('wp-chain-hit').value);
            GM_setValue('wp_non_war_hit', document.getElementById('wp-non-war-hit').value);
            GM_setValue('wp_retal', document.getElementById('wp-retal').value);
            GM_setValue('wp_assist', document.getElementById('wp-assist').value);
            GM_setValue('wp_respect_rate', document.getElementById('wp-respect-rate').value);
            GM_setValue('wp_split_remainder', document.getElementById('wp-split-remainder').checked);

            panels.payout.style.display = 'none';
            if (Object.keys(compiledMemberStats).length > 0) renderPayslips();
        });

        document.getElementById('wp-run-btn').addEventListener('click', () => {
            const apiKey = GM_getValue('wp_torn_api_key', '');
            if (!apiKey) {
                alert('Please save your Torn API key first.');
                togglePanel('settings');
                return;
            }
            startDeepAttackScan(apiKey);
        });

        document.getElementById('wp-export-btn').addEventListener('click', exportPayslipsCSV);
    }

    function startDeepAttackScan(apiKey) {
        const resultsEl = document.getElementById('wp-results');
        document.getElementById('wp-export-btn').style.display = 'none';

        const now = Math.floor(Date.now() / 1000);
        const startVal = document.getElementById('wp-start-date').value;
        const endVal = document.getElementById('wp-end-date').value;

        const startTime = startVal ? Math.floor(new Date(startVal).getTime() / 1000) : (now - (7 * 24 * 60 * 60));
        let scanTo = endVal ? Math.floor(new Date(endVal).getTime() / 1000) : now;
        if (scanTo > now) scanTo = now;

        resultsEl.innerHTML = `<p style="color:#ffca28;">Fetching faction roster...</p>`;

        // 1. Fetch Roster First
        GM_xmlhttpRequest({
            method: "GET",
            url: `https://api.torn.com/faction/?selections=basic&key=${apiKey}`,
            onload: function(res) {
                try {
                    const data = JSON.parse(res.responseText);
                    if (data.error) {
                        resultsEl.innerHTML = `<p style="color:#f44336;">API Error: ${data.error.error}</p>`;
                        return;
                    }
                    const members = data.members || {};
                    paginateAttacks(apiKey, startTime, scanTo, members);
                } catch (e) {
                    resultsEl.innerHTML
