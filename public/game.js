const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const bgImage = new Image();
bgImage.src = 'map.png'; // Твоя актуальна мапа

let mapData = {};
let currentGameState = {};
let myPlayerId = null;

// Масштаб зараз 1.0, бо координати вже підігнані
const SCALE_X = 1.0;
const SCALE_Y = 1.0;
const OFFSET_X = 0;
const OFFSET_Y = 0;

function getCoords(originalX, originalY) {
    return {
        x: (originalX * SCALE_X) + OFFSET_X,
        y: (originalY * SCALE_Y) + OFFSET_Y
    };
}

socket.on('init_game', (data) => {
    mapData = data.cities;
    currentGameState = data.gameState;
    // Оновлюємо ID тільки якщо сервер його прислав (щоб не скинути гравця)
    if (data.myId) {
        myPlayerId = data.myId;
    }
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

    if (bgImage.complete) {
        ctx.drawImage(bgImage, 0, 0, canvas.width, canvas.height);
    } else {
        ctx.fillStyle = '#1a202c';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    const drawnLines = new Set();

    for (const [cityName, cityData] of Object.entries(mapData)) {
        cityData.connections.forEach(targetName => {
            const pairKey = [cityName, targetName].sort().join('-');
            
            if (!drawnLines.has(pairKey) && mapData[targetName]) {
                drawnLines.add(pairKey);
                
                const target = mapData[targetName];
                const start = getCoords(cityData.x, cityData.y);
                const end = getCoords(target.x, target.y);

                const dist = Math.hypot(start.x - end.x, start.y - end.y);

                ctx.beginPath();
                if (dist > canvas.width * 0.7) { 
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

    for (const [cityName, cityData] of Object.entries(mapData)) {
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

// Єдиний обробник кліків
canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    
    // ЯКЩО ЗАТИСНУТО Alt -> Зберігаємо координати
    if (e.altKey) {
        for (const [name, data] of Object.entries(mapData)) {
            const pos = getCoords(data.x, data.y);
            if (Math.hypot(x - pos.x, y - pos.y) < 30) {
                socket.emit('update_city_coords', { name, x: Math.round(x/SCALE_X), y: Math.round(y/SCALE_Y) });
                console.log(`Місто ${name} успішно збережено у файл cities.json!`);
                return; // Зупиняємось, щоб фішка не стрибнула туди
            }
        }
    }

    // ЯКЩО Alt НЕ ЗАТИСНУТО -> Звичайний рух
    for (const [cityName, cityData] of Object.entries(mapData)) {
        const pos = getCoords(cityData.x, cityData.y);
        const dist = Math.hypot(x - pos.x, y - pos.y);
        if (dist < 20) {
            socket.emit('move_player', cityName);
            break;
        }
    }
});

draw();