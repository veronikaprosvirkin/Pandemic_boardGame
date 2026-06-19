const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let mapData = {};
let currentGameState = {};
let myPlayerId = null;

// Отримуємо початкові дані від сервера
socket.on('init_game', (data) => {
    mapData = data.cities;
    currentGameState = data.gameState;
    myPlayerId = data.myId;
    updateUI();
});

// Слухаємо оновлення стану гри (рух інших гравців)
socket.on('state_update', (newState) => {
    currentGameState = newState;
    updateUI();
});

function updateUI() {
    if (!currentGameState.players[myPlayerId]) return;
    const me = currentGameState.players[myPlayerId];
    document.getElementById('my-role').innerText = me.role;
    document.getElementById('my-city').innerText = me.city;
}

// Головний цикл відмальовки (60 FPS)
function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height); // Очищення екрану

    // 1. Малюємо лінії (зв'язки)
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#4a5568';
    for (const [cityName, cityData] of Object.entries(mapData)) {
        cityData.connections.forEach(targetName => {
            const target = mapData[targetName];
            if (target) {
                ctx.beginPath();
                ctx.moveTo(cityData.x, cityData.y);
                ctx.lineTo(target.x, target.y);
                ctx.stroke();
            }
        });
    }

    // 2. Малюємо міста
    for (const [cityName, cityData] of Object.entries(mapData)) {
        ctx.fillStyle = cityData.color;
        ctx.beginPath();
        ctx.arc(cityData.x, cityData.y, 15, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.fillStyle = "white";
        ctx.font = "14px Arial";
        ctx.fillText(cityName, cityData.x - 20, cityData.y - 20);
    }

    // 3. Малюємо гравців (анімацію переходу додамо в наступному модулі)
    if (currentGameState.players) {
        Object.values(currentGameState.players).forEach(player => {
            const city = mapData[player.city];
            if (city) {
                ctx.fillStyle = player.id === myPlayerId ? "#48bb78" : "#ed8936"; // Я зелений, інші помаранчеві
                ctx.beginPath();
                // Ставимо фішку трохи зі зміщенням
                ctx.arc(city.x + 10, city.y + 10, 8, 0, Math.PI * 2);
                ctx.fill();
            }
        });
    }

    requestAnimationFrame(draw);
}

// Обробка кліків для руху
canvas.addEventListener('click', (event) => {
    const rect = canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    // Перевіряємо, чи клікнули на якесь місто
    for (const [cityName, cityData] of Object.entries(mapData)) {
        const dist = Math.hypot(mouseX - cityData.x, mouseY - cityData.y);
        if (dist < 20) {
            socket.emit('move_player', cityName);
            break;
        }
    }
});

// Запускаємо цикл малювання
draw();