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
    
    // Перевіряємо, чи достатньо гравців і чи всі готові
    let allReady = true;
    let playerCount = 0;

    Object.values(players).forEach(p => {
        playerCount++;
        if (!p.isReady) allReady = false;

        const li = document.createElement('li');
        // Додаємо стиль для списку
        li.style.padding = "10px";
        li.style.borderBottom = "1px solid #4a5568";
        li.style.color = p.isReady ? "#48bb78" : "#e2e8f0";
        li.innerHTML = `<strong>${p.name}</strong> - ${p.isReady ? 'Готовий ✔️' : 'Обирає...'}`;
        lobbyPlayersList.appendChild(li);
    });

    // Оновлюємо текст (замість [object...])
    const statusText = document.getElementById('lobby-status');
    if (statusText) {
        if (playerCount < 2) {
             statusText.innerText = "Очікуємо гравців... (мінімум 2)";
        } else if (!allReady) {
             statusText.innerText = "Чекаємо, поки всі натиснуть 'Готово'";
        } else {
             statusText.innerText = "Всі готові! Запускаємо гру...";
        }
    }
});

btnReady.addEventListener('click', () => {
    socket.emit('player_ready');
    btnReady.innerText = "ОЧІКУВАННЯ ІНШИХ...";
    btnReady.style.backgroundColor = "#718096"; // Робимо кнопку сірою ТІЛЬКИ ПІСЛЯ натискання
    btnReady.disabled = true;
});

socket.on('game_already_started', () => {
    lobbyView.innerHTML = "<div class='panel lobby-panel'><h2 class='text-blue'>Гра вже почалася!</h2><p class='text-gray'>Ви не можете приєднатися зараз.</p></div>";
});

// ================== СТАРТ ГРИ ==================
socket.on('game_started', (data) => {
    myPlayerId = socket.id; 
    mapData = data.cities;
    currentGameState = data.gameState;
    
    lobbyView.classList.add('is-hidden');
    gameView.classList.remove('is-hidden');
    gameView.classList.add('game-view-active');

    updateUI();
    draw(); 
});

socket.on('state_update', (newState) => {
    currentGameState = newState;
    updateUI();
});

// ================== ІНТЕРФЕЙС (UI) ==================
//ВІДМАЛЬОВКА КАРТ ГРАВЦЯ
    const isOverLimit = me.cards && me.cards.length > 7;
    const cardsContainer = document.getElementById('my-cards-container');
    if (cardsContainer) {
        cardsContainer.innerHTML = '';
        if (me.cards && me.cards.length > 0) {
            me.cards.forEach(cardCity => {
                const cardEl = document.createElement('div');
                const cityColor = mapData[cardCity] ? mapData[cardCity].color : "#718096";
                
                cardEl.innerText = cardCity;
                cardEl.className = 'player-card'; 
                cardEl.style.backgroundColor = cityColor; 
                
                // Якщо карт > 7, робимо їх клікабельними для скидання
                if (isOverLimit && isMyTurn) {
                    cardEl.style.cursor = "pointer";
                    cardEl.style.border = "2px solid #e53e3e"; // Червона рамка-підказка
                    cardEl.onclick = () => socket.emit('discard_card', cardCity);
                }

                cardsContainer.appendChild(cardEl);
            });
        } else {
            cardsContainer.innerHTML = '<span class="no-cards-text">Немає карт</span>';
        }
    }

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
        const btnBuild = document.getElementById('btn-build');

        if (isMyTurn) {
            turnIndicator.innerText = "🟢 Ваш хід!";
            turnIndicator.classList.remove('turn-indicator-waiting');
            turnIndicator.classList.add('turn-indicator-active');
            
            if (isOverLimit) {
                actionsSpan.innerText = "СКИНЬТЕ КАРТИ (натисніть на них)";
                actionsSpan.style.color = "#e53e3e";
                endTurnBtn.classList.add('is-hidden');
                if (btnTreat) btnTreat.style.display = "none";
                if (btnBuild) btnBuild.style.display = "none";
            } else {
                actionsSpan.innerText = currentGameState.actionsLeft;
                actionsSpan.style.color = "#ed8936";
                endTurnBtn.classList.remove('is-hidden');

                if (currentGameState.infections && currentGameState.infections[me.city] > 0) {
                    btnTreat.style.display = "block";
                    btnTreat.innerText = me.role === "Медик" ? "💊 Вилікувати ВСІ кубики" : "💊 Вилікувати 1 кубик";
                } else {
                    btnTreat.style.display = "none";
                }

                // Кнопка будівництва (якщо є карта міста і там ще немає станції)
                if (btnBuild) {
                    if (me.cards.includes(me.city) && (!currentGameState.researchStations || !currentGameState.researchStations.includes(me.city))) {
                        btnBuild.style.display = "block";
                    } else {
                        btnBuild.style.display = "none";
                    }
                }
            }
        } else {
            // ... (тут залишається твій код else для очікування)
            if (activePlayer) turnIndicator.innerText = `⏳ Ходить: ${activePlayer.role}`;
            turnIndicator.classList.remove('turn-indicator-active');
            turnIndicator.classList.add('turn-indicator-waiting');
            actionsSpan.innerText = "Очікування...";
            actionsSpan.style.color = "#a0aec0";
            endTurnBtn.classList.add('is-hidden');
            if(btnTreat) btnTreat.style.display = "none";
            if(btnBuild) btnBuild.style.display = "none";
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
    // 2.5. Дослідні станції (Білі будиночки)
    if (currentGameState.researchStations) {
        currentGameState.researchStations.forEach(stationCity => {
            if (mapData[stationCity]) {
                const pos = getCoords(mapData[stationCity].x, mapData[stationCity].y);
                ctx.fillStyle = "white";
                // Малюємо "будиночок"
                ctx.beginPath();
                ctx.moveTo(pos.x - 10, pos.y - 12);
                ctx.lineTo(pos.x + 10, pos.y - 12);
                ctx.lineTo(pos.x, pos.y - 24); // Дах
                ctx.fill();
                ctx.fillRect(pos.x - 7, pos.y - 12, 14, 10); // Основа
                
                ctx.strokeStyle = "black";
                ctx.lineWidth = 1;
                ctx.stroke();
            }
        });
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
        const infRate = currentGameState.infectionRate || 2;
        const outbrks = currentGameState.outbreaks || 0;
        const text = `☣️ Швидкість інфекції: ${infRate}      |      💥 Спалахи: ${outbrks} / 8`;

        ctx.font = "bold 18px Arial";
        const textWidth = ctx.measureText(text).width; // Вимірюємо ширину тексту
        
        const panelWidth = textWidth + 40; // Динамічна ширина (+ відступи)
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
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(text, canvas.width / 2, panelY + (panelHeight / 2));
        
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

const btnBuild = document.getElementById('btn-build');
if (btnBuild) {
    btnBuild.addEventListener('click', () => {
        socket.emit('build_station');
    });
}

// Рух по карті
canvas.addEventListener('click', (e) => {
    if (currentGameState.status !== 'PLAYING') return;

    const activePlayerId = currentGameState.turnOrder[currentGameState.currentTurnIndex];
    if (activePlayerId !== myPlayerId) return; 
    if (currentGameState.actionsLeft <= 0) return; 
    
    const me = currentGameState.players[myPlayerId];
    if (me.cards.length > 7) return;

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
// ==========================================
// СИСТЕМА СПЛИВАЮЧИХ ПОВІДОМЛЕНЬ
// ==========================================

function showNotification(message, type = 'card', cityColor = null) {
    let container = document.getElementById('notifications-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'notifications-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = 'toast-message';
    toast.innerHTML = message;
    
    // Застосовуємо стилі залежно від типу події
    if (type === 'card') {
        toast.classList.add('toast-card');
        toast.style.backgroundColor = cityColor || "#3182ce";
    } else if (type === 'infection') {
        toast.classList.add('toast-infection');
        if (cityColor) toast.style.borderLeftColor = cityColor; // Фарбуємо тільки смужку збоку
    } else if (type === 'epidemic') {
        toast.classList.add('toast-epidemic');
    }

    container.appendChild(toast);

    // Анімація появи
    setTimeout(() => toast.classList.add('show'), 10);

    // Зникнення через 4 секунди
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// 1. Сповіщення про взяті карти (тільки для поточного гравця)
socket.on('cards_drawn', (cards) => {
    cards.forEach(card => {
        const cityColor = mapData[card] ? mapData[card].color : "#4a5568";
        showNotification(`🃏 Ви отримали карту:<br><strong>${card}</strong>`, 'card', cityColor);
    });
});

// 2. Сповіщення про поширення хвороби (для всіх гравців)
socket.on('infection_drawn', (citiesList) => {
    citiesList.forEach(city => {
        const cityColor = mapData[city] ? mapData[city].color : "#e53e3e";
        showNotification(`☣️ Інфекція поширюється:<br><strong>${city}</strong>`, 'infection', cityColor);
    });
});

// 3. Сповіщення про Епідемію (для всіх гравців)
socket.on('epidemic_alert', (city) => {
    showNotification(`⚠️ ЕПІДЕМІЯ В МІСТІ<br><strong>${city}</strong>!`, 'epidemic');
});