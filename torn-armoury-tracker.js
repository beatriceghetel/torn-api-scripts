// ==UserScript==
// @name         Torn Faction Roster Armory Overlay
// @namespace    http://tampermonkey.net/
// @version      1.1.3
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

    // --- Inject Styles ---
    const styles = `
        .armory-tracker-wrap { background: #222; color: #fff; padding: 15px; margin: 10px 0; border-radius: 5px; border: 1px solid #444; font-family: Arial, sans-serif; }
        .armory-tracker-title { font-size: 16px; font-weight: bold; margin-bottom: 10px; color: #ffca28; display: flex; justify-content: space-between; align-items: center; }
        .armory-tracker-table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        .armory-tracker-table th, .armory-tracker-table td { border: 1px solid #444; padding: 8px; text-align: left; }
        .armory-tracker-table th { background-color: #333; color: #aaa; text-align: center; font-size: 12px; }
        .armory-tracker-table td { text-align: center; }
        .armory-tracker-table td:first-child { text-align: left; }
        .armory-tracker-table tr:nth-child(even) { background-color: #2a2a2a; }
        
        /* Clean Text Overrides */
        .armory-tracker-table td a, 
        .armory-tracker-table td strong, 
        .armory-tracker-table td { color: #ffffff !important; text-decoration: none !important; }
        .armory-tracker-table td a:hover { text-decoration: underline !important; color: #ffca28 !important; }
        
        .tracker-btn { background: #4caf50; color: white; border: none; padding: 6px 12px; cursor: pointer; border-radius: 3px; font-size: 12px; font-weight: bold; margin-right: 5px; }
        .tracker-btn:hover { background: #45a049; }
        .tracker-btn.secondary-toggle-btn { background: #444; color: #ccc; }
        .tracker-btn.secondary-toggle-btn:hover { background: #555; color: #fff; }
        .tracker-btn.export-csv-btn { background: #007acc; }
        .tracker-btn.export-csv-btn:hover { background: #0062a3; }

        .tracker-inline-panel { display: none; background: #1a1a1a; border: 1px solid #333; padding: 12px; margin-bottom: 15px; border-radius: 4px; }
        .tracker-inline-input { padding: 6px; background: #111; border: 1px solid #444; color: #fff; border-radius: 3px; font-size: 12px; margin-right: 10px; }
        .filter-row { display: flex; align-items: center; margin-bottom: 10px; font-size: 13px; color: #ccc; flex-wrap: wrap; gap: 10px; }
        .filter-row label { margin-right: 8px; }
    `;
    const styleSheet = document.createElement("style");
    styleSheet.innerText = styles;
    document.head.appendChild(styleSheet);

    let compiledGlobalLoans = {}; 

    function injectDashboard() {
        if (document.getElementById('armory-loan-dashboard')) return;

        const target = document.querySelector('#mainContainer') 
            || document.querySelector('.content-wrapper') 
            || document.querySelector('.main-wrapper');
        if (!target) return;

        const dashboard = document.createElement('div');
        dashboard.id = 'armory-loan-dashboard';
        dashboard.className = 'armory-tracker-wrap';

        let savedKey = GM_getValue('torn_api_key', '');

        dashboard.innerHTML = `
            <div class="armory-tracker-title">
                <span>🛡️ Faction Armory Loan Tracker</span>
                <div>
                    <button id="fetch-loans-btn" class="tracker-btn">Scan Loans</button>
                    <button id="toggle-filters-btn" class="tracker-btn secondary-toggle-btn">🎛️ Filters</button>
                    <button id="toggle-settings-btn" class="tracker-btn secondary-toggle-btn">⚙️ Settings</button>
                    <button id="export-csv-btn" class="tracker-btn export-csv-btn" style="display: none;">📥 Export CSV</button>
                </div>
            </div>
            
            <div id="tracker-filters-panel" class="tracker-inline-panel">
                <div class="filter-row">
                    <label><input type="checkbox" id="filter-weapons" checked> Weapons</label>
                    <label><input type="checkbox" id="filter-armor" checked> Armor</label>
                    <label><input type="checkbox" id="filter-temp" checked> Temp / Meds</label>
                    <label><input type="checkbox" id="filter-drugs" checked> Drugs / Boosters</label>
                    <label style="color: #2ed573; margin-left: 10px;"><input type="checkbox" id="filter-newcomers-only"> Highlight Newcomers (<=30 Days)</label>
                </div>
            </div>

            <div id="tracker-settings-panel" class="tracker-inline-panel">
                <p style="font-size:12px; margin-top:0; margin-bottom:8px; color:#aaa;">Enter your Limited/Full Access API Key:</p>
                <div style="display:flex; align-items:center;">
                    <input type="password" id="inline-api-input" class="tracker-inline-input" style="width: 50%;" value="${savedKey}" placeholder="Paste API Key...">
                    <button id="inline-save-btn" class="tracker-btn">Save</button>
                </div>
                <div id="inline-save-status" style="margin-top: 6px; font-size: 12px;"></div>
            </div>

            <div id="tracker-results-container">
                ${savedKey ? 
                  '<p style="color: #aaa; font-size:12px;">Click "Scan Loans" to pull live active armory loans.</p>' : 
                  '<p style="color: #ff9800; font-size:12px;">⚠️ API Key missing. Click <b>⚙️ Settings</b> above to set it up.</p>'}
            </div>
        `;

        if (target.firstChild) {
            target.insertBefore(dashboard, target.firstChild);
        } else {
            target.appendChild(dashboard);
        }

        const filtersPanel = document.getElementById('tracker-filters-panel');
        const settingsPanel = document.getElementById('tracker-settings-panel');

        document.getElementById('toggle-filters-btn').addEventListener('click', () => {
            filtersPanel.style.display = filtersPanel.style.display === 'block' ? 'none' : 'block';
            settingsPanel.style.display = 'none';
        });

        document.getElementById('toggle-settings-btn').addEventListener('click', () => {
            settingsPanel.style.display = settingsPanel.style.display === 'block' ? 'none' : 'block';
            filtersPanel.style.display = 'none';
        });

        document.getElementById('inline-save-btn').addEventListener('click', () => {
            const keyVal = document.getElementById('inline-api-input').value.trim();
            const status = document.getElementById('inline-save-status');
            GM_setValue('torn_api_key', keyVal);
            status.style.color = '#4caf50';
            status.innerText = '✅ Key successfully saved!';
            setTimeout(() => { status.innerText = ''; settingsPanel.style.display = 'none'; }, 1500);
        });

        document.getElementById('fetch-loans-btn').addEventListener('click', () => {
            const apiKey = GM_getValue('torn_api_key', '');
            if (!apiKey) {
                alert('Please configure your API key first inside Settings.');
                settingsPanel.style.display = 'block';
                return;
            }
            startArmoryScan(apiKey);
        });

        document.getElementById('export-csv-btn').addEventListener('click', exportToCSVFile);
    }

    function startArmoryScan(apiKey) {
        document.getElementById('export-csv-btn').style.display = 'none';
        const resultsContainer = document.getElementById('tracker-results-container');
        resultsContainer.innerHTML = `<p style="color: #ffca28; font-size: 12px;">Fetching all armory categories and member roster...</p>`;

        const selections = 'weapons,armor,temporary,medical,drugs,boosters,cesium,main,basic';
        const url = `https://api.torn.com/faction/?selections=${selections}&key=${apiKey}`;

        GM_xmlhttpRequest({
            method: "GET",
            url: url,
            onload: function(response) {
                try {
                    const data = JSON.parse(response.responseText);
                    if (data.error) {
                        resultsContainer.innerHTML = `<p style="color: #f44336; font-size:12px;">API Error: ${data.error.error}</p>`;
                        return;
                    }
                    processArmoryData(data);
                } catch (e) {
                    resultsContainer.innerHTML = `<p style="color: #f44336; font-size:12px;">Error parsing armory response.</p>`;
                }
            },
            onerror: function() {
                resultsContainer.innerHTML = `<p style="color: #f44336; font-size:12px;">Network error while contacting Torn API.</p>`;
            }
        });
    }

    function processArmoryData(data) {
        const members = data.members || {};
        const memberLoansMap = {};

        const trackWeapons = document.getElementById('filter-weapons').checked;
        const trackArmor = document.getElementById('filter-armor').checked;
        const trackTemp = document.getElementById('filter-temp').checked;
        const trackDrugs = document.getElementById('filter-drugs').checked;

        const scanCategory = (categoryObj, typeCategory) => {
            if (!categoryObj || typeof categoryObj !== 'object' || Array.isArray(categoryObj)) return;

            Object.values(categoryObj).forEach(item => {
                if (item && item.loaned_to) {
                    const borrowerId = String(item.loaned_to);

                    if (!memberLoansMap[borrowerId]) {
                        const mInfo = members[borrowerId] || {};
                        memberLoansMap[borrowerId] = {
                            id: borrowerId,
                            name: mInfo.name || `User [${borrowerId}]`,
                            daysInFaction: mInfo.days_in_faction !== undefined ? mInfo.days_in_faction : 999,
                            items: []
                        };
                    }

                    memberLoansMap[borrowerId].items.push({
                        name: item.name || 'Unknown Item',
                        type: typeCategory
                    });
                }
            });
        };

        if (trackWeapons) scanCategory(data.weapons, 'weapon');
        if (trackArmor) scanCategory(data.armor, 'armor');
        if (trackTemp) {
            scanCategory(data.temporary, 'temp');
            scanCategory(data.medical, 'medical');
        }
        if (trackDrugs) {
            scanCategory(data.drugs, 'drug');
            scanCategory(data.boosters, 'booster');
            scanCategory(data.cesium, 'cesium');
        }

        compiledGlobalLoans = memberLoansMap;
        renderTable(memberLoansMap);
    }

    function renderTable(memberLoansMap) {
        const resultsContainer = document.getElementById('tracker-results-container');
        const csvBtn = document.getElementById('export-csv-btn');
        const newcomersOnly = document.getElementById('filter-newcomers-only').checked;

        let membersList = Object.values(memberLoansMap);

        if (newcomersOnly) {
            membersList = membersList.filter(m => m.daysInFaction <= 30);
        }

        if (membersList.length === 0) {
            resultsContainer.innerHTML = '<p style="color: #aaa; font-size:12px;">No loaned items match current active filters.</p>';
            csvBtn.style.display = 'none';
            return;
        }

        csvBtn.style.display = 'inline-block';

        // Sort: Newcomers first, then by total loaned items (descending)
        membersList.sort((a, b) => {
            if (a.daysInFaction <= 30 && b.daysInFaction > 30) return -1;
            if (a.daysInFaction > 30 && b.daysInFaction <= 30) return 1;
            return b.items.length - a.items.length;
        });

        let totalItemsOut = 0;
        let tableHtml = `
            <table class="armory-tracker-table">
                <thead>
                    <tr>
                        <th style="width: 25%;">Member</th>
                        <th style="width: 12%;">Days in Faction</th>
                        <th style="width: 12%;">Total Loaned</th>
                        <th style="width: 51%; text-align: left;">Comma-Separated Item List</th>
                    </tr>
                </thead>
                <tbody>
        `;

        membersList.forEach(m => {
            totalItemsOut += m.items.length;
            const isNewcomer = m.daysInFaction <= 30;
            const daysText = m.daysInFaction === 999 ? 'Left Faction' : `${m.daysInFaction}d`;
            const nameColor = isNewcomer ? '#2ed573' : '#70a1ff';
            const itemsCSV = m.items.map(i => i.name).join(', ');

            tableHtml += `
                <tr>
                    <td>
                        <a href="https://www.torn.com/profiles.php?XID=${m.id}" target="_blank" style="color: ${nameColor} !important; font-weight: bold;">
                            ${m.name} [${m.id}]
                        </a>
                        ${isNewcomer ? ' <span style="color: #2ed573; font-size: 10px;">(New)</span>' : ''}
                    </td>
                    <td>${daysText}</td>
                    <td style="color: #ffca28 !important; font-weight: bold;">${m.items.length}</td>
                    <td style="font-size: 12px; color: #ccc !important; text-align: left;">${itemsCSV}</td>
                </tr>
            `;
        });

        tableHtml += `</tbody></table>`;
        resultsContainer.innerHTML = tableHtml;
    }

    function exportToCSVFile() {
        if (Object.keys(compiledGlobalLoans).length === 0) return;

        let header = "Member ID,Member Name,Days In Faction,Total Items,Loaned Items CSV\n";
        let csvContent = "data:text/csv;charset=utf-8," + header;

        Object.values(compiledGlobalLoans).forEach(m => {
            const itemsCSV = m.items.map(i => i.name).join(' | ');
            const row = `${m.id},"${m.name}",${m.daysInFaction},${m.items.length},"${itemsCSV}"\n`;
            csvContent += row;
        });

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `Faction_Armory_Loans_${Math.floor(Date.now()/1000)}.csv`);
        document.body.appendChild(link);
        
        link.click();
        document.body.removeChild(link);
    }

    const observer = new MutationObserver(() => {
        injectDashboard();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    injectDashboard();
})();