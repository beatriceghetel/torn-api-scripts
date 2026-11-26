// ==UserScript==
// @name         Torn Mercenary Contract Tracker
// @namespace    https://github.com/beatriceghetel/torn-api-scripts
// @version      1.2.0
// @description  Lists recent attacks and bounty placement events from your Torn account.
// @author       beatrice
// @license      MIT
// @match        https://www.torn.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      api.torn.com
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    const widgetId = 'mercenary-contract-tracker';
    const style = document.createElement('style');
    style.textContent = `
        #${widgetId} { box-sizing: border-box; margin: 10px 0; padding: 12px; width: 100%; color: #f2f2f2; background: #202321; border: 1px solid #48524b; border-radius: 4px; font: 13px Arial, sans-serif; }
        #${widgetId} * { box-sizing: border-box; }
        .mct-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; margin-bottom: 10px; }
        .mct-title { color: #e7c66a; font-size: 15px; font-weight: 700; }
        .mct-controls { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
        .mct-control, .mct-button { min-height: 30px; padding: 6px 9px; color: #f2f2f2; background: #171a18; border: 1px solid #566057; border-radius: 3px; font-size: 12px; }
        .mct-date { width: 145px; color-scheme: dark; }
        .mct-button { cursor: pointer; background: #536c46; border-color: #718b63; font-weight: 700; }
        .mct-button:hover { background: #648253; }
        .mct-settings { display: none; margin-bottom: 10px; padding: 10px; background: #191c1a; border: 1px solid #3b433d; }
        .mct-settings-row { display: flex; flex-wrap: wrap; gap: 6px; }
        .mct-key { flex: 1 1 260px; }
        .mct-note, .mct-status { margin: 7px 0 0; color: #b7c0b9; font-size: 11px; }
        .mct-status.error { color: #ff8c7a; }
        .mct-table-wrap { width: 100%; overflow-x: auto; }
        .mct-table { width: 100%; min-width: 720px; border-collapse: collapse; }
        .mct-table th, .mct-table td { padding: 7px 8px; border: 1px solid #404741; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
        .mct-table th { color: #c6cec8; background: #303632; font-size: 11px; }
        .mct-table td, .mct-table td a.mct-player-link { color: #f2f2f2 !important; }
        .mct-table tbody tr:nth-child(even) { background: #292e2a; }
        .mct-table a { color: #e7c66a; }
        .mct-price-input { width: 100%; min-width: 90px; min-height: 32px; padding: 6px; color: #f2f2f2; background: #171a18; border: 1px solid #566057; border-radius: 3px; }
        .mct-empty { color: #b7c0b9; }
        @media (max-width: 600px) { #${widgetId} { padding: 9px; } .mct-controls { width: 100%; } }
    `;
    document.head.appendChild(style);

    function escapeHTML(value) {
        return String(value ?? '').replace(/[&<>"']/g, character => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[character]);
    }

    function apiGet(path) {
        const key = GM_getValue('mct_api_key', '').trim();
        const separator = path.includes('?') ? '&' : '?';
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: `https://api.torn.com${path}${separator}key=${encodeURIComponent(key)}`,
                onload: response => {
                    let payload;
                    try {
                        payload = JSON.parse(response.responseText || '{}');
                    } catch (error) {
                        reject('Torn returned an unreadable response.');
                        return;
                    }
                    if (payload.error) {
                        reject(`Torn API error ${payload.error.code}: ${payload.error.error}`);
                        return;
                    }
                    resolve(payload);
                },
                onerror: () => reject('Could not connect to the Torn API.')
            });
        });
    }

    function asList(value) {
        if (Array.isArray(value)) return value;
        if (value && typeof value === 'object') {
            return Object.entries(value).map(([id, entry]) => ({ id, ...entry }));
        }
        return [];
    }

    function formatDate(timestamp) {
        const date = new Date(Number(timestamp) * 1000);
        return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString();
    }

    function getDateRangeTimestamps(startDate, endDate) {
        const toLocalMidnight = (dateValue, dayOffset = 0) => {
            if (!dateValue) return null;
            const [year, month, day] = dateValue.split('-').map(Number);
            return new Date(year, month - 1, day + dayOffset).getTime();
        };
        const from = startDate ? Math.floor(toLocalMidnight(startDate) / 1000) : null;
        const to = endDate ? Math.floor(toLocalMidnight(endDate, 1) / 1000) - 1 : null;
        return { from, to };
    }

    function getAttackTimestamp(attack) {
        return Number(attack.started ?? attack.timestamp_started ?? attack.ended ?? attack.timestamp_ended ?? attack.timestamp);
    }

    function buildAttacksPath(from, to) {
        const params = new URLSearchParams({ limit: '100' });
        if (from !== null) params.set('from', String(from));
        if (to !== null) params.set('to', String(to));
        return `/v2/user/attacks?${params.toString()}`;
    }

    function getUser(value) {
        if (!value || typeof value !== 'object') return escapeHTML(value || 'Unknown');
        const name = value.name || 'Unknown';
        const id = value.id;
        if (!id) return escapeHTML(name);
        return `<a class="mct-player-link" href="https://www.torn.com/profiles.php?XID=${encodeURIComponent(id)}" target="_blank" rel="noopener">${escapeHTML(name)} [${escapeHTML(id)}]</a>`;
    }

    function getUserName(value) {
        return typeof value === 'object' && value ? value.name || 'Unknown' : value || 'Unknown';
    }

    function getAttackCode(attack) {
        return String(attack.code || attack.attack_code || '');
    }

    function getAttackReportUrl(attack) {
        const code = getAttackCode(attack);
        return code ? `https://www.torn.com/page.php?sid=attackLog&ID=${encodeURIComponent(code)}` : '';
    }

    function getFilteredAttacks(attacks, selectedFaction, dateRange = {}) {
        return attacks.filter(attack => {
            const timestamp = getAttackTimestamp(attack);
            if (!Number.isFinite(timestamp)) return false;
            const inDateRange = (dateRange.from === null || dateRange.from === undefined || timestamp >= dateRange.from) &&
                (dateRange.to === null || dateRange.to === undefined || timestamp <= dateRange.to);
            const inFaction = !selectedFaction || getTargetFaction(attack)?.id === selectedFaction;
            return inDateRange && inFaction;
        });
    }

    function getPriceTags() {
        return GM_getValue('mct_attack_price_tags', {});
    }

    function getTargetFaction(attack) {
        const defender = attack.defender || {};
        const faction = defender.faction || attack.defender_faction || attack.defenderFaction || {};
        const id = (typeof faction === 'object' ? faction.id ?? faction.faction_id : faction) ?? defender.faction_id ?? attack.defender_faction_id;
        const name = (typeof faction === 'object' ? faction.name : '') || defender.faction_name || attack.defender_faction_name;
        if (id === undefined && !name) return null;
        return { id: String(id ?? name), name: name || `Faction ${id}` };
    }

    function renderAttacks(attacks, selectedFaction = '', dateRange = {}) {
        if (!attacks.length) return '<p class="mct-empty">No attack records were returned.</p>';

        const filteredAttacks = getFilteredAttacks(attacks, selectedFaction, dateRange);
        if (!filteredAttacks.length) return '<p class="mct-empty">No attacks match this target faction.</p>';

        const priceTags = getPriceTags();
        const rows = filteredAttacks.map(attack => {
            const attackCode = getAttackCode(attack);
            const reportUrl = getAttackReportUrl(attack);
            const report = reportUrl
                ? `<a href="${escapeHTML(reportUrl)}" target="_blank" rel="noopener">Open report</a>`
                : 'Unavailable';
            const sides = `${getUser(attack.attacker)} &rarr; ${getUser(attack.defender)}`;
            const result = attack.result || attack.res || 'Unknown';
            const respect = attack.respect ?? attack.respect_gain ?? '';
            return `<tr>
                <td>${escapeHTML(formatDate(attack.timestamp || attack.started || attack.ended))}</td>
                <td>${sides}</td>
                <td>${escapeHTML(result)}</td>
                <td>${escapeHTML(respect)}</td>
                <td>${report}</td>
                <td><input class="mct-price-input" type="text" maxlength="40" data-attack-code="${escapeHTML(attackCode)}" value="${escapeHTML(priceTags[attackCode] || '')}" placeholder="e.g. 550k" aria-label="Price tag"></td>
            </tr>`;
        }).join('');

        return `<div class="mct-table-wrap"><table class="mct-table">
            <thead><tr><th>Date</th><th>Attacker &rarr; Defender</th><th>Result</th><th>Respect</th><th>Attack report</th><th>Price tag</th></tr></thead>
            <tbody>${rows}</tbody>
        </table></div>`;
    }

    function exportFilteredAttacks(attacks, selectedFaction, dateRange, results) {
        const filteredAttacks = getFilteredAttacks(attacks, selectedFaction, dateRange);
        const priceTags = getPriceTags();
        results.querySelectorAll('.mct-price-input').forEach(input => {
            priceTags[input.dataset.attackCode] = input.value.trim();
        });
        GM_setValue('mct_attack_price_tags', priceTags);

        const csvEscape = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
        const csvRows = [
            ['Number', 'Attacker', 'URL', 'Price tag'],
            ...filteredAttacks.map((attack, index) => {
                const code = getAttackCode(attack);
                return [index + 1, getUserName(attack.attacker), getAttackReportUrl(attack), priceTags[code] || ''];
            })
        ];
        const csv = csvRows.map(row => row.map(csvEscape).join(',')).join('\r\n');
        const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `mercenary-contracts-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    }

    function renderBounties(payload) {
        const events = asList(payload.log || payload.logs || payload.events || payload);
        if (!events.length) return '<p class="mct-empty">No bounty placement events were returned.</p>';

        const rows = events.map(event => {
            const details = event.details ?? event.data ?? event.params ?? '';
            const detailText = typeof details === 'string' ? details : JSON.stringify(details);
            return `<tr>
                <td>${escapeHTML(formatDate(event.timestamp))}</td>
                <td>${escapeHTML(event.title || event.event || event.category || 'Bounty event')}</td>
                <td>${escapeHTML(detailText || 'No event details supplied.')}</td>
                <td>${escapeHTML(event.id || event.log_id || '')}</td>
            </tr>`;
        }).join('');

        return `<div class="mct-table-wrap"><table class="mct-table">
            <thead><tr><th>Date</th><th>Event</th><th>Bounty event details</th><th>Log ID</th></tr></thead>
            <tbody>${rows}</tbody>
        </table></div>`;
    }

    function injectDashboard() {
        if (document.getElementById(widgetId)) return true;
        const target = document.querySelector('.content-wrapper') || document.querySelector('#mainContainer');
        if (!target) return false;

        const dashboard = document.createElement('section');
        dashboard.id = widgetId;
        dashboard.innerHTML = `
            <div class="mct-header">
                <strong class="mct-title">Mercenary Contract Activity</strong>
                <div class="mct-controls">
                    <select id="mct-mode" class="mct-control" aria-label="Activity type">
                        <option value="bounties">Last bounties placed</option>
                        <option value="attacks">Recent attacks</option>
                    </select>
                    <input id="mct-start-date" class="mct-control mct-date" type="date" aria-label="Start date" title="Start date" style="display:none;">
                    <input id="mct-end-date" class="mct-control mct-date" type="date" aria-label="End date" title="End date" style="display:none;">
                    <select id="mct-faction-filter" class="mct-control" aria-label="Filter by target faction" style="display:none;">
                        <option value="">All target factions</option>
                    </select>
                    <button id="mct-export" class="mct-control" type="button" style="display:none;">Export filtered</button>
                    <button id="mct-fetch" class="mct-button" type="button">Load activity</button>
                    <button id="mct-settings-toggle" class="mct-control" type="button">API key</button>
                </div>
            </div>
            <div id="mct-settings" class="mct-settings">
                <div class="mct-settings-row">
                    <input id="mct-api-key" class="mct-control mct-key" type="password" autocomplete="off" placeholder="Torn API key">
                    <button id="mct-save-key" class="mct-button" type="button">Save key</button>
                </div>
                <p class="mct-note">Used only in this browser for Torn API requests. The key needs access to user attacks and user logs.</p>
            </div>
            <div id="mct-results"><p class="mct-empty">Choose an activity type and load the latest records.</p></div>
            <p id="mct-status" class="mct-status" role="status" aria-live="polite"></p>
        `;
        target.insertBefore(dashboard, target.firstChild);

        const keyInput = dashboard.querySelector('#mct-api-key');
        const modeSelect = dashboard.querySelector('#mct-mode');
        const startDateInput = dashboard.querySelector('#mct-start-date');
        const endDateInput = dashboard.querySelector('#mct-end-date');
        const factionFilter = dashboard.querySelector('#mct-faction-filter');
        const exportButton = dashboard.querySelector('#mct-export');
        const results = dashboard.querySelector('#mct-results');
        let loadedAttacks = [];
        keyInput.value = GM_getValue('mct_api_key', '');
        startDateInput.value = GM_getValue('mct_attack_start_date', '');
        endDateInput.value = GM_getValue('mct_attack_end_date', '');

        modeSelect.addEventListener('change', () => {
            const showAttackControls = modeSelect.value === 'attacks' && loadedAttacks.length > 0;
            startDateInput.style.display = modeSelect.value === 'attacks' ? '' : 'none';
            endDateInput.style.display = modeSelect.value === 'attacks' ? '' : 'none';
            factionFilter.style.display = showAttackControls ? '' : 'none';
            exportButton.style.display = showAttackControls ? '' : 'none';
        });
        [startDateInput, endDateInput].forEach(input => input.addEventListener('change', () => {
            GM_setValue('mct_attack_start_date', startDateInput.value);
            GM_setValue('mct_attack_end_date', endDateInput.value);
        }));
        factionFilter.addEventListener('change', () => {
            const dateRange = getDateRangeTimestamps(startDateInput.value, endDateInput.value);
            results.innerHTML = renderAttacks(loadedAttacks, factionFilter.value, dateRange);
            dashboard.querySelector('#mct-status').textContent = `Showing ${dashboard.querySelectorAll('#mct-results tbody tr').length} record(s).`;
        });
        results.addEventListener('change', event => {
            const input = event.target.closest('.mct-price-input');
            if (!input) return;
            const priceTags = getPriceTags();
            priceTags[input.dataset.attackCode] = input.value.trim();
            GM_setValue('mct_attack_price_tags', priceTags);
        });
        exportButton.addEventListener('click', () => {
            const dateRange = getDateRangeTimestamps(startDateInput.value, endDateInput.value);
            exportFilteredAttacks(loadedAttacks, factionFilter.value, dateRange, results);
        });

        dashboard.querySelector('#mct-settings-toggle').addEventListener('click', () => {
            const panel = dashboard.querySelector('#mct-settings');
            panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
        });
        dashboard.querySelector('#mct-save-key').addEventListener('click', () => {
            GM_setValue('mct_api_key', keyInput.value.trim());
            dashboard.querySelector('#mct-status').textContent = 'API key saved locally.';
            dashboard.querySelector('#mct-settings').style.display = 'none';
        });
        dashboard.querySelector('#mct-fetch').addEventListener('click', async () => {
            const key = GM_getValue('mct_api_key', '').trim();
            const results = dashboard.querySelector('#mct-results');
            const status = dashboard.querySelector('#mct-status');
            if (!key) {
                dashboard.querySelector('#mct-settings').style.display = 'block';
                status.textContent = 'Add your Torn API key to load activity.';
                status.className = 'mct-status error';
                return;
            }

            const mode = dashboard.querySelector('#mct-mode').value;
            const dateRange = getDateRangeTimestamps(startDateInput.value, endDateInput.value);
            if (mode === 'attacks' && dateRange.from !== null && dateRange.to !== null && dateRange.from > dateRange.to) {
                status.textContent = 'Start date must be on or before the end date.';
                status.className = 'mct-status error';
                return;
            }
            GM_setValue('mct_attack_start_date', startDateInput.value);
            GM_setValue('mct_attack_end_date', endDateInput.value);
            status.className = 'mct-status';
            status.textContent = 'Loading latest records...';
            results.innerHTML = '';
            try {
                const payload = mode === 'attacks'
                    ? await apiGet(buildAttacksPath(dateRange.from, dateRange.to))
                    : await apiGet('/v2/user/log?cat=bounties&limit=100');
                if (mode === 'attacks') {
                    loadedAttacks = asList(payload.attacks || payload.attack || payload);
                    const factions = new Map();
                    loadedAttacks.forEach(attack => {
                        const faction = getTargetFaction(attack);
                        if (faction) factions.set(faction.id, faction.name);
                    });
                    factionFilter.innerHTML = '<option value="">All target factions</option>' +
                        [...factions.entries()].sort((a, b) => a[1].localeCompare(b[1]))
                            .map(([id, name]) => `<option value="${escapeHTML(id)}">${escapeHTML(name)}</option>`).join('');
                    factionFilter.style.display = '';
                    exportButton.style.display = '';
                    results.innerHTML = renderAttacks(loadedAttacks, factionFilter.value, dateRange);
                } else {
                    startDateInput.style.display = 'none';
                    endDateInput.style.display = 'none';
                    factionFilter.style.display = 'none';
                    factionFilter.innerHTML = '<option value="">All target factions</option>';
                    exportButton.style.display = 'none';
                    loadedAttacks = [];
                    results.innerHTML = renderBounties(payload);
                }
                status.textContent = `Loaded ${results.querySelectorAll('tbody tr').length} record(s).`;
            } catch (error) {
                status.textContent = String(error);
                status.className = 'mct-status error';
            }
        });
        return true;
    }

    if (!injectDashboard()) {
        const observer = new MutationObserver(() => {
            if (injectDashboard()) observer.disconnect();
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
    }
})();