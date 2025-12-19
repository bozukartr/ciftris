// Firebase configuration - USER NEEDS TO UPDATE THIS
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

// Initialize Firebase
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

const db = firebase.database();

class Multiplayer {
    constructor(game) {
        this.game = game;
        this.roomRef = null;
        this.playerRole = null; // 'mover' or 'rotator'
        this.isHost = false;
        this.roomId = null;
        this.otherPlayerJoined = false;

        this.setupGameListeners();
    }

    setupGameListeners() {
        this.game.onStateChange = () => {
            if (this.roomRef) {
                this.syncState();
            }
        };

        this.game.onPieceSpawn = (count) => {
            if (this.roomRef) {
                this.updateRoleBasedOnCount(count);
                if (this.isHost) {
                    this.roomRef.child('pieceCount').set(count);
                }
            }
        };

        this.game.onScoreChange = (score) => {
            if (this.isHost && this.roomRef) {
                this.roomRef.child('score').set(score);
            }
        };

        this.game.onGameOver = (score) => {
            if (this.isHost && this.roomRef) {
                this.roomRef.child('gameOver').set(true);
            }
        };
    }

    updateRoleBasedOnCount(count) {
        // Simple logic: every piece, swap roles
        // We use the initial hostRole choice to determine the sequence
        const roles = ['mover', 'rotator'];
        const hostBaseIdx = this.initialHostRole === 'mover' ? 0 : 1;
        const currentHostRoleIdx = (hostBaseIdx + count - 1) % 2;
        const currentHostRole = roles[currentHostRoleIdx];

        if (this.isHost) {
            this.playerRole = currentHostRole;
        } else {
            this.playerRole = (currentHostRole === 'mover') ? 'rotator' : 'mover';
        }

        this.updateRoleUI();
    }

    updateRoleUI() {
        const roleDisplay = document.getElementById('player-role');
        const roleBar = document.getElementById('role-bar');
        if (roleDisplay && roleBar) {
            roleBar.classList.remove('hidden');
            roleDisplay.innerText = this.playerRole === 'mover' ? 'HAREKET ETTİRİCİ' : 'DÖNDÜRÜCÜ';
            roleDisplay.className = 'stat-value ' + this.playerRole;
        }
    }

    async createRoom() {
        // Generate 5-digit numeric room code
        this.roomId = Math.floor(10000 + Math.random() * 90000).toString();
        this.roomRef = db.ref('rooms/' + this.roomId);

        const roles = ['mover', 'rotator'];
        this.initialHostRole = roles[Math.floor(Math.random() * 2)];
        this.playerRole = this.initialHostRole;
        this.isHost = true;

        await this.roomRef.set({
            hostRole: this.initialHostRole,
            pieceCount: 1,
            players: { host: true },
            state: this.getInitialGameState(),
            score: 0,
            gameOver: false,
            lastAction: null
        });

        this.listenToRoom();
        return this.roomId;
    }

    async cancelRoom() {
        if (this.roomRef && this.isHost) {
            await this.roomRef.remove();
            this.roomRef = null;
            this.roomId = null;
            this.isHost = false;
        }
    }

    async joinRoom(id) {
        id = id.toUpperCase();
        const snapshot = await db.ref('rooms/' + id).once('value');
        if (!snapshot.exists()) throw new Error('Oda bulunamadı');

        const data = snapshot.val();
        if (data.players.guest) throw new Error('Oda dolu');

        this.roomId = id;
        this.roomRef = db.ref('rooms/' + id);
        this.isHost = false;
        this.initialHostRole = data.hostRole;

        // Use current pieceCount to determine current role
        const count = data.pieceCount || 1;
        this.updateRoleBasedOnCount(count);

        await this.roomRef.child('players/guest').set(true);

        this.listenToRoom();
        return id;
    }

    // ... (listenToRoom, etc.)
    listenToRoom() {
        this.roomRef.on('value', (snapshot) => {
            const data = snapshot.val();
            if (!data) return;

            if (data.players.guest && !this.otherPlayerJoined) {
                this.otherPlayerJoined = true;
                if (typeof this.onOpponentJoin === 'function') this.onOpponentJoin();
            }

            if (data.gameOver && !this.game.gameOver) {
                this.game.gameOver = true;
                if (this.game.onGameOver) this.game.onGameOver(data.score);
            }

            // Sync score
            if (data.score !== undefined) {
                this.game.score = data.score;
                document.getElementById('score').innerText = data.score;
            }

            // Sync pieceCount for role swapping on guest side
            if (!this.isHost && data.pieceCount !== undefined && data.pieceCount !== this.game.pieceCount) {
                this.game.pieceCount = data.pieceCount;
                this.updateRoleBasedOnCount(data.pieceCount);
            }

            if (data.state && !this.isHost) {
                this.game.grid = data.state.grid;
                this.game.piece = data.state.piece;
                this.game.nextPiece = data.state.nextPiece;
                this.game.draw();
                this.game.drawNext();
            }
        });

        this.roomRef.child('lastAction').on('value', (snapshot) => {
            const action = snapshot.val();
            if (!action || action.playerId === this.playerRole) return;

            if (action.type === 'move') {
                this.game.move(action.dx, action.dy);
            } else if (action.type === 'rotate') {
                this.game.rotate();
            }
        });
    }

    sendAction(type, dx, dy) {
        if (!this.roomRef) return;
        if (this.playerRole === 'mover' && type === 'move') {
            this.game.move(dx, dy);
            this.roomRef.child('lastAction').set({
                type, dx, dy, playerId: this.playerRole, timestamp: Date.now()
            });
            this.syncState();
        } else if (this.playerRole === 'rotator' && type === 'rotate') {
            this.game.rotate();
            this.roomRef.child('lastAction').set({
                type, playerId: this.playerRole, timestamp: Date.now()
            });
            this.syncState();
        }
    }

    getInitialGameState() {
        return {
            grid: this.game.grid,
            piece: this.game.piece,
            nextPiece: this.game.nextPiece
        };
    }

    syncState() {
        if (!this.roomRef || !this.isHost) return;
        this.roomRef.child('state').set({
            grid: this.game.grid,
            piece: this.game.piece,
            nextPiece: this.game.nextPiece
        });
    }
}
