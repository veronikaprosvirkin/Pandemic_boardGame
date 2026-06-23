const socket = io();

// --- ЕЛЕМЕНТИ ДОМ ---
const lobbyView = document.getElementById('lobby-view');
const gameView = document.getElementById('game-view');
const btnReady = document.getElementById('btn-ready');
const lobbyPlayersList = document.getElementById('lobby-players');

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const bgImage = new Image();
bgImage.src = 'map.png'; // Переконайся, що ім'я файлу відповідає реальному

let mapData = {};
let currentGameState = {};
let myPlayerId = null;

// Масштабування для карти
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

const roleDescriptions = {
    "Медик": "💊 Виліковує всі кубики хвороби одного кольору за 1 дію. Якщо ліки знайдено — лікує автоматично.",
    "Вчений": "🔬 Для винайдення ліків потрібно лише 4 карти одного кольору замість 5.",
    "Диспетчер": "🚁 Може рухати чужі фішки як свої. За 1 дію може перемістити будь-яку фішку в місто, де є інша.",
    "Дослідник": "📑 Може віддати будь-яку карту міста гравцю, який знаходиться з ним в одному місті.",
    "Фахівець із карантину": "🛑 Запобігає появі нових кубиків хвороб та спалахам у місті, де стоїть, та в усіх сусідніх."
};

// ==========================================
// ЛОГІКА ЛОБІ
// ==========================================

socket.on('lobby_update', (players) => {
    lobbyPlayersList.innerHTML = ''; // Очищаємо список
    
    Object.values(players).forEach(p => {
        const li = document.createElement('li');
        li.style.padding = "10px";
        li.style.borderBottom = "1px solid #4a5568";
        li.style.color = p.isReady ? "#48bb78" : "#e2e8f0";
        li.innerHTML = `<strong>${p.name}</strong> - ${p.isReady ? 'Готовий ✔️' : 'Обирає...'}`;
        lobbyPlayersList.appendChild(li);
    });
});

btnReady.addEventListener('click', () => {
    socket.emit('player_ready');
    btnReady.innerText = "ОЧІКУВАННЯ ІНШИХ...";
    btnReady.style.backgroundColor = "#718096";
    btnReady.disabled = true;
});

socket.on('game_already_started', () => {
    lobbyView.innerHTML = "<h2 style='color:#e53e3e;'>Гра вже почалася!</h2><p>Ви не можете приєднатися зараз.</p>";
});

// ==========================================
// СТАРТ ГРИ ТА ОНОВЛЕННЯ СТАНУ
// ==========================================

socket.on('game_started', (data) => {
    // Зберігаємо свій ID при старті гри
    myPlayerId = socket.id; 
    
    mapData = data.cities;
    currentGameState = data.gameState;
    
    // Перемикаємо екрани
    lobbyView.style.display = 'none';
    gameView.style.display = 'flex';
    gameView.style.flexDirection = 'row';

    updateUI();
    draw(); // Запускаємо цикл малювання карти
});

socket.on('state_update', (newState) => {
    currentGameState = newState;
    updateUI();
});

socket.on('map_updated', (newMapData) => {
    mapData = newMapData;
});

function updateUI() {
    if (!currentGameState.players || !currentGameState.players[myPlayerId]) return;
    
    const me = currentGameState.players[myPlayerId];
    document.getElementById('my-role').innerText = me.role;
    document.getElementById('my-city').innerText = me.city;

    const descEl = document.getElementById('my-role-desc');
    if (descEl) descEl.innerText = roleDescriptions[me.role];

    // --- ІНДИКАТОР ХОДУ ---
    if (currentGameState.turnOrder && currentGameState.turnOrder.length > 0) {
        if (currentGameState.currentTurnIndex >= currentGameState.turnOrder.length) {
            currentGameState.currentTurnIndex = 0; 
        }

        const activePlayerId = currentGameState.turnOrder[currentGameState.currentTurnIndex];
        const isMyTurn = (activePlayerId === myPlayerId);
        const activePlayer = currentGameState.players[activePlayerId];

        const turnIndicator = document.getElementById('turn-indicator');
        const endTurnBtn = document.getElementById('end-turn-btn');
        const actionsSpan = document.getElementById('my-actions');

        if (isMyTurn) {
            turnIndicator.innerText = "🟢 Ваш хід!";
            turnIndicator.style.color = "#48bb78";
            actionsSpan.innerText = currentGameState.actionsLeft;
            actionsSpan.style.color = "#48bb78";
            endTurnBtn.style.display = "block";
        } else {
            if (activePlayer) {
                turnIndicator.innerText = `⏳ Ходить: ${activePlayer.role}`;
            } else {
                turnIndicator.innerText = "⏳ Очікування гравців...";
            }
            turnIndicator.style.color = "#f56565";
            actionsSpan.innerText = "Очікування...";
            actionsSpan.style.color = "#a0aec0";
            endTurnBtn.style.display = "none";
        }
    }
}

// ==========================================
// ВІДМАЛЬОВКА КАРТИ (CANVAS)
// ==========================================

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (bgImage.complete) {
        ctx.drawImage(bgImage, 0, 0, canvas.width, canvas.height);
    } else {
        ctx.fillStyle = '#1a202c';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // 1. Лінії між містами
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    const drawnLines = new Set();

    for (const [cityName, cityData] of Object.entries(mapData)) {
        if (!cityData.connections) continue;
        
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

    // 2. Міста
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

    // 3. Гравці
    if (currentGameState.players) {
        Object.values(currentGameState.players).forEach(player => {
            const city = mapData[player.city];
            if (city) {
                const pos = getCoords(city.x, city.y);
                // Зелений - якщо це ми, Оранжевий - якщо інший гравець
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

// ==========================================
// КЕРУВАННЯ ГРОЮ
// ==========================================

const endTurnBtn = document.getElementById('end-turn-btn');
if (endTurnBtn) {
    endTurnBtn.addEventListener('click', () => {
        socket.emit('end_turn');
    });
}

// --- Alt+Drag для калібрування карти (якщо колись знадобиться) ---
let draggedCity = null;

canvas.addEventListener('mousedown', (e) => {
    if (!e.altKey) return; 
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    for (const [name, data] of Object.entries(mapData)) {
        const pos = getCoords(data.x, data.y);
        if (Math.hypot(x - pos.x, y - pos.y) < 20) {
            draggedCity = name;
            break;
        }
    }
});

canvas.addEventListener('mousemove', (e) => {
    if (draggedCity) {
        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) * (canvas.width / rect.width);
        const y = (e.clientY - rect.top) * (canvas.height / rect.height);
        mapData[draggedCity].x = x / SCALE_X;
        mapData[draggedCity].y = y / SCALE_Y;
    }
});

canvas.addEventListener('mouseup', () => {
    if (draggedCity) {
        socket.emit('update_city_coords', {
            name: draggedCity,
            x: Math.round(mapData[draggedCity].x),
            y: Math.round(mapData[draggedCity].y)
        });
        draggedCity = null;
    }
});

// --- Звичайний рух по карті ---
canvas.addEventListener('click', (e) => {
    if (e.altKey) return; // Якщо тягнемо місто - не рухати фішку
    if (currentGameState.status !== 'PLAYING') return;

    const activePlayerId = currentGameState.turnOrder[currentGameState.currentTurnIndex];
    if (activePlayerId !== myPlayerId) return; // Хід не наш
    if (currentGameState.actionsLeft <= 0) return; // Закінчились дії

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);

    for (const [cityName, cityData] of Object.entries(mapData)) {
        const pos = getCoords(cityData.x, cityData.y);
        const dist = Math.hypot(x - pos.x, y - pos.y);
        if (dist < 20) {
            socket.emit('move_player', cityName);
            break;
        }
    }
});