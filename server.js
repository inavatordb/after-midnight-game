// server.js

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static('public'));

let games = {}; // Stores all active game states

function generateRoomCode() {
    return Math.random().toString(36).substring(2, 7).toUpperCase();
}

function assignRoles(players) {
    const playerArray = Object.values(players).filter(p => !p.disconnected);
    const playerCount = playerArray.length;
    let availableRoles = [];
    switch (playerCount) {
        case 4: availableRoles = ['Collector', 'Detective', 'Thief', 'Fencer']; break;
        case 5: availableRoles = ['Collector', 'Detective', 'Detective', 'Thief', 'Fencer']; break;
        case 6: availableRoles = ['Collector', 'Detective', 'Detective', 'Detective', 'Thief', 'Fencer']; break;
        case 7: availableRoles = ['Collector', 'Detective', 'Detective', 'Detective', 'Thief', 'Thief', 'Fencer']; break;
        default: availableRoles = ['Collector', 'Detective', 'Detective', 'Detective', 'Detective', 'Thief', 'Thief', 'Fencer']; break;
    }
    const shuffledRoles = availableRoles.sort(() => 0.5 - Math.random());
    playerArray.forEach((player, index) => {
        player.role = shuffledRoles[index];
        player.team = (player.role === 'Thief' || player.role === 'Fencer') ? 'Bad' : 'Good';
    });
}

function createMorningReport(game) {
    const clueForToday = game.stolenItemClues[game.day - 1] || game.stolenItemClues[0];
    const truth = `A key detail has emerged: "${clueForToday}".`;
    const lies = game.nightActions.filter(action => action.lie).map(action => action.lie);
    const report = [truth];
    if (lies.length > 0) {
        const randomLie = lies[Math.floor(Math.random() * lies.length)];
        report.push(randomLie);
    } else {
        const quietNightMessages = [
            "An eerie silence hangs over the city. It's hard to know who to trust when everyone is being so quiet.",
            "The underworld was suspiciously calm last night. Some are laying low, but who?",
            "No new rumors surfaced overnight. It seems some players are choosing their moves very carefully."
        ];
        report.push(quietNightMessages[Math.floor(Math.random() * quietNightMessages.length)]);
    }
    const shuffledReport = report.sort(() => 0.5 - Math.random());
    game.dossier.push(...shuffledReport);
    return shuffledReport;
}

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('createGame', ({ playerName }) => {
        const roomCode = generateRoomCode();
        const newGame = {
            roomCode, players: {}, hostId: socket.id, state: 'lobby', day: 1,
            stolenItem: null, stolenItemClues: [], dossier: [], nightActions: [], votes: {}, morningReport: []
        };
        newGame.players[socket.id] = { id: socket.id, name: playerName, profile: null, role: null, team: null, isAlive: true, disconnected: false };
        games[roomCode] = newGame;
        socket.join(roomCode);
        socket.emit('gameCreated', { roomCode, game: newGame });
    });

    socket.on('joinGame', ({ roomCode, playerName }) => {
        const game = games[roomCode];
        if (game && game.state === 'lobby') {
            const newPlayer = { id: socket.id, name: playerName, profile: null, role: null, team: null, isAlive: true, disconnected: false };
            game.players[socket.id] = newPlayer;
            socket.join(roomCode);
            // Send full state to the new joiner ONLY
            socket.emit('joinedGame', { roomCode, game });
            // Send just the new player data to everyone else
            socket.to(roomCode).emit('playerJoined', newPlayer);
        } else {
            socket.emit('error', 'Game not found or has already started.');
        }
    });
    
    socket.on('rejoinGame', ({ roomCode, playerId }) => {
        const game = games[roomCode];
        if (game) {
            const playerEntry = Object.entries(game.players).find(([id, p]) => id === playerId);
            if (playerEntry) {
                const [oldId, player] = playerEntry;
                player.id = socket.id;
                player.disconnected = false;
                game.players[socket.id] = player;
                if (oldId !== socket.id) {
                   delete game.players[oldId];
                }
                if (game.hostId === oldId) {
                    game.hostId = socket.id;
                }
                console.log(`Player ${player.name} reconnected with new ID ${socket.id}`);
                socket.join(roomCode);
                // Send the full game state to the rejoining player
                socket.emit('gameRejoined', game);
                // Inform others of the ID change and reconnection status
                io.to(roomCode).emit('playerReconnected', { oldId, newId: socket.id, newHostId: game.hostId });
            }
        } else {
            socket.emit('error', 'Could not find the game you were in.');
        }
    });

    socket.on('updateProfile', ({ roomCode, profile }) => {
        const game = games[roomCode];
        if (game && game.players[socket.id]) {
            game.players[socket.id].profile = profile;
            // Send only the updated profile to everyone
            io.to(roomCode).emit('playerProfileUpdated', { playerId: socket.id, profile });
        }
    });

    socket.on('startGame', (roomCode) => {
        const game = games[roomCode];
        if (game && game.hostId === socket.id && Object.values(game.players).filter(p => !p.disconnected).length >= 4) {
            game.state = 'setup';
            assignRoles(game.players);
            // Send each player their specific role privately
            Object.values(game.players).forEach(p => {
                io.to(p.id).emit('roleAssigned', { role: p.role, team: p.team });
            });
            // Tell everyone the game is starting so they can switch screens
            io.to(roomCode).emit('gameStarting', { players: game.players }); // Send player list with teams
            const collector = Object.values(game.players).find(p => p.role === 'Collector');
            if (collector) io.to(collector.id).emit('promptCollectorForItem');
        } else {
             socket.emit('error', 'Need at least 4 active players to start.');
        }
    });

    socket.on('submitItemDescription', ({ roomCode, item, clues }) => {
        const game = games[roomCode];
        if (game && game.players[socket.id].role === 'Collector') {
            game.stolenItem = item;
            game.stolenItemClues = clues;
            const initialClue = `Forensics found traces related to "${clues[0]}" at the crime scene.`;
            game.morningReport = [initialClue];
            game.dossier.push(initialClue);
            game.state = 'day';
            // Announce the start of Day 1
            io.to(roomCode).emit('dayStarted', {
                day: game.day,
                stolenItem: game.stolenItem,
                morningReport: game.morningReport
            });
        }
    });

    socket.on('submitNightAction', ({ roomCode, targetId }) => {
        const game = games[roomCode];
        const player = game.players[socket.id];
        if (!game || !player || game.state !== 'night') return;
        let nightAction = { actorId: socket.id, actorRole: player.role, targetId: targetId };
        // Generate lies only if a target is selected
        if (player.role === 'Thief' && targetId) {
            const target = game.players[targetId];
            nightAction.lie = `A strange piece of evidence points to someone with a hobby of ${target.profile.hobby}.`;
        } else if (player.role === 'Fencer' && targetId) {
            const target = game.players[targetId];
            nightAction.lie = `A whisper on the street implicates someone whose occupation is a ${target.profile.occupation}.`;
        }
        game.nightActions.push(nightAction);
        socket.emit('actionConfirmed');
        const playersWithNightActions = Object.values(game.players).filter(p => ['Thief', 'Fencer', 'Detective', 'Collector'].includes(p.role) && !p.disconnected && p.isAlive);
        if (game.nightActions.length >= playersWithNightActions.length) {
            processNight(roomCode);
        }
    });
    
    socket.on('endDay', (roomCode) => {
        const game = games[roomCode];
        if (game && (game.hostId === socket.id || game.day > 4) && game.state === 'day') {
            game.state = 'night';
            io.to(roomCode).emit('nightStarted', { day: game.day });
        }
    });

    socket.on('startVote', (roomCode) => {
        const game = games[roomCode];
        if (game && game.hostId === socket.id) { 
            game.state = 'vote'; 
            io.to(roomCode).emit('voteStarted'); 
        }
    });

    socket.on('submitVote', ({ roomCode, votedPlayerId }) => {
        const game = games[roomCode];
        if (game && game.state === 'vote' && game.players[socket.id]) {
            game.votes[socket.id] = votedPlayerId;
            socket.emit('voteConfirmed');
            const activePlayers = Object.values(game.players).filter(p => !p.disconnected && p.isAlive);
            if (Object.keys(game.votes).length >= activePlayers.length) {
                endGame(roomCode);
            }
        }
    });

    socket.on('playAgain', (roomCode) => {
        const game = games[roomCode];
        if (game && game.hostId === socket.id) {
            const oldPlayers = game.players;
            const newGame = {
                 ...games[roomCode], 
                 state: 'lobby', day: 1, stolenItem: null, stolenItemClues: [], 
                 nightActions: [], votes: {}, dossier: [], morningReport: [] 
            };
            Object.values(newGame.players).forEach(p => { p.role = null; p.team = null; });
            games[roomCode] = newGame;
            io.to(roomCode).emit('gameReset', newGame);
        }
    });

    socket.on('disconnect', () => {
        console.log('A user disconnected:', socket.id);
        for (const roomCode in games) {
            const game = games[roomCode];
            if (game.players[socket.id]) {
                const player = game.players[socket.id];
                player.disconnected = true;
                let newHostId = game.hostId;

                if (game.hostId === socket.id) {
                    const activePlayers = Object.values(game.players).filter(p => !p.disconnected);
                    if (activePlayers.length > 0) {
                        newHostId = activePlayers[0].id;
                        game.hostId = newHostId;
                    } else {
                        delete games[roomCode];
                        return; // Game is over, no need to update
                    }
                }
                io.to(roomCode).emit('playerDisconnected', { playerId: socket.id, newHostId });
                break;
            }
        }
    });

    function processNight(roomCode) {
        const game = games[roomCode];
        if (!game) return;
        // Private message logic remains the same
        const detectiveAction = game.nightActions.find(a => a.actorRole === 'Detective' && a.targetId);
        if (detectiveAction) {
            const targetPlayer = game.players[detectiveAction.targetId];
            let message = `You tailed ${targetPlayer.name}. `;
            if (targetPlayer.role === 'Collector') { message += 'Nothing eventful seemed to occur.';
            } else {
                const targetAction = game.nightActions.find(a => a.actorId === detectiveAction.targetId && (a.actorRole === 'Thief' || a.actorRole === 'Fencer') && a.targetId);
                message += targetAction ? 'They made a suspicious move last night!' : 'They laid low last night.';
            }
            io.to(detectiveAction.actorId).emit('privateMessage', message);
        }
        const collectorAction = game.nightActions.find(a => a.actorRole === 'Collector' && a.targetId);
        if (collectorAction) {
            const clueForNextDay = game.stolenItemClues[game.day] || game.stolenItemClues[0];
            const message = `You sent a secret tip to ${game.players[collectorAction.targetId].name} regarding: "${clueForNextDay}".`;
            const recipientMessage = `The Collector sent you a secret tip! A true detail is: "${clueForNextDay}".`;
            io.to(collectorAction.actorId).emit('privateMessage', message);
            io.to(collectorAction.targetId).emit('privateMessage', recipientMessage);
        }
        
        game.day++;
        if (game.day > 4) {
            game.state = 'vote';
            io.to(roomCode).emit('voteStarted');
        } else {
            game.state = 'day';
            game.morningReport = createMorningReport(game);
            io.to(roomCode).emit('dayStarted', {
                day: game.day,
                morningReport: game.morningReport
            });
        }
        game.nightActions = [];
        game.votes = {};
    }

    function endGame(roomCode) {
        const game = games[roomCode];
        if (!game) return;
        game.state = 'end';
        const voteCounts = {};
        Object.values(game.votes).forEach(votedId => { voteCounts[votedId] = (voteCounts[votedId] || 0) + 1; });
        let maxVotes = 0, votedOutId = null, isTie = false;
        for (const playerId in voteCounts) {
            if (voteCounts[playerId] > maxVotes) {
                maxVotes = voteCounts[playerId];
                votedOutId = playerId;
                isTie = false;
            } else if (voteCounts[playerId] === maxVotes) {
                isTie = true;
            }
        }
        const votedOutPlayer = votedOutId ? game.players[votedOutId] : null;

        // FIXED: Correct winner logic based on TEAM
        let winner = 'Bad Team'; // Default winner
        if (isTie) {
            winner = 'Bad Team'; // Bad team wins on a tie
        } else if (votedOutPlayer && votedOutPlayer.team === 'Bad') {
            winner = 'Good Team'; // Good team wins if they vote out any bad player
        }

        const allClues = `The stolen item was: ${game.stolenItem}. The true clues were: ${game.stolenItemClues.join(', ')}.`;
        const result = { winner, votedOutPlayer, isTie, allClues, players: Object.values(game.players) };
        io.to(roomCode).emit('gameOver', result);
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));