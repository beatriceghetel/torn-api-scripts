// ==UserScript==
// @name         Torn Company Competitor Intelligence
// @namespace    https://github.com/beatriceghetel/torn-api-scripts/raw/main/torn-company-intel-script.js
// @version      9.0.9
// @license      MIT
// @description  Fetches real daily/weekly income and customer metrics from /v2/company/snapshot
// @author       beatrice27
// @match        https://www.torn.com/companies.php*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    let apiKey = GM_getValue('torn_api_key', '');

    const refreshWidget = (forceRefresh = false) => {
        ensureWidgetVisible();
        renderLoadingState();
        fetchIntel(forceRefresh);
    };

    const fetchIntel = (forceRefresh = false) => {
        if (!apiKey) {
            renderApiKeyPrompt();
            return;
        }

        const cached = localStorage.getItem('company_snapshot_cache_v9');
        if (!forceRefresh && cached) {
            try {
                const parsed = JSON.parse(cached);
                if (parsed.lastUpdate && (Date.now() - parsed.lastUpdate < 1800000) && parsed.data) { // 30-min cache
                    processSnapshot(parsed.data);
                    return;
                }
            } catch(e) {
                localStorage.removeItem('company_snapshot_cache_v9');
            }
        }

        // 1. Fetch Director Profile to get your company's star rating & industry type
        GM_xmlhttpRequest({
            method: "GET",
            url: `https://api.torn.com/company/?selections=profile&key=${apiKey}`,
            onload: (res) => {
                let myComp;
                try {
                    myComp = JSON.parse(res.responseText || '{}');
                } catch(e) {
                    renderError("Failed to parse company profile.", res.responseText);
                    return;
                }

                if (!myComp || myComp.error) {
                    renderError(`API Error: ${myComp?.error?.error || "Invalid Request"}`, myComp);
                    return;
                }

                const myType = Number(myComp.company?.company_type || 1);
                const myRating = Number(myComp.company?.rating || 1);

                // 2. Fetch Global CSV Snapshot
                GM_xmlhttpRequest({
                    method: "GET",
                    url: `https://api.torn.com/v2/company/snapshot?key=${apiKey}`,
                    onload: (csvRes) => {
                        if (csvRes.status !== 200) {
                            renderError("Snapshot request failed. Ensure API key has Public access.", csvRes.responseText);
                            return;
                        }

                        const payload = {
                            myType: myType,
                            myRating: myRating,
                            targetRating: myRating < 5 ? myRating + 1 : 5,
                            rawCsv: csvRes.responseText
                        };

                        localStorage.setItem('company_snapshot_cache_v9', JSON.stringify({
                            data: payload,
                            lastUpdate: Date.now()
                        }));

                        processSnapshot(payload);
                    }
                });
            }
        });
    };

    // Robust CSV parser capable of handling quoted company names
    const parseCSV = (csvText) => {
        const lines = csvText.trim().split('\n');
        if (lines.length < 2) return [];

        const list = [];
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            // Split line by comma while preserving quoted strings
            const cols = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
            if (cols.length >= 14) {
                const clean = str => str ? str.replace(/^"|"$/g, '').trim() : '';
                list.push({
                    id: clean(cols[0]),
                    name: clean(cols[1]),
                    daysOld: Number(clean(cols[3])) || 0,
                    type: Number(clean(cols[5])),
                    rating: Number(clean(cols[6])),
                    employees: Number(clean(cols[8])),
                    dailyIncome: Number(clean(cols[10])),
                    dailyCustomers: Number(clean(cols[11])),
                    weeklyIncome: Number(clean(cols[12])),
                    weeklyCustomers: Number(clean(cols[13]))
                });
            }
        }
        return list;
    };

    const processSnapshot = (data) => {
        const allCompanies = parseCSV(data.rawCsv);
        const myType = data.myType;
        const myRating = data.myRating;
        const targetRating = data.targetRating;

        // Filter companies by same Industry Type
        const sameTypeCompanies = allCompanies.filter(c => c.type === myType);

        // Group by Star Rating
        const sameStar = sameTypeCompanies.filter(c => c.rating === myRating);
        const targetStar = sameTypeCompanies.filter(c => c.rating === targetRating);

        // Sort by Weekly Income descending
        const sortByIncome = (a, b) => b.weeklyIncome - a.weeklyIncome;

        sameStar.sort(sortByIncome);
        targetStar.sort(sortByIncome);

        const top3Same = sameStar.slice(0, 3);
        const top3Target = targetStar.slice(0, 3);
        const bottom3Target = targetStar.length > 3 
            ? targetStar.slice(-3).reverse() 
            : [...targetStar].reverse();

        renderUI(myRating, targetRating, top3Same, bottom3Target, top3Target, sameTypeCompanies.length);
    };

    const formatCurrency = (amount) => {
        return '$' + amount.toLocaleString();
    };

    const renderLoadingState = () => {
        const container = ensureWidgetVisible();
        container.innerHTML = `
            <div style="text-align: center; padding: 10px; color: #aaa; font-size: 12px;">
                Loading company intelligence...
            </div>
        `;
        container.dataset.rendered = 'true';
    };

    const renderApiKeyPrompt = () => {
        const container = ensureWidgetVisible();
        container.innerHTML = `
            <div style="padding: 10px 0; color: #ccc; font-size: 12px;">
                <div style="margin-bottom: 8px;">Enter your Torn API key to load the company intelligence widget.</div>
                <button id="btn-enter-api-key" style="background: #2ed573; color: #111; border: none; padding: 5px 10px; border-radius: 3px; cursor: pointer; font-size: 11px;">Enter API Key</button>
            </div>
        `;
        container.dataset.rendered = 'true';
        attachEventListeners();
    };

    const renderCategoryRows = (title, list) => {
        if (!list || list.length === 0) {
            return `
                <tr style="background: #222; border-bottom: 1px solid #444;">
                    <td colspan="5" style="padding: 6px 4px; color: #eccc68; font-weight: bold; font-size: 13px;">${title}</td>
                </tr>
                <tr style="border-bottom: 1px solid #2a2a2a;">
                    <td colspan="5" style="padding: 8px; color: #888; font-style: italic; font-size: 12px;">No companies found in this tier.</td>
                </tr>`;
        }

        let rows = list.map(c => {
            const ageText = Number.isFinite(c.daysOld) ? c.daysOld.toLocaleString() : '—';
            return `
                <tr style="border-bottom: 1px solid #2a2a2a;">
                    <td style="padding: 6px 4px; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                        <a href="https://www.torn.com/joblist.php#/p=corpinfo&ID=${c.id}" target="_blank" style="color: #70a1ff; text-decoration: underline; font-weight: bold; font-size: 12px; display: inline-block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                            ${c.name} 🔗
                        </a>
                    </td>
                    <td style="padding: 6px 4px; text-align: center; color: #bdbdbd; white-space: nowrap;">${ageText}</td>
                    <td style="padding: 6px 4px; text-align: right; color: #2ed573; font-weight: bold; white-space: nowrap;">${formatCurrency(c.dailyIncome)}</td>
                    <td style="padding: 6px 4px; text-align: right; color: #1e90ff; white-space: nowrap;">${c.dailyCustomers.toLocaleString()}</td>
                    <td style="padding: 6px 4px; text-align: right; color: #ffa502; font-weight: bold; white-space: nowrap;">${formatCurrency(c.weeklyIncome)}</td>
                </tr>
            `;
        }).join('');

        return `
            <tr style="background: #222; border-top: 2px solid #444; border-bottom: 1px solid #444;">
                <td colspan="5" style="padding: 6px 4px; color: #eccc68; font-weight: bold; font-size: 13px;">${title}</td>
            </tr>
            ${rows}
        `;
    };

    const renderUI = (myRating, targetRating, top3Same, bottom3Target, top3Target, totalIndustryCount) => {
        let container = ensureWidgetVisible();

        container.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                <h3 style="margin: 0; color: #fff; font-size: 15px;">📊 Global Industry Intelligence (Real Revenue)</h3>
                <div>
                    <span style="font-size: 11px; color: #888; margin-right: 8px;">Analyzed ${totalIndustryCount} industry shops</span>
                    <button id="btn-refresh-snapshot" style="background: #333; color: #ccc; border: 1px solid #555; padding: 3px 8px; border-radius: 3px; cursor: pointer; font-size: 11px; margin-right: 6px;">🔄 Reload Snapshot</button>
                    <button id="btn-reset-key" style="background: #222; color: #aaa; border: 1px solid #444; padding: 3px 8px; border-radius: 3px; cursor: pointer; font-size: 11px;">🔑 Reset Key</button>
                </div>
            </div>

            <div style="overflow-x: auto; width: 100%;">
                <table style="width: 100%; border-collapse: collapse; font-size: 12px; table-layout: fixed;">
                    <colgroup>
                        <col style="width: 35%;">
                        <col style="width: 12%;">
                        <col style="width: 17%;">
                        <col style="width: 16%;">
                        <col style="width: 20%;">
                    </colgroup>
                    <thead>
                        <tr style="color: #888; font-size: 11px; border-bottom: 2px solid #555;">
                            <th style="text-align: left; padding: 6px 4px;">Company Name</th>
                            <th style="text-align: center; padding: 6px 4px;">Age</th>
                            <th style="text-align: right; padding: 6px 4px;">Daily Sales</th>
                            <th style="text-align: right; padding: 6px 4px;">Customers</th>
                            <th style="text-align: right; padding: 6px 4px;">Weekly Rev.</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${renderCategoryRows(`⭐ Top Competitors (${myRating}-Star Tier)`, top3Same)}
                        ${renderCategoryRows(`📈 Lowest Revenue (${targetRating}-Star Tier)`, bottom3Target)}
                        ${renderCategoryRows(`🏆 Top Competitors (${targetRating}-Star Tier)`, top3Target)}
                    </tbody>
                </table>
            </div>
        `;

        attachEventListeners();
    };

    const renderError = (msg) => {
        let container = ensureWidgetVisible();
        container.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <h3 style="margin: 0; color: #ff4757; font-size: 14px;">⚠️ Snapshot Error</h3>
                <button id="btn-reset-key" style="background: #ff4757; color: #fff; border: none; padding: 3px 8px; border-radius: 3px; cursor: pointer; font-size: 11px;">🔑 Re-enter API Key</button>
            </div>
            <div style="color: #ccc; font-size: 12px;">${msg}</div>
        `;
        container.dataset.rendered = 'true';
        attachEventListeners();
    };

    const attachEventListeners = () => {
        const btnRefresh = document.getElementById('btn-refresh-snapshot');
        if (btnRefresh) {
            btnRefresh.addEventListener('click', () => {
                localStorage.removeItem('company_snapshot_cache_v9');
                getWidgetContainer().innerHTML = `<div style="text-align:center; padding:10px; color:#aaa;">Downloading latest global CSV snapshot...</div>`;
                fetchIntel(true);
            });
        }

        const btnResetKey = document.getElementById('btn-reset-key');
        if (btnResetKey) {
            btnResetKey.addEventListener('click', promptApiKey);
        }

        const btnEnterApiKey = document.getElementById('btn-enter-api-key');
        if (btnEnterApiKey) {
            btnEnterApiKey.addEventListener('click', promptApiKey);
        }
    };

    const getWidgetContainer = () => {
        let container = document.getElementById('director-intel-widget');
        if (!container) {
            container = document.createElement('div');
            container.id = 'director-intel-widget';
            container.style = "background: #191919; color: #fff; padding: 14px; margin: 10px 0; border: 1px solid #333; border-radius: 5px; font-family: Arial, sans-serif; display: block; width: 100%; max-width: 100%; box-sizing: border-box; overflow-x: auto; position: relative; z-index: 2147483647;";

            const fallbackTarget = document.body || document.documentElement;
            if (fallbackTarget) {
                fallbackTarget.appendChild(container);
            }
        }
        return container;
    };

    const ensureWidgetVisible = () => {
        const container = getWidgetContainer();
        const fallbackTarget = document.body || document.documentElement;
        if (fallbackTarget && !fallbackTarget.contains(container)) {
            fallbackTarget.appendChild(container);
        }
        return container;
    };

    const promptApiKey = () => {
        const key = prompt("Enter your Torn API Key (Public Access level required):");
        if (key) {
            GM_setValue('torn_api_key', key.trim());
            apiKey = key.trim();
            localStorage.removeItem('company_snapshot_cache_v9');
            location.reload();
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => refreshWidget(), { once: true });
    } else {
        refreshWidget();
    }

    window.addEventListener('pageshow', () => refreshWidget(true));
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            refreshWidget(true);
        }
    });
})();
