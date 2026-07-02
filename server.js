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
    infections: {} 
};

let infectionDeck = [];
let infectionDiscard = [];
let playerDeck = []; 

const roles = ["Медик", "Вчений", "Диспетчер", "Дослідник", "Фахівець із карантину", "Інженер"];

io.on('connection', (socket) => {
    console.log(`Гравець підключився: ${socket.id}`);

    if (gameState.status === 'PLAYING') {
        socket.emit('game_already_started');
        return;
    }

    gameState.players[socket.id] = {
        id: socket.id,
        isReady: false,
        name: `Гравець ${Object.keys(gameState.players).length + 1}`,
        role: null,
        city: null,
        cards: []
    };

    io.emit('lobby_update', gameState.players);

    socket.on('player_ready', () => {
        if (gameState.players[socket.id]) {
            gameState.players[socket.id].isReady = true;
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
                        gameState.infections[city] = cubesToPlace;
                        infectionDiscard.push(city);
                    }
                }
            }

            initialInfect(3, 3);
            initialInfect(3, 2);
            initialInfect(3, 1);

            let initialPlayerDeck = Object.keys(cities); 
            for (let i = initialPlayerDeck.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [initialPlayerDeck[i], initialPlayerDeck[j]] = [initialPlayerDeck[j], initialPlayerDeck[i]];
            }

            playersArr.forEach(p => {
                for(let i = 0; i < 2; i++) {
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
        for (let city in gameState.infections) {
            if (cities[city] && cities[city].color === color) {
                count += gameState.infections[city];
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
    function infectCity(cityName, amount, outbrokenCities = new Set()) {
        if (gameState.status === 'GAME_OVER') return;
        if (!cities[cityName]) return;
        const color = cities[cityName].color;

        // Якщо хворобу повністю знищено - ігноруємо зараження!
        if (gameState.eradicated && gameState.eradicated[color]) return;

        // Захист Карантину
        if (isQuarantined(cityName)) return;

        if (gameState.infections[cityName] === undefined) {
            gameState.infections[cityName] = 0;
        }

        for (let i = 0; i < amount; i++) {
            if (gameState.infections[cityName] >= 3) {
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
                        infectCity(neighbor, 1, outbrokenCities);
                    });
                }
                break; // Більше кубиків у ЦЕ місто не кладемо
            } else {
                // Перевірка на ліміт кубиків (24)
                if (getCubesCount(color) >= 24) {
                    triggerGameOver(false, `СВІТ ЗАГИНУВ... Закінчилися кубики хвороби (колір: ${color}).`);
                    return;
                }
                gameState.infections[cityName]++;
            }
        }
    }

    // === ДІЇ ГРАВЦІВ ===
    socket.on('move_player', (data) => {
        const targetCity = typeof data === 'object' ? data.targetCity : data;
        const pawnId = typeof data === 'object' && data.pawnId ? data.pawnId : socket.id;

        if (gameState.status !== 'PLAYING') return;
        if (gameState.turnOrder[gameState.currentTurnIndex] !== socket.id) return;
        if (gameState.actionsLeft <= 0) return;

        const player = gameState.players[socket.id];
        if (player.cards.length > 7) return;

        const isDispatcher = (player.role === "Диспетчер");
        if (pawnId !== socket.id && !isDispatcher) return; 

        const movingPlayer = gameState.players[pawnId];
        if (!movingPlayer) return;

        const currentCity = cities[movingPlayer.city];
        let moved = false;

        if (currentCity && currentCity.connections.includes(targetCity)) {
            moved = true;
        }
        else if (isDispatcher && Object.values(gameState.players).some(p => p.city === targetCity && p.id !== movingPlayer.id)) {
            moved = true;
        }
        else if (player.cards.includes(targetCity)) {
            player.cards.splice(player.cards.indexOf(targetCity), 1);
            moved = true;
        }
        else if (player.cards.includes(movingPlayer.city)) {
            player.cards.splice(player.cards.indexOf(movingPlayer.city), 1);
            moved = true;
        }
        else if (gameState.researchStations.includes(movingPlayer.city) && gameState.researchStations.includes(targetCity)) {
            moved = true;
        }

        if (moved) {
            movingPlayer.city = targetCity;
            gameState.actionsLeft--;

            if (movingPlayer.role === "Медик") {
                const cityColor = cities[movingPlayer.city].color;
                if (gameState.cured && gameState.cured[cityColor]) {
                    gameState.infections[movingPlayer.city] = 0;
                    checkEradication(); // Перевіряємо, чи не знищив він щойно хворобу
                }
            }
            io.emit('state_update', gameState); 
        }
    });

    socket.on('treat_disease', () => {
        if (gameState.status !== 'PLAYING') return;
        if (gameState.turnOrder[gameState.currentTurnIndex] !== socket.id) return;
        if (gameState.actionsLeft <= 0) return;

        const player = gameState.players[socket.id];
        const city = player.city;
        const cityColor = cities[city].color;

        if (gameState.infections[city] && gameState.infections[city] > 0) {
            if (player.role === "Медик" || (gameState.cured && gameState.cured[cityColor])) {
                gameState.infections[city] = 0;
            } else {
                gameState.infections[city] -= 1;
            }
            gameState.actionsLeft--;
            checkEradication(); // Перевіряємо, чи ми не знищили останній кубик!
            io.emit('state_update', gameState);
        }
    });

    socket.on('share_knowledge', ({ action, targetId, cardCity }) => {
        if (gameState.status !== 'PLAYING') return;
        if (gameState.turnOrder[gameState.currentTurnIndex] !== socket.id) return;
        if (gameState.actionsLeft <= 0) return;

        const p1 = gameState.players[socket.id];
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

    // === КІНЕЦЬ ХОДУ ТА ЕПІДЕМІЇ ===
    socket.on('end_turn', () => {
        if (gameState.status !== 'PLAYING') return;
        if (gameState.turnOrder[gameState.currentTurnIndex] === socket.id) {

            const player = gameState.players[socket.id];
            if (!player.cards) player.cards = []; 
            const drawnCards = [];
            let epidemicsDrawn = 0;

            for(let i = 0; i < 2; i++) {
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
            if (drawnCards.length > 0) io.to(socket.id).emit('cards_drawn', drawnCards);

            for (let e = 0; e < epidemicsDrawn; e++) {
                gameState.infectionRateIndex++;
                const rates = [2, 2, 2, 3, 3, 4, 4];
                gameState.infectionRate = rates[Math.min(gameState.infectionRateIndex, rates.length - 1)];

                if (infectionDeck.length > 0) {
                    const bottomCity = infectionDeck.shift(); 
                    infectionDiscard.push(bottomCity);
                    
                    // Використовуємо нову ідеальну функцію зараження (вона сама обробить Карантин, Спалахи і Знищення)
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
            for (let i = 0; i < gameState.infectionRate; i++) {
                if (infectionDeck.length > 0) {
                    const infectedCity = infectionDeck.pop();
                    infectionDiscard.push(infectedCity);
                    infectCity(infectedCity, 1, new Set());
                    infectedCitiesThisTurn.push(infectedCity); 
                }
            }
            
            if (infectedCitiesThisTurn.length > 0) {
                io.emit('infection_drawn', infectedCitiesThisTurn);
            }

            gameState.currentTurnIndex = (gameState.currentTurnIndex + 1) % gameState.turnOrder.length;
            gameState.actionsLeft = 4;
            io.emit('state_update', gameState);
        }
    });

    socket.on('build_station', () => {
        if (gameState.status !== 'PLAYING') return;
        if (gameState.turnOrder[gameState.currentTurnIndex] !== socket.id) return;
        if (gameState.actionsLeft <= 0) return;

        const player = gameState.players[socket.id];
        
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
        if (gameState.status !== 'PLAYING') return;
        if (gameState.turnOrder[gameState.currentTurnIndex] !== socket.id) return;
        if (gameState.actionsLeft <= 0) return;

        const player = gameState.players[socket.id];
        if (!gameState.researchStations.includes(player.city)) return;

        const needed = player.role === "Вчений" ? 4 : 5; 
        const cardsByColor = {};
        
        player.cards.forEach(city => {
            const color = cities[city].color;
            if (!cardsByColor[color]) cardsByColor[color] = [];
            cardsByColor[color].push(city);
        });

        if (!gameState.cured) gameState.cured = {};

        for (const [color, cityCards] of Object.entries(cardsByColor)) {
            if (cityCards.length >= needed && !gameState.cured[color]) {
                gameState.cured[color] = true;
                
                for (let i = 0; i < needed; i++) {
                    const cardToRemove = cityCards[i];
                    player.cards.splice(player.cards.indexOf(cardToRemove), 1);
                }

                gameState.actionsLeft--;
                checkEradication(); // Перевіряємо, чи немає кубиків цієї хвороби на полі
                io.emit('state_update', gameState);
                io.emit('cure_discovered', color); 
                
                // ПЕРЕМОГА: ЗІБРАНО 4 ВАКЦИНИ
                if (Object.keys(gameState.cured).length >= 4) {
                    triggerGameOver(true, 'ЛЮДСТВО ВРЯТОВАНО! Винайдено всі 4 вакцини!');
                }
                return;
            }
        }
    });

    socket.on('discard_card', (cardName) => {
        const player = gameState.players[socket.id];
        if (player && player.cards.length > 7) {
            const idx = player.cards.indexOf(cardName);
            if (idx !== -1) {
                player.cards.splice(idx, 1);
                io.emit('state_update', gameState);
            }
        }
    });

    socket.on('disconnect', () => {
        console.log(`Гравець відключився: ${socket.id}`);
        if (gameState.status === 'LOBBY') {
            delete gameState.players[socket.id];
            io.emit('lobby_update', gameState.players);
        } else {
            const index = gameState.turnOrder.indexOf(socket.id);
            if (index !== -1) {
                gameState.turnOrder.splice(index, 1);
                if (gameState.turnOrder.length === 0) {
                    gameState.status = 'LOBBY'; 
                    gameState.players = {};
                    gameState.currentTurnIndex = 0;
                } else if (index < gameState.currentTurnIndex) {
                    gameState.currentTurnIndex--;
                } else if (index === gameState.currentTurnIndex) {
                    if (gameState.turnOrder.length > 0) {
                        gameState.currentTurnIndex = gameState.currentTurnIndex % gameState.turnOrder.length;
                    } else {
                        gameState.currentTurnIndex = 0;
                    }
                    gameState.actionsLeft = 4;
                }
            }
            delete gameState.players[socket.id];
            io.emit('state_update', gameState);
        }
    });
});

server.listen(3000, () => {
    console.log('Сервер гри запущено на http://localhost:3000');
});