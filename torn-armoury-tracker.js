// ==UserScript==
// @name         Torn Faction Armory Tracker (Live Items)
// @namespace    http://tampermonkey.net/
// @version      1.1.0
// @description  Tracks faction items loaned to members reading directly from armory inventory.
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
        // Fetch specific categories + basic (for the member list)
        GM_xmlhttpRequest({
            method: "GET",
            url: `https://api.torn.com/faction/?selections=weapons,armor,temporary,basic&key=${apiKey}`,
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

                processLoans(data);
            }
        });
    };

    const processLoans = (data) => {
        const members = data.members || {};
        const activeLoans = [];

        // Helper to parse items and grab loaned ones
        const extractLoans = (itemsObj, categoryName) => {
            if (!itemsObj) return;
            
            // The API returns items where the key is the unique Item ID
            for (const [uniqueId, item] of Object.entries(itemsObj)) {
                if (item.loaned_to) {
                    activeLoans.push({
                        uniqueId: uniqueId,
                        name: item.name,
                        type: item.type || categoryName,
                        loanedToId: item.loaned_to,
                        memberName: members[item.loaned_to] ? members[item.loaned_to].name : 'Unknown',
                        daysInFaction: members[item.loaned_to] ? members[item.loaned_to].days_in_faction : 999
                    });
                }
            }
        };

        extractLoans(data.weapons, "Weapon");
        extractLoans(data.armor, "Armor");
        extractLoans(data.temporary, "Temporary");

        // Sort loans: Newcomers (<= 30 days) at the top, then alphabetically by member name
        activeLoans.sort((a, b) => {
            if (a.daysInFaction <= 30 && b.daysInFaction > 30) return -1;
            if (a.daysInFaction > 30 && b.daysInFaction <= 30) return 1;
            return a.memberName.localeCompare(b.memberName);
        });

        renderUI(activeLoans, members);
    };

    const renderLoadingState = () => {
        const container = ensureWidgetVisible();
        container.innerHTML = `<div style="text-align: center; padding: 10px; color: #aaa; font-size: 12px;">Scanning armory inventory...</div>`;
    };

    const renderApiKeyPrompt = () => {
        const container = ensureWidgetVisible();
        container.innerHTML = `
            <div style="padding: 10px 0; text-align: center; color: #ccc; font-size: 12px;">
                <div style="margin-bottom: 8px;">Enter a Torn API key (Limited/Full access with Faction permissions) to load the tracker.</div>
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
                <button id="btn-reset-key" style="background: #ff4757; color: #fff; border: none; padding: 3px 8px; border-radius: 3px; cursor: pointer; font-size: 11px;">🔑 Reset API Key</button>
            </div>
            <div style="color: #ccc; font-size: 12px;">${msg}</div>
        `;
        attachEventListeners();
    };

    const renderUI = (loans, members) => {
        let container = ensureWidgetVisible();

        let tableRows = loans.map(loan => {
            const isNewcomer = loan.daysInFaction <= 30;
            const rowBg = isNewcomer ? 'rgba(46, 213, 115, 0.1)' : 'transparent';
            const nameColor = isNewcomer ? '#2ed573' : '#70a1ff';
            const daysText = loan.daysInFaction === 999 ? 'Left Faction' : `${loan.daysInFaction} days`;
            
            return `
                <tr style="border-bottom: 1px solid #2a2a2a; background: ${rowBg};">
                    <td style="padding: 6px 4px; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                        <a href="https://www.torn.com/profiles.php?XID=${loan.loanedToId}" target="_blank" style="color: ${nameColor}; text-decoration: underline; font-weight: bold; font-size: 12px;">
                            ${loan.memberName} [${loan.loanedToId}] 🔗
                        </a>
                        ${isNewcomer ? '<span style="font-size: 10px; color: #2ed573; margin-left: 4px;">(New)</span>' : ''}
                    </td>
                    <td style="padding: 6px 4px; text-align: center; color: #bdbdbd; font-size: 11px; white-space: nowrap;">${daysText}</td>
                    <td style="padding: 6px 4px; text-align: left; color: #fff; font-size: 12px; white-space: nowrap;">${loan.name}</td>
                    <td style="padding: 6px 4px; text-align: center; color: #ffa502; font-size: 11px; white-space: nowrap;">${loan.type}</td>
                </tr>
            `;
        }).join('');

        if (loans.length === 0) {
            tableRows = `<tr><td colspan="4" style="padding: 10px; text-align: center; color: #888; font-style: italic; font-size: 12px;">No items currently loaned out.</td></tr>`;
        }

        container.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                <h3 style="margin: 0; color: #fff; font-size: 15px;">🛡️ Live Armory Loan Tracker</h3>
                <div>
                    <span style="font-size: 11px; color: #888; margin-right: 8px;">Active Loans: ${loans.length}</span>
                    <button id="btn-refresh-armory" style="background: #333; color: #ccc; border: 1px solid #555; padding: 3px 8px; border-radius: 3px; cursor: pointer; font-size: 11px; margin-right: 6px;">🔄 Refresh</button>
                    <button id="btn-reset-key" style="background: #222; color: #aaa; border: 1px solid #444; padding: 3px 8px; border-radius: 3px; cursor: pointer; font-size: 11px;">🔑 Reset Key</button>
                </div>
            </div>

            <div style="overflow-x: auto; width: 100%;">
                <table style="width: 100%; border-collapse: collapse; font-size: 12px; table-layout: fixed;">
                    <colgroup>
                        <col style="width: 35%;">
                        <col style="width: 20%;">
                        <col style="width: 25%;">
                        <col style="width: 20%;">
                    </colgroup>
                    <thead>
                        <tr style="color: #888; font-size: 11px; border-bottom: 2px solid #555; background: #222;">
                            <th style="text-align: left; padding: 6px 4px;">Loaned To</th>
                            <th style="text-align: center; padding: 6px 4px;">Time in Faction</th>
                            <th style="text-align: left; padding: 6px 4px;">Item Name</th>
                            <th style="text-align: center; padding: 6px 4px;">Category</th>
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
        const container = getWidgetContainer();
        return container;
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