// ==UserScript==
// @name         Torn Faction Armory & Activity Engine
// @namespace    http://tampermonkey.net/
// @version      2.1.0
// @description  Tracks drug/alcohol usage, chain hits, OR active armory loans grouped by member.
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

    const DRUGS_TO_TRACK = ['Xanax', 'Vicodin', 'Speed', 'Opium', 'LSD', 'Ecstasy', 'Ketamine', 'Shrooms', 'PCP', 'Cannabis'];
    const ALCOHOL_TO_TRACK = ['Beer', 'Wine', 'Vodka', 'Sake', 'Tequila'];
    const MAX_CHUNKS = 40; 

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
        .tracker-inline-input:disabled { background: #222; color: #555; border-color: #333; cursor: not-allowed; }
        .filter-row { display: flex; align-items: center; margin-bottom: 10px; font-size: 13px; color: #ccc; flex-wrap: wrap; gap: 8px; }
        .filter-row label { margin-right: 8px; }
    `;
    const styleSheet = document.createElement("style");
    styleSheet.innerText = styles;
    document.head.appendChild(styleSheet);

    let compiledGlobalStats = {}; 

    function injectDashboard() {
        if (document.getElementById('armory-tracker-dashboard')) return;

        const target = document.querySelector('.content-wrapper') || document.querySelector('#mainContainer');
        if (!target) return;

        const dashboard = document.createElement('div');
        dashboard.id = 'armory-tracker-dashboard';
        dashboard.className = 'armory-tracker-wrap';

        let savedKey = GM_getValue('torn_api_key', '');

        dashboard.innerHTML = `
            <div class="armory-tracker-title">
                <span>Faction Armory & Activity Engine</span>
                <div>
                    <button id="fetch-armory-btn" class="tracker-btn">Run Report</button>
                    <button id="toggle-filters-btn" class="tracker-btn secondary-toggle-btn">🎛️ Filters</button>
                    <button id="toggle-settings-btn" class="tracker-btn secondary-toggle-btn">⚙️ Settings</button>
                    <button id="export-csv-btn" class="tracker-btn export-csv-btn" style="display: none;">📥 Export CSV</button>
                </div>
            </div>
            
            <div id="tracker-filters-panel" class="tracker-inline-panel">
                <div class="filter-row">
                    <label><input type="checkbox" id="track-drugs-checkbox" checked> Track Drugs</label>
                    <label><input type="checkbox" id="track-alcohol-checkbox" checked> Track Alcohol</label>
                    <label style="color: #ffca28;"><input type="checkbox" id="track-chain-checkbox" checked> Show Last Chain Hit</label>
                    <label style="color: #70a1ff; font-weight: bold;"><input type="checkbox" id="track-loans-checkbox"> Track Active Loans Only</label>
                </div>
                <div class="filter-row" style="margin-bottom: 0;">
                    <label>Start Date:</label>
                    <input type="date" id="filter-start-date" class="tracker-inline-input">
                    <label>End Date:</label>
                    <input type="date" id="filter-end-date" class="tracker-inline-input">
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
                  '<p style="color: #aaa; font-size:12px;">Click "Run Report" to generate data according to active filters.</p>' : 
                  '<p style="color: #ff9800; font-size:12px;">⚠️ API Key missing. Click the <b>⚙️ Settings</b> button above to set it up.</p>'}
            </div>
        `;

        target.insertBefore(dashboard, target.firstChild);

        setupFilterToggleHandlers();

        document.getElementById('toggle-filters-btn').addEventListener('click', () => {
            const filtersPanel = document.getElementById('tracker-filters-panel');
            const settingsPanel = document.getElementById('tracker-settings-panel');
            filtersPanel.style.display = filtersPanel.style.display === 'block' ? 'none' : 'block';
            settingsPanel.style.display = 'none';
        });

        document.getElementById('toggle-settings-btn').addEventListener('click', () => {
            const filtersPanel = document.getElementById('tracker-filters-panel');
            const settingsPanel = document.getElementById('tracker-settings-panel');
            settingsPanel.style.display = settingsPanel.style.display === 'block' ? 'none' : 'block';
            filtersPanel.style.display = 'none';
        });

        document.getElementById('inline-save-btn').addEventListener('click', () => {
            const keyVal = document.getElementById('inline-api-input').value.trim();
            const status = document.getElementById('inline-save-status');
            GM_setValue('torn_api_key', keyVal);
            status.style.color = '#4caf50';
            status.innerText = '✅ Key successfully saved!';
            setTimeout(() => { status.innerText = ''; document.getElementById('tracker-settings-panel').style.display = 'none'; }, 1500);
        });

        document.getElementById('fetch-armory-btn').addEventListener('click', () => {
            const apiKey = GM_getValue('torn_api_key', '');
            if (!apiKey) {
                alert('Please configure your API key first inside Settings.');
                document.getElementById('tracker-settings-panel').style.display = 'block';
                return;
            }
            startScan(apiKey);
        });

        document.getElementById('export-csv-btn').addEventListener('click', exportToCSVFile);
    }

    function setupFilterToggleHandlers() {
        const drugsCb = document.getElementById('track-drugs-checkbox');
        const alcCb = document.getElementById('track-alcohol-checkbox');
        const chainCb = document.getElementById('track-chain-checkbox');
        const loansCb = document.getElementById('track-loans-checkbox');
        const startDate = document.getElementById('filter-start-date');
        const endDate = document.getElementById('filter-end-date');

        loansCb.addEventListener('change', () => {
            if (loansCb.checked) {
                drugsCb.checked = false;
                alcCb.checked = false;
                chainCb.checked = false;
                startDate.disabled = true;
                endDate.disabled = true;
            } else {
                startDate.disabled = false;
                endDate.disabled = false;
            }
        });

        [drugsCb, alcCb, chainCb].forEach(cb => {
            cb.addEventListener('change', () => {
                if (cb.checked) {
                    loansCb.checked = false;
                    startDate.disabled = false;
                    endDate.disabled = false;
                }
            });
        });
    }

    function startScan(apiKey) {
        document.getElementById('export-csv-btn').style.display = 'none';
        const resultsContainer = document.getElementById('tracker-results-container');
        const trackLoans = document.getElementById('track-loans-checkbox').checked;

        if (trackLoans) {
            fetchActiveLoansOnly(apiKey);
        } else {
            startActivityScan(apiKey);
        }
    }

    // --- Active Loan Dedicated Scan ---
    function fetchActiveLoansOnly(apiKey) {
        const resultsContainer = document.getElementById('tracker-results-container');
        resultsContainer.innerHTML = `<p style="color: #70a1ff;">Querying faction armory active loans...</p>`;

        const url = `https://api.torn.com/faction/?selections=weapons,armor,temporary,medical,drugs,boosters&key=${apiKey}`;

        GM_xmlhttpRequest({
            method: "GET",
            url: url,
            onload: function(response) {
                try {
                    const data = JSON.parse(response.responseText);
                    if (data.error) {
                        resultsContainer.innerHTML = `<p style="color: #f44336;">API Error: ${data.error.error}</p>`;
                        return;
                    }

                    const categories = ['weapons', 'armor', 'temporary', 'medical', 'drugs', 'boosters'];
                    const loansByUser = {};

                    // Iterate over all items in all categories
                    categories.forEach(cat => {
                        const catData = data[cat];
                        if (catData) {
                            const itemsList = Array.isArray(catData) ? catData : Object.values(catData);
                            itemsList.forEach(item => {
                                if (item && item.loaned_to) {
                                    const borrowerId = String(item.loaned_to);
                                    
                                    if (!loansByUser[borrowerId]) {
                                        loansByUser[borrowerId] = {};
                                    }

                                    const itemName = item.name || 'Unknown Item';
                                    loansByUser[borrowerId][itemName] = (loansByUser[borrowerId][itemName] || 0) + 1;
                                }
                            });
                        }
                    });

                    compiledGlobalStats = loansByUser;
                    renderLoansTable(loansByUser);

                } catch(e) {
                    resultsContainer.innerHTML = `<p style="color: #f44336;">Error parsing active loan response data.</p>`;
                }
            },
            onerror: function() {
                resultsContainer.innerHTML = `<p style="color: #f44336;">Network protocol layer failure while reading loans.</p>`;
            }
        });
    }

    function renderLoansTable(loansByUser) {
        const resultsContainer = document.getElementById('tracker-results-container');
        const csvBtn = document.getElementById('export-csv-btn');

        const userIds = Object.keys(loansByUser);
        if (userIds.length === 0) {
            resultsContainer.innerHTML = '<p style="color: #aaa;">No active loaned items currently found in faction armory.</p>';
            csvBtn.style.display = 'none';
            return;
        }

        csvBtn.style.display = 'inline-block';

        let tableHtml = `
            <table class="armory-tracker-table">
                <thead>
                    <tr>
                        <th style="width: 25%; text-align: left;">Borrower ID</th>
                        <th style="width: 75%; text-align: left;">Active Loaned Items</th>
                    </tr>
                </thead>
                <tbody>
        `;

        userIds.forEach(uid => {
            const gearMap = loansByUser[uid];
            const itemsStr = Object.entries(gearMap)
                .map(([name, count]) => count > 1 ? `<strong>${name}</strong> (x${count})` : `<strong>${name}</strong>`)
                .join(', ');

            tableHtml += `
                <tr>
                    <td><a href="https://www.torn.com/profiles.php?XID=${uid}" target="_blank">User [${uid}]</a></td>
                    <td style="text-align: left; color: #70a1ff !important; font-size: 13px;">${itemsStr}</td>
                </tr>
            `;
        });

        tableHtml += `</tbody></table>`;
        resultsContainer.innerHTML = tableHtml;
    }

    // --- Activity / Usage Scan ---
    function startActivityScan(apiKey) {
        const resultsContainer = document.getElementById('tracker-results-container');
        let allArmoryLogs = {};
        let allAttackLogs = {};
        let currentChunk = 0;
        
        const now = Math.floor(Date.now() / 1000);
        const startDateVal = document.getElementById('filter-start-date').value;
        const endDateVal = document.getElementById('filter-end-date').value;
        const showChainHits = document.getElementById('track-chain-checkbox').checked;

        let targetEndTime = now - (3 * 24 * 60 * 60); 
        let scanToTimestamp = now;

        if (startDateVal) targetEndTime = Math.floor(new Date(startDateVal).getTime() / 1000);
        if (endDateVal) scanToTimestamp = Math.floor(new Date(endDateVal).getTime() / 1000) + (24 * 60 * 60) - 1;
        if (scanToTimestamp > now) scanToTimestamp = now;

        function fetchLiveAttacks(callback) {
            if (!showChainHits) {
                callback({});
                return;
            }
            resultsContainer.innerHTML = `<p style="color: #ffca28;">Fetching live faction chain hit activity...</p>`;
            const url = `https://api.torn.com/faction/?selections=attacks&key=${apiKey}`;
            GM_xmlhttpRequest({
                method: "GET",
                url: url,
                onload: function(response) {
                    try {
                        const data = JSON.parse(response.responseText);
                        callback(data.attacks || {});
                    } catch(e) { callback({}); }
                },
                onerror: function() { callback({}); }
            });
        }

        fetchLiveAttacks(function(attackData) {
            allAttackLogs = attackData;
            fetchNextArmoryChunk();
        });

        function fetchNextArmoryChunk() {
            currentChunk++;
            resultsContainer.innerHTML = `<p style="color: #ffca28;">Processing historical chunk ${currentChunk} of ${MAX_CHUNKS}...</p>`;

            const url = `https://api.torn.com/faction/?selections=armorynews&to=${scanToTimestamp}&key=${apiKey}`;

            GM_xmlhttpRequest({
                method: "GET",
                url: url,
                onload: function(response) {
                    try {
                        const data = JSON.parse(response.responseText);
                        if (data.error) {
                            resultsContainer.innerHTML = `<p style="color: #f44336;">API Error: ${data.error.error}</p>`;
                            return;
                        }

                        const chunkArmory = data.armorynews || {};
                        const logKeys = Object.keys(chunkArmory);

                        if (logKeys.length === 0) {
                            processActivityLogs(allArmoryLogs, allAttackLogs, targetEndTime);
                            return;
                        }

                        Object.assign(allArmoryLogs, chunkArmory);

                        let oldestTimestamp = scanToTimestamp;
                        logKeys.forEach(id => {
                            if (chunkArmory[id].timestamp < oldestTimestamp) {
                                oldestTimestamp = chunkArmory[id].timestamp;
                            }
                        });

                        if (oldestTimestamp <= targetEndTime || oldestTimestamp === scanToTimestamp || currentChunk >= MAX_CHUNKS) {
                            processActivityLogs(allArmoryLogs, allAttackLogs, targetEndTime);
                        } else {
                            scanToTimestamp = oldestTimestamp - 1;
                            setTimeout(fetchNextArmoryChunk, 250);
                        }
                    } catch (e) {
                        resultsContainer.innerHTML = `<p style="color: #f44336;">Error processing log structural payload.</p>`;
                    }
                },
                onerror: function() {
                    resultsContainer.innerHTML = `<p style="color: #f44336;">Network protocol layer failure.</p>`;
                }
            });
        }
    }

    function processActivityLogs(armoryLogs, attackLogs, targetEndTime) {
        const now = Math.floor(Date.now() / 1000);
        const oneDayAgo = now - (24 * 60 * 60);
        
        const trackDrugs = document.getElementById('track-drugs-checkbox').checked;
        const trackAlcohol = document.getElementById('track-alcohol-checkbox').checked;
        const showChainHits = document.getElementById('track-chain-checkbox').checked;

        let activeFilterList = [];
        if (trackDrugs) activeFilterList = activeFilterList.concat(DRUGS_TO_TRACK);
        if (trackAlcohol) activeFilterList = activeFilterList.concat(ALCOHOL_TO_TRACK);

        const userStats = {};
        const initUser = () => ({
            drugs24h: 0, alcohol24h: 0,
            drugsWindow: 0, alcoholWindow: 0,
            breakdown: {}, lastChainHit: 'N/A', lastChainHitRaw: 0
        });

        Object.values(armoryLogs).forEach(log => {
            const newsText = log.news;
            const timestamp = log.timestamp;

            if (timestamp < targetEndTime) return;

            let foundMatch = activeFilterList.find(item => newsText.toLowerCase().includes(item.toLowerCase()));
            
            if (foundMatch && newsText.includes("used one of")) {
                const nameParts = newsText.split(/\s+used\s+/);
                if (nameParts.length > 0) {
                    const username = nameParts[0].trim();
                    if (!userStats[username]) userStats[username] = initUser();

                    const isDrug = DRUGS_TO_TRACK.includes(foundMatch);

                    if (isDrug) {
                        userStats[username].drugsWindow++;
                        if (timestamp >= oneDayAgo) userStats[username].drugs24h++;
                    } else {
                        userStats[username].alcoholWindow++;
                        if (timestamp >= oneDayAgo) userStats[username].alcohol24h++;
                    }

                    userStats[username].breakdown[foundMatch] = (userStats[username].breakdown[foundMatch] || 0) + 1;
                }
            }
        });

        if (showChainHits) {
            Object.values(attackLogs).forEach(attack => {
                const isChainHit = (attack.chain && attack.chain > 0) || attack.chain_hit === 1;
                const isSuccess = ["Hospitalized", "Mugged", "Left", "Arrested"].includes(attack.result);

                if (isChainHit && isSuccess && attack.timestamp >= targetEndTime) {
                    const attackerName = attack.attacker_name;
                    if (attackerName) {
                        if (!userStats[attackerName]) userStats[attackerName] = initUser();
                        
                        if (attack.timestamp > userStats[attackerName].lastChainHitRaw) {
                            userStats[attackerName].lastChainHitRaw = attack.timestamp;
                            const dateObj = new Date(attack.timestamp * 1000);
                            userStats[attackerName].lastChainHit = dateObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) + ' ' + dateObj.toLocaleDateString([], {month: 'short', day: 'numeric'});
                        }
                    }
                }
            });
        }

        compiledGlobalStats = userStats; 
        renderActivityTable(userStats, showChainHits);
    }

    function renderActivityTable(userStats, showChainHits) {
        const resultsContainer = document.getElementById('tracker-results-container');
        const csvBtn = document.getElementById('export-csv-btn');

        if (Object.keys(userStats).length === 0) {
            resultsContainer.innerHTML = '<p style="color: #aaa;">No matches discovered across current selection intervals.</p>';
            csvBtn.style.display = 'none';
            return;
        }

        csvBtn.style.display = 'inline-block';

        const sortedUsers = Object.keys(userStats).sort((a, b) => 
            (userStats[b].drugsWindow + userStats[b].alcoholWindow) - (userStats[a].drugsWindow + userStats[a].alcoholWindow)
        );

        let tableHtml = `
            <table class="armory-tracker-table">
                <thead>
                    <tr>
                        <th rowspan="2" style="text-align: left; vertical-align: middle;">Member</th>
                        <th colspan="2">Past 24 Hours</th>
                        <th colspan="2">Selected Window</th>
                        ${showChainHits ? '<th rowspan="2" style="vertical-align: middle;">Last Chain Hit</th>' : ''}
                        <th rowspan="2" style="text-align: left; vertical-align: middle;">Breakdown Summary</th>
                    </tr>
                    <tr>
                        <th>Drugs</th>
                        <th>Alcohol</th>
                        <th>Drugs</th>
                        <th>Alcohol</th>
                    </tr>
                </thead>
                <tbody>
        `;

        sortedUsers.forEach(user => {
            const data = userStats[user];
            const breakdownStr = Object.entries(data.breakdown).map(([item, count]) => `${item} (x${count})`).join(', ') || 'None';

            tableHtml += `
                <tr>
                    <td><strong>${user}</strong></td>
                    <td style="color: ${data.drugs24h > 2 ? '#ff9800' : '#fff'} !important;">${data.drugs24h}</td>
                    <td>${data.alcohol24h}</td>
                    <td>${data.drugsWindow}</td>
                    <td>${data.alcoholWindow}</td>
                    ${showChainHits ? `<td style="color: #ffca28 !important; font-size: 12px;">${data.lastChainHit}</td>` : ''}
                    <td style="font-size: 12px; color: #ccc !important;">${breakdownStr}</td>
                </tr>
            `;
        });

        tableHtml += `</tbody></table>`;
        resultsContainer.innerHTML = tableHtml;
    }

    function exportToCSVFile() {
        if (Object.keys(compiledGlobalStats).length === 0) return;

        const isLoansMode = document.getElementById('track-loans-checkbox').checked;
        let csvContent = "data:text/csv;charset=utf-8,";

        if (isLoansMode) {
            csvContent += "Borrower ID,Active Loaned Gear\n";
            Object.keys(compiledGlobalStats).forEach(uid => {
                const itemsStr = Object.entries(compiledGlobalStats[uid])
                    .map(([name, count]) => count > 1 ? `${name} (x${count})` : name)
                    .join(' | ');
                csvContent += `"${uid}","${itemsStr}"\n`;
            });
        } else {
            const showChainHits = document.getElementById('track-chain-checkbox').checked;
            csvContent += "Member,24h Drugs,24h Alcohol,Window Drugs,Window Alcohol," + 
                          (showChainHits ? "Last Chain Hit," : "") + 
                          "Usage Breakdown\n";

            Object.keys(compiledGlobalStats).forEach(user => {
                const data = compiledGlobalStats[user];
                const breakdownStr = Object.entries(data.breakdown).map(([item, count]) => `${item} (x${count})`).join(' | ') || 'None';
                
                let row = `${user},${data.drugs24h},${data.alcohol24h},${data.drugsWindow},${data.alcoholWindow},`;
                if (showChainHits) row += `"${data.lastChainHit}",`;
                row += `"${breakdownStr}"\n`;
                
                csvContent += row;
            });
        }

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `Faction_Report_${isLoansMode ? 'Loans' : 'Activity'}_${Math.floor(Date.now()/1000)}.csv`);
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