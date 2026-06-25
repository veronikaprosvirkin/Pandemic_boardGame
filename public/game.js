const socket = io();

// Елементи DOM
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

let visualPlayers = {}; // Для плавної анімації

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
    "Медик": "💊 Виліковує всі кубики хвороби одного кольору за 1 дію.",
    "Вчений": "🔬 Для винайдення ліків потрібно лише 4 карти.",
    "Диспетчер": "🚁 Може рухати чужі фішки як свої.",
    "Дослідник": "📑 Може віддавати карти іншим гравцям.",
    "Фахівець із карантину": "🛑 Запобігає поширенню хвороб."
};

// ================== ЛОБІ ==================
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

// ================== СТАРТ ГРИ ==================
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

// ================== ІНТЕРФЕЙС (UI) ==================
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
        const btnTreat = document.getElementById('btn-treat');

        if (isMyTurn) {
            turnIndicator.innerText = "🟢 Ваш хід!";
            turnIndicator.style.color = "#48bb78";
            actionsSpan.innerText = currentGameState.actionsLeft;
            actionsSpan.style.color = "#48bb78";
            endTurnBtn.style.display = "block";

            // Показуємо кнопку лікування, якщо в місті є хвороба
            if (currentGameState.infections && currentGameState.infections[me.city] > 0) {
                btnTreat.style.display = "block";
                btnTreat.innerText = me.role === "Медик" ? "💊 Вилікувати ВСІ кубики" : "💊 Вилікувати 1 кубик";
            } else {
                btnTreat.style.display = "none";
            }

        } else {
            if (activePlayer) turnIndicator.innerText = `⏳ Ходить: ${activePlayer.role}`;
            turnIndicator.style.color = "#f56565";
            actionsSpan.innerText = "Очікування...";
            actionsSpan.style.color = "#a0aec0";
            endTurnBtn.style.display = "none";
            btnTreat.style.display = "none";
        }
    }
}

// ================== ВІДМАЛЬОВКА (CANVAS) ==================
function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (bgImage.complete) {
        ctx.drawImage(bgImage, 0, 0, canvas.width, canvas.height);
    } else {
        ctx.fillStyle = '#1a202c';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // 1. Лінії
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
        const textWidth = ctx.measureText(cityName).width;
        
        ctx.shadowColor = "black";
        ctx.shadowBlur = 4;
        ctx.fillText(cityName, pos.x - (textWidth / 2), pos.y + 28);
        ctx.shadowBlur = 0;
    }

    // 3. Кубики інфекцій (Над містом)
    if (currentGameState.infections) {
        for (const [cityName, count] of Object.entries(currentGameState.infections)) {
            if (count > 0 && mapData[cityName]) {
                const pos = getCoords(mapData[cityName].x, mapData[cityName].y);
                const cubeColor = mapData[cityName].color;

                for (let i = 0; i < count; i++) {
                    ctx.fillStyle = cubeColor;
                    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
                    ctx.lineWidth = 2;
                    
                    const cx = pos.x - 18 + (i * 14);
                    const cy = pos.y - 30;
                    
                    ctx.shadowColor = "rgba(0, 0, 0, 0.7)";
                    ctx.shadowBlur = 4;
                    ctx.shadowOffsetX = 2;
                    ctx.shadowOffsetY = 2;

                    ctx.fillRect(cx, cy, 12, 12);
                    ctx.strokeRect(cx, cy, 12, 12);

                    ctx.shadowBlur = 0;
                    ctx.shadowOffsetX = 0;
                    ctx.shadowOffsetY = 0;
                }
            }
        }
    }

    // 4. Гравці (Lerp анімація)
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
                const angle = (index / Object.keys(currentGameState.players).length) * Math.PI * 2;
                const radius = 15; 
                const offsetX = Math.cos(angle) * radius;
                const offsetY = Math.sin(angle) * radius;

                ctx.fillStyle = player.id === myPlayerId ? "#48bb78" : "#ed8936";
                ctx.beginPath();
                ctx.arc(pos.x + offsetX, pos.y + offsetY, 9, 0, Math.PI * 2);
                
                ctx.shadowColor = "rgba(0, 0, 0, 0.8)";
                ctx.shadowBlur = 5;
                ctx.shadowOffsetY = 3;
                ctx.fill();
                
                ctx.shadowBlur = 0; 
                ctx.shadowOffsetY = 0;

                ctx.strokeStyle = "white";
                ctx.lineWidth = 2;
                ctx.stroke();
            }
        });
    }

    // 5. ГЛОБАЛЬНА ПАНЕЛЬ НА КАРТІ (Північ)
    if (currentGameState.status === 'PLAYING') {
        const panelWidth = 400;
        const panelHeight = 50;
        const panelX = (canvas.width - panelWidth) / 2;
        const panelY = 15;

        ctx.fillStyle = "rgba(26, 32, 44, 0.85)";
        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(panelX, panelY, panelWidth, panelHeight, 10);
        } else {
            ctx.fillRect(panelX, panelY, panelWidth, panelHeight);
        }
        ctx.fill();
        
        ctx.strokeStyle = currentGameState.outbreaks >= 6 ? "#e53e3e" : "#4a5568";
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = "white";
        ctx.font = "bold 18px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        
        const infRate = currentGameState.infectionRate || 2;
        const outbrks = currentGameState.outbreaks || 0;
        
        ctx.fillText(`☣️ Швидкість інфекції: ${infRate}      |      💥 Спалахи: ${outbrks} / 8`, canvas.width / 2, panelY + (panelHeight / 2));
        
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
    }

    requestAnimationFrame(draw);
}

// ================== ДІЇ ГРАВЦЯ ==================
const endTurnBtn = document.getElementById('end-turn-btn');
if (endTurnBtn) {
    endTurnBtn.addEventListener('click', () => {
        socket.emit('end_turn');
    });
}

const btnTreat = document.getElementById('btn-treat');
if (btnTreat) {
    btnTreat.addEventListener('click', () => {
        socket.emit('treat_disease');
    });
}

// Рух по карті
canvas.addEventListener('click', (e) => {
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