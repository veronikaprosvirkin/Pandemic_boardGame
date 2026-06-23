const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const bgImage = new Image();
bgImage.src = 'map.png'; // Переконайся, що назва мапи правильна (map.png чи map.jpg)

let mapData = {};
let currentGameState = {};
let myPlayerId = null;

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

// Словник описів
const roleDescriptions = {
    "Медик": "💊 Виліковує всі кубики хвороби одного кольору за 1 дію. Якщо ліки знайдено — лікує автоматично.",
    "Вчений": "🔬 Для винайдення ліків потрібно лише 4 карти одного кольору замість 5.",
    "Диспетчер": "🚁 Може рухати чужі фішки як свої. За 1 дію може перемістити будь-яку фішку в місто, де є інша.",
    "Дослідник": "📑 Може віддати будь-яку карту міста гравцю, який знаходиться з ним в одному місті.",
    "Фахівець із карантину": "🛑 Запобігає появі нових кубиків хвороб та спалахам у місті, де стоїть, та в усіх сусідніх."
};

socket.on('init_game', (data) => {
    mapData = data.cities;
    currentGameState = data.gameState;
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
    if (!currentGameState.players || !currentGameState.players[myPlayerId]) return;
    
    const me = currentGameState.players[myPlayerId];
    document.getElementById('my-role').innerText = me.role;
    document.getElementById('my-city').innerText = me.city;

    const descEl = document.getElementById('my-role-desc');
    if (descEl) descEl.innerText = roleDescriptions[me.role];

    // --- ЛОГІКА ХОДІВ ---
    const turnIndicator = document.getElementById('turn-indicator');
    const endTurnBtn = document.getElementById('end-turn-btn');
    const actionsSpan = document.getElementById('my-actions');

    if (currentGameState.turnOrder && currentGameState.turnOrder.length > 0) {
        // Перевіряємо, чи індекс не вийшов за межі масиву (якщо хтось вийшов)
        if (currentGameState.currentTurnIndex >= currentGameState.turnOrder.length) {
            currentGameState.currentTurnIndex = 0; 
        }

        const activePlayerId = currentGameState.turnOrder[currentGameState.currentTurnIndex];
        const isMyTurn = (activePlayerId === myPlayerId);
        const activePlayer = currentGameState.players[activePlayerId];

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
    } else {
         // Якщо черга порожня (старт гри), даємо ходити
         turnIndicator.innerText = "🟢 Ваш хід!";
         turnIndicator.style.color = "#48bb78";
         actionsSpan.innerText = currentGameState.actionsLeft;
         actionsSpan.style.color = "#48bb78";
         endTurnBtn.style.display = "block";
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

    // Лінії
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

    // Міста
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

    // Гравці (фішки)
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

// Кнопка завершення ходу
const endTurnBtn = document.getElementById('end-turn-btn');
if (endTurnBtn) {
    endTurnBtn.addEventListener('click', () => {
        socket.emit('end_turn');
    });
}

// Кліки по карті для руху
canvas.addEventListener('click', (e) => {
    if (!currentGameState.turnOrder) return;
    
    const activePlayerId = currentGameState.turnOrder[currentGameState.currentTurnIndex];
    
    // БЛОКУВАННЯ: ігноруємо клік, якщо хід не наш або закінчилися дії
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

draw();