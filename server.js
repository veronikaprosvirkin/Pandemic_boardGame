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

const roles = ["Медик", "Вчений", "Диспетчер", "Дослідник", "Фахівець із карантину"];

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

            let availableRoles = [...roles];
            playersArr.forEach(p => {
                const roleIndex = Math.floor(Math.random() * availableRoles.length);
                p.role = availableRoles.splice(roleIndex, 1)[0];
                p.city = "Atlanta"; 
                p.cards = [];
                gameState.turnOrder.push(p.id); 
            });

            // 1. Ініціалізація інфекцій
            gameState.infections = {};
            infectionDeck = Object.keys(cities);
            infectionDiscard = [];

            for (let i = infectionDeck.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [infectionDeck[i], infectionDeck[j]] = [infectionDeck[j], infectionDeck[i]];
            }

            function infectCities(amountOfCities, cubesToPlace) {
                for (let i = 0; i < amountOfCities; i++) {
                    const city = infectionDeck.pop();
                    gameState.infections[city] = cubesToPlace;
                    infectionDiscard.push(city);
                }
            }

            infectCities(3, 3);
            infectCities(3, 2);
            infectCities(3, 1);

            // 2. Ініціалізація колоди гравців та ЕПІДЕМІЙ
            let initialPlayerDeck = Object.keys(cities); 
            for (let i = initialPlayerDeck.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [initialPlayerDeck[i], initialPlayerDeck[j]] = [initialPlayerDeck[j], initialPlayerDeck[i]];
            }

            // Роздаємо стартові карти (без епідемій)
            playersArr.forEach(p => {
                for(let i = 0; i < 2; i++) {
                    if(initialPlayerDeck.length > 0) p.cards.push(initialPlayerDeck.pop());
                }
            });

            // Ділимо залишок колоди на 4 стопки
            const numEpidemics = 4;
            const piles = Array.from({ length: numEpidemics }, () => []);
            initialPlayerDeck.forEach((card, index) => {
                piles[index % numEpidemics].push(card);
            });

            // Додаємо в кожну стопку 1 Епідемію, тасуємо і збираємо фінальну колоду
            playerDeck = [];
            for (let i = piles.length - 1; i >= 0; i--) {
                let pile = piles[i];
                pile.push("ЕПІДЕМІЯ");
                for (let k = pile.length - 1; k > 0; k--) {
                    const j = Math.floor(Math.random() * (k + 1));
                    [pile[k], pile[j]] = [pile[j], pile[k]];
                }
                playerDeck = playerDeck.concat(pile); // Кладемо стопку наверх
            }

            io.emit('game_started', { cities, gameState });
        }
    }

    socket.on('move_player', (targetCity) => {
        if (gameState.status !== 'PLAYING') return;
        if (gameState.turnOrder[gameState.currentTurnIndex] !== socket.id) return;
        if (gameState.actionsLeft <= 0) return;

        const player = gameState.players[socket.id];
        const currentCity = cities[player.city];

        if (currentCity && currentCity.connections.includes(targetCity)) {
            player.city = targetCity;
            gameState.actionsLeft--;
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

    socket.on('end_turn', () => {
        if (gameState.status !== 'PLAYING') return;
        if (gameState.turnOrder[gameState.currentTurnIndex] === socket.id) {

            // --- 1. ГРАВЕЦЬ ТЯГНЕ КАРТИ ---
            const player = gameState.players[socket.id];
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
                    console.log("💀 ПРОГРАШ: Колода гравців закінчилася!");
                }
            }
            if (drawnCards.length > 0) io.to(socket.id).emit('cards_drawn', drawnCards);

            // --- ОБРОБКА ЕПІДЕМІЙ ---
            for (let e = 0; e < epidemicsDrawn; e++) {
                // 1. Підвищення: збільшуємо індекс і визначаємо новий рейт
                gameState.infectionRateIndex++;
                const rates = [2, 2, 2, 3, 3, 4, 4];
                gameState.infectionRate = rates[Math.min(gameState.infectionRateIndex, rates.length - 1)];

                // 2. Епідемія: тягнемо з САМОГО НИЗУ (shift)
                if (infectionDeck.length > 0) {
                    const bottomCity = infectionDeck.shift(); 
                    infectionDiscard.push(bottomCity);
                    
                    if (gameState.infections[bottomCity] === undefined) {
                        gameState.infections[bottomCity] = 0;
                    }
                    
                    gameState.infections[bottomCity] += 3;
                    if (gameState.infections[bottomCity] > 3) {
                        gameState.outbreaks++; // Спалах!
                        gameState.infections[bottomCity] = 3;
                    }
                    
                    // Відправляємо всім червоне сповіщення
                    io.emit('epidemic_alert', bottomCity);
                }

                // 3. Загострення: тасуємо скид і кладемо ЗВЕРХУ (додаємо в кінець масиву)
                for (let i = infectionDiscard.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [infectionDiscard[i], infectionDiscard[j]] = [infectionDiscard[j], infectionDiscard[i]];
                }
                infectionDeck = infectionDeck.concat(infectionDiscard); 
                infectionDiscard = []; // Скид порожній
            }

            // --- 2. ФАЗА ІНФЕКЦІЇ ---
            const infectedCitiesThisTurn = []; // Масив для сповіщень про інфекцію
            
            for (let i = 0; i < gameState.infectionRate; i++) {
                if (infectionDeck.length > 0) {
                    const infectedCity = infectionDeck.pop();
                    infectionDiscard.push(infectedCity);
                    infectedCitiesThisTurn.push(infectedCity); // Додаємо місто в список

                    if (gameState.infections[infectedCity] === undefined) {
                        gameState.infections[infectedCity] = 0;
                    }

                    if (gameState.infections[infectedCity] >= 3) {
                        gameState.outbreaks++; 
                        console.log(`💥 СПАЛАХ у місті ${infectedCity}!`);
                    } else {
                        gameState.infections[infectedCity]++; 
                    }
                }
            }

            // Сповіщаємо всіх гравців про нові інфекції
            io.emit('infection_drawn', infectedCitiesThisTurn);

            // --- 3. ПЕРЕДАЧА ХОДУ ---
            gameState.currentTurnIndex = (gameState.currentTurnIndex + 1) % gameState.turnOrder.length;
            gameState.actionsLeft = 4;
            io.emit('state_update', gameState);
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