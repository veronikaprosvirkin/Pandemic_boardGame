const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public')); // Папка для клієнтських файлів

// База даних міст (для прикладу даю Північну Америку, далі додамо решту 48)
const cities = {
    "Atlanta": { color: "blue", x: 300, y: 300, connections: ["Chicago", "Washington", "Miami"] },
    "Chicago": { color: "blue", x: 280, y: 220, connections: ["Atlanta", "San Francisco", "Los Angeles", "Montreal"] },
    "Washington": { color: "blue", x: 400, y: 280, connections: ["Atlanta", "Montreal", "New York", "Miami"] },
    "Montreal": { color: "blue", x: 420, y: 200, connections: ["Chicago", "Washington", "New York"] },
    "New York": { color: "blue", x: 480, y: 220, connections: ["Montreal", "Washington", "London", "Madrid"] }
};

// Стан гри
let gameState = {
    players: {},
    currentTurn: null,
    infectionRate: 2,
    outbreaks: 0
};

// Доступні ролі (додамо всі згодом)
const roles = ["Медик", "Вчений", "Диспетчер", "Дослідник"];

io.on('connection', (socket) => {
    console.log(`Гравець підключився: ${socket.id}`);

    // Додаємо нового гравця в Атланту (старт за правилами)
    gameState.players[socket.id] = {
        id: socket.id,
        city: "Atlanta",
        role: roles[Object.keys(gameState.players).length % roles.length],
        cards: []
    };

    // Відправляємо новому гравцю карту і поточний стан
    socket.emit('init_game', { cities, gameState, myId: socket.id });
    
    // Повідомляємо інших про нового гравця
    socket.broadcast.emit('state_update', gameState);

    // Обробка руху гравця
    socket.on('move_player', (targetCity) => {
        const player = gameState.players[socket.id];
        const currentCity = cities[player.city];

        // Перевірка, чи міста з'єднані (правило "Drive/Ferry")
        if (currentCity.connections.includes(targetCity)) {
            player.city = targetCity;
            io.emit('state_update', gameState); // Оновлюємо всіх клієнтів
        }
    });

    socket.on('disconnect', () => {
        console.log(`Гравець відключився: ${socket.id}`);
        delete gameState.players[socket.id];
        io.emit('state_update', gameState);
    });
});

server.listen(3000, () => {
    console.log('Сервер гри запущено на http://localhost:3000');
});