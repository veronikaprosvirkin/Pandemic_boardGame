const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public')); 

// Читаємо міста з файлу
let cities = JSON.parse(fs.readFileSync('cities.json', 'utf8'));

let gameState = {
    status: 'LOBBY', // Новий стан: LOBBY або PLAYING
    players: {},
    turnOrder: [],
    currentTurnIndex: 0,
    actionsLeft: 4,
    infectionRate: 2,
    outbreaks: 0,
    infections: {}
};

let infectionDeck = [];
let infectionDiscard = [];

const roles = ["Медик", "Вчений", "Диспетчер", "Дослідник", "Фахівець із карантину"];

io.on('connection', (socket) => {
    console.log(`Гравець підключився: ${socket.id}`);

    // Якщо гра вже йде, не пускаємо нових (або пускаємо як глядачів)
    if (gameState.status === 'PLAYING') {
        socket.emit('game_already_started');
        return;
    }

    // Додаємо гравця в лобі (без ролі і міста)
    gameState.players[socket.id] = {
        id: socket.id,
        isReady: false,
        name: `Гравець ${Object.keys(gameState.players).length + 1}`,
        role: null,
        city: null,
        cards: []
    };

    io.emit('lobby_update', gameState.players);

    // Гравець натиснув "Я готовий"
    socket.on('player_ready', () => {
        if (gameState.players[socket.id]) {
            gameState.players[socket.id].isReady = true;
            io.emit('lobby_update', gameState.players);
            checkGameStart();
        }
    });

    function checkGameStart() {
        const playersArr = Object.values(gameState.players);
        if (playersArr.length >= 2 && playersArr.every(p => p.isReady)) {
            gameState.status = 'PLAYING';
            
            // 1. Очищаємо чергу та роздаємо ролі
            gameState.turnOrder = [];
            gameState.currentTurnIndex = 0;
            let availableRoles = [...roles];
            
            playersArr.forEach(p => {
                const roleIndex = Math.floor(Math.random() * availableRoles.length);
                p.role = availableRoles.splice(roleIndex, 1)[0];
                p.city = "Atlanta"; 
                gameState.turnOrder.push(p.id); 
            });

            // 2. ІНІЦІАЛІЗАЦІЯ ІНФЕКЦІЇ
            gameState.infections = {};
            infectionDeck = Object.keys(cities); // Беремо всі назви міст
            infectionDiscard = [];

            // Перемішуємо колоду інфекцій (алгоритм Фішера-Йейтса)
            for (let i = infectionDeck.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [infectionDeck[i], infectionDeck[j]] = [infectionDeck[j], infectionDeck[i]];
            }

            // Функція для витягування міст
            function infectCities(amountOfCities, cubesToPlace) {
                for (let i = 0; i < amountOfCities; i++) {
                    const city = infectionDeck.pop(); // Беремо верхню карту
                    gameState.infections[city] = cubesToPlace; // Кладемо кубики
                    infectionDiscard.push(city); // Відправляємо у скид
                }
            }

            // Роздаємо кубики за правилами:
            infectCities(3, 3); // 3 міста по 3 кубики
            infectCities(3, 2); // 3 міста по 2 кубики
            infectCities(3, 1); // 3 міста по 1 кубику

            // 3. Відправляємо сигнал про старт гри
            io.emit('game_started', { cities, gameState });
        }
    }

    // ЗБЕРЕЖЕННЯ КООРДИНАТ (калібрування)
    socket.on('update_city_coords', (data) => {
        if (cities[data.name]) {
            cities[data.name].x = data.x;
            cities[data.name].y = data.y;
            fs.writeFileSync('cities.json', JSON.stringify(cities, null, 4));
            // Відправляємо тільки карту, щоб не скидати стан гри
            io.emit('map_updated', cities); 
        }
    });

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

    socket.on('end_turn', () => {
        if (gameState.status !== 'PLAYING') return;
        if (gameState.turnOrder[gameState.currentTurnIndex] === socket.id) {
            gameState.currentTurnIndex = (gameState.currentTurnIndex + 1) % gameState.turnOrder.length;
            gameState.actionsLeft = 4;
            io.emit('state_update', gameState);
        }
    });

    socket.on('disconnect', () => {
        console.log(`Гравець відключився: ${socket.id}`);
        
        if (gameState.status === 'LOBBY') {
            delete gameState.players[socket.id];
            io.emit('lobby_update', gameState.players);
        } else {
            // Логіка відключення під час гри (видалення з черги)
            const index = gameState.turnOrder.indexOf(socket.id);
            if (index !== -1) {
                gameState.turnOrder.splice(index, 1);
                if (gameState.turnOrder.length === 0) {
                    gameState.status = 'LOBBY'; // Якщо всі вийшли, скидаємо в лобі
                    gameState.players = {};
                    gameState.currentTurnIndex = 0;
                } else if (index < gameState.currentTurnIndex) {
                    gameState.currentTurnIndex--;
                } else if (index === gameState.currentTurnIndex) {
                    gameState.currentTurnIndex = gameState.currentTurnIndex % gameState.turnOrder.length;
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