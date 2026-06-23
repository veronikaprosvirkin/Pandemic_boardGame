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
    players: {},
    currentTurn: null,
    infectionRate: 2,
    outbreaks: 0
};

const roles = ["Медик", "Вчений", "Диспетчер", "Дослідник", "Фахівець із карантину"];

let gameState = {
    players: {},
    turnOrder: [], // Черга гравців (масив їхніх socket.id)
    currentTurnIndex: 0, // Хто зараз ходить (індекс у масиві)
    actionsLeft: 4, // Скільки дій залишилося у поточного гравця
    infectionRate: 2,
    outbreaks: 0
};

const roles = ["Медик", "Вчений", "Диспетчер", "Дослідник", "Фахівець із карантину"];

io.on('connection', (socket) => {
    console.log(`Гравець підключився: ${socket.id}`);

    // Присвоюємо роль і початкове місто
    gameState.players[socket.id] = {
        id: socket.id,
        city: "Atlanta",
        role: roles[Object.keys(gameState.players).length % roles.length],
        cards: []
    };

    // Додаємо нового гравця в кінець черги
    gameState.turnOrder.push(socket.id);

    socket.emit('init_game', { cities, gameState, myId: socket.id });
    socket.broadcast.emit('state_update', gameState);

    socket.on('update_city_coords', (data) => {
        if (cities[data.name]) {
            cities[data.name].x = data.x;
            cities[data.name].y = data.y;
            fs.writeFileSync('cities.json', JSON.stringify(cities, null, 4));
            io.emit('init_game', { cities, gameState, myId: null }); 
        }
    });

    socket.on('move_player', (targetCity) => {
        // ПЕРЕВІРКА 1: Чи зараз мій хід?
        if (gameState.turnOrder[gameState.currentTurnIndex] !== socket.id) return;
        // ПЕРЕВІРКА 2: Чи є в мене дії?
        if (gameState.actionsLeft <= 0) return;

        const player = gameState.players[socket.id];
        const currentCity = cities[player.city];

        // Якщо місто сусіднє - переходимо
        if (currentCity && currentCity.connections.includes(targetCity)) {
            player.city = targetCity;
            gameState.actionsLeft--; // Віднімаємо 1 дію за рух
            io.emit('state_update', gameState); 
        }
    });

    // Нова подія: Гравець натиснув "Завершити хід"
    socket.on('end_turn', () => {
        // Перевіряємо, чи це справді його хід, щоб ніхто не "вкрав" хід
        if (gameState.turnOrder[gameState.currentTurnIndex] === socket.id) {
            // Передаємо хід наступному по колу
            gameState.currentTurnIndex = (gameState.currentTurnIndex + 1) % gameState.turnOrder.length;
            gameState.actionsLeft = 4; // Відновлюємо 4 дії для наступного
            io.emit('state_update', gameState);
        }
    });

    socket.on('disconnect', () => {
        console.log(`Гравець відключився: ${socket.id}`);
        
        // Видаляємо гравця з черги
        const index = gameState.turnOrder.indexOf(socket.id);
        if (index !== -1) {
            gameState.turnOrder.splice(index, 1);
            
            // Коригуємо індекс черги
            if (gameState.turnOrder.length === 0) {
                gameState.currentTurnIndex = 0;
            } else if (index < gameState.currentTurnIndex) {
                gameState.currentTurnIndex--;
            } else if (index === gameState.currentTurnIndex) {
                gameState.currentTurnIndex = gameState.currentTurnIndex % gameState.turnOrder.length;
                gameState.actionsLeft = 4; // Скидаємо дії для наступного
            }
        }

        delete gameState.players[socket.id];
        io.emit('state_update', gameState);
    });
});

server.listen(3000, () => {
    console.log('Сервер гри запущено на http://localhost:3000');
});