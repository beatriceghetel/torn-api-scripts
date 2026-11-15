// ==UserScript==
// @name         Torn War & Chain Report Payout Engine
// @namespace    http://tampermonkey.net/
// @version      3.0.0
// @description  Pulls permanent ranked war and chain reports from Torn API for accurate payslips and bonus splits.
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
                        if (data.error) reject(`API Error (${data.error.code}): ${data.error.error}`);
                        else resolve(data);
                    } catch (e) {
                        reject("Invalid JSON response from Torn API.");
                    }
                },
                onerror: () => reject("Network connection failed.")
            });
        });
    }

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
            retal: GM_getValue('wp_retal', '10000'),
            assist: GM_getValue('wp_assist', '25000'),
            respectRate: GM_getValue('wp_respect_rate', '0'),
            splitRemainder: GM_getValue('wp_split_remainder', true)
        };

        dashboard.innerHTML = `
            <div class="war-payout-title">
                <span>⚔️ Permanent War & Chain Report Engine</span>
                <div>
                    <button id="wp-run-btn" class="wp-btn scan">🚀 Fetch War Reports</button>
                    <button id="wp-toggle-payout-btn" class="wp-btn config">💰 Payout Rates</button>
                    <button id="wp-toggle-settings-btn" class="wp-btn secondary">⚙️ API Key</button>
                    <button id="wp-export-btn" class="wp-btn export" style="display: none;">📥 Export CSV</button>
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
                        <label>Retaliation Bonus ($):</label>
                        <input type="number" id="wp-retal" class="wp-input" value="${cfg.retal}">
                    </div>
                    <div class="wp-field">
                        <label>Assist Bonus ($):</label>
                        <input type="number" id="wp-assist" class="wp-input" value="${cfg.assist}">
                    </div>
                    <div class="wp-field">
                        <label>Fixed $/Score (Optional):</label>
                        <input type="number" id="wp-respect-rate" class="wp-input" value="${cfg.respectRate}">
                    </div>
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
                    <label style="font-size:12px; color:#ffca28; cursor:pointer;">
                        <input type="checkbox" id="wp-split-remainder" ${cfg.splitRemainder ? 'checked' : ''}> 
                        Auto-split remaining Reward Pool proportionally by <b>War Score</b>
                    </label>
                    <button id="wp-recalc-btn" class="wp-btn">Save & Recalculate</button>
                </div>
            </div>

            <!-- API Settings Panel -->
            <div id="wp-settings-panel" class="wp-panel">
                <p style="font-size:12px; margin-top:0; margin-bottom:8px; color:#aaa;">Enter your API Key:</p>
                <div style="display:flex; gap:8px; max-width: 450px;">
                    <input type="password" id="wp-api-input" class="wp-input" value="${savedKey}" placeholder="Paste API Key...">
                    <button id="wp-save-key-btn" class="wp-btn">Save</button>
                </div>
                <div id="wp-key-status" style="margin-top: 6px; font-size: 12px;"></div>
            </div>

            <div id="wp-results">
                ${savedKey ? 
                  '<p style="color: #aaa; font-size:12px;">Click <b>🚀 Fetch War Reports</b> to pull exact war scores and hits directly from Torn report logs.</p>' : 
                  '<p style="color: #ff9800; font-size:12px;">⚠️ API Key missing. Click <b>⚙️ API Key</b> above to configure it.</p>'}
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
            fetchWarReports(apiKey);
        });

        document.getElementById('wp-export-btn').addEventListener('click', exportPayslipsCSV);
    }

    async function fetchWarReports(apiKey) {
        const resultsEl = document.getElementById('wp-results');
        document.getElementById('wp-export-btn').style.display = 'none';

        try {
            resultsEl.innerHTML = `<p style="color:#ffca28;">Identifying faction ID and fetching roster...</p>`;
            const profileData = await apiGet(`https://api.torn.com/user/?selections=profile&key=${apiKey}`);
            const myFactionId = profileData.faction?.faction_id;

            if (!myFactionId) {
                resultsEl.innerHTML = `<p style="color:#f44336;">Error: API key owner is not in a faction.</p>`;
                return;
            }

            const basicData = await apiGet(`https://api.torn.com/faction/${myFactionId}?selections=basic&key=${apiKey}`);
            const members = basicData.members || {};

            const stats = {};
            Object.entries(members).forEach(([id, info]) => {
                stats[info.name] = {
                    id: id,
                    name: info.name,
                    warHits: 0,
                    chainHits: 0,
                    retals: 0,
                    assists: 0,
                    respect: 0
                };
            });

            // Fetch Ranked Wars list
            resultsEl.innerHTML = `<p style="color:#ffca28;">Fetching ranked war history...</p>`;
            const rwList = await apiGet(`https://api.torn.com/faction/${myFactionId}?selections=rankedwars&key=${apiKey}`);
            const rankedWars = rwList.rankedwars || {};

            let foundReport = false;
            for (const [warId, warInfo] of Object.entries(rankedWars)) {
                resultsEl.innerHTML = `<p style="color:#ffca28;">Reading Ranked War Report #${warId}...</p>`;
                try {
                    const reportData = await apiGet(`https://api.torn.com/torn/${warId}?selections=rankedwarreport&key=${apiKey}`);
                    const factions = reportData.rankedwarreport?.factions || {};
                    const ourFactionReport = factions[myFactionId];

                    if (ourFactionReport && ourFactionReport.members) {
                        foundReport = true;
                        Object.entries(ourFactionReport.members).forEach(([mId, mData]) => {
                            const name = mData.name;
                            if (!stats[name]) {
                                stats[name] = { id: mId, name: name, warHits: 0, chainHits: 0, retals: 0, assists: 0, respect: 0 };
                            }
                            stats[name].warHits += (parseInt(mData.attacks, 10) || 0);
                            stats[name].respect += (parseFloat(mData.score) || 0);
                        });
                    }
                } catch (e) {
                    console.warn(`Could not load war report ${warId}:`, e);
                }
            }

            if (!foundReport) {
                resultsEl.innerHTML = `<p style="color:#ff9800;">⚠️ No ranked war report found. Checking recent chain reports...</p>`;
            }

            // Fetch recent chains
            resultsEl.innerHTML = `<p style="color:#ffca28;>Fetching recent chain reports...</p>`;
            const chainList = await apiGet(`https://api.torn.com/faction/${myFactionId}?selections=chains&key=${apiKey}`);
            const chains = chainList.chains || {};
            const recentChainIds = Object.keys(chains).slice(-5); // Check last 5 chains

            for (const chainId of recentChainIds) {
                try {
                    const cData = await apiGet(`https://api.torn.com/torn/${chainId}?selections=chainreport&key=${apiKey}`);
                    const cMembers = cData.chainreport?.members || {};

                    Object.entries(cMembers).forEach(([mId, mData]) => {
                        const name = mData.name;
                        if (!stats[name]) {
                            stats[name] = { id: mId, name: name, warHits: 0, chainHits: 0, retals: 0, assists: 0, respect: 0 };
                        }
                        stats[name].chainHits += (parseInt(mData.attacks, 10) || 0);
                        stats[name].retals += (parseInt(mData.retaliations, 10) || 0);
                        stats[name].assists += (parseInt(mData.assists, 10) || 0);
                    });
                } catch (e) {
                    console.warn(`Could not load chain report ${chainId}:`, e);
                }
            }

            compiledMemberStats = stats;
            renderPayslips();

        } catch (err) {
            resultsEl.innerHTML = `<p style="color:#f44336;">${err}</p>`;
        }
    }

    function formatMoney(num) {
        return '$' + Math.round(num).toLocaleString();
    }

    function renderPayslips() {
        const resultsEl = document.getElementById('wp-results');
        const exportBtn = document.getElementById('wp-export-btn');

        const pool = parseFloat(GM_getValue('wp_pool', '1000000000')) || 0;
        const rateWar = parseFloat(GM_getValue('wp_war_hit', '1000000')) || 0;
        const rateChain = parseFloat(GM_getValue('wp_chain_hit', '120000')) || 0;
        const rateRetal = parseFloat(GM_getValue('wp_retal', '10000')) || 0;
        const rateAssist = parseFloat(GM_getValue('wp_assist', '25000')) || 0;
        const rateRespect = parseFloat(GM_getValue('wp_respect_rate', '0')) || 0;
        const splitRemainder = GM_getValue('wp_split_remainder', true);

        const activeMembers = Object.values(compiledMemberStats).filter(m =>
            m.warHits > 0 || m.chainHits > 0 || m.retals > 0 || m.assists > 0 || m.respect > 0
        );

        if (activeMembers.length === 0) {
            resultsEl.innerHTML = `<p style="color:#aaa;">No war or chain hits recorded in reports.</p>`;
            exportBtn.style.display = 'none';
            return;
        }

        exportBtn.style.display = 'inline-block';

        let totalFactionScore = 0;
        let totalBasePay = 0;

        activeMembers.forEach(m => {
            totalFactionScore += m.respect;
            m.basePay = (m.warHits * rateWar) +
                        (m.chainHits * rateChain) +
                        (m.retals * rateRetal) +
                        (m.assists * rateAssist) +
                        (m.respect * rateRespect);
            totalBasePay += m.basePay;
        });

        const remainderPool = Math.max(0, pool - totalBasePay);
        const perScoreBonus = (splitRemainder && totalFactionScore > 0 && remainderPool > 0)
            ? (remainderPool / totalFactionScore)
            : 0;

        activeMembers.forEach(m => {
            m.scoreBonus = m.respect * perScoreBonus;
            m.finalPay = m.basePay + m.scoreBonus;
        });

        activeMembers.sort((a, b) => b.finalPay - a.finalPay);
        const totalDistributed = activeMembers.reduce((sum, m) => sum + m.finalPay, 0);

        let html = `
            <div class="wp-summary-bar">
                <div><strong>Reward Pool:</strong> ${formatMoney(pool)}</div>
                <div><strong>Direct Hit/Bonus Pay:</strong> ${formatMoney(totalBasePay)}</div>
                <div><strong>War Score Pool Split:</strong> ${formatMoney(splitRemainder ? remainderPool : 0)} (${formatMoney(perScoreBonus)}/score)</div>
                <div style="color:#4caf50;"><strong>Total Payout:</strong> ${formatMoney(totalDistributed)}</div>
            </div>
            <table class="war-payout-table">
                <thead>
                    <tr>
                        <th style="text-align:left;">Member</th>
                        <th>War Hits</th>
                        <th>Chain Hits</th>
                        <th>Retals</th>
                        <th>Assists</th>
                        <th>War Score</th>
                        <th style="color:#ffca28;">Total Paycheck</th>
                        <th style="text-align:left;">Payslip Calculation Breakdown</th>
                    </tr>
                </thead>
                <tbody>
        `;

        activeMembers.forEach(m => {
            const parts = [];
            if (m.warHits > 0 && rateWar > 0) parts.push(`${m.warHits} War (${formatMoney(m.warHits * rateWar)})`);
            if (m.chainHits > 0 && rateChain > 0) parts.push(`${m.chainHits} Chain (${formatMoney(m.chainHits * rateChain)})`);
            if (m.retals > 0 && rateRetal > 0) parts.push(`${m.retals} Retal (${formatMoney(m.retals * rateRetal)})`);
            if (m.assists > 0 && rateAssist > 0) parts.push(`${m.assists} Assist (${formatMoney(m.assists * rateAssist)})`);
            if (m.respect > 0 && rateRespect > 0) parts.push(`${m.respect.toFixed(2)} Score (${formatMoney(m.respect * rateRespect)})`);
            if (m.scoreBonus > 0) parts.push(`Pool Share (${formatMoney(m.scoreBonus)})`);

            const explanation = parts.length > 0 ? parts.join(' + ') : 'No payable actions';

            html += `
                <tr>
                    <td><strong>${m.name}</strong></td>
                    <td>${m.warHits}</td>
                    <td>${m.chainHits}</td>
                    <td>${m.retals}</td>
                    <td>${m.assists}</td>
                    <td>${m.respect.toFixed(2)}</td>
                    <td style="color:#4caf50 !important; font-weight:bold;">${formatMoney(m.finalPay)}</td>
                    <td style="font-size:11px; color:#ccc !important;">${explanation}</td>
                </tr>
            `;
        });

        html += `</tbody></table>`;
        resultsEl.innerHTML = html;
    }

    function exportPayslipsCSV() {
        const activeMembers = Object.values(compiledMemberStats).filter(m => m.finalPay !== undefined);
        if (activeMembers.length === 0) return;

        let csv = "Member,War Hits,Chain Hits,Retals,Assists,War Score,Base Pay,Score Bonus,Total Paycheck\n";
        activeMembers.sort((a, b) => b.finalPay - a.finalPay).forEach(m => {
            csv += `"${m.name}",${m.warHits},${m.chainHits},${m.retals},${m.assists},${m.respect.toFixed(2)},${Math.round(m.basePay)},${Math.round(m.scoreBonus)},${Math.round(m.finalPay)}\n`;
        });

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `Faction_War_Payslips_${new Date().toISOString().slice(0,10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    const observer = new MutationObserver(() => injectDashboard());
    observer.observe(document.body, { childList: true, subtree: true });
    injectDashboard();
})();
