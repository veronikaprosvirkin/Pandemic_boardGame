const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const bgImage = new Image();
bgImage.src = 'map.png';

let mapData = {};
let currentGameState = {};
let myPlayerId = null;

// КАЛІБРУВАННЯ КАРТИ: 
// Змінюй ці цифри, щоб посунути всі міста разом і підігнати під свою картинку.
// Судячи з фото, міста треба підняти десь на 100 пікселів вгору:
const OFFSET_X = 0;    // від'ємне число - вліво, додатнє - вправо
const OFFSET_Y = 0; // від'ємне число - вгору, додатнє - вниз

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
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    
    // Щоб не малювати ту саму лінію двічі
    const drawnLines = new Set();

    for (const [cityName, cityData] of Object.entries(mapData)) {
        cityData.connections.forEach(targetName => {
            const pairKey = [cityName, targetName].sort().join('-');
            
            if (!drawnLines.has(pairKey) && mapData[targetName]) {
                drawnLines.add(pairKey);
                
                const target = mapData[targetName];
                const startX = cityData.x + OFFSET_X;
                const startY = cityData.y + OFFSET_Y;
                const endX = target.x + OFFSET_X;
                const endY = target.y + OFFSET_Y;

                const dist = Math.hypot(startX - endX, startY - endY);

                ctx.beginPath();
                if (dist > 800) {
                    // МІСТА НА РІЗНИХ КІНЦЯХ СВІТУ
                    const leftCity = startX < endX ? {x: startX, y: startY} : {x: endX, y: endY};
                    const rightCity = startX > endX ? {x: startX, y: startY} : {x: endX, y: endY};

                    // Лінія від лівого міста за лівий край
                    ctx.moveTo(leftCity.x, leftCity.y);
                    ctx.lineTo(-50, leftCity.y);
                    
                    // Лінія від правого міста за правий край
                    ctx.moveTo(rightCity.x, rightCity.y);
                    ctx.lineTo(canvas.width + 50, rightCity.y);
                } else {
                    // Звичайна лінія
                    ctx.moveTo(startX, startY);
                    ctx.lineTo(endX, endY);
                }
                ctx.stroke();
            }
        });
    }

    // 3. Малюємо міста
    for (const [cityName, cityData] of Object.entries(mapData)) {
        const cx = cityData.x + OFFSET_X;
        const cy = cityData.y + OFFSET_Y;

        ctx.fillStyle = cityData.color;
        ctx.beginPath();
        ctx.arc(cx, cy, 12, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.lineWidth = 2;
        ctx.strokeStyle = "white";
        ctx.stroke();
        
        ctx.fillStyle = "white";
        ctx.font = "bold 14px Arial";
        ctx.shadowColor = "black";
        ctx.shadowBlur = 4;
        ctx.fillText(cityName, cx - 20, cy - 15);
        ctx.shadowBlur = 0;
    }

    // 4. Малюємо гравців
    if (currentGameState.players) {
        Object.values(currentGameState.players).forEach(player => {
            const city = mapData[player.city];
            if (city) {
                const cx = city.x + OFFSET_X;
                const cy = city.y + OFFSET_Y;

                ctx.fillStyle = player.id === myPlayerId ? "#48bb78" : "#ed8936";
                ctx.beginPath();
                ctx.arc(cx + 12, cy + 12, 9, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = "white";
                ctx.stroke();
            }
        });
    }

    requestAnimationFrame(draw);
}

// Обробка кліків
canvas.addEventListener('click', (event) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const mouseX = (event.clientX - rect.left) * scaleX;
    const mouseY = (event.clientY - rect.top) * scaleY;

    for (const [cityName, cityData] of Object.entries(mapData)) {
        // Додаємо OFFSET і для кліків, щоб зона натискання збігалася з відмальованим містом
        const cx = cityData.x + OFFSET_X;
        const cy = cityData.y + OFFSET_Y;

        const dist = Math.hypot(mouseX - cx, mouseY - cy);
        if (dist < 20) {
            socket.emit('move_player', cityName);
            break;
        }
    }
});

draw();