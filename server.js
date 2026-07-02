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
    infectionRateIndex: 0, // Індекс для масиву швидкості
    infectionRate: 2,      // Сама швидкість
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

            let availableRoles = [...roles];
            playersArr.forEach(p => {
                const roleIndex = Math.floor(Math.random() * availableRoles.length);
                p.role = availableRoles.splice(roleIndex, 1)[0];
                p.city = "Atlanta"; 
                p.cards = [];
                gameState.turnOrder.push(p.id); 
            });

            // === 1. ІНІЦІАЛІЗАЦІЯ ІНФЕКЦІЙ ===
            gameState.infections = {}; // Очищаємо всі інфекції
            infectionDeck = Object.keys(cities); // Створюємо колоду інфекцій
            infectionDiscard = [];

            // Перемішуємо колоду інфекцій
            for (let i = infectionDeck.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [infectionDeck[i], infectionDeck[j]] = [infectionDeck[j], infectionDeck[i]];
            }

            // Функція розкладання кубиків
            function infectCities(amountOfCities, cubesToPlace) {
                for (let i = 0; i < amountOfCities; i++) {
                    if (infectionDeck.length > 0) {
                        const city = infectionDeck.pop();
                        gameState.infections[city] = cubesToPlace;
                        infectionDiscard.push(city);
                        console.log(`Стартова інфекція: ${cubesToPlace} кубиків у ${city}`); // Додали лог для перевірки
                    }
                }
            }

            // Розкладаємо 9 стартових інфекцій (3 по 3, 3 по 2, 3 по 1)
            infectCities(3, 3);
            infectCities(3, 2);
            infectCities(3, 1);

            // === 2. ІНІЦІАЛІЗАЦІЯ КОЛОДИ ГРАВЦІВ (З ЕПІДЕМІЯМИ) ===
            let initialPlayerDeck = Object.keys(cities); 
            // Перемішуємо міста для роздачі гравцям
            for (let i = initialPlayerDeck.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [initialPlayerDeck[i], initialPlayerDeck[j]] = [initialPlayerDeck[j], initialPlayerDeck[i]];
            }

            // Роздаємо стартові карти гравцям (по 2 кожному)
            playersArr.forEach(p => {
                for(let i = 0; i < 2; i++) {
                    if(initialPlayerDeck.length > 0) p.cards.push(initialPlayerDeck.pop());
                }
            });

            // Ділимо залишок колоди на 4 стопки для Епідемій
            const numEpidemics = 4;
            const piles = Array.from({ length: numEpidemics }, () => []);
            initialPlayerDeck.forEach((card, index) => {
                piles[index % numEpidemics].push(card);
            });

            playerDeck = [];
            // Замішуємо Епідемії і збираємо колоду гравця
            for (let i = piles.length - 1; i >= 0; i--) {
                let pile = piles[i];
                pile.push("ЕПІДЕМІЯ");
                for (let k = pile.length - 1; k > 0; k--) {
                    const j = Math.floor(Math.random() * (k + 1));
                    [pile[k], pile[j]] = [pile[j], pile[k]];
                }
                playerDeck = playerDeck.concat(pile); 
            }

            // ВІДПРАВЛЯЄМО СТАН ГРИ ВСІМ
            io.emit('game_started', { cities, gameState });
        }
    }

    socket.on('move_player', (data) => {
        const targetCity = data.targetCity;
        const pawnId = data.pawnId || socket.id;

        if (gameState.status !== 'PLAYING') return;
        if (gameState.turnOrder[gameState.currentTurnIndex] !== socket.id) return;
        if (gameState.actionsLeft <= 0) return;

        const player = gameState.players[socket.id];
        if (player.cards.length > 7) return;

        const isDispatcher = (player.role === "Диспетчер");
        if (pawnId !== socket.id && !isDispatcher) return; // Тільки Диспетчер може рухати чужі фішки

        const movingPlayer = gameState.players[pawnId];
        if (!movingPlayer) return;

        const currentCity = cities[movingPlayer.city];
        let moved = false;

        // 1. Сусіднє місто
        if (currentCity && currentCity.connections.includes(targetCity)) {
            moved = true;
        }
        // 2. Спец-рух Диспетчера: перекинути фішку в будь-яке місто, де ВЖЕ Є інший гравець
        else if (isDispatcher && Object.values(gameState.players).some(p => p.city === targetCity && p.id !== movingPlayer.id)) {
            moved = true;
        }
        // 3. Прямий рейс (Диспетчер скидає СВОЮ карту, куди летить фішка)
        else if (player.cards.includes(targetCity)) {
            player.cards.splice(player.cards.indexOf(targetCity), 1);
            moved = true;
        }
        // 4. Чартерний рейс (Диспетчер скидає СВОЮ карту того міста, де стоїть керована фішка)
        else if (player.cards.includes(movingPlayer.city)) {
            player.cards.splice(player.cards.indexOf(movingPlayer.city), 1);
            moved = true;
        }
        // 5. Службовий рейс (між станціями)
        else if (gameState.researchStations.includes(movingPlayer.city) && gameState.researchStations.includes(targetCity)) {
            moved = true;
        }

        if (moved) {
            movingPlayer.city = targetCity;
            gameState.actionsLeft--;

            // Якщо диспетчер рухає МЕДИКА, медик лікує місто автоматично (пасивна навичка)
            if (movingPlayer.role === "Медик") {
                const cityColor = cities[movingPlayer.city].color;
                if (gameState.cured && gameState.cured[cityColor]) {
                    gameState.infections[movingPlayer.city] = 0;
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

        if (gameState.infections[city] && gameState.infections[city] > 0) {
            if (player.role === "Медик") {
                gameState.infections[city] = 0;
            } else {
                gameState.infections[city] -= 1;
            }
            gameState.actionsLeft--;
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

    socket.on('end_turn', () => {
        if (gameState.status !== 'PLAYING') return;
        if (gameState.turnOrder[gameState.currentTurnIndex] === socket.id) {

            // --- 1. ГРАВЕЦЬ ТЯГНЕ КАРТИ ---
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
                    // === ПОРАЗКА 1: ЗАКІНЧИЛИСЯ КАРТИ ===
                    gameState.status = 'GAME_OVER';
                    io.emit('game_over', { win: false, reason: 'СВІТ ЗАГИНУВ... У вас закінчився час (порожня колода гравців).' });
                    return; // Гра негайно зупиняється
                }
            }
            if (drawnCards.length > 0) io.to(socket.id).emit('cards_drawn', drawnCards);

            // --- ОБРОБКА ЕПІДЕМІЙ ---
            for (let e = 0; e < epidemicsDrawn; e++) {
                gameState.infectionRateIndex++;
                const rates = [2, 2, 2, 3, 3, 4, 4];
                gameState.infectionRate = rates[Math.min(gameState.infectionRateIndex, rates.length - 1)];

                if (infectionDeck.length > 0) {
                    const bottomCity = infectionDeck.shift(); 
                    infectionDiscard.push(bottomCity);
                    
                    if (gameState.infections[bottomCity] === undefined) {
                        gameState.infections[bottomCity] = 0;
                    }
                    
                    // ЗАХИСТ КАРАНТИНУ ВІД ЕПІДЕМІЇ
                    if (!isQuarantined(bottomCity)) {
                        gameState.infections[bottomCity] += 3;
                        if (gameState.infections[bottomCity] > 3) {
                            gameState.outbreaks++; 
                            gameState.infections[bottomCity] = 3;
                            
                            // === ПОРАЗКА 2: 8 СПАЛАХІВ ===
                            if (gameState.outbreaks >= 8) {
                                gameState.status = 'GAME_OVER';
                                io.emit('game_over', { win: false, reason: 'СВІТ ЗАГИНУВ... Досягнуто критичний рівень (8 спалахів).' });
                                return;
                            }
                        }
                    }
                    
                    io.emit('epidemic_alert', bottomCity);
                }

                for (let i = infectionDiscard.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [infectionDiscard[i], infectionDiscard[j]] = [infectionDiscard[j], infectionDiscard[i]];
                }
                infectionDeck = infectionDeck.concat(infectionDiscard); 
                infectionDiscard = []; 
            }

            // --- 2. ФАЗА ІНФЕКЦІЇ (ВИСУВАЄМО НОВІ ХВОРОБИ) ---
            const infectedCitiesThisTurn = [];

            for (let i = 0; i < gameState.infectionRate; i++) {
                if (infectionDeck.length > 0) {
                    const infectedCity = infectionDeck.pop();
                    infectionDiscard.push(infectedCity);
                    
                    if (gameState.infections[infectedCity] === undefined) {
                        gameState.infections[infectedCity] = 0;
                    }

                    // ЗАХИСТ КАРАНТИНУ ВІД ЗВИЧАЙНИХ ХВОРОБ
                    if (!isQuarantined(infectedCity)) {
                        infectedCitiesThisTurn.push(infectedCity); 
                        if (gameState.infections[infectedCity] >= 3) {
                            gameState.outbreaks++; 
                            console.log(`💥 СПАЛАХ у місті ${infectedCity}!`);
                            
                            // === ПОРАЗКА 2: 8 СПАЛАХІВ ===
                            if (gameState.outbreaks >= 8) {
                                gameState.status = 'GAME_OVER';
                                io.emit('game_over', { win: false, reason: 'СВІТ ЗАГИНУВ... Досягнуто критичний рівень (8 спалахів).' });
                                return;
                            }
                        } else {
                            gameState.infections[infectedCity]++; 
                        }
                    }
                }
            }
            
            if (infectedCitiesThisTurn.length > 0) {
                io.emit('infection_drawn', infectedCitiesThisTurn);
            }

            // --- 3. ПЕРЕДАЧА ХОДУ ---
            gameState.currentTurnIndex = (gameState.currentTurnIndex + 1) % gameState.turnOrder.length;
            gameState.actionsLeft = 4;
            io.emit('state_update', gameState);
        }
    });

    // БУДІВНИЦТВО СТАНЦІЇ
    socket.on('build_station', () => {
        if (gameState.status !== 'PLAYING') return;
        if (gameState.turnOrder[gameState.currentTurnIndex] !== socket.id) return;
        if (gameState.actionsLeft <= 0) return;

        const player = gameState.players[socket.id];
        
        if (!gameState.researchStations.includes(player.city)) {
            // ЖОРСТКИЙ ЛІМІТ: Якщо 6 станцій вже є, блокуємо і кидаємо помилку
            if (gameState.researchStations.length >= 6) {
                socket.emit('max_stations_reached'); 
                return; // Зупиняємо виконання, карту не витрачаємо!
            }

            let canBuild = false;
            
            if (player.role === "Інженер") {
                canBuild = true;
            } else if (player.cards.includes(player.city)) {
                player.cards.splice(player.cards.indexOf(player.city), 1); // Витрачаємо карту
                canBuild = true;
            }

            if (canBuild) {
                gameState.researchStations.push(player.city);
                gameState.actionsLeft--;
                io.emit('state_update', gameState);
            }
        }
    });

    // ВИНАЙДЕННЯ ЛІКІВ (ВАКЦИНИ)
    socket.on('discover_cure', () => {
        if (gameState.status !== 'PLAYING') return;
        if (gameState.turnOrder[gameState.currentTurnIndex] !== socket.id) return;
        if (gameState.actionsLeft <= 0) return;

        const player = gameState.players[socket.id];
        
        // 1. Гравець ПОВИНЕН стояти на Дослідній станції
        if (!gameState.researchStations.includes(player.city)) return;

        // 2. Рахуємо карти в руці за кольором
        const needed = player.role === "Вчений" ? 4 : 5; // Вченому треба лише 4!
        const cardsByColor = {};
        
        player.cards.forEach(city => {
            const color = cities[city].color;
            if (!cardsByColor[color]) cardsByColor[color] = [];
            cardsByColor[color].push(city);
        });

        if (!gameState.cured) gameState.cured = {};

        // 3. Шукаємо колір, якого вистачає і який ще не вилікуваний
        for (const [color, cityCards] of Object.entries(cardsByColor)) {
            if (cityCards.length >= needed && !gameState.cured[color]) {
                // Ліки знайдено!
                gameState.cured[color] = true;
                
                for (let i = 0; i < needed; i++) {
                    const cardToRemove = cityCards[i];
                    player.cards.splice(player.cards.indexOf(cardToRemove), 1);
                }

                gameState.actionsLeft--;
                io.emit('state_update', gameState);
                io.emit('cure_discovered', color); // Сповіщаємо всіх про успіх
                io.emit('cure_discovered', color); // Сповіщаємо всіх про успіх
                
                // === ПЕРЕМОГА ===
                if (Object.keys(gameState.cured).length >= 4) {
                    gameState.status = 'GAME_OVER';
                    io.emit('game_over', { win: true, reason: 'ЛЮДСТВО ВРЯТОВАНО! Винайдено всі 4 вакцини!' });
                }
                return;
            }
        }
    });

    // СКИДАННЯ ЗАЙВИХ КАРТ (>7)
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
        // ... (Тут залишається твоя стара логіка disconnect)
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