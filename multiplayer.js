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
        // When game state changes locally, sync to Firebase (if we are the authority for that change)
        this.game.onStateChange = () => {
            if (this.roomRef) {
                this.syncState();
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

    async createRoom() {
        this.roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
        this.roomRef = db.ref('rooms/' + this.roomId);

        // Randomly assign roles
        const roles = ['mover', 'rotator'];
        const hostRole = roles[Math.floor(Math.random() * 2)];
        this.playerRole = hostRole;
        this.isHost = true;

        await this.roomRef.set({
            hostRole: hostRole,
            players: { host: true },
            state: this.getInitialGameState(),
            score: 0,
            gameOver: false,
            lastAction: null
        });

        this.listenToRoom();
        return this.roomId;
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
        this.playerRole = data.hostRole === 'mover' ? 'rotator' : 'mover';

        await this.roomRef.child('players/guest').set(true);

        this.listenToRoom();
        return id;
    }

    getInitialGameState() {
        return {
            grid: this.game.grid,
            piece: this.game.piece,
            nextPiece: this.game.nextPiece
        };
    }

    listenToRoom() {
        // Listen for Role assignment and Player joining
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

            // Sync game state (if we are not the host, we take the state from Firebase)
            // Or if we are the host but an action happened from the guest
            if (data.state && !this.isHost) {
                this.game.grid = data.state.grid;
                this.game.piece = data.state.piece;
                this.game.nextPiece = data.state.nextPiece;
                this.game.draw();
                this.game.drawNext();
            }
        });

        // Listen for actions specifically to reduce full state sync frequency
        this.roomRef.child('lastAction').on('value', (snapshot) => {
            const action = snapshot.val();
            if (!action || action.playerId === this.playerRole) return;

            // Handle remote actions
            if (action.type === 'move') {
                this.game.move(action.dx, action.dy);
            } else if (action.type === 'rotate') {
                this.game.rotate();
            }
        });
    }

    sendAction(type, dx, dy) {
        if (!this.roomRef) return;

        // Mover can move, Rotator can rotate
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

    syncState() {
        if (!this.roomRef) return;
        // Only host syncs the full state to keep it authoritative
        // Guest only sends actions
        if (this.isHost) {
            this.roomRef.child('state').set({
                grid: this.game.grid,
                piece: this.game.piece,
                nextPiece: this.game.nextPiece
            });
        }
    }
}
