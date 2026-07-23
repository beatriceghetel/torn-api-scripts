// ==UserScript==
// @name         Torn Faction Roster Armory Overlay
// @namespace    http://tampermonkey.net/
// @version      1.1.4
// @description  Appends loaned armory items directly next to member names on the native Faction Roster.
// @author       beatrice27
// @match        https://www.torn.com/factions.php*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// ==/UserScript==


(function() {
    'use strict';

    // Inject Styles for Modal
    const styles = `
        #armory-loan-modal-overlay {
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background: rgba(0, 0, 0, 0.75); z-index: 99999;
            display: flex; align-items: center; justify-content: center;
        }
        .armory-modal-card {
            background: #1e1e1e; border: 1px solid #444; border-radius: 6px;
            width: 85%; max-width: 900px; max-height: 85vh;
            display: flex; flex-direction: column; color: #fff;
            box-shadow: 0 10px 30px rgba(0,0,0,0.8); font-family: Arial, sans-serif;
        }
        .armory-modal-header {
            padding: 12px 18px; background: #2a2a2a; border-bottom: 1px solid #333;
            display: flex; justify-content: space-between; align-items: center;
            border-top-left-radius: 6px; border-top-right-radius: 6px;
        }
        .armory-modal-header h2 { margin: 0; font-size: 16px; color: #ffca28; }
        .armory-modal-close {
            background: none; border: none; color: #aaa; font-size: 20px;
            cursor: pointer; font-weight: bold;
        }
        .armory-modal-close:hover { color: #fff; }
        .armory-modal-controls {
            padding: 10px 18px; background: #242424; border-bottom: 1px solid #333;
            display: flex; gap: 10px; align-items: center;
        }
        .armory-modal-search {
            flex-grow: 1; padding: 6px 10px; background: #111; border: 1px solid #444;
            color: #fff; border-radius: 4px; font-size: 12px;
        }
        .armory-modal-body {
            padding: 15px; overflow-y: auto; flex-grow: 1;
        }
        .armory-modal-table {
            width: 100%; border-collapse: collapse; font-size: 13px;
        }
        .armory-modal-table th, .armory-modal-table td {
            border: 1px solid #333; padding: 8px 10px; text-align: left;
        }
        .armory-modal-table th { background: #2d2d2d; color: #aaa; font-size: 11px; text-transform: uppercase; }
        .armory-modal-table tr:nth-child(even) { background: #262626; }
        .armory-badge {
            background: #007acc; color: #fff; padding: 2px 6px; border-radius: 10px;
            font-size: 11px; font-weight: bold; display: inline-block;
        }
        .loan-trigger-btn {
            background: #2ed573; color: #000; font-weight: bold; border: none;
            padding: 6px 12px; border-radius: 4px; cursor: pointer; margin: 10px 0;
            font-size: 12px; display: inline-flex; align-items: center; gap: 5px;
        }
        .loan-trigger-btn:hover { background: #26af5f; }
    `;

    const styleElement = document.createElement('style');
    styleElement.innerText = styles;
    document.head.appendChild(styleElement);

    let globalLoanData = [];

    // Inject Trigger Button on Faction Page
    function injectTriggerButton() {
        if (document.getElementById('open-armory-modal-btn')) return;

        const target = document.querySelector('.content-title') || document.querySelector('.content-wrapper');
        if (!target) return;

        const btn = document.createElement('button');
        btn.id = 'open-armory-modal-btn';
        btn.className = 'loan-trigger-btn';
        btn.innerHTML = '🛡️ View Armory Loans';
        btn.onclick = openModal;

        target.parentNode.insertBefore(btn, target);
    }

    // Open Modal
    function openModal() {
        let apiKey = GM_getValue('torn_api_key', '');
        if (!apiKey) {
            apiKey = prompt("Enter your Torn API Key (Faction access required):");
            if (apiKey) {
                apiKey = apiKey.trim();
                GM_setValue('torn_api_key', apiKey);
            } else {
                return;
            }
        }

        // Create Overlay
        let overlay = document.getElementById('armory-loan-modal-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'armory-loan-modal-overlay';
            overlay.innerHTML = `
                <div class="armory-modal-card">
                    <div class="armory-modal-header">
                        <h2>🛡️ Active Faction Armory Loans</h2>
                        <button class="armory-modal-close" id="close-armory-modal">&times;</button>
                    </div>
                    <div class="armory-modal-controls">
                        <input type="text" id="armory-modal-search-input" class="armory-modal-search" placeholder="Search by member name or item...">
                        <button id="armory-modal-refresh" style="background:#444; color:#fff; border:none; padding:6px 10px; border-radius:3px; cursor:pointer;">🔄 Refresh</button>
                    </div>
                    <div class="armory-modal-body" id="armory-modal-content">
                        <p style="color: #aaa;">Fetching armory inventory...</p>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);

            document.getElementById('close-armory-modal').onclick = () => overlay.style.display = 'none';
            document.getElementById('armory-modal-refresh').onclick = () => fetchArmoryLoans(apiKey);
            document.getElementById('armory-modal-search-input').oninput = (e) => filterTable(e.target.value);
            
            // Close on outside click
            overlay.onclick = (e) => { if (e.target === overlay) overlay.style.display = 'none'; };
        } else {
            overlay.style.display = 'flex';
        }

        fetchArmoryLoans(apiKey);
    }

    // Fetch and Process Data
    function fetchArmoryLoans(apiKey) {
        const content = document.getElementById('armory-modal-content');
        content.innerHTML = '<p style="color: #ffca28;">Querying all 6 armory categories & member list...</p>';

        const selections = 'weapons,armor,temporary,medical,drugs,boosters,basic';
        const url = `https://api.torn.com/faction/?selections=${selections}&key=${apiKey}`;

        GM_xmlhttpRequest({
            method: "GET",
            url: url,
            onload: function(res) {
                try {
                    const data = JSON.parse(res.responseText);
                    if (data.error) {
                        content.innerHTML = `<p style="color: #ff4757;">API Error: ${data.error.error}</p>`;
                        return;
                    }
                    parseDataAndRender(data);
                } catch(e) {
                    content.innerHTML = `<p style="color: #ff4757;">Failed to parse response payload.</p>`;
                }
            }
        });
    }

    function parseDataAndRender(data) {
        const members = data.members || {};
        const categories = ['weapons', 'armor', 'temporary', 'medical', 'drugs', 'boosters'];
        const userLoansMap = {};

        categories.forEach(cat => {
            const catObj = data[cat];
            if (catObj && typeof catObj === 'object' && !Array.isArray(catObj)) {
                Object.values(catObj).forEach(item => {
                    if (item && item.loaned_to) {
                        const borrowerId = String(item.loaned_to);

                        if (!userLoansMap[borrowerId]) {
                            const memberInfo = members[borrowerId] || {};
                            userLoansMap[borrowerId] = {
                                id: borrowerId,
                                name: memberInfo.name || `User [${borrowerId}]`,
                                daysInFaction: memberInfo.days_in_faction ?? 'N/A',
                                itemCounts: {}
                            };
                        }

                        const itemName = item.name || 'Unknown Item';
                        userLoansMap[borrowerId].itemCounts[itemName] = (userLoansMap[borrowerId].itemCounts[itemName] || 0) + 1;
                    }
                });
            }
        });

        // Convert Map to Array
        globalLoanData = Object.values(userLoansMap).map(u => {
            let totalCount = 0;
            const itemStrings = [];

            Object.entries(u.itemCounts).forEach(([name, count]) => {
                totalCount += count;
                itemStrings.push(count > 1 ? `${name} (x${count})` : name);
            });

            return {
                id: u.id,
                name: u.name,
                daysInFaction: u.daysInFaction,
                totalCount: totalCount,
                itemsFormatted: itemStrings.join(', ')
            };
        });

        // Sort by total items borrowed descending
        globalLoanData.sort((a, b) => b.totalCount - a.totalCount);
        renderTable(globalLoanData);
    }

    function renderTable(dataList) {
        const content = document.getElementById('armory-modal-content');

        if (dataList.length === 0) {
            content.innerHTML = '<p style="color: #aaa;">No active loans found across any armory category.</p>';
            return;
        }

        let html = `
            <table class="armory-modal-table">
                <thead>
                    <tr>
                        <th style="width: 25%;">Member</th>
                        <th style="width: 15%;">Days in Faction</th>
                        <th style="width: 15%;">Total Borrowed</th>
                        <th style="width: 45%;">Loaned Gear Breakdown</th>
                    </tr>
                </thead>
                <tbody>
        `;

        dataList.forEach(user => {
            html += `
                <tr>
                    <td>
                        <a href="https://www.torn.com/profiles.php?XID=${user.id}" target="_blank" style="color: #70a1ff; text-decoration: none; font-weight: bold;">
                            ${user.name}
                        </a>
                    </td>
                    <td>${user.daysInFaction}d</td>
                    <td><span class="armory-badge">${user.totalCount}</span></td>
                    <td style="color: #ccc;">${user.itemsFormatted}</td>
                </tr>
            `;
        });

        html += `</tbody></table>`;
        content.innerHTML = html;
    }

    function filterTable(query) {
        const q = query.toLowerCase().trim();
        if (!q) {
            renderTable(globalLoanData);
            return;
        }

        const filtered = globalLoanData.filter(u => 
            u.name.toLowerCase().includes(q) || 
            u.id.includes(q) || 
            u.itemsFormatted.toLowerCase().includes(q)
        );

        renderTable(filtered);
    }

    // Observer to insert trigger button on page load
    const observer = new MutationObserver(injectTriggerButton);
    observer.observe(document.body, { childList: true, subtree: true });
    injectTriggerButton();

})();