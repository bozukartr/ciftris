/**
 * Çiftris - 2 Player Co-op Tetris
 * using Firebase Realtime Database for sync
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, set, onValue, update as updateDB, push, child, get, onDisconnect, remove } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// --- CONFIG ---
const firebaseConfig = {
    apiKey: "AIzaSyA_heUZFdcsFY3PenJkg062utvZst8W9uI",
    authDomain: "ciftris.firebaseapp.com",
    databaseURL: "https://ciftris-default-rtdb.firebaseio.com",
    projectId: "ciftris",
    storageBucket: "ciftris.firebasestorage.app",
    messagingSenderId: "533713486052",
    appId: "1:533713486052:web:29c05b42412b287ad4acf1",
    measurementId: "G-GNV45H1NWS"
};

// --- GAME CONSTANTS ---
const COLS = 10;
const ROWS = 20;
const BLOCK_SIZE = 30; // Base size, will scale
const COLORS = [
    null,
    '#4ecdc4', // I
    '#45b7d1', // J
    '#f7b731', // L
    '#f1c40f', // O
    '#2ecc71', // S
    '#9b59b6', // T
    '#ff6b6b'  // Z
];

// Tetromino definitions
const SHAPES = [
    [],
    [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]], // I
    [[2, 0, 0], [2, 2, 2], [0, 0, 0]], // J
    [[0, 0, 3], [3, 3, 3], [0, 0, 0]], // L
    [[4, 4], [4, 4]], // O
    [[0, 5, 5], [5, 5, 0], [0, 0, 0]], // S
    [[0, 6, 0], [6, 6, 6], [0, 0, 0]], // T
    [[7, 7, 0], [0, 7, 7], [0, 0, 0]]  // Z
];

// --- GLOBALS ---
let app, db, auth;
let playerId = null;
let roomId = null;
let isHost = false;
let role = null; // 'MOVE' or 'ROTATE'
let gameActive = false;
let isPaused = false;

// Game State
let grid = createGrid();
let piece = null;
let score = 0;
let level = 1;
let lines = 0;
let dropCounter = 0;
let dropInterval = 1000;
let lastTime = 0;
let animationId = null;

// HTML Elements
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
// const nextCanvas = document.getElementById('nextCanvas');
// const nextCtx = nextCanvas.getContext('2d');

// --- INIT ---
let isOffline = false;

function init() {
    try {
        // Initialize Firebase
        app = initializeApp(firebaseConfig);
        db = getDatabase(app);
        auth = getAuth(app);

        // Auth Listener
        onAuthStateChanged(auth, (user) => {
            if (user) {
                playerId = user.uid;
                console.log("Logged in as:", playerId);
                setupUI();
            } else {
                signInAnonymously(auth).catch(handleAuthError);
            }
        });
    } catch (err) {
        console.error("Firebase Init Error:", err);
        handleAuthError(err);
    }

    scaleCanvas();
    window.addEventListener('resize', scaleCanvas);

    // Initial draw
    draw();
}

function handleAuthError(e) {
    console.error("Authentication/Connection Error:", e);
    isOffline = true;
    playerId = "offline_" + Math.random().toString(36).substr(2, 5);

    showToast("Offline Mode (No Connection)");

    // Set status in UI
    const codeDisplay = document.getElementById('display-room-code');
    if (codeDisplay) codeDisplay.innerText = "OFFLINE";

    // In offline mode, allow playing solo or local testing
    setupUI();
}

function createGrid() {
    return Array.from({ length: ROWS }, () => Array(COLS).fill(0));
}

function scaleCanvas() {
    // Fit canvas to container, maintaining aspect ratio
    const container = canvas.parentElement;
    const aspect = COLS / ROWS;
    let w = container.clientWidth;
    let h = w / aspect;

    if (h > container.clientHeight) {
        h = container.clientHeight;
        w = h * aspect;
    }

    canvas.width = w;
    canvas.height = h;
    draw();
}

function drawBlock(x, y, colorId, context = ctx, blockSizeW = canvas.width / COLS, blockSizeH = canvas.height / ROWS) {
    if (colorId === 0) return;
    const color = COLORS[colorId];
    context.fillStyle = color;

    // Slight gap for modern grid look
    const gap = 1;
    context.fillRect(
        x * blockSizeW + gap,
        y * blockSizeH + gap,
        blockSizeW - gap * 2,
        blockSizeH - gap * 2
    );

    // No stroke, purely flat
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height); // Transparent/Clear
    // Draw Grid dots or subtle background?
    // Let's keep it clean black/dark.

    const bw = canvas.width / COLS;
    const bh = canvas.height / ROWS;

    // Grid (Static blocks)
    grid.forEach((row, y) => {
        row.forEach((value, x) => {
            drawBlock(x, y, value, ctx, bw, bh);
        });
    });

    // Piece
    if (piece) {
        // Draw Ghost
        const ghost = { ...piece };
        while (!collide(grid, { ...ghost, y: ghost.y + 1 })) {
            ghost.y++;
        }

        ghost.shape.forEach((row, y) => {
            row.forEach((value, x) => {
                if (value !== 0) {
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
                    ctx.fillRect(
                        (ghost.x + x) * bw + 1,
                        (ghost.y + y) * bh + 1,
                        bw - 2,
                        bh - 2
                    );
                }
            });
        });

        // Draw Active Piece
        piece.shape.forEach((row, y) => {
            row.forEach((value, x) => {
                if (value !== 0) {
                    drawBlock(piece.x + x, piece.y + y, value, ctx, bw, bh);
                }
            });
        });
    }
}

function gameLoop(time = 0) {
    if (!gameActive || isPaused) {
        animationId = requestAnimationFrame(gameLoop);
        return;
    }

    const deltaTime = time - lastTime;
    lastTime = time;

    // Only Host processes gravity
    if (isHost) {
        dropCounter += deltaTime;
        if (dropCounter > dropInterval) {
            playerDrop();
            // Gravity drop only needs piece sync usually, unless it locks
            // playerDrop handles locking logic
            if (piece) syncPiece();
        }
    }

    // Don't draw here if we want to draw on state updates, but smooth animation might need it?
    // For now draw every frame
    draw();
    animationId = requestAnimationFrame(gameLoop);
}

function playerDrop() {
    piece.y++;
    if (collide(grid, piece)) {
        piece.y--;
        merge(grid, piece);
        resetPiece();
        arenaSweep();
        syncGrid(); // Major state change (Grid + Score + New Piece?)
        syncPiece(); // New piece position
    }
    dropCounter = 0;
}

function collide(arena, player) {
    const [m, o] = [player.shape, player];
    for (let y = 0; y < m.length; ++y) {
        for (let x = 0; x < m[y].length; ++x) {
            if (m[y][x] !== 0 &&
                (arena[y + o.y] && arena[y + o.y][x + o.x]) !== 0) {
                return true;
            }
        }
    }
    return false;
}

function merge(arena, player) {
    player.shape.forEach((row, y) => {
        row.forEach((value, x) => {
            if (value !== 0) {
                arena[y + player.y][x + player.x] = value;
            }
        });
    });
}

function resetPiece() {
    // TODO: Random bag
    const typeId = (Math.random() * 7 | 0) + 1;
    // Deep copy the shape to avoid mutating the global definition with rotations
    const newShape = SHAPES[typeId].map(row => [...row]);

    piece = {
        shape: newShape,
        x: (COLS / 2 | 0) - (newShape[0].length / 2 | 0),
        y: 0
    };
    if (collide(grid, piece)) {
        gameOver();
    }
}

function arenaSweep() {
    let rowCount = 0;
    outer: for (let y = grid.length - 1; y > 0; --y) {
        for (let x = 0; x < grid[y].length; ++x) {
            if (grid[y][x] === 0) {
                continue outer;
            }
        }

        const row = grid.splice(y, 1)[0].fill(0);
        grid.unshift(row);
        ++y;

        rowCount++;
    }
    if (rowCount > 0) {
        score += rowCount * 10;
        lines += rowCount;
        level = Math.floor(lines / 10) + 1;
        dropInterval = Math.max(100, 1000 - (level - 1) * 100);

        document.getElementById('score').innerText = score;
        document.getElementById('level').innerText = level;
        document.getElementById('lines').innerText = lines;
    }
}

function gameOver() {
    gameActive = false;
    alert('Game Over');
    // TODO: Reset / Sync
}

// --- NETWORK ---

function createRoom() {
    if (isOffline) {
        // Simulate waiting
        roomId = "LOCAL";
        isHost = true;
        role = 'MOVE'; // Dfault to Move in offline test

        document.getElementById('modal-connect').classList.remove('visible');
        document.getElementById('modal-connect').classList.add('hidden');
        document.getElementById('modal-waiting').classList.remove('hidden');
        document.getElementById('modal-waiting').classList.add('visible');
        document.getElementById('display-room-code').innerText = "LOCAL";

        // Auto-start after 1 sec for testing
        setTimeout(() => {
            startGame("CPU");
        }, 1000);
        return;
    }

    if (!playerId) return;

    // Create room ref
    const roomRef = push(ref(db, 'rooms'));
    roomId = roomRef.key;
    isHost = true;

    // Set Room Data
    set(roomRef, {
        host: playerId,
        status: 'waiting',
        code: roomId.substring(roomId.length - 4).toUpperCase() // Simple 4 digit code from ID
    });

    // Listen for guest
    onValue(roomRef, (snapshot) => {
        const data = snapshot.val();
        // If guest exists and we haven't started yet (or status is ready to start)
        if (data && data.guest && (data.status === 'waiting' || data.status === 'ready')) {
            // Guest joined
            // Check if we are already playing to avoid double start? 
            // startGame updates status to 'playing', so the next snapshot will be 'playing'.
            if (data.status !== 'playing') {
                startGame(data.guest);
            }
        }
    });

    // Listen for Guest Inputs
    onValue(ref(db, `rooms/${roomId}/inputs`), (snapshot) => {
        if (!isHost) return;
        const inputs = snapshot.val();
        if (inputs) {
            // Process all inputs in the queue
            Object.values(inputs).forEach(input => {
                processInput(input);
            });
            remove(ref(db, `rooms/${roomId}/inputs`)); // Consume all
        }
    });

    // Clean up on disconnect
    onDisconnect(roomRef).remove();

    // UI
    document.getElementById('modal-connect').classList.remove('visible');
    document.getElementById('modal-connect').classList.add('hidden');
    document.getElementById('modal-waiting').classList.remove('hidden');
    document.getElementById('modal-waiting').classList.add('visible');
    document.getElementById('display-room-code').innerText = roomId.substring(roomId.length - 4).toUpperCase();
}

function joinRoom() {
    if (isOffline) {
        alert("Cannot join rooms in Offline Mode.");
        return;
    }

    if (!playerId) return;

    const codeInput = document.getElementById('inp-room-code').value.toUpperCase();
    if (codeInput.length < 4) return alert("Invalid Code");

    // Search for room (Inefficient for many rooms, but fine for prototype)
    // Better: We should probably use the code as the key if we want easy lookup, but push() is safer.
    // Let's just assume User inputs the suffix we displayed.
    // Querying...
    get(ref(db, 'rooms')).then((snapshot) => {
        const rooms = snapshot.val();
        if (!rooms) return alert("No rooms found");

        const foundId = Object.keys(rooms).find(key => key.endsWith(codeInput) || rooms[key].code === codeInput);

        if (foundId) {
            roomId = foundId;
            isHost = false;

            // Join
            const updates = {};
            updates[`rooms/${roomId}/guest`] = playerId;
            updates[`rooms/${roomId}/status`] = 'ready';
            updateDB(ref(db), updates);

            // Guest Disconnect Logic
            onDisconnect(ref(db, `rooms/${roomId}/guest`)).remove();

            // Setup Listeners for State
            setupGameListeners();

            // UI
            document.getElementById('modal-connect').classList.remove('visible');
            document.getElementById('modal-connect').classList.add('hidden');
            // Wait for Start
        } else {
            alert("Room not found");
        }
    });
}

function startGame(guestId) {
    if (isOffline) {
        // Local start
        document.getElementById('modal-waiting').classList.remove('visible');
        document.getElementById('modal-waiting').classList.add('hidden');

        gameActive = true;
        resetPiece();
        lastTime = performance.now();
        gameLoop();

        // Give both controls in local for testing
        role = 'BOTH';
        showToast("Local / Offline Mode");
        return;
    }

    // Assign Roles Randomly
    const r = Math.random() > 0.5;
    const hostRole = r ? 'MOVE' : 'ROTATE';
    const guestRole = r ? 'ROTATE' : 'MOVE';

    updateDB(ref(db, `rooms/${roomId}`), {
        roles: {
            [playerId]: hostRole,
            [guestId]: guestRole
        },
        status: 'playing',
        state: {
            grid: grid,
            score: 0,
            piece: null // Initial piece will be generated by host
        }
    });

    // Hide Modals & Overlay
    document.getElementById('modal-waiting').classList.add('hidden');
    document.getElementById('modal-overlay').classList.remove('visible');

    setupGameListeners();

    resetPiece();
    gameActive = true;
    lastTime = performance.now();
    gameLoop();
}

function setupGameListeners() {
    // Listen for Roles
    onValue(ref(db, `rooms/${roomId}/roles`), (snap) => {
        const roles = snap.val();
        if (roles && roles[playerId]) {
            role = roles[playerId];
            // Show Role Toast
            showToast(`Role: ${role}`);

            updateControls(role);
        }
    });

    // Connectivity Listeners
    if (isHost) {
        onValue(ref(db, `rooms/${roomId}/guest`), (snap) => {
            if (!snap.exists() && gameActive) {
                showToast("Player B Disconnected");
                isPaused = true;
                showMenu("Player B Disconnected");
            }
        });
    } else {
        onValue(ref(db, `rooms/${roomId}`), (snap) => {
            if (!snap.exists()) {
                alert("Host Disconnected");
                location.reload();
            }
        });
    }

    // Optimized State Listeners for Guest
    if (!isHost) {
        // Listen for Game Start
        onValue(ref(db, `rooms/${roomId}/status`), (snap) => {
            if (snap.val() === 'playing') {
                gameActive = true;
                document.getElementById('modal-waiting').classList.add('hidden');
                document.getElementById('modal-connect').classList.add('hidden'); // Safety
                document.getElementById('modal-overlay').classList.remove('visible');
            }
        });

        // High frequency: Piece updates
        onValue(ref(db, `rooms/${roomId}/state/piece`), (snap) => {
            const p = snap.val();
            // If p is null/undefined, keep existing or clear? 
            // Usually Host sends valid piece.
            if (p) {
                piece = p;
                draw();
            }
        });

        // Low frequency: Grid/Score updates
        onValue(ref(db, `rooms/${roomId}/state/grid`), (snap) => {
            const g = snap.val();
            if (g) {
                grid = g;
                draw();
            }
        });

        onValue(ref(db, `rooms/${roomId}/state/score`), (snap) => {
            const s = snap.val();
            if (s !== null) {
                score = s;
                document.getElementById('score').innerText = score;
            }
        });
    }
}

function syncPiece() {
    if (!isHost || !gameActive) return;
    updateDB(ref(db, `rooms/${roomId}/state`), { piece: piece });
}

function syncGrid() {
    if (!isHost || !gameActive) return;
    updateDB(ref(db, `rooms/${roomId}/state`), {
        grid: grid,
        score: score
    });
}

function processInput(inputData) {
    if (!gameActive) return;
    const { action, val } = inputData;

    let pieceMoved = false;
    let gridChanged = false;

    // Host Logic
    if (action === 'move') { move(val); pieceMoved = true; }
    if (action === 'rotate') { rotate(val); pieceMoved = true; }
    if (action === 'drop') { playerDrop(); pieceMoved = true; } // playerDrop handles its own sync if locked?
    if (action === 'harddrop') {
        while (!collide(grid, { ...piece, y: piece.y + 1 })) {
            piece.y++;
        }
        playerDrop(); // will trigger syncGrid inside playerDrop if locked
        // But playerDrop logic needs to know? 
        // playerDrop calls syncState() currently. We need to update playerDrop too.
        pieceMoved = true;
    }

    // Explicit sync if we just moved/rotated without locking
    // (playerDrop handles locking sync)
    // Actually relying on the generic sync is safer but let's optimize calls.
    if (pieceMoved) syncPiece();
}

// UI Setup
function setupUI() {
    document.getElementById('btn-create-room').addEventListener('click', createRoom);
    document.getElementById('btn-join-room').addEventListener('click', joinRoom);

    // Inputs
    const actions = {
        'left': () => handleInput('move', -1),
        'right': () => handleInput('move', 1),
        'rotate': () => handleInput('rotate', 1),
        'down': () => handleInput('drop', 0),
        'drop': () => handleInput('harddrop', 0),
        'pause': () => togglePause()
    };

    // Touch/Click
    document.querySelectorAll('.control-btn').forEach(btn => {
        btn.addEventListener('touchstart', (e) => {
            if (e.cancelable) e.preventDefault(); // Prevent scroll/zoom if possible
            const action = btn.dataset.action;
            if (actions[action]) actions[action]();
        }, { passive: false }); // Mark as non-passive to allow preventing default

        btn.addEventListener('mousedown', (e) => {
            const action = btn.dataset.action;
            if (actions[action]) actions[action]();
        });
    });

    // Keyboard
    document.addEventListener('keydown', event => {
        if (event.keyCode === 37) actions.left();
        else if (event.keyCode === 39) actions.right();
        else if (event.keyCode === 40) actions.down();
        else if (event.keyCode === 38) actions.rotate();
        else if (event.keyCode === 32) actions.drop(); // Space
    });
}

function handleInput(type, val) {
    // Check Role
    if (role !== 'BOTH') {
        if (role === 'MOVE' && (type === 'rotate')) return; // Can't rotate
        if (role === 'ROTATE' && (type === 'move')) return; // Can't move
    }

    // Drop is shared? Or maybe restrict? Prompt said "opsiyonel: ortak".
    // Let's keep Drop shared for now, or maybe only Host?
    // User said "Player A: left/right", "Player B: rotate".
    // Usually Drop is shared.

    if (isHost || role === 'BOTH') {
        // Apply directly
        if (type === 'move') { move(val); syncPiece(); }
        if (type === 'rotate') { rotate(val); syncPiece(); }
        if (type === 'drop') { playerDrop(); syncPiece(); } // soft drop
        if (type === 'harddrop') {
            while (!collide(grid, { ...piece, y: piece.y + 1 })) {
                piece.y++;
            }
            playerDrop();
            // playerDrop calls syncGrid if locked
        }
    } else {
        // CLIENT-SIDE PREDICTION
        // Apply immediately locally to hide latency
        if (role === 'BOTH' ||
            (role === 'MOVE' && (type === 'move')) ||
            (role === 'ROTATE' && (type === 'rotate'))) {

            if (type === 'move') { move(val); draw(); }
            if (type === 'rotate') { rotate(val); draw(); }
        }

        // Send to Host
        push(ref(db, `rooms/${roomId}/inputs`), {
            action: type,
            val: val,
            src: playerId
        });
    }
}

function updateControls(myRole) {
    // Visual feedback
    const btnLeft = document.getElementById('btn-left');
    const btnRight = document.getElementById('btn-right');
    const btnDown = document.getElementById('btn-down');
    const btnRotate = document.getElementById('btn-rotate');

    const dim = '0.3';
    const active = '1';

    // Safety check just in case
    if (!btnLeft) return;

    if (myRole === 'BOTH') {
        btnRotate.style.opacity = active;
        btnLeft.style.opacity = active;
        btnRight.style.opacity = active;
        btnDown.style.opacity = active;
        return;
    }

    if (myRole === 'MOVE') {
        btnRotate.style.opacity = dim;
        btnLeft.style.opacity = active;
        btnRight.style.opacity = active;
        btnDown.style.opacity = active;
    } else if (myRole === 'ROTATE') {
        btnLeft.style.opacity = dim;
        btnRight.style.opacity = dim;
        btnDown.style.opacity = dim;
        btnRotate.style.opacity = active;
    }
}

function move(dir) {
    piece.x += dir;
    if (collide(grid, piece)) {
        piece.x -= dir;
    }
}

function rotate(dir) {
    const pos = piece.x;
    let offset = 1;
    rotateMatrix(piece.shape, dir);
    while (collide(grid, piece)) {
        piece.x += offset;
        offset = -(offset + (offset > 0 ? 1 : -1));
        if (offset > piece.shape[0].length) {
            rotateMatrix(piece.shape, -dir);
            piece.x = pos;
            return;
        }
    }
}

function rotateMatrix(matrix, dir) {
    for (let y = 0; y < matrix.length; ++y) {
        for (let x = 0; x < y; ++x) {
            [matrix[x][y], matrix[y][x]] = [matrix[y][x], matrix[x][y]];
        }
    }
    if (dir > 0) matrix.forEach(row => row.reverse());
    else matrix.reverse();
}

function togglePause() {
    isPaused = !isPaused;
    if (isPaused) {
        showMenu("PAUSED");
        document.getElementById('modal-overlay').classList.add('visible');
    } else {
        document.getElementById('modal-game-menu').classList.remove('visible');
        document.getElementById('modal-game-menu').classList.add('hidden');
        document.getElementById('modal-overlay').classList.remove('visible');
    }
}

function showToast(msg) {
    const t = document.getElementById('toast');
    t.innerText = msg;
    t.classList.remove('hidden');
    t.classList.add('show');
    setTimeout(() => {
        t.classList.remove('show');
        t.classList.add('hidden');
    }, 2000);
}

function showMenu(title) {
    document.getElementById('menu-title').innerText = title || "Paused";
    document.getElementById('menu-score').innerText = `Score: ${score}`;
    document.getElementById('modal-game-menu').classList.remove('hidden');
    document.getElementById('modal-game-menu').classList.add('visible');
}

document.getElementById('btn-resume').addEventListener('click', () => {
    isPaused = false;
    document.getElementById('modal-game-menu').classList.remove('visible');
    document.getElementById('modal-game-menu').classList.add('hidden');
});

document.getElementById('btn-restart').addEventListener('click', () => {
    location.reload();
});

// Start
init();
