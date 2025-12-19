document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('tetris');
    const nextCanvas = document.getElementById('next');
    const scoreElement = document.getElementById('score');
    const finalScoreElement = document.getElementById('final-score');
    const waitingRoomIdDisplay = document.getElementById('waiting-room-id');

    // UI Panels
    const menuPanel = document.getElementById('menu');
    const waitingPanel = document.getElementById('waiting');
    const gameOverPanel = document.getElementById('game-over');
    const overlay = document.getElementById('overlay');

    const game = new Game(canvas, nextCanvas);
    const mp = new Multiplayer(game);

    // Haptic & Audio Engines
    const Haptics = {
        unlocked: false,
        unlock() {
            if (this.unlocked) return;
            try {
                navigator.vibrate(0);
                this.unlocked = true;
            } catch (e) { }
        },
        vibrate(pattern) {
            if (!this.unlocked) return;
            try { navigator.vibrate(pattern); } catch (e) { }
        },
        tap: function () { this.vibrate(10); },
        heavy: function () { this.vibrate(30); },
        success: function () { this.vibrate([20, 30, 20]); }
    };

    const AudioEngine = {
        ctx: null,
        init() {
            if (!this.ctx) {
                this.ctx = new (window.AudioContext || window.webkitAudioContext)();
            }
        },
        play(freq, type, duration, vol = 0.1) {
            if (!this.ctx) return;
            if (this.ctx.state === 'suspended') this.ctx.resume();

            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
            gain.gain.setValueAtTime(vol, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start();
            osc.stop(this.ctx.currentTime + duration);
        },
        move() { this.play(200, 'sine', 0.05); },
        rotate() { this.play(400, 'sine', 0.1); },
        land() { this.play(150, 'square', 0.1, 0.05); },
        clear() {
            this.play(523.25, 'sine', 0.2); // C5
            setTimeout(() => this.play(659.25, 'sine', 0.3), 100); // E5
        },
        gameOver() { this.play(100, 'sawtooth', 0.8, 0.2); }
    };

    // Bind Score
    game.onScoreChange = (score) => {
        scoreElement.innerText = score;
        AudioEngine.clear(); // Play sound on score
    };

    // Disable browser behaviors
    document.addEventListener('contextmenu', e => e.preventDefault());

    // Prevent double-tap zoom
    let lastTouchEnd = 0;
    document.addEventListener('touchend', (e) => {
        const now = (new Date()).getTime();
        if (now - lastTouchEnd <= 300) {
            e.preventDefault();
        }
        lastTouchEnd = now;
    }, false);

    let dropInterval = 1000;
    let lastTime = 0;
    let dropCounter = 0;
    let isFastDropping = false;

    // Fast Drop Listeners (Touch & Mouse)
    const gameWrapper = document.getElementById('game-wrapper');
    const startFastDrop = (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
        if (e.cancelable && e.type.startsWith('touch')) e.preventDefault();
        isFastDropping = true;
    };
    const stopFastDrop = (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
        if (e.cancelable && e.type.startsWith('touch')) e.preventDefault();
        isFastDropping = false;
    };

    gameWrapper.addEventListener('touchstart', startFastDrop, { passive: false });
    gameWrapper.addEventListener('touchmove', (e) => {
        if (e.cancelable) e.preventDefault(); // Prevent scrolling while holding
    }, { passive: false });
    gameWrapper.addEventListener('touchend', stopFastDrop);
    gameWrapper.addEventListener('touchcancel', stopFastDrop);
    gameWrapper.addEventListener('mousedown', startFastDrop);
    gameWrapper.addEventListener('mouseup', stopFastDrop);
    gameWrapper.addEventListener('mouseleave', stopFastDrop);

    function resetUI() {
        menuPanel.classList.add('hidden');
        waitingPanel.classList.add('hidden');
        gameOverPanel.classList.add('hidden');
        overlay.classList.add('hidden');
    }

    // Game Loop
    function update(time = 0) {
        if (game.gameOver) return;

        const deltaTime = time - lastTime;
        lastTime = time;

        // Update particles always (independent of host/role)
        if (game.particles.length > 0) {
            game.updateParticles(deltaTime);
            game.draw(); // Force redraw to animate particles
        }

        if (mp.isHost && mp.otherPlayerJoined) {
            dropCounter += deltaTime;

            // Speed logic
            let currentSpeed;

            // Fast drop if holding down AND is 'mover' role
            if (isFastDropping && mp.playerRole === 'mover') {
                currentSpeed = 50; // Very fast
            } else {
                // Regular speed based on level
                // Level 1: 1000ms, Level 10: ~100ms
                currentSpeed = Math.max(100, 1000 - (game.getLevel() - 1) * 100);
            }

            if (dropCounter > currentSpeed) {
                game.move(0, 1);
                dropCounter = 0;
            }
        }

        requestAnimationFrame(update);
    }

    // Multiplayer Callbacks
    mp.onOpponentJoin = () => {
        resetUI();
        mp.updateRoleUI(); // Reveal roles now that game is starting
        if (mp.isHost) {
            game.reset();
            update();
        }
        Haptics.success();
    };

    game.onGameOver = (score) => {
        resetUI();
        overlay.classList.remove('hidden');
        gameOverPanel.classList.remove('hidden');
        finalScoreElement.innerText = score;
        Haptics.heavy();
        AudioEngine.gameOver();
    };

    game.onLock = () => {
        AudioEngine.land();
        Haptics.tap();
    };

    game.onScoreChange = (score) => {
        document.getElementById('score').innerText = score;
        AudioEngine.clear();
        Haptics.success();
        // Visual flash
        canvas.classList.add('flash');
        setTimeout(() => canvas.classList.remove('flash'), 300);
    };

    // Prevent mobile defaults on controls
    const buttons = document.querySelectorAll('.joy-btn, .btn-pill');
    buttons.forEach(btn => {
        btn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            AudioEngine.init();
            Haptics.unlock();
            btn.click();
        }, { passive: false });
    });
    document.getElementById('create-btn').addEventListener('click', async () => {
        AudioEngine.init();
        Haptics.unlock();
        Haptics.tap();
        try {
            const id = await mp.createRoom();
            menuPanel.classList.add('hidden');
            waitingPanel.classList.remove('hidden');
            waitingRoomIdDisplay.innerText = id;
            document.getElementById('room-id').innerText = id;
        } catch (e) {
            alert('Oda oluşturulamadı: ' + e.message);
        }
    });

    document.getElementById('cancel-waiting-btn').addEventListener('click', async () => {
        Haptics.tap();
        await mp.cancelRoom();
        resetUI();
        overlay.classList.remove('hidden');
        menuPanel.classList.remove('hidden');
    });

    document.getElementById('join-btn').addEventListener('click', async () => {
        AudioEngine.init();
        Haptics.unlock();
        Haptics.tap();
        const id = document.getElementById('join-input').value.trim();
        if (!id) return alert('Lütfen oda kodu girin');
        try {
            await mp.joinRoom(id);
            document.getElementById('room-id').innerText = id;
            resetUI();
            update();
        } catch (e) {
            alert('Odaya katılamadı: ' + e.message);
        }
    });

    document.getElementById('restart-btn').addEventListener('click', () => {
        Haptics.unlock();
        Haptics.tap();
        location.reload();
    });

    // Controls
    const handleAction = (action) => {
        if (game.gameOver) return;
        AudioEngine.init();
        Haptics.unlock();

        switch (action) {
            case 'left':
                mp.sendAction('move', -1, 0);
                Haptics.tap();
                AudioEngine.move();
                break;
            case 'right':
                mp.sendAction('move', 1, 0);
                Haptics.tap();
                AudioEngine.move();
                break;
            case 'rotate':
                mp.sendAction('rotate');
                Haptics.heavy();
                AudioEngine.rotate();
                break;
        }
    };

    // Click controls
    document.getElementById('left-btn').addEventListener('click', () => handleAction('left'));
    document.getElementById('right-btn').addEventListener('click', () => handleAction('right'));
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
