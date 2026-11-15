// ==UserScript==
// @name         Torn War & Chain Payout Engine
// @namespace    http://tampermonkey.net/
// @version      2.0.1
// @description  Accurate faction war payout engine with robust CSV parsing for decimal scores and respect.
// @author       beatrice
// @license      MIT
// @match        https://www.torn.com/factions.php*
// @grant        GM_setValue
// @grant        GM_getValue
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
        .wp-btn.import { background: #2196f3; color: white; }
        .wp-btn.import:hover { background: #1976d2; }
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
        .wp-textarea { width: 100%; height: 120px; background: #111; color: #fff; border: 1px solid #444; padding: 8px; font-family: monospace; font-size: 12px; box-sizing: border-box; margin-bottom: 8px; }
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
                <span>⚔️ Faction War & Payout Engine (Exact Score Math Fix)</span>
                <div>
                    <button id="wp-toggle-import-btn" class="wp-btn import">📥 Paste / Import Data</button>
                    <button id="wp-toggle-payout-btn" class="wp-btn config">💰 Payout Rates</button>
                    <button id="wp-export-btn" class="wp-btn export" style="display: none;">📥 Export CSV</button>
                </div>
            </div>

            <!-- Import Panel -->
            <div id="wp-import-panel" class="wp-panel" style="display: block;">
                <p style="font-size:12px; color:#ffca28; margin-top:0;">
                    <b>Paste stats format:</b> <code>Name, WarHits, ChainHits, Retals, Assists, Score/Respect</code><br>
                    <i>(Example below includes Beatrice with her exact score of 422.72)[cite: 1]:</i>
                </p>
                <textarea id="wp-import-textarea" class="wp-textarea">Beatrice, 31, 0, 2, 4, 422.72
Mishkin, 28, 5, 13, 2, 444.13
GracefulHunter, 32, 2, 21, 0, 438.26</textarea>
                <button id="wp-process-import-btn" class="wp-btn">Process & Calculate Payslips</button>
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
                        Auto-split remaining Reward Pool proportionally by <b>Score / Respect</b>
                    </label>
                    <button id="wp-recalc-btn" class="wp-btn">Save & Recalculate</button>
                </div>
            </div>

            <div id="wp-results">
                <p style="color: #aaa; font-size:12px;">Click <b>Process & Calculate Payslips</b> above to generate accurate payouts.</p>
            </div>
        `;

        target.insertBefore(dashboard, target.firstChild);

        const panels = {
            import: document.getElementById('wp-import-panel'),
            payout: document.getElementById('wp-payout-panel')
        };

        function togglePanel(key) {
            Object.keys(panels).forEach(k => {
                panels[k].style.display = (k === key && panels[k].style.display !== 'block') ? 'block' : 'none';
            });
        }

        document.getElementById('wp-toggle-import-btn').addEventListener('click', () => togglePanel('import'));
        document.getElementById('wp-toggle-payout-btn').addEventListener('click', () => togglePanel('payout'));

        document.getElementById('wp-process-import-btn').addEventListener('click', () => {
            const rawText = document.getElementById('wp-import-textarea').value.trim();
            if (!rawText) {
                alert('Please paste some data first.');
                return;
            }
            parseAndLoadText(rawText);
            panels.import.style.display = 'none';
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

        document.getElementById('wp-export-btn').addEventListener('click', exportPayslipsCSV);

        // Auto-run with default box values on load
        parseAndLoadText(document.getElementById('wp-import-textarea').value.trim());
    }

    function parseAndLoadText(text) {
        const lines = text.split('\n');
        const stats = {};

        lines.forEach(line => {
            const parts = line.split(',').map(p => p.trim());
            if (parts.length >= 2) {
                const name = parts[0];
                const warHits = parseFloat(parts[1]) || 0;
                const chainHits = parseFloat(parts[2]) || 0;
                const retals = parseFloat(parts[3]) || 0;
                const assists = parseFloat(parts[4]) || 0;
                // Ensures floating-point scores like 422.72 are parsed correctly
                const respect = parseFloat(parts[5]) || 0;

                stats[name] = { name, warHits, chainHits, retals, assists, respect };
            }
        });

        compiledMemberStats = stats;
        renderPayslips();
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

        const activeMembers = Object.values(compiledMemberStats);
        if (activeMembers.length === 0) {
            resultsEl.innerHTML = `<p style="color:#f44336;">No valid member data found.</p>`;
            exportBtn.style.display = 'none';
            return;
        }

        exportBtn.style.display = 'inline-block';

        let totalFactionRespect = 0;
        let totalBasePay = 0;

        activeMembers.forEach(m => {
            totalFactionRespect += m.respect;
            m.basePay = (m.warHits * rateWar) +
                        (m.chainHits * rateChain) +
                        (m.retals * rateRetal) +
                        (m.assists * rateAssist) +
                        (m.respect * rateRespect);
            totalBasePay += m.basePay;
        });

        const remainderPool = Math.max(0, pool - totalBasePay);
        const perRespectBonus = (splitRemainder && totalFactionRespect > 0 && remainderPool > 0)
            ? (remainderPool / totalFactionRespect)
            : 0;

        activeMembers.forEach(m => {
            // Correct proportional pool share based on individual score/respect
            m.respectBonus = m.respect * perRespectBonus;
            m.finalPay = m.basePay + m.respectBonus;
        });

        activeMembers.sort((a, b) => b.finalPay - a.finalPay);
        const totalDistributed = activeMembers.reduce((sum, m) => sum + m.finalPay, 0);

        let html = `
            <div class="wp-summary-bar">
                <div><strong>Reward Pool:</strong> ${formatMoney(pool)}</div>
                <div><strong>Direct Hit/Bonus Pay:</strong> ${formatMoney(totalBasePay)}</div>
                <div><strong>Score/Respect Pool Split:</strong> ${formatMoney(splitRemainder ? remainderPool : 0)} (${formatMoney(perRespectBonus)}/score)</div>
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
                        <th>Score/Respect</th>
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
            if (m.respect > 0 && rateRespect > 0) parts.push(`${m.respect} Score (${formatMoney(m.respect * rateRespect)})`);
            if (m.respectBonus > 0) parts.push(`Pool Share (${formatMoney(m.respectBonus)})`);

            const explanation = parts.length > 0 ? parts.join(' + ') : 'No payable actions';

            html += `
                <tr>
                    <td><strong>${m.name}</strong></td>
                    <td>${m.warHits}</td>
                    <td>${m.chainHits}</td>
                    <td>${m.retals}</td>
                    <td>${m.assists}</td>
                    <td>${m.respect}</td>
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

        let csv = "Member,War Hits,Chain Hits,Retals,Assists,Score,Base Pay,Pool Bonus,Total Paycheck\n";
        activeMembers.sort((a, b) => b.finalPay - a.finalPay).forEach(m => {
            csv += `"${m.name}",${m.warHits},${m.chainHits},${m.retals},${m.assists},${m.respect},${Math.round(m.basePay)},${Math.round(m.respectBonus)},${Math.round(m.finalPay)}\n`;
        });

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `Faction_Payslips_${new Date().toISOString().slice(0,10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    const observer = new MutationObserver(() => injectDashboard());
    observer.observe(document.body, { childList: true, subtree: true });
    injectDashboard();
})();
