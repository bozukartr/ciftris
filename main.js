document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('tetris');
    const nextCanvas = document.getElementById('next');
    const scoreElement = document.getElementById('score');
    const finalScoreElement = document.getElementById('final-score');
    const playerRoleElement = document.getElementById('player-role');
    const roomIdDisplay = document.getElementById('room-id');
    const waitingRoomIdDisplay = document.getElementById('waiting-room-id');

    // UI Panels
    const menuPanel = document.getElementById('menu');
    const waitingPanel = document.getElementById('waiting');
    const gameOverPanel = document.getElementById('game-over');
    const overlay = document.getElementById('overlay');
    const roleIndicator = document.getElementById('role-indicator');
    const roomInfo = document.getElementById('room-info');

    const game = new Game(canvas, nextCanvas);
    const mp = new Multiplayer(game);

    let dropInterval = 1000;
    let lastTime = 0;
    let dropCounter = 0;

    function resetUI() {
        menuPanel.classList.add('hidden');
        waitingPanel.classList.add('hidden');
        gameOverPanel.classList.add('hidden');
        overlay.classList.add('hidden');
    }

    function showRole() {
        roleIndicator.classList.remove('hidden');
        roomInfo.classList.remove('hidden');

        const isMover = mp.playerRole === 'mover';
        playerRoleElement.innerText = isMover ? 'HAREKET' : 'DÖNDÜR';
        playerRoleElement.className = isMover ? 'mover' : 'rotator';
    }

    // Game Loop
    function update(time = 0) {
        if (game.gameOver) return;

        const deltaTime = time - lastTime;
        lastTime = time;

        if (mp.isHost && mp.otherPlayerJoined) {
            dropCounter += deltaTime;
            if (dropCounter > dropInterval) {
                game.move(0, 1);
                dropCounter = 0;
            }
        }

        requestAnimationFrame(update);
    }

    // Multiplayer Callbacks
    mp.onOpponentJoin = () => {
        resetUI();
        showRole();
        if (mp.isHost) {
            game.reset();
            update();
        }
    };

    game.onGameOver = (score) => {
        resetUI();
        overlay.classList.remove('hidden');
        gameOverPanel.classList.remove('hidden');
        finalScoreElement.innerText = score;
    };

    // Button Listeners
    document.getElementById('create-btn').addEventListener('click', async () => {
        try {
            const id = await mp.createRoom();
            menuPanel.classList.add('hidden');
            waitingPanel.classList.remove('hidden');
            waitingRoomIdDisplay.innerText = id;
            roomIdDisplay.innerText = id;
        } catch (e) {
            alert('Oda oluşturulamadı: ' + e.message);
        }
    });

    document.getElementById('join-btn').addEventListener('click', async () => {
        const id = document.getElementById('join-input').value;
        if (!id) return alert('Lütfen oda kodu girin');
        try {
            await mp.joinRoom(id);
            roomIdDisplay.innerText = id.toUpperCase();
            resetUI();
            showRole();
            update();
        } catch (e) {
            alert('Odaya katılamadı: ' + e.message);
        }
    });

    document.getElementById('restart-btn').addEventListener('click', () => {
        location.reload();
    });

    // Controls
    const handleAction = (action) => {
        if (game.gameOver) return;

        switch (action) {
            case 'left': mp.sendAction('move', -1, 0); break;
            case 'right': mp.sendAction('move', 1, 0); break;
            case 'down': mp.sendAction('move', 0, 1); break;
            case 'rotate': mp.sendAction('rotate'); break;
        }
    };

    // Click controls
    document.getElementById('left-btn').addEventListener('click', () => handleAction('left'));
    document.getElementById('right-btn').addEventListener('click', () => handleAction('right'));
    document.getElementById('down-btn').addEventListener('click', () => handleAction('down'));
    document.getElementById('rotate-btn').addEventListener('click', () => handleAction('rotate'));

    // Keyboard controls (for desktop testing)
    document.addEventListener('keydown', (e) => {
        switch (e.keyCode) {
            case 37: handleAction('left'); break;
            case 38: handleAction('rotate'); break;
            case 39: handleAction('right'); break;
            case 40: handleAction('down'); break;
        }
    });

    window.addEventListener('resize', () => game.resize());
});
