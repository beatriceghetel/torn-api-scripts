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
                    <input type="text" id="wp-quick-rankid" class="wp-input" value="${savedRankId}" placeholder="e.g. 12345 (optional)">
                </div>
                <div style="flex: 2; min-width: 240px;">
                    <label style="font-size:11px; color:#aaa; display:block; margin-bottom:3px;">Chain IDs (comma-separated):</label>
                    <div style="display:flex; gap:5px;">
                        <input type="text" id="wp-chain-ids" class="wp-input" value="${savedChainIds}" placeholder="e.g. 4189201, 4189450">
                        <button id="wp-auto-chains-btn" class="wp-btn secondary" style="white-space:nowrap; margin:0;" title="Fetch recent Chain IDs">Auto-Find</button>
                        <button id="wp-clear-chains-btn" class="wp-btn secondary" style="white-space:nowrap; margin:0;" title="Clear">Clear</button>
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
                        <label>Fixed $/Respect (Optional):</label>
                        <input type="number" id="wp-respect-rate" class="wp-input" value="${cfg.respectRate}">
                    </div>
                    <div class="wp-field">
                        <label>Remaining Pool Split By:</label>
                        <select id="wp-split-basis" class="wp-input">
                            <option value="score" ${cfg.splitBasis === 'score' ? 'selected' : ''}>War Score (Scoreboard)</option>
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
                <p style="font-size:12px; margin-top:0; margin-bottom:8px; color:#aaa;">Enter your Torn API Key:</p>
                <div style="display:flex; gap:8px; max-width: 450px;">
                    <input type="password" id="wp-api-input" class="wp-input" value="${savedKey}" placeholder="Paste API Key...">
                    <button id="wp-save-settings-btn" class="wp-btn">Save Key</button>
                </div>
                <div id="wp-key-status" style="margin-top: 6px; font-size: 12px;"></div>
            </div>

            <div id="wp-results">
                ${savedKey ? 
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
                const data = await apiGet(`https://api.torn.com/faction/?selections=chains&key=${apiKey}`);
                const chains = data.chains || {};
                const recentIds = Object.keys(chains).slice(-10);
                if (recentIds.length === 0) {
                    resultsEl.innerHTML = `<p style="color:#aaa;">No recent chains returned.</p>`;
                    return;
                }
                document.getElementById('wp-chain-ids').value = recentIds.join(', ');
                GM_setValue('wp_chain_ids', recentIds.join(', '));
                resultsEl.innerHTML = `<p style="color:#4caf50; font-size:12px;">✅ Loaded ${recentIds.length} recent Chain IDs!</p>`;
            } catch (err) {
                resultsEl.innerHTML = `<p style="color:#ff9800; font-size:12px;">⚠️ Auto-list failed (${err}). You can paste Chain IDs manually.</p>`;
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

            if (!apiKey) {
                alert('Please configure your API Key first.');
                togglePanel('settings');
                return;
            }
            if (!rankId && !chainIdsRaw) {
                alert('Please enter at least a Ranked War ID or one Chain ID.');
                return;
            }

            GM_setValue('wp_rank_id', rankId);
            GM_setValue('wp_chain_ids', chainIdsRaw);

            const chainIds = chainIdsRaw.split(',').map(s => s.trim()).filter(Boolean);
            fetchAndFilterReports(apiKey, rankId, chainIds);
        });

        document.getElementById('wp-export-btn').addEventListener('click', exportPayslipsCSV);
    }

    async function fetchAndFilterReports(apiKey, rankId, chainIds) {
        const resultsEl = document.getElementById('wp-results');
        document.getElementById('wp-export-btn').style.display = 'none';

        try {
            // 1. Get User Profile & Faction ID
            resultsEl.innerHTML = `<p style="color:#ffca28;">Fetching your faction roster...</p>`;
            const profile = await apiGet(`https://api.torn.com/user/?selections=profile&key=${apiKey}`);
            const myFactionId = String(profile.faction?.faction_id || '');

            if (!myFactionId || myFactionId === '0') {
                resultsEl.innerHTML = `<p style="color:#f44336;">Error: API key owner is not in a faction.</p>`;
                return;
            }

            // 2. Fetch official Roster of YOUR faction to build an explicit white-list of member IDs
            const basicData = await apiGet(`https://api.torn.com/faction/${myFactionId}?selections=basic&key=${apiKey}`);
            const factionMembers = basicData.members || {};
            
            const validMemberIds = new Set(Object.keys(factionMembers));
            const stats = {};

            // Initialize stats strictly for your faction's current roster
            Object.entries(factionMembers).forEach(([id, info]) => {
                stats[String(id)] = {
                    id: String(id),
                    name: info.name,
                    warHits: 0,
                    warScore: 0,
                    chainHits: 0,
                    retals: 0,
                    assists: 0,
                    respect: 0
                };
            });

            let warStart = 0;
            let warEnd = 0;

            // 3. Fetch Ranked War Report
            if (rankId) {
                resultsEl.innerHTML = `<p style="color:#ffca28;">Fetching Ranked War Report #${rankId}...</p>`;
                const rwData = await apiGet(`https://api.torn.com/torn/${rankId}?selections=rankedwarreport&key=${apiKey}`);
                const report = rwData.rankedwarreport;

                if (!report || !report.factions || !report.factions[myFactionId]) {
                    resultsEl.innerHTML = `<p style="color:#f44336;">Error: Your faction was not found in Ranked War Report #${rankId}.</p>`;
                    return;
                }

                warStart = report.war?.start || 0;
                warEnd = report.war?.end || 0;

                // Only parse members belonging to your faction
                Object.entries(report.factions[myFactionId].members || {}).forEach(([mId, mData]) => {
                    const sid = String(mId);
                    if (validMemberIds.has(sid)) {
                        if (!stats[sid]) {
                            stats[sid] = { id: sid, name: mData.name, warHits: 0, warScore: 0, chainHits: 0, retals: 0, assists: 0, respect: 0 };
                        }
                        stats[sid].warHits = parseInt(mData.attacks, 10) || 0;
                        stats[sid].warScore = parseFloat(mData.score) || 0;
                    }
                });
            }

            // 4. Fetch Chain Reports (Strictly filtering out enemy/non-faction members)
            for (let i = 0; i < chainIds.length; i++) {
                const cId = chainIds[i];
                resultsEl.innerHTML = `<p style="color:#ffca28;">Fetching Chain Report #${cId} (${i + 1}/${chainIds.length})...</p>`;

                const cData = await apiGet(`https://api.torn.com/torn/${cId}?selections=chainreport&key=${apiKey}`);
                const cReport = cData.chainreport;
                if (!cReport || !cReport.members) continue;

                if (warStart > 0 && warEnd > 0 && cReport.end && cReport.start) {
                    if (cReport.end < (warStart - 3600) || cReport.start > (warEnd + 3600)) continue;
                }

                Object.entries(cReport.members).forEach(([mId, mStats]) => {
                    const sid = String(mId);
                    // EXCLUDE enemy faction members entirely
                    if (!validMemberIds.has(sid)) return;

                    if (!stats[sid]) {
                        stats[sid] = { id: sid, name: mStats.name || `Player [${sid}]`, warHits: 0, warScore: 0, chainHits: 0, retals: 0, assists: 0, respect: 0 };
                    }

                    const totalChainAtks = parseInt(mStats.attacks, 10) || 0;
                    const chainWarAtks = parseInt(mStats.war, 10) || 0;
                    const retals = parseInt(mStats.retaliations, 10) || 0;
                    const assists = parseInt(mStats.assists, 10) || 0;
                    const respect = parseFloat(mStats.respect) || 0;

                    const pureChainHits = rankId ? Math.max(0, totalChainAtks - chainWarAtks) : totalChainAtks;

                    stats[sid].chainHits += pureChainHits;
                    stats[sid].retals += retals;
                    stats[sid].assists += assists;
                    stats[sid].respect += respect;
                });

                if (i < chainIds.length - 1) {
                    await new Promise(r => setTimeout(r, 200));
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
        const splitBasis = GM_getValue('wp_split_basis', 'score');

        // Only include members from YOUR faction who had activity
        const activeMembers = Object.values(compiledMemberStats).filter(m =>
            m.warHits > 0 || m.warScore > 0 || m.chainHits > 0 || m.retals > 0 || m.assists > 0 || m.respect > 0
        );

        if (activeMembers.length === 0) {
            resultsEl.innerHTML = `<p style="color:#aaa;">No faction member activity found in the selected reports.</p>`;
            exportBtn.style.display = 'none';
            return;
        }

        exportBtn.style.display = 'inline-block';

        let totalMetric = 0;
        let totalBasePay = 0;

        activeMembers.forEach(m => {
            if (splitBasis === 'score') totalMetric += m.warScore;
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
            const memberMetric = splitBasis === 'score' ? m.warScore : (splitBasis === 'respect' ? m.respect : 0);
            m.poolBonus = memberMetric * perUnitBonus;
            m.finalPay = m.basePay + m.poolBonus;
        });

        activeMembers.sort((a, b) => b.finalPay - a.finalPay);
        const totalDistributed = activeMembers.reduce((sum, m) => sum + m.finalPay, 0);
        const basisLabel = splitBasis === 'score' ? 'War Score' : (splitBasis === 'respect' ? 'Chain Respect' : 'None');

        let html = `
            <div class="wp-summary-bar">
                <div><strong>Reward Pool:</strong> ${formatMoney(pool)}</div>
                <div><strong>Direct Hit/Bonus Pay:</strong> ${formatMoney(totalBasePay)}</div>
                <div><strong>Pool Split (${basisLabel}):</strong> ${formatMoney(splitBasis !== 'none' ? remainderPool : 0)} (${formatMoney(perUnitBonus)}/pt)</div>
                <div style="color:#4caf50;"><strong>Total Payout:</strong> ${formatMoney(totalDistributed)}</div>
            </div>
            <table class="war-payout-table">
                <thead>
                    <tr>
                        <th style="text-align:left;">Member (Your Faction Only)</th>
                        <th>War Hits</th>
                        <th>War Score</th>
                        <th>Chain Hits</th>
                        <th>Retals</th>
                        <th>Assists</th>
                        <th>Chain Respect</th>
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

        html += `</tbody></table>`;
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
