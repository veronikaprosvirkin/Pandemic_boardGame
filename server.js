const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public')); 

let cities = JSON.parse(fs.readFileSync('cities.json', 'utf8'));

let gameState = {
    status: 'LOBBY',
    players: {},
    turnOrder: [],
    currentTurnIndex: 0,
    actionsLeft: 4,
    infectionRateIndex: 0,
    infectionRate: 2,      
    outbreaks: 0,
    infections: {},
    quietNight: false
};

let infectionDeck = [];
let infectionDiscard = [];
let playerDeck = []; 

const roles = ["Медик", "Вчений", "Диспетчер", "Дослідник", "Фахівець із карантину", "Інженер"];
const EVENT_CARDS = [
    'EVENT_ONE_QUIET_NIGHT',
    'EVENT_GOVERNMENT_GRANT',
    'EVENT_AIRLIFT',
    'EVENT_RESILIENT_POPULATION',
    'EVENT_FORECAST'
];

let pendingEvent = null;
const socketMap = {};

function isCityCard(cardName) {
    return Boolean(cities[cardName]);
}

function removeCardFromHand(player, cardName) {
    const index = player.cards.indexOf(cardName);
    if (index === -1) return false;
    player.cards.splice(index, 1);
    return true;
}

function getPlayerIdForSocket(socket) {
    return socketMap[socket.id] || null;
}

function getPlayerForSocket(socket) {
    const playerId = getPlayerIdForSocket(socket);
    return {
        playerId,
        player: playerId ? gameState.players[playerId] || null : null
    };
}

function bindSocketToPlayer(socket, playerId) {
    socketMap[socket.id] = playerId;
    if (gameState.players[playerId]) {
        gameState.players[playerId].currentSocketId = socket.id;
    }
}

function emitToPlayer(playerId, eventName, payload) {
    const player = gameState.players[playerId];
    if (player && player.currentSocketId) {
        io.to(player.currentSocketId).emit(eventName, payload);
    }
}

function ensureCityInfections(cityName) {
    const value = gameState.infections[cityName];
    if (!value || typeof value !== 'object') {
        gameState.infections[cityName] = {};
    }
    return gameState.infections[cityName];
}

io.on('connection', (socket) => {
    console.log(`Гравець підключився: ${socket.id}`);

    socket.on('register_player', (playerId) => {
        if (!playerId) return;

        bindSocketToPlayer(socket, playerId);

        const existingPlayer = gameState.players[playerId];

        if (gameState.status === 'LOBBY') {
            if (!existingPlayer) {
                gameState.players[playerId] = {
                    id: playerId,
                    currentSocketId: socket.id,
                    isReady: false,
                    name: `Гравець ${Object.keys(gameState.players).length + 1}`,
                    role: null,
                    city: null,
                    cards: []
                };
            } else {
                existingPlayer.currentSocketId = socket.id;
            }

            io.emit('lobby_update', gameState.players);
            return;
        }

        if (gameState.status === 'PLAYING') {
            if (!existingPlayer) {
                socket.emit('game_already_started');
                return;
            }

            existingPlayer.currentSocketId = socket.id;
            socket.emit('game_started', { cities, gameState });
            socket.emit('state_update', gameState);

            // НОВЕ: Відновлення вікна події, якщо гравець оновив сторінку!
            if (pendingEvent && pendingEvent.playerId === playerId) {
                if (pendingEvent.type === 'forecast') {
                    socket.emit('forecast_ready', { eventCard: pendingEvent.eventCard, cards: pendingEvent.cards });
                } else if (pendingEvent.type === 'resilient_population') {
                    socket.emit('resilient_population_ready', { eventCard: pendingEvent.eventCard, discardCards: [...infectionDiscard] });
                }
            }
            return;
        }

        if (existingPlayer) {
            existingPlayer.currentSocketId = socket.id;
            socket.emit('lobby_update', gameState.players);
            return;
        }

        socket.emit('lobby_update', gameState.players);
    });

    socket.on('player_ready', () => {
        const { playerId, player } = getPlayerForSocket(socket);
        if (playerId && player) {
            gameState.players[playerId].isReady = true;
            io.emit('lobby_update', gameState.players);
            checkGameStart();
        }
    });

    function checkGameStart() {
        const playersArr = Object.values(gameState.players);
        
        if (playersArr.length >= 2 && playersArr.every(p => p.isReady === true)) {
            console.log("УСІ ГОТОВІ! ПОЧИНАЄМО ГРУ!");
            gameState.status = 'PLAYING';
            
            gameState.turnOrder = []; 
            gameState.currentTurnIndex = 0;
            gameState.actionsLeft = 4;
            gameState.outbreaks = 0;
            gameState.infectionRateIndex = 0;
            gameState.infectionRate = 2;
            gameState.researchStations = ["Atlanta"]; 
            gameState.cured = {}; 
            gameState.eradicated = {}; // НОВЕ: Знищені хвороби
            gameState.quietNight = false;
            pendingEvent = null;

            let availableRoles = [...roles];
            playersArr.forEach(p => {
                const roleIndex = Math.floor(Math.random() * availableRoles.length);
                p.role = availableRoles.splice(roleIndex, 1)[0];
                p.city = "Atlanta"; 
                p.cards = [];
                gameState.turnOrder.push(p.id); 
            });

            gameState.infections = {}; 
            infectionDeck = Object.keys(cities); 
            infectionDiscard = [];

            for (let i = infectionDeck.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [infectionDeck[i], infectionDeck[j]] = [infectionDeck[j], infectionDeck[i]];
            }

            function initialInfect(amountOfCities, cubesToPlace) {
                for (let i = 0; i < amountOfCities; i++) {
                    if (infectionDeck.length > 0) {
                        const city = infectionDeck.pop();
                        const nativeColor = cities[city].color;
                        const cityInfections = ensureCityInfections(city);
                        cityInfections[nativeColor] = (cityInfections[nativeColor] || 0) + cubesToPlace;
                        infectionDiscard.push(city);
                    }
                }
            }

            initialInfect(3, 3);
            initialInfect(3, 2);
            initialInfect(3, 1);

            let initialPlayerDeck = [...Object.keys(cities), ...EVENT_CARDS]; 
            for (let i = initialPlayerDeck.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [initialPlayerDeck[i], initialPlayerDeck[j]] = [initialPlayerDeck[j], initialPlayerDeck[i]];
            }
            
            let initialCards = 2;
            if (playersArr.length === 2) initialCards = 4;
            if (playersArr.length === 3) initialCards = 3;

            playersArr.forEach(p => {
                for(let i = 0; i < initialCards; i++) {
                    if(initialPlayerDeck.length > 0) p.cards.push(initialPlayerDeck.pop());
                }
            });

            const numEpidemics = 4;
            const piles = Array.from({ length: numEpidemics }, () => []);
            initialPlayerDeck.forEach((card, index) => {
                piles[index % numEpidemics].push(card);
            });

            playerDeck = [];
            for (let i = piles.length - 1; i >= 0; i--) {
                let pile = piles[i];
                pile.push("ЕПІДЕМІЯ");
                for (let k = pile.length - 1; k > 0; k--) {
                    const j = Math.floor(Math.random() * (k + 1));
                    [pile[k], pile[j]] = [pile[j], pile[k]];
                }
                playerDeck = playerDeck.concat(pile); 
            }

            io.emit('game_started', { cities, gameState });
        }
    }

    // === ДОПОМІЖНІ ФУНКЦІЇ ДЛЯ ІДЕАЛЬНИХ ПРАВИЛ ===
    function triggerGameOver(win, reason) {
        if (gameState.status === 'GAME_OVER') return;
        gameState.status = 'GAME_OVER';
        io.emit('game_over', { win, reason });
    }

    function isQuarantined(city) {
        for (let p of Object.values(gameState.players)) {
            if (p.role === "Фахівець із карантину") {
                if (p.city === city || (cities[p.city] && cities[p.city].connections.includes(city))) {
                    return true;
                }
            }
        }
        return false;
    }

    function getCubesCount(color) {
        let count = 0;
        for (const cityInfections of Object.values(gameState.infections)) {
            if (cityInfections && typeof cityInfections === 'object') {
                count += cityInfections[color] || 0;
            }
        }
        return count;
    }

    function checkEradication() {
        if (!gameState.cured) return;
        for (let color of Object.keys(gameState.cured)) {
            if (gameState.cured[color] && !gameState.eradicated[color]) {
                if (getCubesCount(color) === 0) {
                    gameState.eradicated[color] = true;
                    io.emit('disease_eradicated', color);
                }
            }
        }
    }

    // ГОЛОВНИЙ ДВИГУН ЗАРАЖЕННЯ (З Ланцюговими спалахами)
    // ГОЛОВНИЙ ДВИГУН ЗАРАЖЕННЯ (З Ланцюговими спалахами)
    function infectCity(cityName, amount, outbrokenCities = new Set(), diseaseColor = null) {
        if (gameState.status === 'GAME_OVER') return;
        if (!cities[cityName]) return;
        const color = diseaseColor || cities[cityName].color;

        // Якщо хворобу повністю знищено - ігноруємо зараження!
        if (gameState.eradicated && gameState.eradicated[color]) return;

        // Захист Карантину
        if (isQuarantined(cityName)) return;

        if (gameState.cured && gameState.cured[color]) {
            let medicHere = false;
            for (let p of Object.values(gameState.players)) {
                if (p.role === "Медик" && p.city === cityName) medicHere = true;
            }
            if (medicHere) return; // Медик блокує інфекцію
        }

        const cityInfections = ensureCityInfections(cityName);
        if (!cityInfections[color]) cityInfections[color] = 0;

        for (let i = 0; i < amount; i++) {
            if (cityInfections[color] >= 3) {
                // СПАЛАХ!
                if (!outbrokenCities.has(cityName)) {
                    gameState.outbreaks++;
                    outbrokenCities.add(cityName);
                    console.log(`💥 СПАЛАХ у місті ${cityName}!`);
                    
                    if (gameState.outbreaks >= 8) {
                        triggerGameOver(false, 'СВІТ ЗАГИНУВ... Досягнуто критичний рівень (8 спалахів).');
                        return;
                    }

                    // Ланцюгова реакція: по 1 кубику в усі сусідні міста!
                    cities[cityName].connections.forEach(neighbor => {
                        infectCity(neighbor, 1, outbrokenCities, color);
                    });
                }
                break; // Більше кубиків у ЦЕ місто не кладемо
            } else {
                // Перевірка на ліміт кубиків (24)
                if (getCubesCount(color) >= 24) {
                    triggerGameOver(false, `СВІТ ЗАГИНУВ... Закінчилися кубики хвороби (колір: ${color}).`);
                    return;
                }
                cityInfections[color]++;
            }
        }
    }

    // === ДІЇ ГРАВЦІВ ===
    socket.on('move_player', (data) => {
                    const playerId = getPlayerIdForSocket(socket);
                    const player = playerId ? gameState.players[playerId] : null;
                    const targetCity = typeof data === 'object' ? data.targetCity : data;
                    const pawnId = typeof data === 'object' && data.pawnId ? data.pawnId : playerId;
                    const discardCard = typeof data === 'object' ? data.discardCard : null;
                    const specialFlight = typeof data === 'object' ? data.specialFlight === true : false;

                    if (gameState.status !== 'PLAYING') return;
                    if (!playerId || !player) return;
                    if (gameState.turnOrder[gameState.currentTurnIndex] !== playerId) return;
                    if (gameState.actionsLeft <= 0) return;
                    if (pendingEvent && pendingEvent.playerId === playerId) return;

                    const isDispatcher = (player.role === "Диспетчер");
                    if (pawnId !== playerId && !isDispatcher) return;

                    const movingPlayer = gameState.players[pawnId];
                    if (!movingPlayer) return;

                    const currentCity = cities[movingPlayer.city];
                    let moved = false;

                    if (
                        specialFlight &&
                        player.role === "Інженер" &&
                        movingPlayer.id === playerId &&
                        gameState.researchStations.includes(movingPlayer.city) &&
                        isCityCard(discardCard) &&
                        player.cards.includes(discardCard) &&
                        cities[targetCity]
                    ) {
                        removeCardFromHand(player, discardCard);
                        moved = true;
                    }

                    if (!moved && currentCity && currentCity.connections.includes(targetCity)) {
                        moved = true;
                    } else if (!moved && isDispatcher && Object.values(gameState.players).some(p => p.city === targetCity && p.id !== movingPlayer.id)) {
                        moved = true;
                    } else if (!moved && player.cards.includes(targetCity)) {
                        removeCardFromHand(player, targetCity);
                        moved = true;
                    } else if (!moved && player.cards.includes(movingPlayer.city)) {
                        removeCardFromHand(player, movingPlayer.city);
                        moved = true;
                    } else if (!moved && gameState.researchStations.includes(movingPlayer.city) && gameState.researchStations.includes(targetCity)) {
                        moved = true;
                    }

                    if (moved) {
                        movingPlayer.city = targetCity;
                        gameState.actionsLeft--;

                        if (movingPlayer.role === "Медик") {
                            const cityInfections = ensureCityInfections(movingPlayer.city);
                            let removedAny = false;
                            for (const [cubeColor, count] of Object.entries(cityInfections)) {
                                if (count > 0 && gameState.cured && gameState.cured[cubeColor]) {
                                    delete cityInfections[cubeColor];
                                    removedAny = true;
                                }
                            }
                            if (removedAny) {
                                checkEradication();
                            }
                        }

                        io.emit('state_update', gameState);
                    }
                });

                socket.on('treat_disease', (data = {}) => {
                    const playerId = getPlayerIdForSocket(socket);
                    const player = playerId ? gameState.players[playerId] : null;
                    if (gameState.status !== 'PLAYING') return;
                    if (!playerId || !player) return;
                    if (gameState.turnOrder[gameState.currentTurnIndex] !== playerId) return;
                    if (gameState.actionsLeft <= 0) return;
                    if (pendingEvent && pendingEvent.playerId === playerId) return;

                    const city = player.city;
                    const cityInfections = ensureCityInfections(city);
                    const targetColor = data.targetColor;
                    if (!targetColor || !cityInfections[targetColor] || cityInfections[targetColor] <= 0) return;

                    if (player.role === "Медик" || (gameState.cured && gameState.cured[targetColor])) {
                        cityInfections[targetColor] = 0;
                    } else {
                        cityInfections[targetColor] -= 1;
                    }

                    if (cityInfections[targetColor] <= 0) {
                        delete cityInfections[targetColor];
                    }

                    gameState.actionsLeft--;
                    checkEradication();
                    io.emit('state_update', gameState);
                });

                socket.on('share_knowledge', ({ action, targetId, cardCity }) => {
                    const playerId = getPlayerIdForSocket(socket);
                    const player = playerId ? gameState.players[playerId] : null;
                    if (gameState.status !== 'PLAYING') return;
                    if (!playerId || !player) return;
                    if (gameState.turnOrder[gameState.currentTurnIndex] !== playerId) return;
                    if (gameState.actionsLeft <= 0) return;
                    if (pendingEvent && pendingEvent.playerId === playerId) return;

                    const p1 = player;
                    const p2 = gameState.players[targetId];

                    if (!p1 || !p2 || p1.city !== p2.city) return;

                    if (action === 'give') {
                        const idx = p1.cards.indexOf(cardCity);
                        if (idx !== -1) {
                            p1.cards.splice(idx, 1);
                            p2.cards.push(cardCity);
                            gameState.actionsLeft--;
                        }
                    } else if (action === 'take') {
                        const idx = p2.cards.indexOf(cardCity);
                        if (idx !== -1) {
                            p2.cards.splice(idx, 1);
                            p1.cards.push(cardCity);
                            gameState.actionsLeft--;
                        }
                    }
                    io.emit('state_update', gameState);
                });

                socket.on('play_event_card', (data) => {
                    const playerId = getPlayerIdForSocket(socket);
                    const player = playerId ? gameState.players[playerId] : null;
                    if (gameState.status !== 'PLAYING') return;
                    if (!playerId || !player) return;
                    if (gameState.turnOrder[gameState.currentTurnIndex] !== playerId) return;
                    if (pendingEvent && pendingEvent.playerId === playerId) return;

                    const eventCard = typeof data === 'object' ? data.eventCard : data;
                    const mode = typeof data === 'object' && data.mode ? data.mode : 'play';

                    if (!player.cards.includes(eventCard)) return;

                    if (mode === 'preview') {
                        if (eventCard === 'EVENT_FORECAST') {
                            const previewCards = [];
                            for (let i = 0; i < 6 && infectionDeck.length > 0; i++) {
                                previewCards.push(infectionDeck.pop());
                            }

                            if (previewCards.length === 0) return;

                            removeCardFromHand(player, eventCard);
                            pendingEvent = {
                                playerId,
                                eventCard,
                                type: 'forecast',
                                cards: previewCards
                            };

                            emitToPlayer(playerId, 'forecast_ready', { eventCard, cards: previewCards });
                            io.emit('state_update', gameState);
                            return;
                        }

                        if (eventCard === 'EVENT_RESILIENT_POPULATION') {
                            if (!infectionDiscard || infectionDiscard.length === 0) return;

                            removeCardFromHand(player, eventCard);
                            pendingEvent = {
                                playerId,
                                eventCard,
                                type: 'resilient_population'
                            };

                            emitToPlayer(playerId, 'resilient_population_ready', {
                                eventCard,
                                discardCards: [...infectionDiscard]
                            });
                            io.emit('state_update', gameState);
                            return;
                        }

                        return;
                    }

                    if (eventCard === 'EVENT_ONE_QUIET_NIGHT') {
                        removeCardFromHand(player, eventCard);
                        gameState.quietNight = true;
                        io.emit('state_update', gameState);
                        return;
                    }

                    if (eventCard === 'EVENT_GOVERNMENT_GRANT') {
                        const targetCity = typeof data === 'object' ? data.targetCity : null;
                        if (!cities[targetCity]) return;
                        if (gameState.researchStations.includes(targetCity)) return;
                        if (gameState.researchStations.length >= 6) {
                            socket.emit('max_stations_reached');
                            return;
                        }

                        removeCardFromHand(player, eventCard);
                        gameState.researchStations.push(targetCity);
                        io.emit('state_update', gameState);
                        return;
                    }

                    if (eventCard === 'EVENT_AIRLIFT') {
                        const targetPlayerId = typeof data === 'object' ? data.targetPlayerId : null;
                        const targetCity = typeof data === 'object' ? data.targetCity : null;
                        const targetPlayer = gameState.players[targetPlayerId];

                        if (!targetPlayer || !cities[targetCity]) return;

                        removeCardFromHand(player, eventCard);
                        targetPlayer.city = targetCity;
                        io.emit('state_update', gameState);
                        return;
                    }
                });

                socket.on('resolve_event_card', (data) => {
                    const playerId = getPlayerIdForSocket(socket);
                    const player = playerId ? gameState.players[playerId] : null;
                    if (!pendingEvent || pendingEvent.playerId !== playerId) return;
                    if (!player) return;

                    if (pendingEvent.type === 'forecast') {
                        const orderedCards = Array.isArray(data.orderedCards) ? data.orderedCards : [];
                        if (orderedCards.length !== pendingEvent.cards.length) return;

                        const pendingSorted = [...pendingEvent.cards].sort().join('|');
                        const orderedSorted = [...orderedCards].sort().join('|');
                        if (pendingSorted !== orderedSorted) return;

                        for (let i = orderedCards.length - 1; i >= 0; i--) {
                            infectionDeck.push(orderedCards[i]);
                        }
                        pendingEvent = null;
                        io.emit('state_update', gameState);
                        return;
                    }

                    if (pendingEvent.type === 'resilient_population') {
                        const selectedCard = data.selectedCard;
                        const index = infectionDiscard.indexOf(selectedCard);
                        if (index === -1) return;

                        infectionDiscard.splice(index, 1);
                        pendingEvent = null;
                        io.emit('state_update', gameState);
                        return;
                    }
                });

                socket.on('cancel_pending_event', () => {
                    const playerId = getPlayerIdForSocket(socket);
                    const player = playerId ? gameState.players[playerId] : null;
                    if (!pendingEvent || pendingEvent.playerId !== playerId) return;
                    if (!player) return;

                    player.cards.push(pendingEvent.eventCard);

                    if (pendingEvent.type === 'forecast' && Array.isArray(pendingEvent.cards)) {
                        for (let i = pendingEvent.cards.length - 1; i >= 0; i--) {
                            infectionDeck.push(pendingEvent.cards[i]);
                        }
                    }

                    pendingEvent = null;
                    io.emit('state_update', gameState);
                });

                // === КІНЕЦЬ ХОДУ ТА ЕПІДЕМІЇ ===
                socket.on('end_turn', () => {
                    const playerId = getPlayerIdForSocket(socket);
                    const player = playerId ? gameState.players[playerId] : null;
                    if (gameState.status !== 'PLAYING') return;
                    if (!playerId || !player) return;
                    if (gameState.turnOrder[gameState.currentTurnIndex] !== playerId) return;
                    if (pendingEvent && pendingEvent.playerId === playerId) return;

                    if (!player.cards) player.cards = [];
                    const drawnCards = [];
                    let epidemicsDrawn = 0;

                    for (let i = 0; i < 2; i++) {
                        if (playerDeck.length > 0) {
                            const card = playerDeck.pop();
                            if (card === "ЕПІДЕМІЯ") {
                                epidemicsDrawn++;
                            } else {
                                player.cards.push(card);
                                drawnCards.push(card);
                            }
                        } else {
                            triggerGameOver(false, 'СВІТ ЗАГИНУВ... У вас закінчився час (порожня колода гравців).');
                            return;
                        }
                    }
                    if (drawnCards.length > 0) emitToPlayer(playerId, 'cards_drawn', drawnCards);

                    for (let e = 0; e < epidemicsDrawn; e++) {
                        gameState.infectionRateIndex++;
                        const rates = [2, 2, 2, 3, 3, 4, 4];
                        gameState.infectionRate = rates[Math.min(gameState.infectionRateIndex, rates.length - 1)];

                        if (infectionDeck.length > 0) {
                            const bottomCity = infectionDeck.shift();
                            infectionDiscard.push(bottomCity);

                            infectCity(bottomCity, 3, new Set());
                            io.emit('epidemic_alert', bottomCity);
                        }

                        for (let i = infectionDiscard.length - 1; i > 0; i--) {
                            const j = Math.floor(Math.random() * (i + 1));
                            [infectionDiscard[i], infectionDiscard[j]] = [infectionDiscard[j], infectionDiscard[i]];
                        }
                        infectionDeck = infectionDeck.concat(infectionDiscard);
                        infectionDiscard = [];
                    }

                    const infectedCitiesThisTurn = [];
                    if (gameState.quietNight) {
                        gameState.quietNight = false;
                        io.emit('quiet_night_skipped');
                    } else {
                        for (let i = 0; i < gameState.infectionRate; i++) {
                            if (infectionDeck.length > 0) {
                                const infectedCity = infectionDeck.pop();
                                infectionDiscard.push(infectedCity);
                                infectCity(infectedCity, 1, new Set());
                                infectedCitiesThisTurn.push(infectedCity);
                            }
                        }
                    }

                    if (infectedCitiesThisTurn.length > 0) {
                        io.emit('infection_drawn', infectedCitiesThisTurn);
                    }

                    gameState.currentTurnIndex = (gameState.currentTurnIndex + 1) % gameState.turnOrder.length;
                    gameState.actionsLeft = 4;
                    io.emit('state_update', gameState);
                });

    socket.on('build_station', () => {
        const playerId = getPlayerIdForSocket(socket);
        const player = playerId ? gameState.players[playerId] : null;
        if (gameState.status !== 'PLAYING') return;
        if (!playerId || !player) return;
        if (gameState.turnOrder[gameState.currentTurnIndex] !== playerId) return;
        if (gameState.actionsLeft <= 0) return;
        if (pendingEvent && pendingEvent.playerId === playerId) return;

        if (!gameState.researchStations.includes(player.city)) {
            if (gameState.researchStations.length >= 6) {
                socket.emit('max_stations_reached');
                return;
            }

            let canBuild = false;

            if (player.role === "Інженер") {
                canBuild = true;
            } else if (player.cards.includes(player.city)) {
                player.cards.splice(player.cards.indexOf(player.city), 1);
                canBuild = true;
            }

            if (canBuild) {
                gameState.researchStations.push(player.city);
                gameState.actionsLeft--;
                io.emit('state_update', gameState);
            }
        }
    });

    socket.on('discover_cure', () => {
        const playerId = getPlayerIdForSocket(socket);
        const player = playerId ? gameState.players[playerId] : null;
        if (gameState.status !== 'PLAYING') return;
        if (!playerId || !player) return;
        if (gameState.turnOrder[gameState.currentTurnIndex] !== playerId) return;
        if (gameState.actionsLeft <= 0) return;
        if (pendingEvent && pendingEvent.playerId === playerId) return;

        if (!gameState.researchStations.includes(player.city)) return;

        const needed = player.role === "Вчений" ? 4 : 5;
        const cardsByColor = {};

        player.cards.forEach(card => {
            if (cities[card]) {
                const color = cities[card].color;
                if (!cardsByColor[color]) cardsByColor[color] = [];
                cardsByColor[color].push(card);
            }
        });

        if (!gameState.cured) gameState.cured = {};

        for (const [color, cityCards] of Object.entries(cardsByColor)) {
            if (cityCards.length >= needed && !gameState.cured[color]) {
                gameState.cured[color] = true;

                for (let p of Object.values(gameState.players)) {
                    if (p.role === "Медик") {
                        const medicInfections = ensureCityInfections(p.city);
                        if (medicInfections[color] > 0) {
                            delete medicInfections[color];
                        }
                    }
                }

                for (let i = 0; i < needed; i++) {
                    const cardToRemove = cityCards[i];
                    player.cards.splice(player.cards.indexOf(cardToRemove), 1);
                }

                gameState.actionsLeft--;
                checkEradication();
                io.emit('state_update', gameState);
                io.emit('cure_discovered', color);

                if (Object.keys(gameState.cured).length >= 4) {
                    triggerGameOver(true, 'ЛЮДСТВО ВРЯТОВАНО! Винайдено всі 4 вакцини!');
                }
                return;
            }
        }
    });

    socket.on('discard_card', (cardName) => {
        const playerId = getPlayerIdForSocket(socket);
        const player = playerId ? gameState.players[playerId] : null;
        if (player && player.cards.length > 7) {
            const idx = player.cards.indexOf(cardName);
            if (idx !== -1) {
                player.cards.splice(idx, 1);
                io.emit('state_update', gameState);
            }
        }
    });

    socket.on('disconnect', () => {
        const playerId = socketMap[socket.id];
        console.log(`Гравець відключився: ${socket.id}`);
        if (!playerId) {
            delete socketMap[socket.id];
            return;
        }

        const player = gameState.players[playerId];
        if (gameState.status === 'LOBBY') {
            delete gameState.players[playerId];
            io.emit('lobby_update', gameState.players);
        } else if (player) {
            player.currentSocketId = null;
            io.emit('state_update', gameState);
        }

        delete socketMap[socket.id];
    });
});

server.listen(3000, () => {
    console.log('Сервер гри запущено на http://localhost:3000');
});