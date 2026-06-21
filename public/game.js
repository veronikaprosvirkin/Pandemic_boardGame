const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const bgImage = new Image();
bgImage.src = 'map.png';

let mapData = {};
let currentGameState = {};
let myPlayerId = null;

// --- СИСТЕМА АВТО-МАСШТАБУВАННЯ КАРТИ ---
// Тобі більше не треба міняти координати кожного міста вручну!
// Ці 4 змінні дозволяють стиснути/розтягнути або посунути всю сітку міст як один об'єкт.
const SCALE_X = 1.0;   // 1.0 - стандарт. Якщо міста треба розтягнути по горизонталі - пиши 1.1, якщо стиснути - 0.9
const SCALE_Y = 0.84;  // Ми стискаємо висоту, бо перейшли з 800 на 675 (675/800 = ~0.84)
const OFFSET_X = 0;    // Посунути всю сітку вправо/вліво
const OFFSET_Y = 0;    // Посунути всю сітку вгору/вниз

// Математика, яка сама перераховує координати для кожного міста на льоту
function getCoords(originalX, originalY) {
    return {
        x: (originalX * SCALE_X) + OFFSET_X,
        y: (originalY * SCALE_Y) + OFFSET_Y
    };
}

socket.on('init_game', (data) => {
    mapData = data.cities;
    currentGameState = data.gameState;
    myPlayerId = data.myId;
    updateUI();
});

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

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 1. Фон
    if (bgImage.complete) {
        ctx.drawImage(bgImage, 0, 0, canvas.width, canvas.height);
    } else {
        ctx.fillStyle = '#1a202c';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // 2. Зв'язки (лінії)
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    const drawnLines = new Set();

    for (const [cityName, cityData] of Object.entries(mapData)) {
        cityData.connections.forEach(targetName => {
            const pairKey = [cityName, targetName].sort().join('-');
            
            if (!drawnLines.has(pairKey) && mapData[targetName]) {
                drawnLines.add(pairKey);
                
                const target = mapData[targetName];
                // Отримуємо нові перераховані координати для ліній
                const start = getCoords(cityData.x, cityData.y);
                const end = getCoords(target.x, target.y);

                const dist = Math.hypot(start.x - end.x, start.y - end.y);

                ctx.beginPath();
                if (dist > canvas.width * 0.7) { // Якщо лінія йде через океан
                    const leftCity = start.x < end.x ? start : end;
                    const rightCity = start.x > end.x ? start : end;

                    ctx.moveTo(leftCity.x, leftCity.y);
                    ctx.lineTo(-50, leftCity.y);
                    
                    ctx.moveTo(rightCity.x, rightCity.y);
                    ctx.lineTo(canvas.width + 50, rightCity.y);
                } else {
                    ctx.moveTo(start.x, start.y);
                    ctx.lineTo(end.x, end.y);
                }
                ctx.stroke();
            }
        });
    }

    // 3. Міста
    for (const [cityName, cityData] of Object.entries(mapData)) {
        // Отримуємо нові координати для відмальовки міст
        const pos = getCoords(cityData.x, cityData.y);

        ctx.fillStyle = cityData.color;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 12, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.lineWidth = 2;
        ctx.strokeStyle = "white";
        ctx.stroke();
        
        ctx.fillStyle = "white";
        ctx.font = "bold 14px Arial";
        ctx.shadowColor = "black";
        ctx.shadowBlur = 4;
        ctx.fillText(cityName, pos.x - 20, pos.y - 15);
        ctx.shadowBlur = 0;
    }

    // 4. Гравці
    if (currentGameState.players) {
        Object.values(currentGameState.players).forEach(player => {
            const city = mapData[player.city];
            if (city) {
                const pos = getCoords(city.x, city.y);

                ctx.fillStyle = player.id === myPlayerId ? "#48bb78" : "#ed8936";
                ctx.beginPath();
                ctx.arc(pos.x + 12, pos.y + 12, 9, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = "white";
                ctx.stroke();
            }
        });
    }

    requestAnimationFrame(draw);
}

// Обробка кліків для руху (з урахуванням перерахованих координат)
canvas.addEventListener('click', (event) => {
    const rect = canvas.getBoundingClientRect();
    const mapScaleX = canvas.width / rect.width;
    const mapScaleY = canvas.height / rect.height;

    const mouseX = (event.clientX - rect.left) * mapScaleX;
    const mouseY = (event.clientY - rect.top) * mapScaleY;

    for (const [cityName, cityData] of Object.entries(mapData)) {
        const pos = getCoords(cityData.x, cityData.y);

        const dist = Math.hypot(mouseX - pos.x, mouseY - pos.y);
        if (dist < 20) {
            socket.emit('move_player', cityName);
            break;
        }
    }
});
// Додай цей блок в кінець файлу public/game.js
canvas.addEventListener('click', (e) => {
    if (e.altKey) { // Тільки якщо затиснуто Alt
        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) * (canvas.width / rect.width);
        const y = (e.clientY - rect.top) * (canvas.height / rect.height);
        
        // Знаходимо, яке місто найближче
        for (const [name, data] of Object.entries(mapData)) {
            const pos = getCoords(data.x, data.y);
            if (Math.hypot(x - pos.x, y - pos.y) < 30) {
                socket.emit('update_city_coords', { name, x: Math.round(x/SCALE_X), y: Math.round(y/SCALE_Y) });
                alert(`Місто ${name} збережено: ${Math.round(x)}, ${Math.round(y)}`);
                break;
            }
        }
    }
});

draw();