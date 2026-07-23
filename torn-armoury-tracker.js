// ==UserScript==
// @name         Torn Faction Armory Tracker (Grouped by Member)
// @namespace    http://tampermonkey.net/
// @version      1.1.1
// @description  Aggregates all loaned armory items per member into comma-separated lists.
// @author       beatrice27
// @match        https://www.torn.com/factions.php*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    let apiKey = GM_getValue('torn_api_key', '');

    const refreshWidget = () => {
        ensureWidgetVisible();
        if (!apiKey) {
            renderApiKeyPrompt();
        } else {
            renderLoadingState();
            fetchArmoryData();
        }
    };

    const fetchArmoryData = () => {
        // Fetch ALL armory categories + basic roster
        GM_xmlhttpRequest({
            method: "GET",
            url: `https://api.torn.com/faction/?selections=weapons,armor,temporary,medical,basic&key=${apiKey}`,
            onload: (res) => {
                let data;
                try {
                    data = JSON.parse(res.responseText || '{}');
                } catch(e) {
                    renderError("Failed to parse Faction API response.");
                    return;
                }

                if (data.error) {
                    renderError(`API Error: ${data.error.error}`);
                    return;
                }

                processLoansByMember(data);
            }
        });
    };

    const processLoansByMember = (data) => {
        const members = data.members || {};
        const memberLoansMap = {};

        // Helper function to iterate through any category object/array
        const scanCategory = (categoryObj) => {
            if (!categoryObj || typeof categoryObj !== 'object') return;

            Object.values(categoryObj).forEach(item => {
                if (!item || !item.loaned_to) return;

                const borrowerId = String(item.loaned_to);

                if (!memberLoansMap[borrowerId]) {
                    const memberInfo = members[borrowerId] || {};
                    memberLoansMap[borrowerId] = {
                        id: borrowerId,
                        name: memberInfo.name || `User #${borrowerId}`,
                        daysInFaction: memberInfo.days_in_faction !== undefined ? memberInfo.days_in_faction : 999,
                        items: []
                    };
                }

                memberLoansMap[borrowerId].items.push(item.name || 'Unknown Item');
            });
        };

        // Scan all 4 armory categories
        scanCategory(data.weapons);
        scanCategory(data.armor);
        scanCategory(data.temporary);
        scanCategory(data.medical);

        // Convert map to array
        const memberLoanList = Object.values(memberLoansMap);

        // Sort: Newcomers (<=30 days) first, then by total item count (descending)
        memberLoanList.sort((a, b) => {
            if (a.daysInFaction <= 30 && b.daysInFaction > 30) return -1;
            if (a.daysInFaction > 30 && b.daysInFaction <= 30) return 1;
            return b.items.length - a.items.length;
        });

        renderUI(memberLoanList, Object.keys(members).length);
    };

    const renderLoadingState = () => {
        const container = ensureWidgetVisible();
        container.innerHTML = `<div style="text-align: center; padding: 10px; color: #aaa; font-size: 12px;">Scanning full armory inventory...</div>`;
    };

    const renderApiKeyPrompt = () => {
        const container = ensureWidgetVisible();
        container.innerHTML = `
            <div style="padding: 10px 0; text-align: center; color: #ccc; font-size: 12px;">
                <div style="margin-bottom: 8px;">Enter a Torn API key (Faction permissions required) to view active loans.</div>
                <button id="btn-enter-api-key" style="background: #2ed573; color: #111; border: none; padding: 5px 10px; border-radius: 3px; cursor: pointer; font-size: 11px;">Enter API Key</button>
            </div>
        `;
        attachEventListeners();
    };

    const renderError = (msg) => {
        let container = ensureWidgetVisible();
        container.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <h3 style="margin: 0; color: #ff4757; font-size: 14px;">⚠️ Tracking Error</h3>
                <button id="btn-reset-key" style="background: #ff4757; color: #fff; border: none; padding: 3px 8px; border-radius: 3px; cursor: pointer; font-size: 11px;">🔑 Reset Key</button>
            </div>
            <div style="color: #ccc; font-size: 12px;">${msg}</div>
        `;
        attachEventListeners();
    };

    const renderUI = (memberLoans, totalFactionMembers) => {
        let container = ensureWidgetVisible();

        let totalItemsLoaned = 0;
        let tableRows = memberLoans.map(m => {
            totalItemsLoaned += m.items.length;
            const isNewcomer = m.daysInFaction <= 30;
            const rowBg = isNewcomer ? 'rgba(46, 213, 115, 0.08)' : 'transparent';
            const nameColor = isNewcomer ? '#2ed573' : '#70a1ff';
            const daysText = m.daysInFaction === 999 ? 'Left Faction' : `${m.daysInFaction}d`;

            // Combine items into a clean comma-separated string
            const itemsCSV = m.items.join(', ');

            return `
                <tr style="border-bottom: 1px solid #2a2a2a; background: ${rowBg};">
                    <td style="padding: 6px 4px; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                        <a href="https://www.torn.com/profiles.php?XID=${m.id}" target="_blank" style="color: ${nameColor}; text-decoration: underline; font-weight: bold; font-size: 12px;">
                            ${m.name} [${m.id}] 🔗
                        </a>
                        ${isNewcomer ? '<span style="font-size: 10px; color: #2ed573; margin-left: 4px;">(New)</span>' : ''}
                    </td>
                    <td style="padding: 6px 4px; text-align: center; color: #bdbdbd; font-size: 11px; white-space: nowrap;">${daysText}</td>
                    <td style="padding: 6px 4px; text-align: center; color: #ffa502; font-weight: bold; font-size: 12px; white-space: nowrap;">${m.items.length}</td>
                    <td style="padding: 6px 4px; text-align: left; color: #ddd; font-size: 12px; word-break: break-word; white-space: normal;">
                        ${itemsCSV}
                    </td>
                </tr>
            `;
        }).join('');

        if (memberLoans.length === 0) {
            tableRows = `<tr><td colspan="4" style="padding: 10px; text-align: center; color: #888; font-style: italic; font-size: 12px;">No active armory loans found.</td></tr>`;
        }

        container.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                <h3 style="margin: 0; color: #fff; font-size: 15px;">🛡️ Armory Loan Summary (${memberLoans.length} Members)</h3>
                <div>
                    <span style="font-size: 11px; color: #888; margin-right: 8px;">Total Items Out: ${totalItemsLoaned}</span>
                    <button id="btn-refresh-armory" style="background: #333; color: #ccc; border: 1px solid #555; padding: 3px 8px; border-radius: 3px; cursor: pointer; font-size: 11px; margin-right: 6px;">🔄 Refresh</button>
                    <button id="btn-reset-key" style="background: #222; color: #aaa; border: 1px solid #444; padding: 3px 8px; border-radius: 3px; cursor: pointer; font-size: 11px;">🔑 Reset Key</button>
                </div>
            </div>

            <div style="overflow-x: auto; width: 100%;">
                <table style="width: 100%; border-collapse: collapse; font-size: 12px; table-layout: fixed;">
                    <colgroup>
                        <col style="width: 25%;">
                        <col style="width: 10%;">
                        <col style="width: 10%;">
                        <col style="width: 55%;">
                    </colgroup>
                    <thead>
                        <tr style="color: #888; font-size: 11px; border-bottom: 2px solid #555; background: #222;">
                            <th style="text-align: left; padding: 6px 4px;">Member</th>
                            <th style="text-align: center; padding: 6px 4px;">Days</th>
                            <th style="text-align: center; padding: 6px 4px;">Count</th>
                            <th style="text-align: left; padding: 6px 4px;">Loaned Items (CSV)</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tableRows}
                    </tbody>
                </table>
            </div>
        `;

        attachEventListeners();
    };

    const attachEventListeners = () => {
        const btnRefresh = document.getElementById('btn-refresh-armory');
        if (btnRefresh) btnRefresh.addEventListener('click', refreshWidget);

        const btnResetKey = document.getElementById('btn-reset-key');
        if (btnResetKey) btnResetKey.addEventListener('click', promptApiKey);

        const btnEnterApiKey = document.getElementById('btn-enter-api-key');
        if (btnEnterApiKey) btnEnterApiKey.addEventListener('click', promptApiKey);
    };

    const promptApiKey = () => {
        const key = prompt("Enter your Torn API Key (Faction permissions required):");
        if (key) {
            GM_setValue('torn_api_key', key.trim());
            apiKey = key.trim();
            refreshWidget();
        }
    };

    const getWidgetContainer = () => {
        let container = document.getElementById('faction-loan-widget');
        if (!container) {
            container = document.createElement('div');
            container.id = 'faction-loan-widget';
            container.style = "background: #191919; color: #fff; padding: 12px; margin: 10px 0; border: 1px solid #333; border-radius: 5px; font-family: Arial, sans-serif; display: block; width: 100%; box-sizing: border-box; overflow-x: auto; position: relative; z-index: 99999;";

            const targetEl = document.querySelector('#mainContainer') 
                || document.querySelector('.content-wrapper') 
                || document.querySelector('.main-wrapper')
                || document.body;

            if (targetEl.firstChild) {
                targetEl.insertBefore(container, targetEl.firstChild);
            } else {
                targetEl.appendChild(container);
            }
        }
        return container;
    };

    const ensureWidgetVisible = () => {
        return getWidgetContainer();
    };

    const initScript = () => {
        if (window.__armory_tracker_initialized) return;
        window.__armory_tracker_initialized = true;
        refreshWidget();
    };

    if (document.readyState === 'interactive' || document.readyState === 'complete') {
        initScript();
    } else {
        document.addEventListener('DOMContentLoaded', initScript, { once: true });
        window.addEventListener('load', initScript, { once: true });
    }

    setTimeout(initScript, 1000);
})();