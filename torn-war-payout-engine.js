// ==UserScript==
// @name         Torn War & Chain Payout Engine
// @namespace    http://tampermonkey.net/
// @version      3.1.2
// @description  Fixed pool split calculation matching War Hits % divisor and multiplier correctly.
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
        .war-payout-wrap { background: #222; color: #fff; padding: 12px; margin: 10px 0; border-radius: 5px; border: 1px solid #444; font-family: Arial, sans-serif; box-sizing: border-box; width: 100%; overflow: hidden; }
        .war-payout-title { font-size: 15px; font-weight: bold; margin-bottom: 10px; color: #ffca28; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }
        
        /* Mobile horizontal scroll container */
        .wp-table-container { width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; margin-top: 10px; border: 1px solid #444; }
        .wp-table-container::-webkit-scrollbar { height: 8px; }
        .wp-table-container::-webkit-scrollbar-track { background: #1a1a1a; }
        .wp-table-container::-webkit-scrollbar-thumb { background: #555; border-radius: 4px; }

        .war-payout-table { width: 100%; border-collapse: collapse; font-size: 12px; white-space: nowrap; }
        .war-payout-table th, .war-payout-table td { border: 1px solid #444; padding: 8px 10px; text-align: center; }
        .war-payout-table th { background-color: #333; color: #aaa; font-size: 11px; position: sticky; top: 0; z-index: 2; }
        .war-payout-table td:first-child { text-align: left; position: sticky; left: 0; background-color: #222; z-index: 1; }
        .war-payout-table th:first-child { position: sticky; left: 0; z-index: 3; background-color: #333; }
        .war-payout-table td:last-child { text-align: left; white-space: normal; min-width: 200px; }
        .war-payout-table tr:nth-child(even) td:not(:first-child) { background-color: #2a2a2a; }
        .war-payout-table tr:nth-child(odd) td:not(:first-child) { background-color: #222; }
        .war-payout-table td strong, .war-payout-table td { color: #ffffff !important; }

        .wp-btn { background: #4caf50; color: white; border: none; padding: 6px 10px; cursor: pointer; border-radius: 3px; font-size: 11px; font-weight: bold; margin-right: 4px; }
        .wp-btn:hover { background: #45a049; }
        .wp-btn.scan { background: #2196f3; color: white; }
        .wp-btn.secondary { background: #444; color: #ccc; }
        .wp-btn.config { background: #ff9800; color: #111; }
        .wp-btn.export { background: #007acc; }

        .wp-panel { display: none; background: #1a1a1a; border: 1px solid #333; padding: 10px; margin-bottom: 12px; border-radius: 4px; }
        .wp-input { padding: 6px; background: #111; border: 1px solid #444; color: #fff; border-radius: 3px; font-size: 12px; width: 100%; box-sizing: border-box; }
        .wp-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; margin-bottom: 10px; }
        .wp-field { display: flex; flex-direction: column; font-size: 11px; color: #bbb; }
        .wp-field label { margin-bottom: 3px; }
        .wp-summary-bar { background: #181818; border: 1px solid #333; padding: 8px 10px; border-radius: 4px; margin-bottom: 8px; font-size: 11px; display: flex; flex-wrap: wrap; gap: 10px; justify-content: space-between; }
        .wp-id-bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; background: #1a1a1a; padding: 8px; border-radius: 4px; border: 1px solid #333; margin-bottom: 8px; }
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
                <span>⚔️ War & Chain Engine</span>
                <div style="display:flex; flex-wrap:wrap; gap:4px;">
                    <button id="wp-run-btn" class="wp-btn scan">🚀 Calculate</button>
                    <button id="wp-toggle-payout-btn" class="wp-btn config">💰 Rates</button>
                    <button id="wp-toggle-settings-btn" class="wp-btn secondary">⚙️ Key</button>
                    <button id="wp-export-btn" class="wp-btn export" style="display: none;">📥 CSV</button>
                </div>
            </div>

            <!-- ID Input Bar -->
            <div class="wp-id-bar">
                <div style="flex: 1; min-width: 120px;">
                    <label style="font-size:10px; color:#aaa; display:block; margin-bottom:2px;">War ID (rankID):</label>
                    <input type="text" id="wp-quick-rankid" class="wp-input" value="${savedRankId}" placeholder="e.g. 52425">
                </div>
                <div style="flex: 2; min-width: 180px;">
                    <label style="font-size:10px; color:#aaa; display:block; margin-bottom:2px;">Chain IDs:</label>
                    <div style="display:flex; gap:4px;">
                        <input type="text" id="wp-chain-ids" class="wp-input" value="${savedChainIds}" placeholder="IDs...">
                        <button id="wp-auto-chains-btn" class="wp-btn secondary" style="margin:0;">Auto</button>
                        <button id="wp-clear-chains-btn" class="wp-btn secondary" style="margin:0;">X</button>
                    </div>
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
                        <label>Pay per War Hit ($):</label>
                        <input type="number" id="wp-war-hit" class="wp-input" value="${cfg.warHit}">
                    </div>
                    <div class="wp-field">
                        <label>Pay per Chain Hit ($):</label>
                        <input type="number" id="wp-chain-hit" class="wp-input" value="${cfg.chainHit}">
                    </div>
                    <div class="wp-field">
                        <label>Bonus per Retal ($):</label>
                        <input type="number" id="wp-retal" class="wp-input" value="${cfg.retal}">
                    </div>
                    <div class="wp-field">
                        <label>Bonus per Assist ($):</label>
                        <input type="number" id="wp-assist" class="wp-input" value="${cfg.assist}">
                    </div>
                    <div class="wp-field">
                        <label>Fixed $/Respect:</label>
                        <input type="number" id="wp-respect-rate" class="wp-input" value="${cfg.respectRate}">
                    </div>
                    <div class="wp-field" style="grid-column: 1 / -1;">
                        <label>Remaining Pool Split By:</label>
                        <select id="wp-split-basis" class="wp-input">
                            <option value="score" ${cfg.splitBasis === 'score' ? 'selected' : ''}>War Score (Scoreboard)</option>
                            <option value="warhits" ${cfg.splitBasis === 'warhits' ? 'selected' : ''}>War Hits % (Proportional)</option>
                            <option value="respect" ${cfg.splitBasis === 'respect' ? 'selected' : ''}>Chain Respect Gained</option>
                            <option value="none" ${cfg.splitBasis === 'none' ? 'selected' : ''}>Do Not Split Remainder</option>
                        </select>
                    </div>
                </div>
                <div style="text-align:right;">
                    <button id="wp-recalc-btn" class="wp-btn">Save & Recalculate</button>
                </div>
            </div>

            <!-- API Settings Panel -->
            <div id="wp-settings-panel" class="wp-panel">
                <p style="font-size:11px; margin-top:0; margin-bottom:6px; color:#aaa;">Enter your Torn API Key:</p>
                <div style="display:flex; gap:6px;">
                    <input type="password" id="wp-api-input" class="wp-input" value="${savedKey}" placeholder="Paste API Key...">
                    <button id="wp-save-settings-btn" class="wp-btn">Save</button>
                </div>
                <div id="wp-key-status" style="margin-top: 4px; font-size: 11px;"></div>
            </div>

            <div id="wp-results">
                ${savedKey ? 
                  '<p style="color: #aaa; font-size:11px;">Enter IDs above and click <b>🚀 Calculate</b>.</p>' : 
                  '<p style="color: #ff9800; font-size:11px;">⚠️ API Key missing. Click <b>⚙️ Key</b>.</p>'}
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
            status.innerText = '✅ Saved!';
            setTimeout(() => { status.innerText = ''; panels.settings.style.display = 'none'; }, 1000);
        });

        document.getElementById('wp-clear-chains-btn').addEventListener('click', () => {
            document.getElementById('wp-chain-ids').value = '';
            GM_setValue('wp_chain_ids', '');
        });

        document.getElementById('wp-auto-chains-btn').addEventListener('click', async () => {
            const apiKey = GM_getValue('wp_torn_api_key', '');
            if (!apiKey) { alert('Configure API Key first.'); togglePanel('settings'); return; }
            const resultsEl = document.getElementById('wp-results');
            try {
                resultsEl.innerHTML = `<p style="color:#ffca28; font-size:11px;">Fetching chains...</p>`;
                const data = await apiGet(`https://api.torn.com/faction/?selections=chains&key=${apiKey}`);
                const chains = data.chains || {};
                const recentIds = Object.keys(chains).slice(-10);
                if (recentIds.length === 0) { resultsEl.innerHTML = `<p style="color:#aaa; font-size:11px;">No chains returned.</p>`; return; }
                document.getElementById('wp-chain-ids').value = recentIds.join(', ');
                GM_setValue('wp_chain_ids', recentIds.join(', '));
                resultsEl.innerHTML = `<p style="color:#4caf50; font-size:11px;">✅ Loaded ${recentIds.length} Chain IDs!</p>`;
            } catch (err) {
                resultsEl.innerHTML = `<p style="color:#ff9800; font-size:11px;">⚠️ Auto-list failed (${err}).</p>`;
            }
        });

        document.getElementById('wp-recalc-btn').addEventListener('click', () => {
            GM_setValue('wp_pool', document.getElementById('wp-pool').value);
            GM_setValue('wp_war_hit', document.getElementById('wp-war-hit').value);
            GM_setValue('wp_chain_hit', document.getElementById('wp-chain-hit').value);
            GM_setValue('wp_retal', document.getElementById('wp-retal').value);
            GM_setValue('wp_assist', document.getElementById('wp-assist').value);
            GM_setValue('wp_respect_rate', document.getElementById('wp-respect-rate').value);
            GM_setValue('wp_split_basis', document.getElementById('wp-split-basis').value);
            panels.payout.style.display = 'none';
            if (Object.keys(compiledMemberStats).length > 0) renderPayslips();
        });

        document.getElementById('wp-run-btn').addEventListener('click', () => {
            const apiKey = GM_getValue('wp_torn_api_key', '');
            const rankId = document.getElementById('wp-quick-rankid').value.trim();
            const chainIdsRaw = document.getElementById('wp-chain-ids').value.trim();
            if (!apiKey) { alert('Configure API Key first.'); togglePanel('settings'); return; }
            if (!rankId && !chainIdsRaw) { alert('Enter War ID or Chain ID(s).'); return; }
            GM_setValue('wp_rank_id', rankId);
            GM_setValue('wp_chain_ids', chainIdsRaw);
            fetchAndFilterReports(apiKey, rankId, chainIdsRaw.split(',').map(s => s.trim()).filter(Boolean));
        });

        document.getElementById('wp-export-btn').addEventListener('click', exportPayslipsCSV);
    }

    async function fetchAndFilterReports(apiKey, rankId, chainIds) {
        const resultsEl = document.getElementById('wp-results');
        document.getElementById('wp-export-btn').style.display = 'none';

        try {
            resultsEl.innerHTML = `<p style="color:#ffca28; font-size:11px;">Fetching faction roster...</p>`;
            const profile = await apiGet(`https://api.torn.com/user/?selections=profile&key=${apiKey}`);
            const myFactionId = String(profile.faction?.faction_id || '');
            if (!myFactionId || myFactionId === '0') {
                resultsEl.innerHTML = `<p style="color:#f44336; font-size:11px;">Error: Not in a faction.</p>`;
                return;
            }

            const basicData = await apiGet(`https://api.torn.com/faction/${myFactionId}?selections=basic&key=${apiKey}`);
            const factionMembers = basicData.members || {};
            const validMemberIds = new Set(Object.keys(factionMembers));
            const stats = {};

            Object.entries(factionMembers).forEach(([id, info]) => {
                stats[String(id)] = { id: String(id), name: info.name, warHits: 0, warScore: 0, chainHits: 0, retals: 0, assists: 0, respect: 0 };
            });

            let warStart = 0, warEnd = 0;
            if (rankId) {
                resultsEl.innerHTML = `<p style="color:#ffca28; font-size:11px;">Fetching War Report #${rankId}...</p>`;
                const rwData = await apiGet(`https://api.torn.com/torn/${rankId}?selections=rankedwarreport&key=${apiKey}`);
                const report = rwData.rankedwarreport;
                if (report?.factions?.[myFactionId]) {
                    warStart = report.war?.start || 0;
                    warEnd = report.war?.end || 0;
                    Object.entries(report.factions[myFactionId].members || {}).forEach(([mId, mData]) => {
                        const sid = String(mId);
                        if (validMemberIds.has(sid)) {
                            if (!stats[sid]) stats[sid] = { id: sid, name: mData.name, warHits: 0, warScore: 0, chainHits: 0, retals: 0, assists: 0, respect: 0 };
                            stats[sid].warHits = parseInt(mData.attacks, 10) || 0;
                            stats[sid].warScore = parseFloat(mData.score) || 0;
                        }
                    });
                }
            }

            for (let i = 0; i < chainIds.length; i++) {
                const cId = chainIds[i];
                resultsEl.innerHTML = `<p style="color:#ffca28; font-size:11px;">Fetching Chain #${cId} (${i + 1}/${chainIds.length})...</p>`;
                const cData = await apiGet(`https://api.torn.com/torn/${cId}?selections=chainreport&key=${apiKey}`);
                const cReport = cData.chainreport;
                if (!cReport || !cReport.members) continue;

                if (warStart > 0 && warEnd > 0 && cReport.end && cReport.start) {
                    if (cReport.end < (warStart - 3600) || cReport.start > (warEnd + 3600)) continue;
                }

                Object.entries(cReport.members).forEach(([mId, mStats]) => {
                    const sid = String(mId);
                    if (!validMemberIds.has(sid)) return;
                    if (!stats[sid]) stats[sid] = { id: sid, name: mStats.name || `Player [${sid}]`, warHits: 0, warScore: 0, chainHits: 0, retals: 0, assists: 0, respect: 0 };

                    const totalChainAtks = parseInt(mStats.attacks, 10) || 0;
                    const chainWarAtks = parseInt(mStats.war, 10) || 0;
                    const retals = parseInt(mStats.retaliation, 10) || parseInt(mStats.retaliations, 10) || parseInt(mStats.retal, 10) || parseInt(mStats.retals, 10) || 0;
                    const assists = parseInt(mStats.assist, 10) || parseInt(mStats.assists, 10) || 0;
                    const respect = parseFloat(mStats.respect) || 0;
                    const pureChainHits = rankId ? Math.max(0, totalChainAtks - chainWarAtks) : totalChainAtks;

                    stats[sid].chainHits += pureChainHits;
                    stats[sid].retals += retals;
                    stats[sid].assists += assists;
                    stats[sid].respect += respect;
                });
                if (i < chainIds.length - 1) await new Promise(r => setTimeout(r, 200));
            }

            compiledMemberStats = stats;
            renderPayslips();
        } catch (err) {
            resultsEl.innerHTML = `<p style="color:#f44336; font-size:11px;">${err}</p>`;
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
        const splitBasis = GM_getValue('wp_split_basis', 'score');

        const activeMembers = Object.values(compiledMemberStats).filter(m =>
            m.warHits > 0 || m.warScore > 0 || m.chainHits > 0 || m.retals > 0 || m.assists > 0 || m.respect > 0
        );

        if (activeMembers.length === 0) {
            resultsEl.innerHTML = `<p style="color:#aaa; font-size:11px;">No activity found.</p>`;
            exportBtn.style.display = 'none';
            return;
        }

        exportBtn.style.display = 'inline-block';

        let totalMetric = 0;
        let totalBasePay = 0;

        activeMembers.forEach(m => {
            if (splitBasis === 'score') totalMetric += m.warScore;
            else if (splitBasis === 'warhits') totalMetric += m.warHits;
            else if (splitBasis === 'respect') totalMetric += m.respect;

            m.basePay = (m.warHits * rateWar) +
                        (m.chainHits * rateChain) +
                        (m.retals * rateRetal) +
                        (m.assists * rateAssist) +
                        (m.respect * rateRespect);
            totalBasePay += m.basePay;
        });

        const remainderPool = Math.max(0, pool - totalBasePay);
        const perUnitBonus = (splitBasis !== 'none' && totalMetric > 0 && remainderPool > 0)
            ? (remainderPool / totalMetric)
            : 0;

        activeMembers.forEach(m => {
            let memberMetric = 0;
            if (splitBasis === 'score') memberMetric = m.warScore;
            else if (splitBasis === 'warhits') memberMetric = m.warHits;
            else if (splitBasis === 'respect') memberMetric = m.respect;

            m.poolBonus = memberMetric * perUnitBonus;
            m.finalPay = m.basePay + m.poolBonus;
        });

        activeMembers.sort((a, b) => b.finalPay - a.finalPay);
        const totalDistributed = activeMembers.reduce((sum, m) => sum + m.finalPay, 0);
        
        let basisLabel = 'War Score';
        if (splitBasis === 'warhits') basisLabel = 'War Hits %';
        else if (splitBasis === 'respect') basisLabel = 'Chain Respect';
        else if (splitBasis === 'none') basisLabel = 'None';

        let html = `
            <div class="wp-summary-bar">
                <div><strong>Pool:</strong> ${formatMoney(pool)}</div>
                <div><strong>Direct:</strong> ${formatMoney(totalBasePay)}</div>
                <div><strong>Split (${basisLabel}):</strong> ${formatMoney(splitBasis !== 'none' ? remainderPool : 0)}</div>
                <div style="color:#4caf50;"><strong>Total:</strong> ${formatMoney(totalDistributed)}</div>
            </div>
            <div class="wp-table-container">
                <table class="war-payout-table">
                    <thead>
                        <tr>
                            <th style="text-align:left;">Member</th>
                            <th>War Hits</th>
                            <th>War Score</th>
                            <th>Chain Hits</th>
                            <th>Retals</th>
                            <th>Assists</th>
                            <th>Respect</th>
                            <th style="color:#ffca28;">Total Paycheck</th>
                            <th style="text-align:left;">Breakdown</th>
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
            if (m.respect > 0 && rateRespect > 0) parts.push(`${m.respect.toFixed(2)} Resp (${formatMoney(m.respect * rateRespect)})`);
            if (m.poolBonus > 0) parts.push(`Pool Share (${formatMoney(m.poolBonus)})`);

            const explanation = parts.length > 0 ? parts.join(' + ') : 'No payable actions';

            html += `
                <tr>
                    <td><strong>${m.name}</strong></td>
                    <td>${m.warHits}</td>
                    <td>${m.warScore.toFixed(2)}</td>
                    <td>${m.chainHits}</td>
                    <td>${m.retals}</td>
                    <td>${m.assists}</td>
                    <td>${m.respect.toFixed(2)}</td>
                    <td style="color:#4caf50 !important; font-weight:bold;">${formatMoney(m.finalPay)}</td>
                    <td style="font-size:11px; color:#ccc !important;">${explanation}</td>
                </tr>
            `;
        });

        html += `</tbody></table></div>`;
        resultsEl.innerHTML = html;
    }

    function exportPayslipsCSV() {
        const activeMembers = Object.values(compiledMemberStats).filter(m => m.finalPay !== undefined);
        if (activeMembers.length === 0) return;

        let csv = "Member,War Hits,War Score,Chain Hits,Retals,Assists,Chain Respect,Base Pay,Pool Bonus,Total Paycheck\n";
        activeMembers.sort((a, b) => b.finalPay - a.finalPay).forEach(m => {
            csv += `"${m.name}",${m.warHits},${m.warScore.toFixed(2)},${m.chainHits},${m.retals},${m.assists},${m.respect.toFixed(2)},${Math.round(m.basePay)},${Math.round(m.poolBonus)},${Math.round(m.finalPay)}\n`;
        });

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `Faction_War_Payslips.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    window.addEventListener('hashchange', () => {
        const detected = detectIdsFromUrl();
        const rankInput = document.getElementById('wp-quick-rankid');
        if (detected.rankId && rankInput) {
            rankInput.value = detected.rankId;
            GM_setValue('wp_rank_id', detected.rankId);
        }
        if (detected.chainId) {
            appendChainIdToInput(detected.chainId);
        }
    });

    const observer = new MutationObserver(() => injectDashboard());
    observer.observe(document.body, { childList: true, subtree: true });
    injectDashboard();
})();
