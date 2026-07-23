// ==UserScript==
// @name         Torn Faction Roster Armory Overlay
// @namespace    http://tampermonkey.net/
// @version      1.1.2
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

    let apiKey = GM_getValue('torn_api_key', '');
    let memberLoansMap = {}; // Format: { "userID": ["Item 1", "Item 2"] }

    const getApiKey = () => {
        if (!apiKey) {
            const input = prompt("Enter your Torn API Key (Faction permissions required) to display armory loans inline:");
            if (input) {
                apiKey = input.trim();
                GM_setValue('torn_api_key', apiKey);
            }
        }
        return apiKey;
    };

    const fetchAllArmoryData = () => {
        const key = getApiKey();
        if (!key) return;

        // Pull ALL 8 armory selections to guarantee no item is left out
        const selections = 'weapons,armor,temporary,medical,drugs,boosters,cesium,main';

        GM_xmlhttpRequest({
            method: "GET",
            url: `https://api.torn.com/faction/?selections=${selections}&key=${key}`,
            onload: (res) => {
                try {
                    const data = JSON.parse(res.responseText || '{}');
                    if (data.error) {
                        console.error("Armory Overlay API Error:", data.error);
                        return;
                    }
                    parseLoans(data);
                    injectIntoRoster();
                } catch(e) {
                    console.error("Armory Overlay Parse Error:", e);
                }
            }
        });
    };

    const parseLoans = (data) => {
        memberLoansMap = {};

        // Loop over every key in the API response
        Object.keys(data).forEach(catKey => {
            const categoryData = data[catKey];

            // Verify category is valid item collection
            if (categoryData && typeof categoryData === 'object' && !Array.isArray(categoryData)) {
                Object.values(categoryData).forEach(item => {
                    if (item && item.loaned_to) {
                        const targetId = String(item.loaned_to);
                        if (!memberLoansMap[targetId]) {
                            memberLoansMap[targetId] = [];
                        }
                        memberLoansMap[targetId].push(item.name || 'Unknown Item');
                    }
                });
            }
        });
    };

    const injectIntoRoster = () => {
        // Target native profile links on the faction member roster page
        const profileLinks = document.querySelectorAll('a[href*="profiles.php?XID="]');

        profileLinks.forEach(link => {
            const href = link.getAttribute('href');
            const match = href.match(/XID=(\d+)/);
            
            if (match && match[1]) {
                const userId = match[1];

                // Prevent duplicate insertions
                if (link.dataset.armoryInjected) return;
                link.dataset.armoryInjected = "true";

                if (memberLoansMap[userId] && memberLoansMap[userId].length > 0) {
                    const itemList = memberLoansMap[userId].join(', ');
                    
                    const badge = document.createElement('span');
                    badge.style.cssText = `
                        display: inline-block;
                        margin-left: 6px;
                        padding: 1px 5px;
                        background: #2a2a2a;
                        border: 1px solid #444;
                        border-radius: 3px;
                        color: #2ed573;
                        font-size: 10px;
                        font-weight: normal;
                        vertical-align: middle;
                        max-width: 300px;
                        overflow: hidden;
                        text-overflow: ellipsis;
                        white-space: nowrap;
                    `;
                    badge.title = `Armory Loans: ${itemList}`;
                    badge.innerHTML = `🛡️ <b>${memberLoansMap[userId].length}:</b> ${itemList}`;

                    // Place the items right next to the player's name
                    if (link.parentNode) {
                        link.parentNode.appendChild(badge);
                    }
                }
            }
        });
    };

    // Observer to re-inject items dynamically if member list pages/tabs switch
    const observeRoster = () => {
        const observer = new MutationObserver(() => {
            if (Object.keys(memberLoansMap).length > 0) {
                injectIntoRoster();
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });
    };

    // Init script
    fetchAllArmoryData();
    observeRoster();
})();