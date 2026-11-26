// ==UserScript==
// @name         Torn Mercenary Contract Tracker
// @namespace    https://github.com/beatriceghetel/torn-api-scripts
// @version      1.0.0
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
        .mct-table tbody tr:nth-child(even) { background: #292e2a; }
        .mct-table a { color: #e7c66a; }
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

    function getUser(value) {
        if (!value || typeof value !== 'object') return escapeHTML(value || 'Unknown');
        const name = value.name || 'Unknown';
        const id = value.id;
        if (!id) return escapeHTML(name);
        return `<a href="https://www.torn.com/profiles.php?XID=${encodeURIComponent(id)}" target="_blank" rel="noopener">${escapeHTML(name)} [${escapeHTML(id)}]</a>`;
    }

    function renderAttacks(payload) {
        const attacks = asList(payload.attacks || payload.attack || payload);
        if (!attacks.length) return '<p class="mct-empty">No attack records were returned.</p>';

        const rows = attacks.map(attack => {
            const attackId = attack.id || attack.code;
            const report = attackId
                ? `<a href="https://www.torn.com/loader.php?sid=attackLog&ID=${encodeURIComponent(attackId)}" target="_blank" rel="noopener">Open report</a>`
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
            </tr>`;
        }).join('');

        return `<div class="mct-table-wrap"><table class="mct-table">
            <thead><tr><th>Date</th><th>Attacker &rarr; Defender</th><th>Result</th><th>Respect</th><th>Attack report</th></tr></thead>
            <tbody>${rows}</tbody>
        </table></div>`;
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
        keyInput.value = GM_getValue('mct_api_key', '');

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
            status.className = 'mct-status';
            status.textContent = 'Loading latest records...';
            results.innerHTML = '';
            try {
                const payload = mode === 'attacks'
                    ? await apiGet('/v2/user/attacks?limit=100')
                    : await apiGet('/v2/user/log?cat=bounties&limit=100');
                results.innerHTML = mode === 'attacks' ? renderAttacks(payload) : renderBounties(payload);
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