const playerIdKey = 'pandemic_playerId';
let playerId = localStorage.getItem(playerIdKey);
if (!playerId) {
    playerId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(playerIdKey, playerId);
}

const socket = io();
socket.emit('register_player', playerId);
socket.on('connect', () => {
    socket.emit('register_player', playerId);
});

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
let myPlayerId = playerId;

let visualPlayers = {}; 
let activeSelectionMode = null;

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

function getCityInfectionEntries(cityName) {
    if (!currentGameState.infections || !currentGameState.infections[cityName]) return [];

    const raw = currentGameState.infections[cityName];
    if (typeof raw === 'number') {
        const nativeColor = mapData[cityName] ? mapData[cityName].color : null;
        if (!nativeColor || raw <= 0) return [];
        return [[nativeColor, raw]];
    }

    if (typeof raw !== 'object') return [];

    return Object.entries(raw).filter(([, count]) => count > 0);
}
function hasAnyInfections(cityName) {
    return getCityInfectionEntries(cityName).length > 0;
}

function estimateInitialPlayerDeckSize(state) {
    if (!state || !state.players || !mapData) return 0;

    const playerCount = Object.keys(state.players).length;
    let initialCards = 2;
    if (playerCount === 2) initialCards = 4;
    if (playerCount === 3) initialCards = 3;

    const cityCardCount = Object.keys(mapData).length;
    const eventCardCount = 5;
    const epidemicCount = 4;

    return cityCardCount + eventCardCount + epidemicCount - (playerCount * initialCards);
}

function colorLabel(hexColor) {
    const labels = {
        '#2b6cb0': 'Синя',
        '#d69e2e': 'Жовта',
        '#e53e3e': 'Червона',
        '#1a202c': 'Чорна',
        '#000000': 'Чорна'
    };
    return labels[hexColor] || hexColor;
}

const roleDescriptions = {
    "Медик": "💊 Виліковує всі кубики хвороби одного кольору за 1 дію.",
    "Вчений": "🔬 Для винайдення ліків потрібно лише 4 карти.",
    "Диспетчер": "🚁 Може рухати чужі фішки як свої.",
    "Дослідник": "📑 Може віддавати карти іншим гравцям.",
    "Фахівець із карантину": "🛑 Запобігає поширенню хвороб.",
    "Інженер": "🛠️ Може будувати дослідну станцію у своєму місті без карти."
};

const eventCardLabels = {
    'EVENT_ONE_QUIET_NIGHT': 'Спокійна ніч',
    'EVENT_GOVERNMENT_GRANT': 'Державна підтримка',
    'EVENT_AIRLIFT': 'Повітряний міст',
    'EVENT_FORECAST': 'Прогноз',
    'EVENT_RESILIENT_POPULATION': 'Імунітет'
};

const eventCardDescriptions = {
    EVENT_ONE_QUIET_NIGHT: 'Наступна фаза інфекції буде пропущена.',
    EVENT_GOVERNMENT_GRANT: 'Побудуйте дослідницьку станцію у будь-якому місті.',
    EVENT_AIRLIFT: 'Перемістіть будь-якого гравця у будь-яке місто.',
    EVENT_RESILIENT_POPULATION: 'Назавжди приберіть 1 карту з discard infection.',
    EVENT_FORECAST: 'Перегляньте 6 верхніх карт infection deck і змініть їх порядок.'
};

let activeEventModal = null;

const eventCardsContainer = document.getElementById('event-cards-container');
const engineerFlightMenu = document.getElementById('engineer-flight-menu');
const engineerFlightCardSelect = document.getElementById('engineer-flight-card-select');
const engineerFlightCitySelect = document.getElementById('engineer-flight-city-select');
const btnEngineerFlight = document.getElementById('btn-engineer-flight');

const eventModal = document.getElementById('event-modal');
const eventModalTitle = document.getElementById('event-modal-title');
const eventModalDesc = document.getElementById('event-modal-desc');
const eventModalBody = document.getElementById('event-modal-body');
const eventModalCancel = document.getElementById('event-modal-cancel');
const eventModalConfirm = document.getElementById('event-modal-confirm');
const treatColorSelect = document.getElementById('treat-color-select');

socket.on('lobby_update', (players) => {
    lobbyPlayersList.innerHTML = '';
    
    let allReady = true;
    let playerCount = 0;

    Object.values(players).forEach(p => {
        playerCount++;
        if (!p.isReady) allReady = false;

        const li = document.createElement('li');
        li.style.padding = "10px";
        li.style.borderBottom = "1px solid #4a5568";
        li.style.color = p.isReady ? "#48bb78" : "#e2e8f0";
        li.innerHTML = `<strong>${p.name}</strong> - ${p.isReady ? 'Готовий ✔️' : 'Обирає...'}`;
        lobbyPlayersList.appendChild(li);
    });

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

    const myLobbyPlayer = players[myPlayerId];
    if (myLobbyPlayer && myLobbyPlayer.isReady) {
        btnReady.innerText = "ОЧІКУВАННЯ ІНШИХ...";
        btnReady.style.backgroundColor = "#718096";
        btnReady.disabled = true;
    }
});

btnReady.addEventListener('click', () => {
    socket.emit('player_ready');
    btnReady.innerText = "ОЧІКУВАННЯ ІНШИХ...";
    btnReady.style.backgroundColor = "#718096"; 
    btnReady.disabled = true;
});

socket.on('game_already_started', () => {
    lobbyView.innerHTML = "<div class='panel lobby-panel'><h2 class='text-blue'>Гра вже почалася!</h2><p class='text-gray'>Ви не можете приєднатися зараз.</p></div>";
});

let isDrawLoopRunning = false;

socket.on('game_started', (data) => {
    mapData = data.cities;
    currentGameState = data.gameState;
    currentGameState.deckSize = data.deckSize !== undefined ? data.deckSize : estimateInitialPlayerDeckSize(data.gameState);
    
    lobbyView.classList.add('is-hidden');
    gameView.classList.remove('is-hidden');
    gameView.classList.add('game-view-active');

    updateUI();
    if (!isDrawLoopRunning) {
        isDrawLoopRunning = true;
        draw(); 
    }
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

    const isOverLimit = me.cards && me.cards.length > 7;
    const cardsContainer = document.getElementById('my-cards-container');
    const eventCardsContainer = document.getElementById('event-cards-container');
    
    if (cardsContainer && eventCardsContainer) {
        cardsContainer.innerHTML = '';
        eventCardsContainer.innerHTML = '';
        
        // РОЗДІЛЯЄМО КАРТИ МІСТ ТА ПОДІЙ
        const cityCards = me.cards ? me.cards.filter(c => !c.startsWith('EVENT_')) : [];
        const eventCards = me.cards ? me.cards.filter(c => c.startsWith('EVENT_')) : [];

        // 1. МАЛЮЄМО КАРТИ МІСТ
        if (cityCards.length > 0) {
            cityCards.forEach(cardCity => {
                const cardEl = document.createElement('div');
                const cityColor = mapData[cardCity] ? mapData[cardCity].color : "#718096";
                cardEl.innerText = cardCity;
                cardEl.className = 'player-card'; 
                cardEl.style.backgroundColor = cityColor; 
                if (isOverLimit) {
                    cardEl.style.cursor = "pointer";
                    cardEl.style.border = "2px solid #e53e3e"; 
                    cardEl.onclick = () => socket.emit('discard_card', cardCity);
                }
                cardsContainer.appendChild(cardEl);
            });
        } else {
            cardsContainer.innerHTML = '<span class="no-cards-text">Немає карт міст</span>';
        }

        // 2. МАЛЮЄМО КАРТИ ПОДІЙ
        if (eventCards.length > 0) {
            eventCards.forEach(card => {
                const cardEl = document.createElement('div');
                cardEl.className = 'player-card'; 
                cardEl.style.backgroundColor = "#805ad5"; // Фіолетовий колір для подій
                cardEl.innerHTML = `<strong style="font-size:12px;">${eventCardLabels[card]}</strong>`;
                
                // Кнопка для використання події
                if (currentGameState.status === 'PLAYING') {
                    const btnPlay = document.createElement('button');
                    btnPlay.innerText = "Зіграти";
                    btnPlay.className = "action-button event-card-play";
                    btnPlay.style.marginTop = "5px";
                    btnPlay.style.padding = "4px";
                    btnPlay.style.fontSize = "11px";
                    btnPlay.onclick = () => handlePlayEventCard(card);
                    cardEl.appendChild(btnPlay);
                }
                eventCardsContainer.appendChild(cardEl);
            });
        } else {
            eventCardsContainer.innerHTML = '<span class="no-cards-text">Немає карт подій</span>';
        }
        
        // 3. МЕНЮ ПЕРЕЛЬОТУ ІНЖЕНЕРА
        const engineerFlightMenu = document.getElementById('engineer-flight-menu');
        if (engineerFlightMenu) {
            const isMyTurn = currentGameState.turnOrder[currentGameState.currentTurnIndex] === myPlayerId;
            const onStation = currentGameState.researchStations && currentGameState.researchStations.includes(me.city);
            
            if (isMyTurn && me.role === "Інженер" && onStation && cityCards.length > 0) {
                engineerFlightMenu.classList.remove('is-hidden');
                engineerFlightCardSelect.innerHTML = '';
                engineerFlightCitySelect.innerHTML = '';
                cityCards.forEach(c => engineerFlightCardSelect.innerHTML += `<option value="${c}">Скинути: ${c}</option>`);
                Object.keys(mapData).forEach(c => engineerFlightCitySelect.innerHTML += `<option value="${c}">Летіти в: ${c}</option>`);
            } else {
                engineerFlightMenu.classList.add('is-hidden');
            }
        }
    }

    if (currentGameState.turnOrder && currentGameState.turnOrder.length > 0) {
        const isMyTurn = (currentGameState.turnOrder[currentGameState.currentTurnIndex] === myPlayerId);
        const activePlayer = currentGameState.players[currentGameState.turnOrder[currentGameState.currentTurnIndex]];

        const turnIndicator = document.getElementById('turn-indicator');
        const endTurnBtn = document.getElementById('end-turn-btn');
        const actionsSpan = document.getElementById('my-actions');
        
        const btnTreat = document.getElementById('btn-treat');
        const btnBuild = document.getElementById('btn-build');
        const btnCure = document.getElementById('btn-cure'); 
        const dispatcherMenu = document.getElementById('dispatcher-menu');
        const dispatcherSelect = document.getElementById('dispatcher-select');
        const tradeMenu = document.getElementById('trade-menu');
        const tradeSelect = document.getElementById('trade-select');

        if (isMyTurn) {
            turnIndicator.innerText = "🟢 Ваш хід!";
            turnIndicator.classList.remove('turn-indicator-waiting');
            turnIndicator.classList.add('turn-indicator-active');
            
            if (isOverLimit) {
                actionsSpan.innerText = "СКИНЬТЕ КАРТИ";
                actionsSpan.style.color = "#e53e3e";
                endTurnBtn.classList.add('is-hidden');
                if (btnTreat) btnTreat.classList.add('is-hidden');
                if (treatColorSelect) {
                    treatColorSelect.classList.add('is-hidden');
                    treatColorSelect.innerHTML = '';
                }
                if (btnBuild) btnBuild.classList.add('is-hidden');
                if (btnCure) btnCure.classList.add('is-hidden'); 
                if (dispatcherMenu) dispatcherMenu.classList.add('is-hidden');
                if (tradeMenu) tradeMenu.classList.add('is-hidden');
            } else {
                actionsSpan.innerText = currentGameState.actionsLeft;
                actionsSpan.style.color = "#ed8936";
                endTurnBtn.classList.remove('is-hidden');

                // 1. ЛІКУВАННЯ
                const treatEntries = getCityInfectionEntries(me.city);
                if (treatEntries.length > 0) {
                    btnTreat.classList.remove('is-hidden');

                    if (treatColorSelect) {
                        const previous = treatColorSelect.value;
                        treatColorSelect.innerHTML = '';
                        treatEntries.forEach(([hexColor, count]) => {
                            const option = document.createElement('option');
                            option.value = hexColor;
                            option.textContent = `${colorLabel(hexColor)} (${count})`;
                            treatColorSelect.appendChild(option);
                        });

                        if (previous && treatEntries.some(([hexColor]) => hexColor === previous)) {
                            treatColorSelect.value = previous;
                        }

                        treatColorSelect.classList.remove('is-hidden');

                        const selectedColor = treatColorSelect.value || treatEntries[0][0];
                        const isCuredSelected = currentGameState.cured && currentGameState.cured[selectedColor];
                        btnTreat.innerText = (me.role === "Медик" || isCuredSelected)
                            ? "💊 Вилікувати ВСІ кубики вибраного кольору"
                            : "💊 Вилікувати 1 кубик вибраного кольору";
                    }
                } else {
                    btnTreat.classList.add('is-hidden');
                    if (treatColorSelect) {
                        treatColorSelect.classList.add('is-hidden');
                        treatColorSelect.innerHTML = '';
                    }
                }
                
                // 2. БУДІВНИЦТВО
                if (btnBuild) {
                    const hasStationHere = currentGameState.researchStations && currentGameState.researchStations.includes(me.city);
                    const canBuild = !hasStationHere && (me.role === "Інженер" || me.cards.includes(me.city));
                    
                    if (canBuild) {
                        btnBuild.classList.remove('is-hidden');
                        btnBuild.innerText = me.role === "Інженер" ? "🛠️ Побудувати станцію (Безкоштовно)" : "🏗️ Побудувати станцію (Скинути карту)";
                    } else {
                        btnBuild.classList.add('is-hidden');
                    }
                }

                // 3. ВАКЦИНА
                if (btnCure) {
                    const atStation = currentGameState.researchStations && currentGameState.researchStations.includes(me.city);
                    const neededCureCards = me.role === "Вчений" ? 4 : 5;
                    let canCure = false;
                    
                    if (atStation && me.cards) {
                        const colorsCount = {};
                        me.cards.forEach(c => {
                            if (mapData[c]) {
                                const col = mapData[c].color;
                                colorsCount[col] = (colorsCount[col] || 0) + 1;
                            }
                        });
                        
                        if (!currentGameState.cured) currentGameState.cured = {};
                        for (const [col, count] of Object.entries(colorsCount)) {
                            if (count >= neededCureCards && !currentGameState.cured[col]) {
                                canCure = true;
                                break;
                            }
                        }
                    }
                    
                    if (canCure) {
                        btnCure.classList.remove('is-hidden');
                        btnCure.innerText = me.role === "Вчений" ? "🧪 Винайти ліки (4 карти)" : "🧪 Винайти ліки (5 карт)";
                    } else {
                        btnCure.classList.add('is-hidden');
                    }
                }

                // 4. МЕНЮ ДИСПЕТЧЕРА
                if (me.role === "Диспетчер") {
                    if (dispatcherMenu && dispatcherSelect) {
                        dispatcherMenu.classList.remove('is-hidden');
                        dispatcherSelect.innerHTML = `<option value="${myPlayerId}">Моя фішка (Диспетчер)</option>`;
                        Object.values(currentGameState.players).forEach(p => {
                            if (p.id !== myPlayerId) {
                                dispatcherSelect.innerHTML += `<option value="${p.id}">Фішка: ${p.role} (${p.city})</option>`;
                            }
                        });
                    }
                } else {
                    if (dispatcherMenu) dispatcherMenu.classList.add('is-hidden');
                }

                // 5. ОБМІН КАРТАМИ
                if (tradeMenu && tradeSelect) {
                    tradeSelect.innerHTML = ''; 
                    let hasTrades = false;

                    const otherPlayersHere = Object.values(currentGameState.players).filter(p => p.id !== myPlayerId && p.city === me.city);
                    const btnTradeConfirm = document.getElementById('btn-trade-confirm');

                    if (otherPlayersHere.length > 0) {
                        tradeMenu.classList.remove('is-hidden');
                        otherPlayersHere.forEach(other => {
                            if (me.role === "Дослідник") {
                                me.cards.forEach(c => {
                                    tradeSelect.innerHTML += `<option value="give|${other.id}|${c}">Віддати ${c} (${other.role})</option>`;
                                    hasTrades = true;
                                });
                            } else if (me.cards.includes(me.city)) {
                                tradeSelect.innerHTML += `<option value="give|${other.id}|${me.city}">Віддати ${me.city} (${other.role})</option>`;
                                hasTrades = true;
                            }

                            if (other.role === "Дослідник") {
                                other.cards.forEach(c => {
                                    tradeSelect.innerHTML += `<option value="take|${other.id}|${c}">Взяти ${c} (${other.role})</option>`;
                                    hasTrades = true;
                                });
                            } else if (other.cards.includes(me.city)) {
                                tradeSelect.innerHTML += `<option value="take|${other.id}|${me.city}">Взяти ${me.city} (${other.role})</option>`;
                                hasTrades = true;
                            }
                        });

                        if (!hasTrades) {
                            tradeSelect.innerHTML = `<option value="">Потрібна карта міста ${me.city}!</option>`;
                            if (btnTradeConfirm) {
                                btnTradeConfirm.disabled = true;
                                btnTradeConfirm.style.opacity = "0.5";
                                btnTradeConfirm.style.cursor = "not-allowed";
                            }
                        } else {
                            if (btnTradeConfirm) {
                                btnTradeConfirm.disabled = false;
                                btnTradeConfirm.style.opacity = "1";
                                btnTradeConfirm.style.cursor = "pointer";
                            }
                        }
                    } else {
                        tradeMenu.classList.add('is-hidden');
                    }
                }
            }
        } else {
            if (activePlayer) turnIndicator.innerText = `⏳ Ходить: ${activePlayer.role}`;
            turnIndicator.classList.remove('turn-indicator-active');
            turnIndicator.classList.add('turn-indicator-waiting');
            actionsSpan.innerText = "Очікування...";
            actionsSpan.style.color = "#a0aec0";
            
            endTurnBtn.classList.add('is-hidden');
            if (btnTreat) btnTreat.classList.add('is-hidden');
            if (treatColorSelect) {
                treatColorSelect.classList.add('is-hidden');
                treatColorSelect.innerHTML = '';
            }
            if (btnBuild) btnBuild.classList.add('is-hidden');
            if (btnCure) btnCure.classList.add('is-hidden'); 
            if (dispatcherMenu) dispatcherMenu.classList.add('is-hidden');
            if (tradeMenu) tradeMenu.classList.add('is-hidden');
        }
    }

    const curesContainer = document.getElementById('cures-container');
    if (curesContainer) {
        curesContainer.innerHTML = '';
        if (currentGameState.cured && Object.keys(currentGameState.cured).length > 0) {
            Object.entries(currentGameState.cured).forEach(([color, isCured]) => {
                if (isCured) {
                    const isEradicated = currentGameState.eradicated && currentGameState.eradicated[color];
                    const flask = document.createElement('div');
                    flask.innerText = isEradicated ? "✨" : "🧪"; // Магія знищення!
                    flask.className = "cure-flask"; 
                    if (isEradicated) {
                        flask.style.border = "2px solid gold";
                        flask.style.boxShadow = "0 0 10px gold";
                    }
                    flask.style.backgroundColor = color;
                    curesContainer.appendChild(flask);
                }
            });
        } else {
            curesContainer.innerHTML = '<span class="no-cards-text">Поки немає</span>';
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

    let reachableCities = [];
    let activeCity = null;
    const me = currentGameState.players ? currentGameState.players[myPlayerId] : null;
    const isMyTurn = currentGameState.status === 'PLAYING' && 
                     currentGameState.turnOrder && 
                     currentGameState.turnOrder[currentGameState.currentTurnIndex] === myPlayerId;

    if (isMyTurn && me) {
        let targetPawnId = myPlayerId;
        if (me.role === "Диспетчер") {
            const sel = document.getElementById('dispatcher-select');
            if (sel) targetPawnId = sel.value;
        }
        
        const movingPlayer = currentGameState.players[targetPawnId];
        if (movingPlayer) {
            activeCity = movingPlayer.city;
            const activeCityData = mapData[activeCity];
            
            if (activeCityData && activeCityData.connections) {
                reachableCities.push(...activeCityData.connections); 
            }
            if (me.role === "Диспетчер" && targetPawnId !== myPlayerId) {
                Object.values(currentGameState.players).forEach(p => {
                    if (p.id !== targetPawnId) reachableCities.push(p.city);
                });
            }
            if (me.cards) {
                reachableCities.push(...me.cards); 
                if (me.cards.includes(activeCity)) {
                    reachableCities = Object.keys(mapData); 
                }
            }
            const stations = currentGameState.researchStations || [];
            if (stations.includes(activeCity)) {
                reachableCities.push(...stations);
            }
        }
    }

    const time = Date.now();
    const pulse = (Math.sin(time / 150) + 1) / 2;
    const slowPulse = (Math.sin(time / 300) + 1) / 2;

    ctx.lineWidth = 3;
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

                const isReachablePath = isMyTurn && 
                    ((activeCity === cityName && reachableCities.includes(targetName)) || 
                     (activeCity === targetName && reachableCities.includes(cityName)));

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

                if (isReachablePath) {
                    ctx.lineWidth = 5;
                    ctx.strokeStyle = `rgba(237, 137, 54, ${0.4 + 0.6 * slowPulse})`;
                } else {
                    ctx.lineWidth = 3;
                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
                }
                ctx.stroke();
            }
        });
    }

    for (const [cityName, cityData] of Object.entries(mapData)) {
        const pos = getCoords(cityData.x, cityData.y);
        const hasStation = currentGameState.researchStations && currentGameState.researchStations.includes(cityName);
        const isReachable = isMyTurn && reachableCities.includes(cityName) && cityName !== activeCity;

        if (isReachable) {
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, 20 + (4 * slowPulse), 0, Math.PI * 2);
            ctx.fillStyle = `rgba(237, 137, 54, 0.3)`; 
            ctx.fill();
        }

        ctx.fillStyle = cityData.color;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, hasStation ? 14 : 12, 0, Math.PI * 2);
        ctx.fill();
        
        if (hasStation) {
            ctx.lineWidth = 4;
            ctx.strokeStyle = "#00ffff"; 
            ctx.shadowColor = "#00ffff";
            ctx.shadowBlur = 15; 
        } else {
            ctx.lineWidth = 2;
            ctx.strokeStyle = "white";
            ctx.shadowBlur = 0;
        }
        ctx.stroke();
        ctx.shadowBlur = 0; 
        
        ctx.fillStyle = "white"; 
        ctx.font = hasStation ? "bold 16px Arial" : "bold 14px Arial"; 
        
        const textToDraw = hasStation ? `🔬 ${cityName}` : cityName;
        const textWidth = ctx.measureText(textToDraw).width;
        const textX = pos.x - (textWidth / 2);
        const textY = pos.y - 20;

        ctx.lineWidth = 3;
        ctx.strokeStyle = "black";
        ctx.strokeText(textToDraw, textX, textY); 
        ctx.fillText(textToDraw, textX, textY);   
    }

    if (currentGameState.infections) {
        for (const cityName of Object.keys(currentGameState.infections)) {
            if (!mapData[cityName]) continue;

            const cubesByColor = getCityInfectionEntries(cityName);
            if (cubesByColor.length === 0) continue;

            const totalCubeCount = cubesByColor.reduce((sum, [, count]) => sum + count, 0);
            const pos = getCoords(mapData[cityName].x, mapData[cityName].y);
            const cubeSize = 12;
            const padding = 2;
            const totalWidth = (totalCubeCount * cubeSize) + ((totalCubeCount - 1) * padding);

            const startX = pos.x - (totalWidth / 2);
            const cy = pos.y + 16;
            let offset = 0;

            for (const [cubeColor, count] of cubesByColor) {
                for (let i = 0; i < count; i++) {
                    const cx = startX + (offset * (cubeSize + padding));

                    ctx.shadowColor = cubeColor === "#000000" ? "#a0aec0" : cubeColor;
                    ctx.shadowBlur = 4 + (10 * pulse);
                    ctx.shadowOffsetX = 0;
                    ctx.shadowOffsetY = 0;

                    ctx.globalAlpha = 0.7 + (0.3 * pulse);
                    ctx.fillStyle = cubeColor;
                    ctx.fillRect(cx, cy, cubeSize, cubeSize);

                    ctx.globalAlpha = 1.0;
                    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
                    ctx.lineWidth = 2;
                    ctx.strokeRect(cx, cy, cubeSize, cubeSize);

                    ctx.shadowBlur = 0;
                    offset++;
                }
            }
        }
    }

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

    if (currentGameState.status === 'PLAYING') {
        const infRate = currentGameState.infectionRate || 2;
        const outbrks = currentGameState.outbreaks || 0;
        
        const deckSize = currentGameState.deckSize !== undefined ? currentGameState.deckSize : estimateInitialPlayerDeckSize(currentGameState);
        const deckWarning = deckSize <= 5 ? '❗️' : '🃏';
        // ---------------------------

        const text = `☣️ Швидкість інфекції: ${infRate}   |   💥 Спалахи: ${outbrks} / 8   |   ${deckWarning} Карт у колоді: ${deckSize}`;

        ctx.font = "bold 18px Arial";
        const textWidth = ctx.measureText(text).width; 
        
        const panelWidth = textWidth + 40; 
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

const endTurnBtn = document.getElementById('end-turn-btn');
if (endTurnBtn) {
    endTurnBtn.addEventListener('click', () => {
        socket.emit('end_turn');
    });
}

const btnTradeConfirm = document.getElementById('btn-trade-confirm');
if (btnTradeConfirm) {
    btnTradeConfirm.addEventListener('click', () => {
        const val = document.getElementById('trade-select').value;
        if (!val) return;
        
        const parts = val.split('|'); 
        socket.emit('share_knowledge', { action: parts[0], targetId: parts[1], cardCity: parts[2] });
    });
}

const btnTreat = document.getElementById('btn-treat');
if (btnTreat) {
    btnTreat.addEventListener('click', () => {
        const selectedColor = treatColorSelect && !treatColorSelect.classList.contains('is-hidden')
            ? treatColorSelect.value
            : null;
        if (!selectedColor) return;
        socket.emit('treat_disease', { targetColor: selectedColor });
    });
}

const btnCure = document.getElementById('btn-cure');
if (btnCure) {
    btnCure.addEventListener('click', () => {
        socket.emit('discover_cure');
    });
}

const btnBuild = document.getElementById('btn-build');
if (btnBuild) {
    btnBuild.addEventListener('click', () => {
        socket.emit('build_station');
    });
}

canvas.addEventListener('click', (e) => {
    if (currentGameState.status !== 'PLAYING') return;

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);

    // Спочатку знаходимо, по якому місту клікнули
    let clickedCity = null;
    for (const [cityName, cityData] of Object.entries(mapData)) {
        const pos = getCoords(cityData.x, cityData.y);
        const dist = Math.hypot(x - pos.x, y - pos.y);
        if (dist < 20) {
            clickedCity = cityName;
            break;
        }
    }

    if (!clickedCity) return;

    // --- НОВА ЛОГІКА ДЛЯ КАРТ ПОДІЙ ---
    if (activeSelectionMode) {
        if (activeSelectionMode.type === 'GOVERNMENT_GRANT') {
            socket.emit('play_event_card', { eventCard: activeSelectionMode.cardId, targetCity: clickedCity });
        } else if (activeSelectionMode.type === 'AIRLIFT') {
            socket.emit('play_event_card', { eventCard: activeSelectionMode.cardId, targetPlayerId: activeSelectionMode.targetPlayerId, targetCity: clickedCity });
        }
        activeSelectionMode = null; // Вимикаємо "приціл"
        return; // Зупиняємо клік, щоб фішка випадково не пішла туди пішки
    }
    // ----------------------------------

    // --- СТАРА ЛОГІКА РУХУ ФІШОК ---
    const activePlayerId = currentGameState.turnOrder[currentGameState.currentTurnIndex];
    if (activePlayerId !== myPlayerId) return; 
    if (currentGameState.actionsLeft <= 0) return; 
    
    const me = currentGameState.players[myPlayerId];
    let targetPawnId = myPlayerId;
    
    if (me.role === "Диспетчер") {
        const sel = document.getElementById('dispatcher-select');
        if (sel) targetPawnId = sel.value;
    }
    
    socket.emit('move_player', { targetCity: clickedCity, pawnId: targetPawnId });
});

// КІНЕЦЬ ГРИ ТА СПОВІЩЕННЯ
socket.on('game_over', (data) => {
    const screen = document.getElementById('game-over-screen');
    const title = document.getElementById('game-over-title');
    const reason = document.getElementById('game-over-reason');

    if(screen) screen.classList.remove('is-hidden');
    
    if (data.win) {
        if(title) { title.innerText = "ПЕРЕМОГА!"; title.style.color = "#48bb78"; }
    } else {
        if(title) { title.innerText = "ПОРАЗКА"; title.style.color = "#e53e3e"; }
    }
    if(reason) reason.innerText = data.reason;
});

socket.on('max_stations_reached', () => {
    showNotification(`❌ Досягнуто ліміт! На карті вже є 6 станцій.`, 'epidemic');
});

socket.on('cure_discovered', (color) => {
    showNotification(`🧪 ВИНАЙДЕНО ЛІКИ!`, 'card', color);
});

socket.on('disease_eradicated', (color) => {
    showNotification(`🏆 ХВОРОБУ ЗНИЩЕНО! Кубики цього кольору більше не з'являться.`, 'card', color);
});

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
    
    if (type === 'card') {
        toast.classList.add('toast-card');
        toast.style.backgroundColor = cityColor || "#3182ce";
    } else if (type === 'infection') {
        toast.classList.add('toast-infection');
        if (cityColor) toast.style.borderLeftColor = cityColor; 
    } else if (type === 'epidemic') {
        toast.classList.add('toast-epidemic');
    }

    container.appendChild(toast);

    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 7000);
}

socket.on('cards_drawn', (cards) => {
    cards.forEach(card => {
        const cityColor = mapData[card] ? mapData[card].color : "#4a5568";
        showNotification(`🃏 Ви отримали карту:<br><strong>${card}</strong>`, 'card', cityColor);
    });
});

socket.on('infection_drawn', (citiesList) => {
    citiesList.forEach(city => {
        const cityColor = mapData[city] ? mapData[city].color : "#e53e3e";
        showNotification(`☣️ Інфекція поширюється:<br><strong>${city}</strong>`, 'infection', cityColor);
    });
});

socket.on('epidemic_alert', (city) => {
    showNotification(`⚠️ ЕПІДЕМІЯ В МІСТІ<br><strong>${city}</strong>!`, 'epidemic');
});

// ==========================================
// ЛОГІКА КАРТ ПОДІЙ ТА ІНЖЕНЕРА
// ==========================================

if (btnEngineerFlight) {
    btnEngineerFlight.addEventListener('click', () => {
        const discard = engineerFlightCardSelect.value;
        const target = engineerFlightCitySelect.value;
        if (discard && target) {
            socket.emit('move_player', { targetCity: target, pawnId: myPlayerId, discardCard: discard, specialFlight: true });
        }
    });
}

function handlePlayEventCard(cardId) {
    if (cardId === 'EVENT_ONE_QUIET_NIGHT') {
        socket.emit('play_event_card', cardId);
    } else if (cardId === 'EVENT_GOVERNMENT_GRANT') {
        // Замість списку вмикаємо режим кліку по мапі
        activeSelectionMode = { type: 'GOVERNMENT_GRANT', cardId: cardId };
        showNotification('📍 Клікніть на будь-яке місто на карті, щоб побудувати там станцію.', 'card', '#d69e2e');
    } else if (cardId === 'EVENT_AIRLIFT') {
        let html = `<select id="modal-player-select" class="trade-select modal-select-full">`;
        Object.values(currentGameState.players).forEach(p => html += `<option value="${p.id}">${p.role} (${p.city})</option>`);
        html += `</select>`;
        openEventModal('Повітряний міст', 'Оберіть гравця для переміщення, натисніть "Підтвердити", а ПОТІМ клікніть на місто на карті:', html, cardId);
    } else if (cardId === 'EVENT_RESILIENT_POPULATION' || cardId === 'EVENT_FORECAST') {
        socket.emit('play_event_card', { eventCard: cardId, mode: 'preview' });
    }
}

function openEventModal(title, desc, bodyHtml, cardId) {
    activeEventModal = cardId;
    eventModalTitle.innerText = title;
    eventModalDesc.innerText = desc;
    eventModalBody.innerHTML = bodyHtml;
    eventModal.classList.remove('is-hidden');
}

if (eventModalCancel) {
    eventModalCancel.onclick = () => {
        eventModal.classList.add('is-hidden');
        if (activeEventModal === 'EVENT_RESILIENT_POPULATION' || activeEventModal === 'EVENT_FORECAST') socket.emit('cancel_pending_event');
        activeEventModal = null;
    };
}

if (eventModalConfirm) {
    eventModalConfirm.onclick = () => {
        if (activeEventModal === 'EVENT_AIRLIFT') {
            const selectedPlayerId = document.getElementById('modal-player-select').value;
            activeSelectionMode = { type: 'AIRLIFT', cardId: activeEventModal, targetPlayerId: selectedPlayerId };
            showNotification('🚁 Тепер клікніть на карті місто, куди хочете перемістити гравця.', 'card', '#3182ce');
        } else if (activeEventModal === 'EVENT_GOVERNMENT_GRANT') {
        } else if (activeEventModal === 'EVENT_RESILIENT_POPULATION') {
            socket.emit('resolve_event_card', { selectedCard: document.getElementById('modal-resilient-select').value });
        } else if (activeEventModal === 'EVENT_FORECAST') {
            const items = document.querySelectorAll('.forecast-item');
            const ordered = Array.from(items).map(el => el.getAttribute('data-card'));
            socket.emit('resolve_event_card', { orderedCards: ordered });
        }
        eventModal.classList.add('is-hidden');
        activeEventModal = null;
    };
}

socket.on('resilient_population_ready', (data) => {
    if (data.discardCards.length === 0) {
        showNotification('Відбій інфекцій порожній!', 'error');
        socket.emit('cancel_pending_event');
        return;
    }
    let html = `<select id="modal-resilient-select" class="trade-select modal-select-full">`;
    data.discardCards.forEach(c => html += `<option value="${c}">${c}</option>`);
    html += `</select>`;
    openEventModal('Імунітет', 'Оберіть карту для ВИДАЛЕННЯ з гри:', html, data.eventCard);
});

socket.on('forecast_ready', (data) => {
    let html = `<p class="forecast-hint">(Верхня карта — перша у списку)</p>`;
    html += `<ul class="forecast-list">`;
    data.cards.forEach(c => {
        html += `<li class="forecast-item" data-card="${c}">
            <span>${c}</span>
            <div class="forecast-controls">
                <button class="btn-forecast-move" onclick="if(this.closest('li').previousElementSibling) this.closest('li').parentNode.insertBefore(this.closest('li'), this.closest('li').previousElementSibling)">⬆️</button>
                <button class="btn-forecast-move" onclick="if(this.closest('li').nextElementSibling) this.closest('li').parentNode.insertBefore(this.closest('li').nextElementSibling, this.closest('li'))">⬇️</button>
            </div>
        </li>`;
    });
    html += `</ul>`;
    openEventModal('Прогноз', 'Змініть порядок карт кнопками (Верхня випаде першою):', html, data.eventCard);
});

socket.on('quiet_night_skipped', () => {
    showNotification(`🌙 СПОКІЙНА НІЧ! Інфекція цього ходу не поширюється..`, 'card', '#805ad5');
});