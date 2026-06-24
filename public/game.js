const socket = io();

// --- ЕЛЕМЕНТИ ДОМ ---
const lobbyView = document.getElementById('lobby-view');
const gameView = document.getElementById('game-view');
const btnReady = document.getElementById('btn-ready');
const lobbyPlayersList = document.getElementById('lobby-players');

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const bgImage = new Image();
bgImage.src = 'map.png';

let mapData = {};
let currentGameState = {};
let myPlayerId = null;

// Зберігає візуальні позиції фішок для плавного перельоту
let visualPlayers = {}; 

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
    lobbyPlayersList.innerHTML = '';
    
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
    myPlayerId = socket.id; 
    mapData = data.cities;
    currentGameState = data.gameState;
    
    lobbyView.style.display = 'none';
    gameView.style.display = 'flex';
    gameView.style.flexDirection = 'row';

    updateUI();
    draw(); 
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
        const btnTreat = document.getElementById('btn-treat'); // Знаходимо кнопку

        if (isMyTurn) {
            turnIndicator.innerText = "🟢 Ваш хід!";
            turnIndicator.style.color = "#48bb78";
            actionsSpan.innerText = currentGameState.actionsLeft;
            actionsSpan.style.color = "#48bb78";
            endTurnBtn.style.display = "block";
            
            // Показуємо кнопку лікування, якщо в місті є кубики
            if (currentGameState.infections[me.city] > 0) {
                btnTreat.style.display = "block";
                // Додаємо підказку на кнопку скільки кубиків зніметься
                btnTreat.innerText = me.role === "Медик" ? "💊 Вилікувати ВСІ кубики" : "💊 Вилікувати 1 кубик";
            } else {
                btnTreat.style.display = "none";
            }

        } else {
            if (activePlayer) {
                turnIndicator.innerText = `⏳ Ходить: ${activePlayer.role}`;
            } else {
                turnIndicator.innerText = "⏳ Очікування...";
            }
            turnIndicator.style.color = "#f56565";
            actionsSpan.innerText = "Очікування...";
            actionsSpan.style.color = "#a0aec0";
            endTurnBtn.style.display = "none";
            btnTreat.style.display = "none"; // Ховаємо, якщо не наш хід
        }
    }
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (bgImage.complete) {
        ctx.drawImage(bgImage, 0, 0, canvas.width, canvas.height);
    } else {
        ctx.fillStyle = '#1a202c';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // 1. Лінії між містами (на самому нижньому шарі)
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

    // 2. Міста та текст (середній шар)
    for (const [cityName, cityData] of Object.entries(mapData)) {
        const pos = getCoords(cityData.x, cityData.y);

        // Кружечок міста
        ctx.fillStyle = cityData.color;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 12, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.lineWidth = 2;
        ctx.strokeStyle = "white";
        ctx.stroke();
        
        // Текст (Назва міста) - розташовуємо під містом
        ctx.fillStyle = "white";
        ctx.font = "bold 14px Arial";
        ctx.shadowColor = "black";
        ctx.shadowBlur = 4; // Легка тінь для читабельності
        
        // Вимірюємо ширину тексту, щоб центрувати його відносно кружечка
        const textWidth = ctx.measureText(cityName).width;
        ctx.fillText(cityName, pos.x - (textWidth / 2), pos.y + 28);
        ctx.shadowBlur = 0; // Скидаємо тінь для наступних елементів
    }

    // 3. Кубики інфекцій (малюємо НАД містом)
    if (currentGameState.infections) {
        for (const [cityName, count] of Object.entries(currentGameState.infections)) {
            if (count > 0 && mapData[cityName]) {
                const pos = getCoords(mapData[cityName].x, mapData[cityName].y);
                const cubeColor = mapData[cityName].color;

                for (let i = 0; i < count; i++) {
                    ctx.fillStyle = cubeColor;
                    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
                    ctx.lineWidth = 2;
                    
                    // Зміщуємо кубики ВГОРУ від міста, щоб вони не перекривали назву
                    const cx = pos.x - 18 + (i * 14); // Рядком зліва направо
                    const cy = pos.y - 30; // Підняли вище
                    
                    // Додаємо тінь кубикам, щоб вони були об'ємними
                    ctx.shadowColor = "rgba(0, 0, 0, 0.7)";
                    ctx.shadowBlur = 4;
                    ctx.shadowOffsetX = 2;
                    ctx.shadowOffsetY = 2;

                    ctx.fillRect(cx, cy, 12, 12);
                    ctx.strokeRect(cx, cy, 12, 12);

                    // Скидаємо тінь
                    ctx.shadowBlur = 0;
                    ctx.shadowOffsetX = 0;
                    ctx.shadowOffsetY = 0;
                }
            }
        }
    }

    // 4. Гравці (фішки) (найвищий шар, з LERP)
    if (currentGameState.players) {
        Object.values(currentGameState.players).forEach((player, index) => {
            const targetCity = mapData[player.city];
            if (targetCity) {
                if (!visualPlayers[player.id]) {
                    visualPlayers[player.id] = { x: targetCity.x, y: targetCity.y };
                }

                const speed = 0.1; 
                visualPlayers[player.id].x += (targetCity.x - visualPlayers[player.id].x) * speed;
                visualPlayers[player.id].y += (targetCity.y - visualPlayers[player.id].y) * speed;

                const pos = getCoords(visualPlayers[player.id].x, visualPlayers[player.id].y);
                
                // Зсув фішок: щоб вони стояли навколо міста, а не рівно по центру
                const angle = (index / Object.keys(currentGameState.players).length) * Math.PI * 2;
                const radius = 15; // Відстань від центру міста
                const offsetX = Math.cos(angle) * radius;
                const offsetY = Math.sin(angle) * radius;

                ctx.fillStyle = player.id === myPlayerId ? "#48bb78" : "#ed8936";
                ctx.beginPath();
                ctx.arc(pos.x + offsetX, pos.y + offsetY, 9, 0, Math.PI * 2);
                
                // Тінь для фішок
                ctx.shadowColor = "rgba(0, 0, 0, 0.8)";
                ctx.shadowBlur = 5;
                ctx.shadowOffsetY = 3;
                ctx.fill();
                
                ctx.shadowBlur = 0; // Скидаємо
                ctx.shadowOffsetY = 0;

                ctx.strokeStyle = "white";
                ctx.lineWidth = 2;
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

canvas.addEventListener('click', (e) => {
    if (e.altKey) return; 
    if (currentGameState.status !== 'PLAYING') return;

    const activePlayerId = currentGameState.turnOrder[currentGameState.currentTurnIndex];
    if (activePlayerId !== myPlayerId) return; 
    if (currentGameState.actionsLeft <= 0) return; 

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

const btnTreat = document.getElementById('btn-treat');
if (btnTreat) {
    btnTreat.addEventListener('click', () => {
        socket.emit('treat_disease');
    });
}