const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public')); 

// База даних усіх 48 міст оригінальної Пандемії
const cities = {
    "San Francisco": { color: "#2b6cb0", x: 120, y: 250, connections: ["Chicago", "Los Angeles", "Tokyo", "Manila"] },
    "Chicago": { color: "#2b6cb0", x: 240, y: 220, connections: ["San Francisco", "Los Angeles", "Atlanta", "Montreal"] },
    "Atlanta": { color: "#2b6cb0", x: 260, y: 290, connections: ["Chicago", "Washington", "Miami"] },
    "Montreal": { color: "#2b6cb0", x: 310, y: 220, connections: ["Chicago", "Washington", "New York"] },
    "Washington": { color: "#2b6cb0", x: 340, y: 280, connections: ["Atlanta", "Montreal", "New York", "Miami"] },
    "New York": { color: "#2b6cb0", x: 360, y: 230, connections: ["Montreal", "Washington", "London", "Madrid"] },
    "London": { color: "#2b6cb0", x: 520, y: 200, connections: ["New York", "Madrid", "Paris", "Essen"] },
    "Madrid": { color: "#2b6cb0", x: 510, y: 280, connections: ["New York", "London", "Paris", "Algiers", "Sao Paulo"] },
    "Paris": { color: "#2b6cb0", x: 560, y: 230, connections: ["London", "Madrid", "Algiers", "Milan", "Essen"] },
    "Essen": { color: "#2b6cb0", x: 600, y: 200, connections: ["London", "Paris", "Milan", "St. Petersburg"] },
    "Milan": { color: "#2b6cb0", x: 610, y: 250, connections: ["Paris", "Essen", "Istanbul"] },
    "St. Petersburg": { color: "#2b6cb0", x: 690, y: 180, connections: ["Essen", "Istanbul", "Moscow"] },
    "Los Angeles": { color: "#d69e2e", x: 130, y: 320, connections: ["San Francisco", "Chicago", "Mexico City", "Sydney"] }, 
    "Mexico City": { color: "#d69e2e", x: 190, y: 400, connections: ["Los Angeles", "Chicago", "Miami", "Bogota", "Lima"] },
    "Miami": { color: "#d69e2e", x: 300, y: 360, connections: ["Atlanta", "Washington", "Mexico City", "Bogota"] },
    "Bogota": { color: "#d69e2e", x: 310, y: 480, connections: ["Mexico City", "Miami", "Lima", "Buenos Aires", "Sao Paulo"] },
    "Lima": { color: "#d69e2e", x: 290, y: 580, connections: ["Mexico City", "Bogota", "Santiago"] },
    "Santiago": { color: "#d69e2e", x: 300, y: 700, connections: ["Lima"] },
    "Buenos Aires": { color: "#d69e2e", x: 400, y: 680, connections: ["Bogota", "Sao Paulo"] },
    "Sao Paulo": { color: "#d69e2e", x: 430, y: 590, connections: ["Bogota", "Buenos Aires", "Madrid", "Lagos"] },
    "Lagos": { color: "#d69e2e", x: 560, y: 480, connections: ["Sao Paulo", "Kinshasa", "Khartoum"] },
    "Kinshasa": { color: "#d69e2e", x: 600, y: 550, connections: ["Lagos", "Khartoum", "Johannesburg"] },
    "Johannesburg": { color: "#d69e2e", x: 640, y: 680, connections: ["Kinshasa", "Khartoum"] },
    "Khartoum": { color: "#d69e2e", x: 670, y: 470, connections: ["Lagos", "Kinshasa", "Johannesburg", "Cairo"] },
    "Algiers": { color: "#1a202c", x: 550, y: 330, connections: ["Madrid", "Paris", "Istanbul", "Cairo"] },
    "Cairo": { color: "#1a202c", x: 640, y: 350, connections: ["Algiers", "Istanbul", "Baghdad", "Riyadh", "Khartoum"] },
    "Istanbul": { color: "#1a202c", x: 660, y: 280, connections: ["Milan", "St. Petersburg", "Moscow", "Baghdad", "Cairo", "Algiers"] },
    "Moscow": { color: "#1a202c", x: 730, y: 220, connections: ["St. Petersburg", "Istanbul", "Tehran"] },
    "Baghdad": { color: "#1a202c", x: 720, y: 320, connections: ["Istanbul", "Cairo", "Riyadh", "Karachi", "Tehran"] },
    "Riyadh": { color: "#1a202c", x: 730, y: 420, connections: ["Cairo", "Baghdad", "Karachi"] },
    "Tehran": { color: "#1a202c", x: 780, y: 300, connections: ["Moscow", "Baghdad", "Karachi", "Delhi"] },
    "Karachi": { color: "#1a202c", x: 830, y: 400, connections: ["Riyadh", "Baghdad", "Tehran", "Delhi", "Mumbai"] },
    "Mumbai": { color: "#1a202c", x: 850, y: 480, connections: ["Karachi", "Delhi", "Chennai"] },
    "Delhi": { color: "#1a202c", x: 880, y: 380, connections: ["Tehran", "Karachi", "Mumbai", "Chennai", "Kolkata"] },
    "Chennai": { color: "#1a202c", x: 900, y: 540, connections: ["Mumbai", "Delhi", "Kolkata", "Bangkok", "Jakarta"] },
    "Kolkata": { color: "#1a202c", x: 940, y: 420, connections: ["Delhi", "Chennai", "Bangkok", "Hong Kong"] },
    "Beijing": { color: "#e53e3e", x: 1000, y: 280, connections: ["Seoul", "Shanghai"] },
    "Seoul": { color: "#e53e3e", x: 1080, y: 280, connections: ["Beijing", "Shanghai", "Tokyo"] },
    "Shanghai": { color: "#e53e3e", x: 1020, y: 350, connections: ["Beijing", "Seoul", "Tokyo", "Taipei", "Hong Kong"] },
    "Tokyo": { color: "#e53e3e", x: 1130, y: 300, connections: ["Seoul", "Shanghai", "Osaka", "San Francisco"] },
    "Osaka": { color: "#e53e3e", x: 1140, y: 350, connections: ["Tokyo", "Taipei"] },
    "Taipei": { color: "#e53e3e", x: 1080, y: 420, connections: ["Shanghai", "Osaka", "Hong Kong", "Manila"] },
    "Hong Kong": { color: "#e53e3e", x: 1030, y: 430, connections: ["Shanghai", "Taipei", "Manila", "Ho Chi Minh City", "Bangkok", "Kolkata"] },
    "Bangkok": { color: "#e53e3e", x: 980, y: 490, connections: ["Kolkata", "Hong Kong", "Ho Chi Minh City", "Jakarta", "Chennai"] },
    "Manila": { color: "#e53e3e", x: 1100, y: 500, connections: ["Taipei", "Hong Kong", "Ho Chi Minh City", "Sydney", "San Francisco"] },
    "Ho Chi Minh City": { color: "#e53e3e", x: 1020, y: 550, connections: ["Bangkok", "Hong Kong", "Manila", "Jakarta"] },
    "Jakarta": { color: "#e53e3e", x: 1010, y: 640, connections: ["Chennai", "Bangkok", "Ho Chi Minh City", "Sydney"] },
    "Sydney": { color: "#e53e3e", x: 1150, y: 700, connections: ["Jakarta", "Manila", "Los Angeles"] }
};

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

    socket.emit('init_game', { cities, gameState, myId: socket.id });
    socket.broadcast.emit('state_update', gameState);

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