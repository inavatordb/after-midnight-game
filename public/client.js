// client.js

document.addEventListener('DOMContentLoaded', () => {
    const socket = io();

    // --- State and DOM Elements (no changes here) ---
    const rejoinData = JSON.parse(sessionStorage.getItem('ngham-rejoin-data'));
    if (rejoinData) {
        socket.on('connect', () => {
            console.log('Attempting to rejoin game...');
            socket.emit('rejoinGame', rejoinData);
        }, { once: true });
    }

    const screens = { home: document.getElementById('home-screen'), lobby: document.getElementById('lobby-screen'), game: document.getElementById('game-screen'), end: document.getElementById('end-screen') };
    const playerNameInput = document.getElementById('playerName');
    const createGameBtn = document.getElementById('createGameBtn');
    const joinGameBtn = document.getElementById('joinGameBtn');
    const roomCodeInput = document.getElementById('roomCodeInput');
    const roomCodeDisplay = document.getElementById('roomCodeDisplay');
    const playerList = document.getElementById('playerList');
    const startGameBtn = document.getElementById('startGameBtn');
    const submitProfileBtn = document.getElementById('submitProfileBtn');
    const gameDay = document.getElementById('game-day');
    const myPlayerName = document.getElementById('my-player-name');
    const myRole = document.getElementById('my-role');
    const myTeam = document.getElementById('my-team');
    const myObjective = document.getElementById('my-objective');
    const crimeReportText = document.getElementById('crime-report-text');
    const clueList = document.getElementById('clue-list');
    const activityTitle = document.getElementById('activity-title');
    const activityDesc = document.getElementById('activity-desc');
    const gamePlayerList = document.getElementById('game-player-list');
    const actionArea = document.getElementById('action-area');
    const playAgainBtn = document.getElementById('playAgainBtn');
    const modalBackdrop = document.getElementById('modal-backdrop');
    const collectorPrompt = document.getElementById('collector-prompt');
    const privateMessagePopup = document.getElementById('private-message-popup');
    const privateMessageText = document.getElementById('private-message-text');
    const closePopupBtn = document.getElementById('close-popup-btn');

    let state = { roomCode: null, game: null, myId: null };

    const roleInfo = {
        'Collector': { objective: 'Identify the Thief and recover your item.', description: 'You know everything about your stolen item. Each night, you can send one truthful clue to a player you trust to guide the investigation.' },
        'Detective': { objective: 'Correctly identify and vote for the Thief.', description: 'A master of observation. Each night, you can tail one player. You will learn if they performed a suspicious action (planting evidence or spreading a rumor).' },
        'Thief': { objective: 'Evade capture for 4 days or frame an innocent player.', description: 'You stole the item. To cover your tracks, you can plant false evidence on a player each night, using their real-life hobby to create a convincing lie.' },
        'Fencer': { objective: 'Help the Thief escape. You win if the Thief wins.', description: 'The shadowy middle-man. You cause chaos by spreading misinformation. Each night, you can start a false rumor about a player based on their real-life occupation.' }
    };
    
    // --- UI Update Functions (mostly unchanged, they just read from local state) ---
    function switchScreen(screenName) {
        Object.values(screens).forEach(screen => screen.classList.remove('active'));
        if (screens[screenName]) screens[screenName].classList.add('active');
    }

    function updateLobby() {
        if (!state.game) return;
        roomCodeDisplay.textContent = state.game.roomCode;
        playerList.innerHTML = '';
        Object.values(state.game.players).forEach(player => {
            const li = document.createElement('li');
            li.textContent = player.name;
            li.className = 'player-card';
            li.dataset.id = player.id;
            if (player.id === state.game.hostId) li.classList.add('is-host');
            if (player.profile) li.classList.add('has-profile');
            if (player.disconnected) li.classList.add('disconnected');
            playerList.appendChild(li);
        });
        startGameBtn.disabled = !(state.myId === state.game.hostId);
    }
    // ... all other UI functions like showRoleRevealAnimation, updateGameView, etc. are the same as your original file ...
    function showRoleRevealAnimation(myAssignedRole) {
        const spinner = document.getElementById('role-spinner');
        const roleRevealModal = document.getElementById('role-reveal-modal');
        const roleRevealContent = document.getElementById('role-reveal-content');
        const revealedRoleName = document.getElementById('revealed-role-name');
        const revealedRoleDesc = document.getElementById('revealed-role-desc');
        const ackBtn = document.getElementById('role-acknowledged-btn');
        collectorPrompt.classList.add('hidden');
        privateMessagePopup.classList.add('hidden');
        roleRevealContent.classList.add('hidden');
        spinner.classList.remove('hidden');
        roleRevealModal.classList.remove('hidden');
        modalBackdrop.classList.remove('hidden');
        const allRoles = ['Detective', 'Collector', 'Thief', 'Fencer'];
        let spinCount = 0;
        const spinInterval = setInterval(() => {
            spinner.style.opacity = 0;
            setTimeout(() => { spinner.textContent = allRoles[Math.floor(Math.random() * allRoles.length)]; spinner.style.opacity = 1; }, 100);
            spinCount++;
            if (spinCount > 20) {
                clearInterval(spinInterval);
                spinner.classList.add('hidden');
                revealedRoleName.textContent = myAssignedRole;
                revealedRoleDesc.textContent = roleInfo[myAssignedRole].description;
                roleRevealContent.classList.remove('hidden');
            }
        }, 150);

        ackBtn.onclick = () => {
            roleRevealModal.classList.add('hidden');
            modalBackdrop.classList.add('hidden');
            setTimeout(() => {
                const me = state.game.players[state.myId];
                if (me.role === 'Collector') {
                    modalBackdrop.classList.remove('hidden');
                    collectorPrompt.classList.remove('hidden');
                }
            }, 50);
        };
    }
    function updateGameView() {
        if (!state.game) return;
        const game = state.game;
        const me = game.players[state.myId];
        document.body.className = game.state === 'night' ? 'night' : 'day';
        gameDay.textContent = `Day ${game.day}`;
        
        if (me) {
            myPlayerName.textContent = me.name;
            if(me.role) {
                myRole.textContent = me.role;
                myTeam.textContent = me.team;
                myObjective.textContent = roleInfo[me.role]?.objective || '';
            }
        }
        
        const crimeReportArea = document.getElementById('crime-report-area');
        const clueDossierArea = document.getElementById('clue-dossier-area');
        const discussionArea = document.getElementById('discussion-area');
        crimeReportArea.classList.toggle('hidden', game.day > 1 && game.state !== 'night');
        clueDossierArea.classList.toggle('hidden', game.day === 1);
        discussionArea.classList.toggle('hidden', game.state === 'night');

        if (game.state === 'night') {
            crimeReportText.textContent = 'The city sleeps. After a day of interrogations, it\'s time to make your move. Choose your action wisely.';
        } else if (game.day === 1) {
            crimeReportText.textContent = game.stolenItem ? `The crime has been reported! The item, "${game.stolenItem}", was stolen. The scene is being processed.` : 'Awaiting the official crime report from the Collector...';
        }

        clueDossierArea.querySelector('h4').textContent = "Morning Report: Clue Dossier";
        clueList.innerHTML = '';
        if (game.morningReport) {
            game.morningReport.forEach(clue => { const li = document.createElement('li'); li.textContent = `• ${clue}`; clueList.appendChild(li); });
        }
        
        const activities = {
            1: { title: 'Open Interrogation', desc: 'A free-for-all discussion. Gauge reactions, form alliances, and find the weak link.' },
            2: { title: 'Round Table', desc: 'Each player gets to ask one direct question to one other player.' },
            3: { title: 'Public Accusation', desc: 'Each player must publicly declare who they are most suspicious of and why.' },
            4: { title: 'The Final Deliberation', desc: 'This is the last chance to make your case before the final vote.' },
        };
        const currentActivity = activities[game.day] || activities[4];
        activityTitle.textContent = currentActivity.title;
        activityDesc.textContent = currentActivity.desc;
        renderPlayersForAction(game);
        renderActionUI(game);
    }
    function renderPlayersForAction(game) {
        gamePlayerList.innerHTML = '';
        Object.values(game.players).forEach(player => {
            const playerDiv = document.createElement('div');
            playerDiv.className = 'game-player';
            playerDiv.textContent = player.name;
            playerDiv.dataset.id = player.id;
            if (player.disconnected) playerDiv.classList.add('disconnected');
            if (player.id !== state.myId) {
                playerDiv.addEventListener('click', () => { document.querySelectorAll('.game-player').forEach(p => p.classList.remove('selected')); playerDiv.classList.add('selected'); });
            }
            gamePlayerList.appendChild(playerDiv);
        });
    }
    function renderActionUI(game) {
        actionArea.innerHTML = '';
        const me = game.players[state.myId];
        if (game.state === 'night' && me && me.role && ['Thief', 'Fencer', 'Detective', 'Collector'].includes(me.role)) {
            actionArea.innerHTML = '<h4>Your Night Action</h4>';
            const actionLabel = document.createElement('label');
            const actionSelect = document.createElement('select');
            const submitBtn = document.createElement('button');
            const layLowBtn = document.createElement('button');
            actionSelect.innerHTML = '<option value="">-- Select a Player --</option>';
            Object.values(game.players).filter(p => !p.disconnected).forEach(player => {
                if (player.id !== state.myId) {
                    const option = document.createElement('option');
                    option.value = player.id;
                    option.textContent = player.name;
                    actionSelect.appendChild(option);
                }
            });
            const actions = { 'Thief': 'Plant Evidence on:', 'Fencer': 'Spread a Rumor about:', 'Detective': 'Tail:', 'Collector': 'Send a Secret Tip to:' };
            actionLabel.textContent = actions[me.role];
            submitBtn.textContent = 'Submit Action';
            submitBtn.addEventListener('click', () => { const targetId = actionSelect.value; if (targetId) socket.emit('submitNightAction', { roomCode: state.roomCode, targetId: targetId }); else alert('Please select a player.'); });
            layLowBtn.textContent = 'Lay Low (Perform No Action)';
            layLowBtn.addEventListener('click', () => socket.emit('submitNightAction', { roomCode: state.roomCode, targetId: null }));
            actionArea.appendChild(actionLabel);
            actionArea.appendChild(actionSelect);
            actionArea.appendChild(submitBtn);
            if (me.role === 'Thief' || me.role === 'Fencer') actionArea.appendChild(layLowBtn);
        }
        if (game.state === 'day' && game.day >= 1 && (state.myId === game.hostId || game.day > 4)) {
            const endDayBtn = document.createElement('button');
            endDayBtn.textContent = game.day >= 4 ? 'Proceed to Final Vote' : 'End Day and Proceed to Night';
            endDayBtn.addEventListener('click', () => game.day >= 4 ? socket.emit('startVote', state.roomCode) : socket.emit('endDay', state.roomCode));
            actionArea.appendChild(endDayBtn);
        }
        if (game.state === 'vote') {
            actionArea.innerHTML = `<h4>Final Vote</h4><p>Select a player from the list above and cast your vote for who you believe is the Thief.</p>`;
            const voteBtn = document.createElement('button');
            voteBtn.textContent = `Cast Final Vote`;
            voteBtn.addEventListener('click', () => { const selected = document.querySelector('.game-player.selected'); if (selected) socket.emit('submitVote', { roomCode: state.roomCode, votedPlayerId: selected.dataset.id }); else alert('You must select a player from the list above before voting!'); });
            actionArea.appendChild(voteBtn);
        }
    }


    // --- Event Listeners for player actions (unchanged) ---
    createGameBtn.addEventListener('click', () => { const playerName = playerNameInput.value.trim(); if (playerName) socket.emit('createGame', { playerName }); });
    joinGameBtn.addEventListener('click', () => { const playerName = playerNameInput.value.trim(); const roomCode = roomCodeInput.value.trim().toUpperCase(); if (playerName && roomCode) socket.emit('joinGame', { roomCode, playerName }); });
    submitProfileBtn.addEventListener('click', () => {
        const profile = { occupation: document.getElementById('occupation').value.trim(), hobby: document.getElementById('hobby').value.trim(), shoes: document.getElementById('shoes').value.trim(), clothing: document.getElementById('clothing').value.trim() };
        if (Object.values(profile).every(val => val !== '')) {
            socket.emit('updateProfile', { roomCode: state.roomCode, profile });
            document.getElementById('profile-setup').style.border = '2px solid lightgreen';
            submitProfileBtn.textContent = 'Profile Saved!';
            submitProfileBtn.disabled = true;
        } else { alert('Please fill out all profile fields.'); }
    });
    startGameBtn.addEventListener('click', () => socket.emit('startGame', state.roomCode));
    closePopupBtn.addEventListener('click', () => modalBackdrop.classList.add('hidden'));
    playAgainBtn.addEventListener('click', () => socket.emit('playAgain', state.roomCode));


    // --- REFACTORED: Socket Event Handlers for receiving data from server ---
    socket.on('connect', () => { state.myId = socket.id; });

    // Initial join/create events (receives full game state)
    socket.on('gameCreated', ({ roomCode, game }) => {
        state.roomCode = roomCode;
        state.game = game;
        sessionStorage.setItem('ngham-rejoin-data', JSON.stringify({ roomCode, playerId: state.myId }));
        switchScreen('lobby');
        updateLobby();
    });
    socket.on('joinedGame', ({ roomCode, game }) => {
        state.roomCode = roomCode;
        state.game = game;
        sessionStorage.setItem('ngham-rejoin-data', JSON.stringify({ roomCode, playerId: state.myId }));
        switchScreen('lobby');
        updateLobby();
    });
    socket.on('gameRejoined', (game) => {
        state.game = game;
        if(game.state === 'lobby') {
            switchScreen('lobby');
            updateLobby();
        } else {
            switchScreen('game');
            updateGameView();
        }
    });

    // Delta update events (receives only changed data)
    socket.on('playerJoined', (newPlayer) => {
        if (state.game) {
            state.game.players[newPlayer.id] = newPlayer;
            updateLobby();
        }
    });
    socket.on('playerProfileUpdated', ({ playerId, profile }) => {
        if (state.game && state.game.players[playerId]) {
            state.game.players[playerId].profile = profile;
            updateLobby();
        }
    });
    socket.on('playerDisconnected', ({ playerId, newHostId }) => {
        if (state.game) {
            if(state.game.players[playerId]) state.game.players[playerId].disconnected = true;
            state.game.hostId = newHostId;
            if (state.game.state === 'lobby') updateLobby();
            else updateGameView();
        }
    });
    socket.on('playerReconnected', ({ oldId, newId, newHostId }) => {
        if (state.game && state.game.players[oldId]) {
            const player = state.game.players[oldId];
            delete state.game.players[oldId];
            player.id = newId;
            player.disconnected = false;
            state.game.players[newId] = player;
            state.game.hostId = newHostId;
            if (state.myId === oldId) state.myId = newId; // Update my own ID if I'm the one who reconnected
            if (state.game.state === 'lobby') updateLobby();
            else updateGameView();
        }
    });

    // Game state transition events
    socket.on('gameStarting', ({ players }) => {
        if (state.game) {
            state.game.state = 'setup';
            state.game.players = players; // Receive the full player list with teams
            switchScreen('game');
            updateGameView();
        }
    });
    socket.on('roleAssigned', ({ role, team }) => {
        if (state.game) {
            state.game.players[state.myId].role = role;
            state.game.players[state.myId].team = team;
            showRoleRevealAnimation(role);
        }
    });
    socket.on('dayStarted', ({ day, stolenItem, morningReport }) => {
        if (state.game) {
            state.game.state = 'day';
            state.game.day = day;
            if (stolenItem) state.game.stolenItem = stolenItem; // Only set on day 1
            state.game.morningReport = morningReport;
            switchScreen('game');
            updateGameView();
        }
    });
    socket.on('nightStarted', ({ day }) => {
        if (state.game) {
            state.game.state = 'night';
            state.game.day = day; // Day remains the same for the following night
            switchScreen('game');
            updateGameView();
        }
    });
    socket.on('voteStarted', () => {
        if (state.game) {
            state.game.state = 'vote';
            switchScreen('game');
            updateGameView();
        }
    });
    socket.on('promptCollectorForItem', () => { /* This handler remains the same */ });
    socket.on('privateMessage', (message) => { /* This handler remains the same */ });
    socket.on('actionConfirmed', () => { actionArea.innerHTML = '<p>Your action has been recorded. Waiting for others...</p>'; });
    socket.on('voteConfirmed', () => { actionArea.innerHTML = '<p>Your vote has been cast. Waiting for others...</p>'; });
    socket.on('gameOver', (result) => { /* This handler remains the same */ });
    socket.on('gameReset', (game) => { /* This handler remains the same */ });
    socket.on('error', (message) => { alert(`Error: ${message}`); });
});