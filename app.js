/* ==================== PHARMTRACKER APP.JS ==================== */

// ==================== CONSTANTS ====================
const COMPOUND_TYPES = ['Peptides', 'PEDs', 'Supplements', 'Ancillaries', 'Nootropics', 'Other'];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_NAMES_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TIME_BLOCKS = [
    { id: 'morning', label: 'Morning (5AM - 12PM)', icon: 'fa-sun', start: 5, end: 12 },
    { id: 'afternoon', label: 'Afternoon (12PM - 5PM)', icon: 'fa-cloud-sun', start: 12, end: 17 },
    { id: 'evening', label: 'Evening (5PM - 9PM)', icon: 'fa-moon', start: 17, end: 21 },
    { id: 'night', label: 'Night (9PM - 5AM)', icon: 'fa-star', start: 21, end: 5 }
];

// ==================== UTILITY FUNCTIONS ====================
function uuid() {
    return 'xxxx-xxxx-xxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
}

function formatDate(date) {
    return date.toISOString().split('T')[0];
}

function formatDateDisplay(date) {
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatDateFull(date) {
    return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function formatTime12(time24) {
    if (!time24) return '';
    const [h, m] = time24.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;
}

function getTimeHour(time24) {
    if (!time24) return 8;
    return parseInt(time24.split(':')[0], 10);
}

function getTimeMinutes(time24) {
    if (!time24) return 480; // default 8:00
    const [h, m] = time24.split(':').map(Number);
    return h * 60 + (m || 0);
}

function sortByTime(items) {
    return [...items].sort((a, b) => {
        const timeDiff = getTimeMinutes(a.timeOfDay) - getTimeMinutes(b.timeOfDay);
        if (timeDiff !== 0) return timeDiff;
        // Events come before compounds at the same time
        const aIsEvent = a._itemType === 'event' ? 0 : 1;
        const bIsEvent = b._itemType === 'event' ? 0 : 1;
        return aIsEvent - bIsEvent;
    });
}

// Group items by linking compounds to events at the same time
function groupItemsByEvent(sortedItems) {
    const groups = [];
    let currentGroup = null;

    sortedItems.forEach(item => {
        if (item._itemType === 'event') {
            // Start a new event group
            currentGroup = { event: item, linkedCompounds: [] };
            groups.push(currentGroup);
        } else {
            // Check if this compound's time matches the current event group
            if (currentGroup && getTimeMinutes(item.timeOfDay) === getTimeMinutes(currentGroup.event.timeOfDay)) {
                currentGroup.linkedCompounds.push(item);
            } else {
                // Standalone compound
                currentGroup = null;
                groups.push({ event: null, linkedCompounds: [item] });
            }
        }
    });

    return groups;
}

function getWeekStart(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(d.setDate(diff));
}

function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
}

function debounce(fn, ms) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
    };
}

function sanitize(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function isEODDay(startDate, checkDate) {
    const start = new Date(startDate);
    const check = new Date(checkDate);
    const diffDays = Math.round((check - start) / (1000 * 60 * 60 * 24));
    return diffDays >= 0 && diffDays % 2 === 0;
}

// ==================== DATA STORE ====================
const PharmStore = {
    // Users
    getUsers() {
        return JSON.parse(localStorage.getItem('pharmtracker_users') || '[]');
    },
    saveUsers(users) {
        try {
            localStorage.setItem('pharmtracker_users', JSON.stringify(users));
        } catch (e) {
            showToast('Storage full! Export your data as a backup.', 'error');
        }
    },
    addUser(name) {
        const users = this.getUsers();
        const user = { id: uuid(), name, createdAt: new Date().toISOString() };
        users.push(user);
        this.saveUsers(users);
        // Init user data
        this.saveUserData(user.id, { compounds: [], stack: [], events: [], dailyNotes: {}, settings: {} });
        return user;
    },
    deleteUser(userId) {
        let users = this.getUsers();
        users = users.filter(u => u.id !== userId);
        this.saveUsers(users);
        localStorage.removeItem(`pharmtracker_data_${userId}`);
    },
    renameUser(userId, newName) {
        const users = this.getUsers();
        const u = users.find(u => u.id === userId);
        if (u) { u.name = newName; this.saveUsers(users); }
    },

    // Active user
    getActiveUserId() {
        return localStorage.getItem('pharmtracker_activeUser');
    },
    setActiveUserId(id) {
        localStorage.setItem('pharmtracker_activeUser', id);
    },

    // User data
    getUserData(userId) {
        const id = userId || this.getActiveUserId();
        return JSON.parse(localStorage.getItem(`pharmtracker_data_${id}`) || '{"compounds":[],"stack":[],"dailyNotes":{},"settings":{}}');
    },
    saveUserData(userId, data) {
        const id = userId || this.getActiveUserId();
        try {
            localStorage.setItem(`pharmtracker_data_${id}`, JSON.stringify(data));
        } catch (e) {
            showToast('Storage full! Export your data as a backup.', 'error');
        }
    },

    // Compounds
    getCompounds() {
        return this.getUserData().compounds || [];
    },
    getCompound(compoundId) {
        return this.getCompounds().find(c => c.id === compoundId);
    },
    saveCompound(compound) {
        const data = this.getUserData();
        const idx = data.compounds.findIndex(c => c.id === compound.id);
        if (idx >= 0) {
            data.compounds[idx] = compound;
        } else {
            data.compounds.push(compound);
        }
        this.saveUserData(null, data);
    },
    deleteCompound(compoundId) {
        const data = this.getUserData();
        data.compounds = data.compounds.filter(c => c.id !== compoundId);
        data.stack = data.stack.filter(id => id !== compoundId);
        this.saveUserData(null, data);
    },

    // Stack
    getStack() {
        const data = this.getUserData();
        return (data.stack || []).map(id => data.compounds.find(c => c.id === id)).filter(Boolean);
    },
    getStackIds() {
        return this.getUserData().stack || [];
    },
    addToStack(compoundId) {
        const data = this.getUserData();
        if (!data.stack) data.stack = [];
        if (!data.stack.includes(compoundId)) {
            data.stack.push(compoundId);
            this.saveUserData(null, data);
        }
    },
    removeFromStack(compoundId) {
        const data = this.getUserData();
        data.stack = (data.stack || []).filter(id => id !== compoundId);
        this.saveUserData(null, data);
    },
    clearStack() {
        const data = this.getUserData();
        data.stack = [];
        this.saveUserData(null, data);
    },

    // Dose Logging
    logDose(compoundId, note, sideEffects) {
        const data = this.getUserData();
        const compound = data.compounds.find(c => c.id === compoundId);
        if (!compound) return;
        if (!compound.logs) compound.logs = [];
        compound.logs.push({
            date: formatDate(new Date()),
            time: new Date().toTimeString().slice(0, 5),
            done: true,
            note: note || '',
            sideEffects: sideEffects || ''
        });
        // Increment vial usage for peptides and PEDs
        if (compound.type === 'Peptides' || compound.type === 'PEDs') {
            compound.vialPinsUsed = (compound.vialPinsUsed || 0) + 1;
        }
        this.saveUserData(null, data);
    },
    resetVial(compoundId) {
        const data = this.getUserData();
        const compound = data.compounds.find(c => c.id === compoundId);
        if (compound) {
            compound.vialPinsUsed = 0;
            this.saveUserData(null, data);
        }
    },
    isDoseLoggedToday(compoundId) {
        const compound = this.getCompound(compoundId);
        if (!compound || !compound.logs) return false;
        const today = formatDate(new Date());
        return compound.logs.some(l => l.date === today);
    },
    getRecentLogs(limit = 5) {
        const compounds = this.getCompounds();
        const allLogs = [];
        compounds.forEach(c => {
            (c.logs || []).forEach(l => {
                allLogs.push({ ...l, compoundName: c.name, compoundType: c.type });
            });
        });
        allLogs.sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
        return allLogs.slice(0, limit);
    },

    // Events
    getEvents() {
        return this.getUserData().events || [];
    },
    getEvent(eventId) {
        return this.getEvents().find(e => e.id === eventId);
    },
    saveEvent(event) {
        const data = this.getUserData();
        if (!data.events) data.events = [];
        const idx = data.events.findIndex(e => e.id === event.id);
        if (idx >= 0) {
            data.events[idx] = event;
        } else {
            data.events.push(event);
        }
        this.saveUserData(null, data);
    },
    deleteEvent(eventId) {
        const data = this.getUserData();
        data.events = (data.events || []).filter(e => e.id !== eventId);
        this.saveUserData(null, data);
    },

    // Daily Notes
    getDailyNotes(dateStr) {
        const data = this.getUserData();
        return (data.dailyNotes || {})[dateStr] || { events: '', notes: '' };
    },
    saveDailyNotes(dateStr, events, notes) {
        const data = this.getUserData();
        if (!data.dailyNotes) data.dailyNotes = {};
        data.dailyNotes[dateStr] = { events, notes };
        this.saveUserData(null, data);
    },

    // Export/Import
    exportAll() {
        const exportData = {};
        exportData.users = this.getUsers();
        exportData.activeUser = this.getActiveUserId();
        exportData.userData = {};
        exportData.users.forEach(u => {
            exportData.userData[u.id] = this.getUserData(u.id);
        });
        return JSON.stringify(exportData, null, 2);
    },
    importAll(jsonStr) {
        const data = JSON.parse(jsonStr);
        if (!data.users || !data.userData) throw new Error('Invalid data format');
        this.saveUsers(data.users);
        if (data.activeUser) this.setActiveUserId(data.activeUser);
        Object.keys(data.userData).forEach(userId => {
            this.saveUserData(userId, data.userData[userId]);
        });
    }
};

// ==================== PEPTIDE CALCULATOR ====================
function calcConcentration(mgPerVial, mlBac) {
    if (!mgPerVial || !mlBac) return 0;
    return (mgPerVial * 1000) / mlBac; // mcg/mL
}

function calcVolumeToDraw(desiredMcg, concentrationMcg) {
    if (!desiredMcg || !concentrationMcg) return 0;
    return desiredMcg / concentrationMcg; // mL
}

function calcSyringeUnits(volumeMl) {
    return volumeMl * 100; // units (100u = 1mL insulin syringe)
}

function calcPinsPerVial(mlBac, volumePerPin) {
    if (!volumePerPin) return 0;
    return Math.floor(mlBac / volumePerPin);
}

function calcWeeksPerVial(pinsPerVial, injectionsPerWeek) {
    if (!injectionsPerWeek) return 0;
    return (pinsPerVial / injectionsPerWeek).toFixed(1);
}

function getCompoundScheduleDays(compound) {
    if (!compound) return [];
    if (compound.type === 'Peptides' || compound.type === 'PEDs') {
        if (compound.scheduleType === 'everyday') return [0, 1, 2, 3, 4, 5, 6];
        if (compound.scheduleType === 'eod') return null; // special handling
        if (compound.scheduleType === 'specific') return compound.scheduleDays || [];
    } else {
        const freq = compound.frequency || 'daily';
        if (freq === 'daily' || freq === 'twice_daily') return [0, 1, 2, 3, 4, 5, 6];
        if (freq === 'eod') return null;
        if (freq === 'weekly') return compound.scheduleDays && compound.scheduleDays.length ? compound.scheduleDays : [1]; // default Monday
        if (freq === 'specific') return compound.scheduleDays || [];
    }
    return [0, 1, 2, 3, 4, 5, 6];
}

function isCompoundScheduledOnDate(compound, date) {
    const dayOfWeek = date.getDay();
    const days = getCompoundScheduleDays(compound);
    if (days === null) {
        // EOD - check based on compound creation date
        const startDate = compound.eodStartDate || compound.createdAt || formatDate(new Date());
        return isEODDay(startDate, formatDate(date));
    }
    return days.includes(dayOfWeek);
}

function getPeptideDisplayInfo(compound) {
    if (compound.type !== 'Peptides') return null;
    const concentration = calcConcentration(compound.mgPerVial, compound.mlBacWater);
    const volume = calcVolumeToDraw(compound.desiredDoseMcg, concentration);
    const units = calcSyringeUnits(volume);
    const pinsPerVial = calcPinsPerVial(compound.mlBacWater, volume);
    return {
        concentration: concentration.toFixed(0),
        volumeMl: volume.toFixed(3),
        units: units.toFixed(1),
        pinsPerVial,
        pinsRemaining: Math.max(0, pinsPerVial - (compound.vialPinsUsed || 0)),
        doseMcg: compound.desiredDoseMcg
    };
}

function getPEDDisplayInfo(compound) {
    if (compound.type !== 'PEDs' || !compound.pedConcentration || !compound.pedDoseMg) return null;
    const volumeMl = compound.pedDoseMg / compound.pedConcentration; // mL to draw
    const units = volumeMl * 100; // insulin syringe units
    const pinsPerVial = compound.pedVialMl ? Math.floor(compound.pedVialMl / volumeMl) : 0;
    return {
        concentration: compound.pedConcentration,
        doseMg: compound.pedDoseMg,
        volumeMl: volumeMl.toFixed(3),
        units: units.toFixed(1),
        pinsPerVial,
        pinsRemaining: Math.max(0, pinsPerVial - (compound.vialPinsUsed || 0)),
        vialMl: compound.pedVialMl || 0
    };
}

function formatEventTime(event) {
    const start = formatTime12(event.timeOfDay);
    if (event.endTime) {
        return `${start} – ${formatTime12(event.endTime)}`;
    }
    return start;
}

function isEventScheduledOnDate(event, date) {
    const dayOfWeek = date.getDay();
    if (event.scheduleType === 'everyday') return true;
    if (event.scheduleType === 'eod') {
        return isEODDay(event.eodStartDate || event.createdAt, formatDate(date));
    }
    if (event.scheduleType === 'specific') {
        return (event.scheduleDays || []).includes(dayOfWeek);
    }
    return true;
}

// ==================== APP STATE ====================
let currentView = 'dashboard';
let currentWeekOffset = 0;
let currentDailyDate = new Date();
let editingCompoundId = null;
let editingEventId = null;
let confirmCallback = null;

// ==================== TOAST NOTIFICATIONS ====================
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icons = { success: 'fa-check-circle', error: 'fa-exclamation-circle', info: 'fa-info-circle' };
    toast.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i> ${sanitize(message)}`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ==================== MODAL MANAGEMENT ====================
function showModal(modalId) {
    document.getElementById('modal-overlay').classList.add('active');
    document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
    document.getElementById(modalId).classList.add('active');
}

function hideModal() {
    document.getElementById('modal-overlay').classList.remove('active');
    document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
}

// ==================== NAVIGATION ====================
function navigateTo(viewName) {
    currentView = viewName;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const target = document.querySelector(`.view[data-view="${viewName}"]`);
    if (target) target.classList.add('active');

    // Update nav
    document.querySelectorAll('.nav-item').forEach(n => {
        n.classList.toggle('active', n.dataset.view === viewName);
    });

    // Update breadcrumb
    const activeNav = document.querySelector(`.nav-item[data-view="${viewName}"]`);
    if (activeNav) {
        const icon = activeNav.querySelector('i').className;
        const label = activeNav.querySelector('span').textContent;
        document.getElementById('breadcrumb').innerHTML = `<i class="${icon}"></i> <span>${label}</span>`;
    }

    // Render view
    renderCurrentView();

    // Close mobile sidebar
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('active');
}

function renderCurrentView() {
    switch (currentView) {
        case 'dashboard': renderDashboard(); break;
        case 'library': renderLibrary(); break;
        case 'stack': renderStack(); break;
        case 'calculator': updateCalcResults(); break;
        case 'weekly': renderWeekly(); break;
        case 'daily': renderDaily(); break;
        case 'settings': renderSettings(); break;
    }
}

// ==================== USER MANAGEMENT ====================
function renderUserSelector() {
    const select = document.getElementById('user-select');
    const users = PharmStore.getUsers();
    const activeId = PharmStore.getActiveUserId();

    select.innerHTML = '';
    if (users.length === 0) {
        select.innerHTML = '<option value="">No users</option>';
        return;
    }
    users.forEach(u => {
        const opt = document.createElement('option');
        opt.value = u.id;
        opt.textContent = u.name;
        if (u.id === activeId) opt.selected = true;
        select.appendChild(opt);
    });
}

function handleAddUser() {
    const nameInput = document.getElementById('new-user-name');
    const name = nameInput.value.trim();
    if (!name) { showToast('Please enter a name', 'error'); return; }
    const user = PharmStore.addUser(name);
    PharmStore.setActiveUserId(user.id);
    renderUserSelector();
    hideModal();
    nameInput.value = '';
    renderCurrentView();
    showToast(`Welcome, ${name}!`);
}

function handleSwitchUser() {
    const select = document.getElementById('user-select');
    if (select.value) {
        PharmStore.setActiveUserId(select.value);
        renderCurrentView();
    }
}

// ==================== RENDER: DASHBOARD ====================
function renderDashboard() {
    if (!PharmStore.getActiveUserId()) return;

    const compounds = PharmStore.getCompounds();
    const stack = PharmStore.getStack();
    const today = new Date();

    // Stat cards
    const todayPins = stack.filter(c => isCompoundScheduledOnDate(c, today)).length;
    const lowVials = stack.filter(c => {
        if (c.type !== 'Peptides') return false;
        const info = getPeptideDisplayInfo(c);
        return info && info.pinsRemaining <= 3;
    }).length;

    document.getElementById('dashboard-stats').innerHTML = `
        <div class="stat-card">
            <div class="stat-icon blue"><i class="fas fa-flask"></i></div>
            <div class="stat-info">
                <div class="stat-value">${compounds.length}</div>
                <div class="stat-label">Total Compounds</div>
            </div>
        </div>
        <div class="stat-card">
            <div class="stat-icon green"><i class="fas fa-layer-group"></i></div>
            <div class="stat-info">
                <div class="stat-value">${stack.length}</div>
                <div class="stat-label">Active Stack</div>
            </div>
        </div>
        <div class="stat-card">
            <div class="stat-icon orange"><i class="fas fa-syringe"></i></div>
            <div class="stat-info">
                <div class="stat-value">${todayPins}</div>
                <div class="stat-label">Today's Doses</div>
            </div>
        </div>
        <div class="stat-card">
            <div class="stat-icon red"><i class="fas fa-exclamation-triangle"></i></div>
            <div class="stat-info">
                <div class="stat-value">${lowVials}</div>
                <div class="stat-label">Low Vials</div>
            </div>
        </div>
    `;

    // Today's date
    document.getElementById('today-date').textContent = formatDateFull(today);

    // Today's schedule (compounds + events merged & sorted)
    const todayCompounds = stack.filter(c => isCompoundScheduledOnDate(c, today)).map(c => ({ ...c, _itemType: 'compound' }));
    const todayEvents = (PharmStore.getEvents()).filter(e => isEventScheduledOnDate(e, today)).map(e => ({ ...e, _itemType: 'event' }));
    const todayItems = sortByTime([...todayCompounds, ...todayEvents]);
    let todayHtml = '';
    if (todayItems.length === 0) {
        todayHtml = '<div class="empty-state"><i class="fas fa-check-circle"></i><h4>Rest Day</h4><p>Nothing scheduled for today</p></div>';
    } else {
        const groups = groupItemsByEvent(todayItems);
        groups.forEach(group => {
            if (group.event) {
                const ev = group.event;
                const hasLinked = group.linkedCompounds.length > 0;
                todayHtml += `<div class="dash-event-group${hasLinked ? ' has-linked' : ''}" style="--event-color: ${ev.color || 'var(--accent)'}">`;
                todayHtml += `
                    <div class="schedule-item event-item" onclick="openEditEvent('${ev.id}')" style="cursor:pointer;">
                        <div class="schedule-item-left">
                            <span class="event-emoji">${ev.emoji || '📅'}</span>
                            <div>
                                <div class="schedule-item-name">${sanitize(ev.name)}</div>
                                ${ev.notes ? `<div class="schedule-item-detail">${sanitize(ev.notes)}</div>` : ''}
                            </div>
                        </div>
                        <span class="schedule-item-time">${formatEventTime(ev)}</span>
                    </div>
                `;
                group.linkedCompounds.forEach(c => {
                    const done = PharmStore.isDoseLoggedToday(c.id);
                    const info = getPeptideDisplayInfo(c);
                    const pedInfo = getPEDDisplayInfo(c);
                    let detail = c.type === 'Peptides' && info
                        ? `${info.doseMcg}mcg — ${info.units}u`
                        : c.type === 'PEDs' && pedInfo
                        ? `${pedInfo.doseMg}mg — ${pedInfo.units}u`
                        : (c.dosage || c.type);
                    todayHtml += `
                        <div class="schedule-item linked ${done ? 'done' : ''}" data-compound-id="${c.id}">
                            <div class="schedule-item-left">
                                <input type="checkbox" ${done ? 'checked disabled' : ''} class="dose-check" data-id="${c.id}">
                                <div>
                                    <div class="schedule-item-name">${sanitize(c.name)}</div>
                                    <div class="schedule-item-detail">${sanitize(detail)}</div>
                                </div>
                            </div>
                        </div>
                    `;
                });
                todayHtml += `</div>`;
            } else {
                group.linkedCompounds.forEach(c => {
                    const done = PharmStore.isDoseLoggedToday(c.id);
                    const info = getPeptideDisplayInfo(c);
                    const pedInfo = getPEDDisplayInfo(c);
                    let detail = c.type === 'Peptides' && info
                        ? `${info.doseMcg}mcg — ${info.units}u`
                        : c.type === 'PEDs' && pedInfo
                        ? `${pedInfo.doseMg}mg — ${pedInfo.units}u`
                        : (c.dosage || c.type);
                    todayHtml += `
                        <div class="schedule-item ${done ? 'done' : ''}" data-compound-id="${c.id}">
                            <div class="schedule-item-left">
                                <input type="checkbox" ${done ? 'checked disabled' : ''} class="dose-check" data-id="${c.id}">
                                <div>
                                    <div class="schedule-item-name">${sanitize(c.name)}</div>
                                    <div class="schedule-item-detail">${sanitize(detail)}</div>
                                </div>
                            </div>
                            <span class="schedule-item-time">${formatTime12(c.timeOfDay)}</span>
                        </div>
                    `;
                });
            }
        });
    }
    document.getElementById('today-schedule').innerHTML = todayHtml;

    // Upcoming 3 days
    let upcomingHtml = '';
    for (let i = 1; i <= 3; i++) {
        const d = addDays(today, i);
        const dayCompounds = stack.filter(c => isCompoundScheduledOnDate(c, d));
        upcomingHtml += `<div class="upcoming-day">
            <div class="upcoming-day-label">${formatDateDisplay(d)}</div>
            ${dayCompounds.length === 0
                ? '<div class="upcoming-compound">Rest day</div>'
                : dayCompounds.map(c => `<div class="upcoming-compound"><span class="type-badge ${c.type}">${c.type}</span> ${sanitize(c.name)}</div>`).join('')
            }
        </div>`;
    }
    document.getElementById('upcoming-schedule').innerHTML = upcomingHtml;

    // Recent logs
    const logs = PharmStore.getRecentLogs(5);
    document.getElementById('recent-logs').innerHTML = logs.length === 0
        ? '<div class="empty-state"><i class="fas fa-clipboard"></i><h4>No Logs Yet</h4><p>Log your first dose to see history here</p></div>'
        : logs.map(l => `
            <div class="log-entry">
                <span class="log-entry-date">${l.date.slice(5)}</span>
                <span class="log-entry-name">${sanitize(l.compoundName)}</span>
                <span class="log-entry-note">${sanitize(l.note || '—')}</span>
            </div>
        `).join('');

    // Vial status
    const peptides = stack.filter(c => c.type === 'Peptides');
    document.getElementById('vial-status').innerHTML = peptides.length === 0
        ? '<div class="empty-state"><i class="fas fa-vial"></i><h4>No Peptides</h4><p>Add peptides to track vial usage</p></div>'
        : peptides.map(c => {
            const info = getPeptideDisplayInfo(c);
            if (!info) return '';
            const pct = info.pinsPerVial > 0 ? ((info.pinsRemaining / info.pinsPerVial) * 100) : 0;
            const level = pct > 50 ? 'high' : pct > 20 ? 'medium' : 'low';
            return `
                <div class="vial-status-item">
                    <span class="vial-status-name">${sanitize(c.name)}</span>
                    <span class="vial-status-count">${info.pinsRemaining}/${info.pinsPerVial} pins</span>
                </div>
                <div class="vial-progress"><div class="vial-progress-bar ${level}" style="width:${pct}%"></div></div>
            `;
        }).join('');
}

// ==================== RENDER: COMPOUND LIBRARY ====================
function renderLibrary() {
    if (!PharmStore.getActiveUserId()) return;

    const filterType = document.getElementById('library-filter-type').value;
    const search = document.getElementById('library-search').value.toLowerCase();
    let compounds = PharmStore.getCompounds();

    if (filterType !== 'all') compounds = compounds.filter(c => c.type === filterType);
    if (search) compounds = compounds.filter(c => c.name.toLowerCase().includes(search));

    const stackIds = PharmStore.getStackIds();
    const grid = document.getElementById('compounds-grid');

    if (compounds.length === 0) {
        grid.innerHTML = '<div class="empty-state"><i class="fas fa-flask"></i><h4>No Compounds Found</h4><p>Add your first compound to get started</p></div>';
        return;
    }

    grid.innerHTML = compounds.map(c => {
        const inStack = stackIds.includes(c.id);
        const info = getPeptideDisplayInfo(c);
        const pedInfo = getPEDDisplayInfo(c);
        let metaHtml = '';

        if (c.type === 'Peptides' && info) {
            metaHtml = `
                <span><i class="fas fa-syringe"></i> ${info.doseMcg}mcg — ${info.units}u per pin</span>
                <span><i class="fas fa-vial"></i> ${info.pinsRemaining}/${info.pinsPerVial} pins left</span>
            `;
        } else if (c.type === 'PEDs' && pedInfo) {
            metaHtml = `
                <span><i class="fas fa-syringe"></i> ${pedInfo.doseMg}mg — ${pedInfo.units}u per pin</span>
                <span><i class="fas fa-vial"></i> ${pedInfo.pinsRemaining}/${pedInfo.pinsPerVial} pins left</span>
            `;
        } else {
            if (c.dosage) metaHtml += `<span><i class="fas fa-pills"></i> ${sanitize(c.dosage)}</span>`;
            if (c.frequency) metaHtml += `<span><i class="fas fa-clock"></i> ${sanitize(c.frequency)}</span>`;
        }
        if (c.halfLife) metaHtml += `<span><i class="fas fa-hourglass-half"></i> t½: ${sanitize(c.halfLife)}</span>`;
        if (c.cost) metaHtml += `<span><i class="fas fa-dollar-sign"></i> $${c.cost}</span>`;

        const vialInfo = info || pedInfo;
        const vialHtml = vialInfo ? `
            <div class="vial-progress"><div class="vial-progress-bar ${vialInfo.pinsRemaining > vialInfo.pinsPerVial * 0.5 ? 'high' : vialInfo.pinsRemaining > vialInfo.pinsPerVial * 0.2 ? 'medium' : 'low'}" style="width:${vialInfo.pinsPerVial > 0 ? (vialInfo.pinsRemaining / vialInfo.pinsPerVial * 100) : 0}%"></div></div>
            <div class="vial-label"><span>Vial remaining</span><span>${vialInfo.pinsRemaining} pins</span><button class="btn-reset-vial" onclick="event.stopPropagation(); resetVial('${c.id}')" title="New vial"><i class="fas fa-sync-alt"></i></button></div>
        ` : '';

        return `
            <div class="compound-card">
                <div class="compound-card-top">
                    <div class="compound-card-name">${sanitize(c.name)}</div>
                    <span class="type-badge ${c.type}">${c.type}</span>
                </div>
                <div class="compound-card-meta">${metaHtml}</div>
                ${vialHtml}
                <div class="compound-card-actions">
                    <button class="btn-outline btn-sm" onclick="openEditCompound('${c.id}')"><i class="fas fa-edit"></i> Edit</button>
                    <button class="btn-outline btn-sm btn-danger" onclick="confirmDeleteCompound('${c.id}')"><i class="fas fa-trash"></i></button>
                    <button class="btn-primary btn-sm" onclick="${inStack ? `removeFromStack('${c.id}')` : `addToStack('${c.id}')`}">
                        <i class="fas ${inStack ? 'fa-minus' : 'fa-plus'}"></i> ${inStack ? 'Remove' : 'Stack'}
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

// ==================== RENDER: MY STACK ====================
function renderStack() {
    if (!PharmStore.getActiveUserId()) return;

    const stack = PharmStore.getStack();
    const container = document.getElementById('stack-list');

    if (stack.length === 0) {
        container.innerHTML = '<div class="empty-state"><i class="fas fa-layer-group"></i><h4>Stack is Empty</h4><p>Add compounds from the library to build your stack</p></div>';
        return;
    }

    container.innerHTML = stack.map(c => {
        const info = getPeptideDisplayInfo(c);
        const pedInfo = getPEDDisplayInfo(c);
        let detail = '';
        if (c.type === 'Peptides' && info) {
            detail = `${info.doseMcg}mcg — ${info.units}u — ${info.pinsRemaining} pins left`;
        } else if (c.type === 'PEDs' && pedInfo) {
            detail = `${pedInfo.doseMg}mg — ${pedInfo.units}u — ${pedInfo.pinsRemaining} pins left`;
        } else {
            detail = [c.dosage, c.frequency].filter(Boolean).join(' · ') || c.type;
        }

        const schedDays = getCompoundScheduleDays(c);
        let schedLabel = '';
        if (c.scheduleType === 'eod' || c.frequency === 'eod') {
            schedLabel = 'Every other day';
        } else if (schedDays && schedDays.length === 7) {
            schedLabel = 'Everyday';
        } else if (schedDays) {
            schedLabel = schedDays.map(d => DAY_NAMES[d]).join(', ');
        }

        return `
            <div class="stack-item">
                <div class="stack-item-left">
                    <span class="type-badge ${c.type}">${c.type}</span>
                    <div class="stack-item-info">
                        <h4>${sanitize(c.name)}</h4>
                        <p>${sanitize(detail)} ${schedLabel ? '· ' + schedLabel : ''}</p>
                    </div>
                </div>
                <div class="stack-item-right">
                    ${c.timeOfDay ? `<span class="schedule-item-time">${formatTime12(c.timeOfDay)}</span>` : ''}
                    <button class="btn-icon" onclick="openLogModal('${c.id}')" title="Log dose"><i class="fas fa-check-circle"></i></button>
                    <button class="btn-icon" onclick="removeFromStack('${c.id}')" title="Remove from stack"><i class="fas fa-times"></i></button>
                </div>
            </div>
        `;
    }).join('');
}

// ==================== RENDER: PEPTIDE CALCULATOR ====================
function updateCalcResults() {
    const mg = parseFloat(document.getElementById('calc-mg').value) || 0;
    const bac = parseFloat(document.getElementById('calc-bac').value) || 0;
    const dose = parseFloat(document.getElementById('calc-dose').value) || 0;
    const freq = parseInt(document.getElementById('calc-freq').value) || 0;

    const concentration = calcConcentration(mg, bac);
    const volume = calcVolumeToDraw(dose, concentration);
    const units = calcSyringeUnits(volume);
    const pins = calcPinsPerVial(bac, volume);
    const weeks = calcWeeksPerVial(pins, freq);

    document.getElementById('res-concentration').textContent = concentration ? `${concentration.toFixed(0)} mcg/mL` : '—';
    document.getElementById('res-volume').textContent = volume ? `${volume.toFixed(3)} mL` : '—';
    document.getElementById('res-units').textContent = units ? `${units.toFixed(1)} units` : '—';
    document.getElementById('res-weekly').textContent = units && freq ? `${(units * freq).toFixed(1)} units/week` : '—';
    document.getElementById('res-pins').textContent = pins ? `${pins} pins/vial` : '—';
    document.getElementById('res-weeks').textContent = weeks && weeks !== '0.0' ? `${weeks} weeks` : '—';

    // Schedule preview
    const schedType = document.querySelector('input[name="calc-schedule"]:checked')?.value || 'everyday';
    let days = [];
    if (schedType === 'everyday') days = [0, 1, 2, 3, 4, 5, 6];
    else if (schedType === 'eod') days = [1, 3, 5]; // preview only
    else {
        document.querySelectorAll('#specific-days-group .day-toggle.active').forEach(b => {
            days.push(parseInt(b.dataset.day));
        });
    }

    const preview = document.getElementById('res-schedule-preview');
    if (dose && freq) {
        preview.innerHTML = `
            <h4>Schedule Preview</h4>
            <div class="result-schedule-days">
                ${[1, 2, 3, 4, 5, 6, 0].map(d => {
                    const active = days.includes(d);
                    return `<span class="schedule-day-pill ${active ? 'active-day' : 'rest-day'}">${DAY_NAMES[d]}${active ? ` — ${dose}mcg (${units.toFixed(1)}u)` : ''}</span>`;
                }).join('')}
            </div>
        `;
    } else {
        preview.innerHTML = '';
    }
}

function saveFromCalculator() {
    const name = document.getElementById('calc-compound-name').value.trim();
    if (!name) { showToast('Please enter a compound name', 'error'); return; }

    const mg = parseFloat(document.getElementById('calc-mg').value);
    const bac = parseFloat(document.getElementById('calc-bac').value);
    const dose = parseFloat(document.getElementById('calc-dose').value);
    const freq = parseInt(document.getElementById('calc-freq').value);
    const schedType = document.querySelector('input[name="calc-schedule"]:checked')?.value || 'everyday';
    const time = document.getElementById('calc-time').value;

    if (!mg || !bac || !dose || !freq) {
        showToast('Please fill in all calculator fields', 'error');
        return;
    }

    let scheduleDays = [];
    if (schedType === 'specific') {
        document.querySelectorAll('#specific-days-group .day-toggle.active').forEach(b => {
            scheduleDays.push(parseInt(b.dataset.day));
        });
        if (scheduleDays.length === 0) { showToast('Please select at least one day', 'error'); return; }
    }

    const compound = {
        id: uuid(),
        name,
        type: 'Peptides',
        mgPerVial: mg,
        mlBacWater: bac,
        desiredDoseMcg: dose,
        injectionsPerWeek: freq,
        scheduleType: schedType,
        scheduleDays: scheduleDays,
        timeOfDay: time,
        eodStartDate: formatDate(new Date()),
        vialPinsUsed: 0,
        logs: [],
        createdAt: new Date().toISOString(),
        notes: ''
    };

    PharmStore.saveCompound(compound);
    PharmStore.addToStack(compound.id);
    showToast(`${name} saved and added to stack!`);
}

// ==================== RENDER: WEEKLY SCHEDULE ====================
function renderWeekly() {
    if (!PharmStore.getActiveUserId()) return;

    const today = new Date();
    const weekStart = getWeekStart(addDays(today, currentWeekOffset * 7));

    // Update label
    const weekEnd = addDays(weekStart, 6);
    document.getElementById('week-label').textContent = `${formatDateDisplay(weekStart)} — ${formatDateDisplay(weekEnd)}`;

    const stack = PharmStore.getStack();
    const events = PharmStore.getEvents();
    const grid = document.getElementById('weekly-grid');

    let html = '';
    for (let i = 0; i < 7; i++) {
        const d = addDays(weekStart, i);
        const isToday = formatDate(d) === formatDate(today);
        const dayCompounds = stack.filter(c => isCompoundScheduledOnDate(c, d)).map(c => ({ ...c, _itemType: 'compound' }));
        const dayEvents = events.filter(e => isEventScheduledOnDate(e, d)).map(e => ({ ...e, _itemType: 'event' }));
        const allItems = sortByTime([...dayCompounds, ...dayEvents]);

        const groups = groupItemsByEvent(allItems);
        let bodyHtml = '';
        if (allItems.length === 0) {
            bodyHtml = '<div class="empty-state" style="padding:20px 8px;"><p style="font-size:0.75rem;">Rest Day</p></div>';
        } else {
            let lastPeriod = '';
            groups.forEach(group => {
                // Period label based on first item in group
                const refItem = group.event || group.linkedCompounds[0];
                const hour = getTimeHour(refItem.timeOfDay);
                let period = '';
                if (hour >= 5 && hour < 12) period = 'Morning';
                else if (hour >= 12 && hour < 17) period = 'Afternoon';
                else if (hour >= 17 && hour < 21) period = 'Evening';
                else period = 'Night';

                if (period !== lastPeriod) {
                    bodyHtml += `<div class="wci-period-label">${period}</div>`;
                    lastPeriod = period;
                }

                if (group.event) {
                    const ev = group.event;
                    const hasLinked = group.linkedCompounds.length > 0;
                    bodyHtml += `<div class="week-event-group${hasLinked ? ' has-linked' : ''}" style="--event-color: ${ev.color || 'var(--accent)'}">`;
                    bodyHtml += `
                        <div class="week-event-item" style="border-left-color: ${ev.color || 'var(--accent)'}; background: ${ev.color || 'var(--accent)'}15;" onclick="openEditEvent('${ev.id}')">
                            <div class="wci-top">
                                <span class="wci-name">${ev.emoji || '📅'} ${sanitize(ev.name)}</span>
                                <span class="wci-time">${formatEventTime(ev)}</span>
                            </div>
                            ${ev.notes ? `<span class="wci-detail">${sanitize(ev.notes)}</span>` : ''}
                        </div>
                    `;
                    group.linkedCompounds.forEach(c => {
                        const info = getPeptideDisplayInfo(c);
                        const pedInfo = getPEDDisplayInfo(c);
                        let detail = '';
                        if (c.type === 'Peptides' && info) detail = `${info.doseMcg}mcg · ${info.units}u`;
                        else if (c.type === 'PEDs' && pedInfo) detail = `${pedInfo.doseMg}mg · ${pedInfo.units}u`;
                        else detail = c.dosage || '';
                        bodyHtml += `
                            <div class="week-compound-item linked ${c.type}">
                                <div class="wci-top">
                                    <span class="wci-name">${sanitize(c.name)}</span>
                                </div>
                                <span class="wci-detail">${sanitize(detail)}</span>
                            </div>
                        `;
                    });
                    bodyHtml += `</div>`;
                } else {
                    group.linkedCompounds.forEach(c => {
                        const info = getPeptideDisplayInfo(c);
                        const pedInfo = getPEDDisplayInfo(c);
                        let detail = '';
                        if (c.type === 'Peptides' && info) detail = `${info.doseMcg}mcg · ${info.units}u`;
                        else if (c.type === 'PEDs' && pedInfo) detail = `${pedInfo.doseMg}mg · ${pedInfo.units}u`;
                        else detail = c.dosage || '';
                        bodyHtml += `
                            <div class="week-compound-item ${c.type}">
                                <div class="wci-top">
                                    <span class="wci-name">${sanitize(c.name)}</span>
                                    <span class="wci-time">${formatTime12(c.timeOfDay)}</span>
                                </div>
                                <span class="wci-detail">${sanitize(detail)}</span>
                            </div>
                        `;
                    });
                }
            });
        }

        html += `
            <div class="week-day-col ${isToday ? 'today' : ''}">
                <div class="week-day-header">
                    ${DAY_NAMES_FULL[d.getDay()]}
                    <span class="day-date">${d.getMonth() + 1}/${d.getDate()}</span>
                    ${allItems.length > 0 ? `<span class="day-count">${allItems.length} item${allItems.length > 1 ? 's' : ''}</span>` : ''}
                </div>
                <div class="week-day-body">
                    ${bodyHtml}
                </div>
            </div>
        `;
    }
    grid.innerHTML = html;
}

// ==================== RENDER: DAILY SCHEDULE ====================
function renderDaily() {
    if (!PharmStore.getActiveUserId()) return;

    const dateStr = formatDate(currentDailyDate);
    document.getElementById('daily-date-picker').value = dateStr;

    const stack = PharmStore.getStack();
    const dayCompounds = stack.filter(c => isCompoundScheduledOnDate(c, currentDailyDate));
    const events = PharmStore.getEvents();
    const dayEvents = events.filter(e => isEventScheduledOnDate(e, currentDailyDate));

    const timeline = document.getElementById('daily-timeline');
    let html = '';

    TIME_BLOCKS.forEach(block => {
        const filterByBlock = (item) => {
            const hour = getTimeHour(item.timeOfDay);
            if (block.id === 'night') return hour >= 21 || hour < 5;
            return hour >= block.start && hour < block.end;
        };
        const blockCompounds = dayCompounds.filter(filterByBlock).map(c => ({ ...c, _itemType: 'compound' }));
        const blockEvents = dayEvents.filter(filterByBlock).map(e => ({ ...e, _itemType: 'event' }));
        const blockItems = sortByTime([...blockCompounds, ...blockEvents]);

        html += `
            <div class="time-block ${blockItems.length === 0 ? 'empty' : ''}">
                <div class="time-block-header">
                    <div class="tb-header-left"><i class="fas ${block.icon}"></i> ${block.label}</div>
                    ${blockItems.length > 0 ? `<span class="tb-count">${blockItems.length}</span>` : ''}
                </div>
                <div class="time-block-body">
                    ${blockItems.length === 0
                        ? '<p class="text-muted" style="font-size:0.8rem; padding:8px 0;">Nothing scheduled</p>'
                        : (function() {
                            const blockGroups = groupItemsByEvent(blockItems);
                            return blockGroups.map(group => {
                                let groupHtml = '';
                                if (group.event) {
                                    const ev = group.event;
                                    const hasLinked = group.linkedCompounds.length > 0;
                                    groupHtml += `<div class="daily-event-group${hasLinked ? ' has-linked' : ''}" style="--event-color: ${ev.color || 'var(--accent)'}">`;
                                    groupHtml += `
                                        <div class="daily-event-item" style="border-left-color: ${ev.color || 'var(--accent)'};" onclick="openEditEvent('${ev.id}')">
                                            <div class="dci-left">
                                                <span class="event-emoji">${ev.emoji || '📅'}</span>
                                                <div class="dci-info">
                                                    <div class="dci-name">${sanitize(ev.name)}</div>
                                                    ${ev.notes ? `<div class="dci-detail">${sanitize(ev.notes)}</div>` : ''}
                                                </div>
                                            </div>
                                            <div class="dci-right">
                                                <span class="dci-time">${formatEventTime(ev)}</span>
                                            </div>
                                        </div>
                                    `;
                                    group.linkedCompounds.forEach(c => {
                                        const done = PharmStore.isDoseLoggedToday(c.id) && formatDate(currentDailyDate) === formatDate(new Date());
                                        const info = getPeptideDisplayInfo(c);
                                        const pedInfo = getPEDDisplayInfo(c);
                                        let detail = c.type === 'Peptides' && info
                                            ? `${info.doseMcg}mcg — ${info.units}u`
                                            : c.type === 'PEDs' && pedInfo
                                            ? `${pedInfo.doseMg}mg — ${pedInfo.units}u`
                                            : (c.dosage || c.type);
                                        groupHtml += `
                                            <div class="daily-compound-item linked ${done ? 'done' : ''} ${c.type}">
                                                <div class="dci-left">
                                                    <input type="checkbox" ${done ? 'checked disabled' : ''} class="dose-check" data-id="${c.id}">
                                                    <div class="dci-info">
                                                        <div class="dci-name">${sanitize(c.name)} <span class="type-badge ${c.type}" style="font-size:0.6rem;">${c.type}</span></div>
                                                        <div class="dci-detail">${sanitize(detail)}</div>
                                                    </div>
                                                </div>
                                                <div class="dci-right">
                                                    <button class="btn-icon" onclick="openLogModal('${c.id}')" title="Log dose"><i class="fas fa-clipboard-check"></i></button>
                                                </div>
                                            </div>
                                        `;
                                    });
                                    groupHtml += `</div>`;
                                } else {
                                    group.linkedCompounds.forEach(c => {
                                        const done = PharmStore.isDoseLoggedToday(c.id) && formatDate(currentDailyDate) === formatDate(new Date());
                                        const info = getPeptideDisplayInfo(c);
                                        const pedInfo = getPEDDisplayInfo(c);
                                        let detail = c.type === 'Peptides' && info
                                            ? `${info.doseMcg}mcg — ${info.units}u`
                                            : c.type === 'PEDs' && pedInfo
                                            ? `${pedInfo.doseMg}mg — ${pedInfo.units}u`
                                            : (c.dosage || c.type);
                                        groupHtml += `
                                            <div class="daily-compound-item ${done ? 'done' : ''} ${c.type}">
                                                <div class="dci-left">
                                                    <input type="checkbox" ${done ? 'checked disabled' : ''} class="dose-check" data-id="${c.id}">
                                                    <div class="dci-info">
                                                        <div class="dci-name">${sanitize(c.name)} <span class="type-badge ${c.type}" style="font-size:0.6rem;">${c.type}</span></div>
                                                        <div class="dci-detail">${sanitize(detail)}</div>
                                                    </div>
                                                </div>
                                                <div class="dci-right">
                                                    <span class="dci-time">${formatTime12(c.timeOfDay)}</span>
                                                    <button class="btn-icon" onclick="openLogModal('${c.id}')" title="Log dose"><i class="fas fa-clipboard-check"></i></button>
                                                </div>
                                            </div>
                                        `;
                                    });
                                }
                                return groupHtml;
                            }).join('');
                        })()
                    }
                </div>
            </div>
        `;
    });

    timeline.innerHTML = html;

    // Load daily notes
    const notes = PharmStore.getDailyNotes(dateStr);
    document.getElementById('daily-events').value = notes.events || '';
    document.getElementById('daily-notes').value = notes.notes || '';
}

// ==================== RENDER: SETTINGS ====================
function renderSettings() {
    const users = PharmStore.getUsers();
    const activeId = PharmStore.getActiveUserId();
    const user = users.find(u => u.id === activeId);
    if (user) {
        document.getElementById('settings-username').value = user.name;
    }
    // Check storage usage
    let totalBytes = 0;
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith('pharmtracker')) {
            totalBytes += localStorage.getItem(key).length * 2; // UTF-16
        }
    }
    const storageKB = (totalBytes / 1024).toFixed(1);
    const compounds = PharmStore.getCompounds().length;
    const stack = PharmStore.getStackIds().length;
    const events = PharmStore.getEvents().length;
    const statsEl = document.getElementById('settings-data-stats');
    if (statsEl) {
        statsEl.innerHTML = `
            <div class="text-muted" style="font-size:0.8rem; margin-top:8px;">
                <span><i class="fas fa-flask"></i> ${compounds} compounds</span> ·
                <span><i class="fas fa-layer-group"></i> ${stack} in stack</span> ·
                <span><i class="fas fa-calendar-alt"></i> ${events} events</span> ·
                <span><i class="fas fa-database"></i> ${storageKB} KB used</span>
            </div>
        `;
    }
}

// ==================== COMPOUND CRUD ====================
function openAddCompound() {
    editingCompoundId = null;
    document.getElementById('compound-modal-title').textContent = 'Add Compound';
    // Reset form
    document.getElementById('compound-name').value = '';
    document.getElementById('compound-type').value = 'Peptides';
    document.getElementById('compound-mg').value = '';
    document.getElementById('compound-bac').value = '';
    document.getElementById('compound-dose-mcg').value = '';
    document.getElementById('compound-inj-week').value = '';
    document.querySelectorAll('#modal-add-compound input[name="compound-schedule"]')[0].checked = true;
    document.querySelectorAll('#modal-add-compound .day-toggle').forEach(b => b.classList.remove('active'));
    document.getElementById('compound-specific-days').style.display = 'none';
    document.getElementById('compound-ped-concentration').value = '';
    document.getElementById('compound-ped-vial-ml').value = '';
    document.getElementById('compound-ped-dose-mg').value = '';
    document.getElementById('compound-ped-inj-week').value = '';
    document.querySelectorAll('#ped-specific-days .day-toggle').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('#modal-add-compound input[name="ped-schedule"]').forEach(r => r.checked = r.value === 'specific');
    document.getElementById('ped-specific-days').style.display = '';
    document.getElementById('compound-dosage').value = '';
    document.getElementById('compound-frequency').value = 'daily';
    document.getElementById('compound-time').value = '08:00';
    document.getElementById('compound-halflife').value = '';
    document.getElementById('compound-cost').value = '';
    document.getElementById('compound-source').value = '';
    document.getElementById('compound-notes').value = '';
    toggleCompoundFields('Peptides');
    showModal('modal-add-compound');
}

function openEditCompound(id) {
    const c = PharmStore.getCompound(id);
    if (!c) return;
    editingCompoundId = id;
    document.getElementById('compound-modal-title').textContent = 'Edit Compound';
    document.getElementById('compound-name').value = c.name;
    document.getElementById('compound-type').value = c.type;
    document.getElementById('compound-mg').value = c.mgPerVial || '';
    document.getElementById('compound-bac').value = c.mlBacWater || '';
    document.getElementById('compound-dose-mcg').value = c.desiredDoseMcg || '';
    document.getElementById('compound-inj-week').value = c.injectionsPerWeek || '';

    // Schedule type
    const schedRadios = document.querySelectorAll('#modal-add-compound input[name="compound-schedule"]');
    schedRadios.forEach(r => r.checked = r.value === (c.scheduleType || 'everyday'));

    // Schedule days
    document.querySelectorAll('#compound-specific-days .day-toggle').forEach(b => {
        b.classList.toggle('active', (c.scheduleDays || []).includes(parseInt(b.dataset.day)));
    });
    document.getElementById('compound-specific-days').style.display = c.scheduleType === 'specific' ? '' : 'none';

    // PED fields
    document.getElementById('compound-ped-concentration').value = c.pedConcentration || '';
    document.getElementById('compound-ped-vial-ml').value = c.pedVialMl || '';
    document.getElementById('compound-ped-dose-mg').value = c.pedDoseMg || '';
    document.getElementById('compound-ped-inj-week').value = c.type === 'PEDs' ? (c.injectionsPerWeek || '') : '';
    const pedSchedRadios = document.querySelectorAll('#modal-add-compound input[name="ped-schedule"]');
    pedSchedRadios.forEach(r => r.checked = r.value === (c.scheduleType || 'specific'));
    document.querySelectorAll('#ped-specific-days .day-toggle').forEach(b => {
        b.classList.toggle('active', (c.scheduleDays || []).includes(parseInt(b.dataset.day)));
    });
    document.getElementById('ped-specific-days').style.display = (c.scheduleType || 'specific') === 'specific' ? '' : 'none';

    // Non-peptide fields
    document.getElementById('compound-dosage').value = c.dosage || '';
    document.getElementById('compound-frequency').value = c.frequency || 'daily';

    // Non-peptide specific days
    document.querySelectorAll('#non-peptide-specific-days .day-toggle').forEach(b => {
        b.classList.toggle('active', (c.scheduleDays || []).includes(parseInt(b.dataset.day)));
    });
    document.getElementById('non-peptide-specific-days').style.display = c.frequency === 'specific' ? '' : 'none';

    document.getElementById('compound-time').value = c.timeOfDay || '08:00';
    document.getElementById('compound-halflife').value = c.halfLife || '';
    document.getElementById('compound-cost').value = c.cost || '';
    document.getElementById('compound-source').value = c.source || '';
    document.getElementById('compound-notes').value = c.notes || '';
    toggleCompoundFields(c.type);
    showModal('modal-add-compound');
}

function toggleCompoundFields(type) {
    document.getElementById('peptide-fields').style.display = type === 'Peptides' ? '' : 'none';
    document.getElementById('ped-fields').style.display = type === 'PEDs' ? '' : 'none';
    document.getElementById('non-peptide-fields').style.display = (type !== 'Peptides' && type !== 'PEDs') ? '' : 'none';
}

function saveCompound() {
    const name = document.getElementById('compound-name').value.trim();
    const type = document.getElementById('compound-type').value;
    if (!name) { showToast('Please enter a compound name', 'error'); return; }

    const compound = editingCompoundId ? { ...PharmStore.getCompound(editingCompoundId) } : {
        id: uuid(),
        logs: [],
        vialPinsUsed: 0,
        createdAt: new Date().toISOString()
    };

    compound.name = name;
    compound.type = type;
    compound.timeOfDay = document.getElementById('compound-time').value;
    compound.halfLife = document.getElementById('compound-halflife').value;
    compound.cost = parseFloat(document.getElementById('compound-cost').value) || null;
    compound.source = document.getElementById('compound-source').value;
    compound.notes = document.getElementById('compound-notes').value;

    if (type === 'Peptides') {
        compound.mgPerVial = parseFloat(document.getElementById('compound-mg').value) || 0;
        compound.mlBacWater = parseFloat(document.getElementById('compound-bac').value) || 0;
        compound.desiredDoseMcg = parseFloat(document.getElementById('compound-dose-mcg').value) || 0;
        compound.injectionsPerWeek = parseInt(document.getElementById('compound-inj-week').value) || 0;
        compound.scheduleType = document.querySelector('#modal-add-compound input[name="compound-schedule"]:checked')?.value || 'everyday';
        compound.scheduleDays = [];
        if (compound.scheduleType === 'specific') {
            document.querySelectorAll('#compound-specific-days .day-toggle.active').forEach(b => {
                compound.scheduleDays.push(parseInt(b.dataset.day));
            });
        }
        if (!compound.eodStartDate) compound.eodStartDate = formatDate(new Date());
    } else if (type === 'PEDs') {
        compound.pedConcentration = parseFloat(document.getElementById('compound-ped-concentration').value) || 0;
        compound.pedVialMl = parseFloat(document.getElementById('compound-ped-vial-ml').value) || 0;
        compound.pedDoseMg = parseFloat(document.getElementById('compound-ped-dose-mg').value) || 0;
        compound.injectionsPerWeek = parseInt(document.getElementById('compound-ped-inj-week').value) || 0;
        compound.scheduleType = document.querySelector('#modal-add-compound input[name="ped-schedule"]:checked')?.value || 'specific';
        compound.scheduleDays = [];
        if (compound.scheduleType === 'specific') {
            document.querySelectorAll('#ped-specific-days .day-toggle.active').forEach(b => {
                compound.scheduleDays.push(parseInt(b.dataset.day));
            });
        }
        if (!compound.eodStartDate) compound.eodStartDate = formatDate(new Date());
    } else {
        compound.dosage = document.getElementById('compound-dosage').value;
        compound.frequency = document.getElementById('compound-frequency').value;
        compound.scheduleDays = [];
        if (compound.frequency === 'specific') {
            document.querySelectorAll('#non-peptide-specific-days .day-toggle.active').forEach(b => {
                compound.scheduleDays.push(parseInt(b.dataset.day));
            });
        }
    }

    PharmStore.saveCompound(compound);
    hideModal();
    showToast(`${name} ${editingCompoundId ? 'updated' : 'added'}!`);
    editingCompoundId = null;
    renderCurrentView();
}

function confirmDeleteCompound(id) {
    const c = PharmStore.getCompound(id);
    if (!c) return;
    document.getElementById('confirm-message').textContent = `Delete "${c.name}"? This will also remove it from your stack.`;
    confirmCallback = () => {
        PharmStore.deleteCompound(id);
        hideModal();
        showToast(`${c.name} deleted`);
        renderCurrentView();
    };
    showModal('modal-confirm');
}

function resetVial(id) {
    const c = PharmStore.getCompound(id);
    if (!c) return;
    document.getElementById('confirm-message').textContent = `Reset vial for "${c.name}"? This sets pins used back to 0 (new vial).`;
    confirmCallback = () => {
        PharmStore.resetVial(id);
        hideModal();
        showToast('Vial reset — new vial started!');
        renderCurrentView();
    };
    showModal('modal-confirm');
}

function addToStack(id) {
    PharmStore.addToStack(id);
    showToast('Added to stack!');
    renderCurrentView();
}

function removeFromStack(id) {
    PharmStore.removeFromStack(id);
    showToast('Removed from stack');
    renderCurrentView();
}

// ==================== EVENT CRUD ====================
function openAddEvent() {
    editingEventId = null;
    document.getElementById('event-modal-title').textContent = 'Add Event';
    document.getElementById('event-name').value = '';
    document.getElementById('event-emoji').value = '';
    document.getElementById('event-time').value = '06:00';
    document.getElementById('event-end-time').value = '';
    document.getElementById('event-color').value = '#00d4aa';
    document.querySelectorAll('#modal-add-event input[name="event-schedule"]').forEach(r => r.checked = r.value === 'specific');
    document.querySelectorAll('#event-specific-days .day-toggle').forEach(b => b.classList.remove('active'));
    document.getElementById('event-specific-days').style.display = '';
    document.getElementById('event-notes').value = '';
    document.getElementById('btn-delete-event').style.display = 'none';
    showModal('modal-add-event');
}

function openEditEvent(id) {
    const e = PharmStore.getEvent(id);
    if (!e) return;
    editingEventId = id;
    document.getElementById('event-modal-title').textContent = 'Edit Event';
    document.getElementById('event-name').value = e.name;
    document.getElementById('event-emoji').value = e.emoji || '';
    document.getElementById('event-time').value = e.timeOfDay || '06:00';
    document.getElementById('event-end-time').value = e.endTime || '';
    document.getElementById('event-color').value = e.color || '#00d4aa';
    document.querySelectorAll('#modal-add-event input[name="event-schedule"]').forEach(r => r.checked = r.value === (e.scheduleType || 'specific'));
    document.querySelectorAll('#event-specific-days .day-toggle').forEach(b => {
        b.classList.toggle('active', (e.scheduleDays || []).includes(parseInt(b.dataset.day)));
    });
    document.getElementById('event-specific-days').style.display = (e.scheduleType || 'specific') === 'specific' ? '' : 'none';
    document.getElementById('event-notes').value = e.notes || '';
    document.getElementById('btn-delete-event').style.display = '';
    showModal('modal-add-event');
}

function saveEventFromModal() {
    const name = document.getElementById('event-name').value.trim();
    if (!name) { showToast('Please enter an event name', 'error'); return; }

    const event = editingEventId ? { ...PharmStore.getEvent(editingEventId) } : {
        id: uuid(),
        createdAt: new Date().toISOString()
    };

    event.name = name;
    event.emoji = document.getElementById('event-emoji').value.trim();
    event.timeOfDay = document.getElementById('event-time').value;
    event.color = document.getElementById('event-color').value;
    event.notes = document.getElementById('event-notes').value;
    event.scheduleType = document.querySelector('#modal-add-event input[name="event-schedule"]:checked')?.value || 'specific';
    event.endTime = document.getElementById('event-end-time').value || '';
    event.scheduleDays = [];
    if (event.scheduleType === 'specific') {
        document.querySelectorAll('#event-specific-days .day-toggle.active').forEach(b => {
            event.scheduleDays.push(parseInt(b.dataset.day));
        });
        if (event.scheduleDays.length === 0) {
            showToast('Please select at least one day', 'error');
            return;
        }
    }
    if (!event.eodStartDate) event.eodStartDate = formatDate(new Date());

    PharmStore.saveEvent(event);
    hideModal();
    showToast(`${name} ${editingEventId ? 'updated' : 'added'}!`);
    editingEventId = null;
    renderCurrentView();
}

function confirmDeleteEvent() {
    const e = PharmStore.getEvent(editingEventId);
    if (!e) return;
    document.getElementById('confirm-message').textContent = `Delete event "${e.name}"?`;
    confirmCallback = () => {
        PharmStore.deleteEvent(editingEventId);
        editingEventId = null;
        hideModal();
        showToast(`${e.name} deleted`);
        renderCurrentView();
    };
    showModal('modal-confirm');
}

// ==================== LOGGING ====================
let logCompoundId = null;

function openLogModal(id) {
    logCompoundId = id;
    const c = PharmStore.getCompound(id);
    if (!c) return;
    document.getElementById('log-compound-name').textContent = c.name;
    document.getElementById('log-note').value = '';
    document.getElementById('log-side-effects').value = '';
    showModal('modal-log-entry');
}

function handleLogDose() {
    if (!logCompoundId) return;
    const note = document.getElementById('log-note').value;
    const sideEffects = document.getElementById('log-side-effects').value;
    PharmStore.logDose(logCompoundId, note, sideEffects);
    hideModal();
    showToast('Dose logged!');
    renderCurrentView();
}

// ==================== PICK COMPOUND FOR STACK ====================
function openPickCompound() {
    const compounds = PharmStore.getCompounds();
    const stackIds = PharmStore.getStackIds();
    const available = compounds.filter(c => !stackIds.includes(c.id));

    const list = document.getElementById('pick-list');
    if (available.length === 0) {
        list.innerHTML = '<div class="empty-state"><p>All compounds are already in your stack, or you have none. Add compounds in the Library first.</p></div>';
    } else {
        list.innerHTML = available.map(c => `
            <div class="pick-item" onclick="addToStack('${c.id}'); hideModal(); renderCurrentView();">
                <span class="pick-item-name">${sanitize(c.name)}</span>
                <span class="pick-item-type type-badge ${c.type}">${c.type}</span>
            </div>
        `).join('');
    }
    document.getElementById('pick-search').value = '';
    showModal('modal-pick-compound');
}

// ==================== EXPORT / IMPORT ====================
function exportData() {
    const json = PharmStore.exportAll();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pharmtracker-backup-${formatDate(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Data exported!');
}

function importData(file) {
    document.getElementById('confirm-message').textContent = 'Import will overwrite all existing data. Make sure you have a backup first. Continue?';
    confirmCallback = () => {
        hideModal();
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                PharmStore.importAll(e.target.result);
                renderUserSelector();
                renderCurrentView();
                showToast('Data imported successfully!');
            } catch (err) {
                showToast('Invalid import file', 'error');
            }
        };
        reader.readAsText(file);
    };
    showModal('modal-confirm');
}

// ==================== INITIALIZATION ====================
function init() {
    // Check for existing users, create default if none
    const users = PharmStore.getUsers();
    if (users.length === 0) {
        const user = PharmStore.addUser('Default User');
        PharmStore.setActiveUserId(user.id);
    } else if (!PharmStore.getActiveUserId()) {
        PharmStore.setActiveUserId(users[0].id);
    }

    renderUserSelector();
    navigateTo('dashboard');
    initEventListeners();
}

function initEventListeners() {
    // Navigation
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            navigateTo(item.dataset.view);
        });
    });

    // User selector
    document.getElementById('user-select').addEventListener('change', handleSwitchUser);
    document.getElementById('btn-add-user').addEventListener('click', () => showModal('modal-add-user'));
    document.getElementById('btn-confirm-add-user').addEventListener('click', handleAddUser);
    document.getElementById('new-user-name').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleAddUser();
    });

    // Modal close buttons
    document.querySelectorAll('.modal-close, .modal-cancel').forEach(btn => {
        btn.addEventListener('click', hideModal);
    });
    document.getElementById('modal-overlay').addEventListener('click', (e) => {
        if (e.target === document.getElementById('modal-overlay')) hideModal();
    });

    // Confirm modal
    document.getElementById('btn-confirm-action').addEventListener('click', () => {
        if (confirmCallback) { confirmCallback(); confirmCallback = null; }
    });

    // Compound CRUD
    document.getElementById('btn-add-compound').addEventListener('click', openAddCompound);
    document.getElementById('btn-save-compound').addEventListener('click', saveCompound);
    document.getElementById('compound-type').addEventListener('change', (e) => toggleCompoundFields(e.target.value));

    // Compound schedule type toggle (modal)
    document.querySelectorAll('#modal-add-compound input[name="compound-schedule"]').forEach(r => {
        r.addEventListener('change', () => {
            document.getElementById('compound-specific-days').style.display = r.value === 'specific' && r.checked ? '' : 'none';
        });
    });

    // PED schedule type toggle
    document.querySelectorAll('#modal-add-compound input[name="ped-schedule"]').forEach(r => {
        r.addEventListener('change', () => {
            document.getElementById('ped-specific-days').style.display = r.value === 'specific' && r.checked ? '' : 'none';
        });
    });

    // Non-peptide frequency toggle
    document.getElementById('compound-frequency').addEventListener('change', (e) => {
        document.getElementById('non-peptide-specific-days').style.display = e.target.value === 'specific' ? '' : 'none';
    });

    // Event modal
    document.getElementById('btn-save-event').addEventListener('click', saveEventFromModal);
    document.getElementById('btn-delete-event').addEventListener('click', confirmDeleteEvent);
    document.querySelectorAll('#modal-add-event input[name="event-schedule"]').forEach(r => {
        r.addEventListener('change', () => {
            document.getElementById('event-specific-days').style.display = r.value === 'specific' && r.checked ? '' : 'none';
        });
    });

    // Day toggle buttons (all)
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('day-toggle')) {
            e.preventDefault();
            e.target.classList.toggle('active');
            // Recalc if on calculator page
            if (currentView === 'calculator') updateCalcResults();
        }
    });

    // Stack buttons
    document.getElementById('btn-add-to-stack').addEventListener('click', openPickCompound);
    document.getElementById('btn-clear-stack').addEventListener('click', () => {
        document.getElementById('confirm-message').textContent = 'Clear all compounds from your stack?';
        confirmCallback = () => {
            PharmStore.clearStack();
            hideModal();
            showToast('Stack cleared');
            renderStack();
        };
        showModal('modal-confirm');
    });

    // Pick search filter
    document.getElementById('pick-search').addEventListener('input', debounce((e) => {
        const search = e.target.value.toLowerCase();
        document.querySelectorAll('.pick-item').forEach(item => {
            const name = item.querySelector('.pick-item-name').textContent.toLowerCase();
            item.style.display = name.includes(search) ? '' : 'none';
        });
    }, 200));

    // Calculator inputs
    ['calc-mg', 'calc-bac', 'calc-dose', 'calc-freq'].forEach(id => {
        document.getElementById(id).addEventListener('input', updateCalcResults);
    });
    document.querySelectorAll('input[name="calc-schedule"]').forEach(r => {
        r.addEventListener('change', () => {
            document.getElementById('specific-days-group').style.display = r.value === 'specific' && r.checked ? '' : 'none';
            updateCalcResults();
        });
    });
    document.getElementById('btn-save-from-calc').addEventListener('click', saveFromCalculator);

    // Weekly navigation
    document.getElementById('week-prev').addEventListener('click', () => { currentWeekOffset--; renderWeekly(); });
    document.getElementById('week-next').addEventListener('click', () => { currentWeekOffset++; renderWeekly(); });

    // Daily navigation
    document.getElementById('day-prev').addEventListener('click', () => {
        currentDailyDate = addDays(currentDailyDate, -1);
        renderDaily();
    });
    document.getElementById('day-next').addEventListener('click', () => {
        currentDailyDate = addDays(currentDailyDate, 1);
        renderDaily();
    });
    document.getElementById('daily-date-picker').addEventListener('change', (e) => {
        currentDailyDate = new Date(e.target.value + 'T12:00:00');
        renderDaily();
    });
    document.getElementById('btn-save-daily-notes').addEventListener('click', () => {
        const dateStr = formatDate(currentDailyDate);
        const events = document.getElementById('daily-events').value;
        const notes = document.getElementById('daily-notes').value;
        PharmStore.saveDailyNotes(dateStr, events, notes);
        showToast('Notes saved!');
    });

    // Dose checkboxes (delegated)
    document.addEventListener('change', (e) => {
        if (e.target.classList.contains('dose-check') && e.target.checked) {
            const id = e.target.dataset.id;
            openLogModal(id);
            // Uncheck temporarily — will re-check after logging
            e.target.checked = false;
        }
    });

    // Log dose confirm
    document.getElementById('btn-confirm-log').addEventListener('click', handleLogDose);

    // Library filters
    document.getElementById('library-filter-type').addEventListener('change', renderLibrary);
    document.getElementById('library-search').addEventListener('input', debounce(renderLibrary, 200));

    // Global search
    document.getElementById('global-search').addEventListener('input', debounce((e) => {
        const q = e.target.value.trim();
        if (q) {
            navigateTo('library');
            document.getElementById('library-search').value = q;
            renderLibrary();
        }
    }, 300));

    // Settings
    document.getElementById('btn-save-username').addEventListener('click', () => {
        const name = document.getElementById('settings-username').value.trim();
        if (!name) { showToast('Name cannot be empty', 'error'); return; }
        PharmStore.renameUser(PharmStore.getActiveUserId(), name);
        renderUserSelector();
        showToast('Name updated!');
    });
    document.getElementById('btn-delete-user').addEventListener('click', () => {
        const users = PharmStore.getUsers();
        if (users.length <= 1) { showToast('Cannot delete the last user', 'error'); return; }
        document.getElementById('confirm-message').textContent = 'Delete this user and all their data? This cannot be undone.';
        confirmCallback = () => {
            const currentId = PharmStore.getActiveUserId();
            PharmStore.deleteUser(currentId);
            const remaining = PharmStore.getUsers();
            if (remaining.length > 0) PharmStore.setActiveUserId(remaining[0].id);
            renderUserSelector();
            hideModal();
            renderCurrentView();
            showToast('User deleted');
        };
        showModal('modal-confirm');
    });

    // Export/Import
    document.getElementById('btn-export').addEventListener('click', exportData);
    document.getElementById('btn-export-settings').addEventListener('click', exportData);
    const importHandler = () => document.getElementById('import-file').click();
    document.getElementById('btn-import').addEventListener('click', importHandler);
    document.getElementById('btn-import-settings').addEventListener('click', () => document.getElementById('import-file-settings').click());
    document.getElementById('import-file').addEventListener('change', (e) => {
        if (e.target.files[0]) importData(e.target.files[0]);
    });
    document.getElementById('import-file-settings').addEventListener('change', (e) => {
        if (e.target.files[0]) importData(e.target.files[0]);
    });

    // Theme toggle
    const themeToggle = document.getElementById('btn-theme-toggle');
    const darkToggle = document.getElementById('dark-mode-toggle');
    const savedTheme = localStorage.getItem('pharmtracker_theme');
    if (savedTheme === 'light') {
        document.body.classList.add('light-mode');
        darkToggle.checked = false;
        themeToggle.innerHTML = '<i class="fas fa-sun"></i>';
    }
    themeToggle.addEventListener('click', () => {
        document.body.classList.toggle('light-mode');
        const isLight = document.body.classList.contains('light-mode');
        localStorage.setItem('pharmtracker_theme', isLight ? 'light' : 'dark');
        themeToggle.innerHTML = `<i class="fas ${isLight ? 'fa-sun' : 'fa-moon'}"></i>`;
        darkToggle.checked = !isLight;
    });
    darkToggle.addEventListener('change', () => {
        document.body.classList.toggle('light-mode', !darkToggle.checked);
        localStorage.setItem('pharmtracker_theme', darkToggle.checked ? 'dark' : 'light');
        themeToggle.innerHTML = `<i class="fas ${darkToggle.checked ? 'fa-moon' : 'fa-sun'}"></i>`;
    });

    // Mobile search
    document.getElementById('mobile-search-toggle').addEventListener('click', () => {
        const bar = document.getElementById('mobile-search-bar');
        bar.style.display = bar.style.display === 'none' ? 'flex' : 'none';
        if (bar.style.display === 'flex') document.getElementById('mobile-search-input').focus();
    });
    document.getElementById('mobile-search-close').addEventListener('click', () => {
        document.getElementById('mobile-search-bar').style.display = 'none';
        document.getElementById('mobile-search-input').value = '';
    });
    document.getElementById('mobile-search-input').addEventListener('input', debounce((e) => {
        const q = e.target.value.trim();
        if (q) {
            navigateTo('library');
            document.getElementById('library-search').value = q;
            renderLibrary();
        }
    }, 300));

    // Mobile
    document.getElementById('hamburger').addEventListener('click', () => {
        document.getElementById('sidebar').classList.toggle('open');
        document.getElementById('sidebar-overlay').classList.toggle('active');
    });
    document.getElementById('sidebar-overlay').addEventListener('click', () => {
        document.getElementById('sidebar').classList.remove('open');
        document.getElementById('sidebar-overlay').classList.remove('active');
    });
}

// ==================== AUTH GATE ====================
const PASS_HASH = '7fcea8e2154b35a328e96ab3bf259dcb8ce4d4a2ea9a6c24b179502d9fcaff46';

async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function attemptLogin() {
    const input = document.getElementById('login-password');
    const error = document.getElementById('login-error');
    const password = input.value;

    if (!password) { error.textContent = 'Please enter a password'; return; }

    const hash = await hashPassword(password);
    if (hash === PASS_HASH) {
        sessionStorage.setItem('pharmtracker_auth', 'true');
        document.getElementById('login-gate').style.display = 'none';
        document.getElementById('app-container').style.display = '';
        init();
    } else {
        error.textContent = 'Incorrect password';
        input.value = '';
        input.focus();
    }
}

// ==================== START ====================
document.addEventListener('DOMContentLoaded', () => {
    if (sessionStorage.getItem('pharmtracker_auth') === 'true') {
        document.getElementById('login-gate').style.display = 'none';
        document.getElementById('app-container').style.display = '';
        init();
    } else {
        document.getElementById('btn-login').addEventListener('click', attemptLogin);
        document.getElementById('login-password').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') attemptLogin();
        });
    }
});
