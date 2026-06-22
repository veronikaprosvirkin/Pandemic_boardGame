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

const roles = ["Медик", "Вчений", "Диспетчер", "Дослідник"];

io.on('connection', (socket) => {
    console.log(`Гравець підключився: ${socket.id}`);

    gameState.players[socket.id] = {
        id: socket.id,
        city: "Atlanta",
        role: roles[Object.keys(gameState.players).length % roles.length],
        cards: []
    };

    // Відправляємо клієнту базу міст та його ID
    socket.emit('init_game', { cities, gameState, myId: socket.id });
    socket.broadcast.emit('state_update', gameState);

    // ЗБЕРЕЖЕННЯ КООРДИНАТ У ФАЙЛ
    socket.on('update_city_coords', (data) => {
        if (cities[data.name]) {
            cities[data.name].x = data.x;
            cities[data.name].y = data.y;
            fs.writeFileSync('cities.json', JSON.stringify(cities, null, 4));
            // Відправляємо всім оновлену карту, НЕ стираючи їхній ID
            io.emit('init_game', { cities, gameState, myId: null }); 
        }
    });

    socket.on('move_player', (targetCity) => {
        const player = gameState.players[socket.id];
        const currentCity = cities[player.city];

        if (currentCity && currentCity.connections.includes(targetCity)) {
            player.city = targetCity;
            io.emit('state_update', gameState); 
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