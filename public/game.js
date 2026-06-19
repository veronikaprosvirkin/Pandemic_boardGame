const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Завантажуємо фон
const bgImage = new Image();
bgImage.src = 'map.jpg'; // Назва твоєї картинки в папці public

let mapData = {};
let currentGameState = {};
let myPlayerId = null;

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

    // 1. Малюємо фон
    if (bgImage.complete) {
        ctx.drawImage(bgImage, 0, 0, canvas.width, canvas.height);
    } else {
        ctx.fillStyle = '#1a202c';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // 2. Малюємо зв'язки (лінії)
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)'; // Напівпрозорі білі лінії
    for (const [cityName, cityData] of Object.entries(mapData)) {
        cityData.connections.forEach(targetName => {
            const target = mapData[targetName];
            if (target) {
                const dist = Math.hypot(cityData.x - target.x, cityData.y - target.y);
                // Малюємо лінію ТІЛЬКИ якщо міста не на різних кінцях світу
                if (dist < 800) { 
                    ctx.beginPath();
                    ctx.moveTo(cityData.x, cityData.y);
                    ctx.lineTo(target.x, target.y);
                    ctx.stroke();
                }
            }
        });
    }

    // 3. Малюємо міста
    for (const [cityName, cityData] of Object.entries(mapData)) {
        ctx.fillStyle = cityData.color;
        ctx.beginPath();
        ctx.arc(cityData.x, cityData.y, 12, 0, Math.PI * 2);
        ctx.fill();
        
        // Обводка для міст
        ctx.lineWidth = 2;
        ctx.strokeStyle = "white";
        ctx.stroke();
        
        // Назви міст
        ctx.fillStyle = "white";
        ctx.font = "bold 14px Arial";
        // Тінь для тексту, щоб читалось на будь-якому фоні
        ctx.shadowColor = "black";
        ctx.shadowBlur = 4;
        ctx.fillText(cityName, cityData.x - 20, cityData.y - 15);
        ctx.shadowBlur = 0; // вимикаємо тінь для інших елементів
    }

    // 4. Малюємо гравців
    if (currentGameState.players) {
        Object.values(currentGameState.players).forEach(player => {
            const city = mapData[player.city];
            if (city) {
                ctx.fillStyle = player.id === myPlayerId ? "#48bb78" : "#ed8936";
                ctx.beginPath();
                ctx.arc(city.x + 12, city.y + 12, 9, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = "white";
                ctx.stroke();
            }
        });
    }

    requestAnimationFrame(draw);
}

canvas.addEventListener('click', (event) => {
    const rect = canvas.getBoundingClientRect();
    
    // Вираховуємо масштаб, оскільки CSS тепер розтягує або звужує canvas
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    // Коригуємо координати миші з урахуванням масштабу
    const mouseX = (event.clientX - rect.left) * scaleX;
    const mouseY = (event.clientY - rect.top) * scaleY;

    for (const [cityName, cityData] of Object.entries(mapData)) {
        const dist = Math.hypot(mouseX - cityData.x, mouseY - cityData.y);
        if (dist < 20) {
            socket.emit('move_player', cityName);
            break;
        }
    }
});

draw();