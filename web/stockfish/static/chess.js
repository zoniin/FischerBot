// Chess.js - Frontend logic for Fischer Bot web interface

class ChessGame {
    constructor() {
        this.board = null;
        this.selectedSquare = null;
        this.legalMoves = [];
        this.playerColor = 'white';
        this.flipped = false;
        this.moveHistory = [];
        this.capturedPieces = { white: [], black: [] };
        this.lastMoveSquares = [];
        this.isThinking = false;

        this.pieceSymbols = {
            'P': '♙', 'N': '♘', 'B': '♗', 'R': '♖', 'Q': '♕', 'K': '♔',
            'p': '♟', 'n': '♞', 'b': '♝', 'r': '♜', 'q': '♛', 'k': '♚'
        };

        this.init();
    }

    async init() {
        this.setupEventListeners();
        await this.newGame();
    }

    setupEventListeners() {
        document.getElementById('newGameBtn').addEventListener('click', () => this.newGame());
        document.getElementById('newGameFromModal').addEventListener('click', () => {
            document.getElementById('gameOverModal').classList.add('hidden');
            this.newGame();
        });
        document.getElementById('flipBoardBtn').addEventListener('click', () => this.flipBoard());
        document.getElementById('colorSelect').addEventListener('change', (e) => {
            this.playerColor = e.target.value;
            this.newGame();
        });
        document.getElementById('depthSelect').addEventListener('change', (e) => {
            this.updateBotDepth(parseInt(e.target.value));
        });
    }

    async newGame() {
        try {
            const response = await fetch('/api/new_game', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ player_color: this.playerColor })
            });
            const data = await response.json();

            this.board = data.board;
            this.moveHistory = [];
            this.capturedPieces = { white: [], black: [] };
            this.lastMoveSquares = [];

            this.renderBoard();
            this.updateStatus('New game started!');
            this.updateMoveList();
            this.updateCapturedPieces();
            this.updateAnalysis(data);

            // If player is black, bot moves first
            if (this.playerColor === 'black') {
                await this.makeBotMove();
            }
        } catch (error) {
            console.error('Error starting new game:', error);
            this.updateStatus('Error starting game');
        }
    }

    renderBoard() {
        const boardElement = document.getElementById('chessBoard');
        boardElement.innerHTML = '';

        const files = 'abcdefgh';
        const ranks = '87654321';

        for (let rankIdx = 0; rankIdx < 8; rankIdx++) {
            for (let fileIdx = 0; fileIdx < 8; fileIdx++) {
                const rank = this.flipped ? 8 - rankIdx : rankIdx + 1;
                const file = this.flipped ? 7 - fileIdx : fileIdx;
                const square = files[file] + rank;

                const squareElement = document.createElement('div');
                squareElement.classList.add('square');
                squareElement.classList.add((rank + file) % 2 === 0 ? 'dark' : 'light');
                squareElement.dataset.square = square;

                // Add coordinate labels
                if (file === (this.flipped ? 7 : 0)) {
                    squareElement.classList.add('rank-label');
                    squareElement.setAttribute('data-rank', rank);
                }
                if (rank === (this.flipped ? 8 : 1)) {
                    squareElement.classList.add('file-label');
                    squareElement.setAttribute('data-file', files[file]);
                }

                // Highlight last move
                if (this.lastMoveSquares.includes(square)) {
                    squareElement.classList.add('last-move');
                }

                // Add piece if present
                const piece = this.getPieceAt(square);
                if (piece) {
                    const pieceElement = document.createElement('div');
                    pieceElement.classList.add('piece');
                    pieceElement.textContent = this.pieceSymbols[piece];
                    pieceElement.dataset.piece = piece;
                    squareElement.appendChild(pieceElement);
                }

                squareElement.addEventListener('click', () => this.handleSquareClick(square));
                boardElement.appendChild(squareElement);
            }
        }

        // Add coordinate labels via CSS
        this.addCoordinateLabels();
    }

    addCoordinateLabels() {
        const files = 'abcdefgh';
        const style = document.createElement('style');
        let css = '';

        for (let i = 0; i < 8; i++) {
            const file = this.flipped ? files[7 - i] : files[i];
            const rank = this.flipped ? i + 1 : 8 - i;

            css += `.square.file-label[data-file="${file}"]::before { content: "${file}"; }\n`;
            css += `.square.rank-label[data-rank="${rank}"]::before { content: "${rank}"; }\n`;
        }

        style.textContent = css;
        document.head.appendChild(style);
    }

    getPieceAt(square) {
        if (!this.board) return null;

        const files = 'abcdefgh';
        const file = files.indexOf(square[0]);
        const rank = 8 - parseInt(square[1]);

        const pieces = this.board.split('\n');
        if (rank >= 0 && rank < pieces.length) {
            const rankPieces = pieces[rank].split(' ');
            if (file >= 0 && file < rankPieces.length) {
                const piece = rankPieces[file];
                return piece !== '.' ? piece : null;
            }
        }
        return null;
    }

    async handleSquareClick(square) {
        if (this.isThinking) return;

        const piece = this.getPieceAt(square);
        const currentTurn = await this.getCurrentTurn();

        // Check if it's player's turn
        const isPlayerTurn = (currentTurn === 'white' && this.playerColor === 'white') ||
                            (currentTurn === 'black' && this.playerColor === 'black');

        if (!isPlayerTurn) return;

        // If clicking on own piece, select it
        if (piece && this.isPieceOwnedByPlayer(piece)) {
            await this.selectSquare(square);
        }
        // If a square is selected, try to move
        else if (this.selectedSquare) {
            await this.makeMove(this.selectedSquare, square);
        }
    }

    isPieceOwnedByPlayer(piece) {
        const isWhitePiece = piece === piece.toUpperCase();
        return (this.playerColor === 'white' && isWhitePiece) ||
               (this.playerColor === 'black' && !isWhitePiece);
    }

    async getCurrentTurn() {
        try {
            const response = await fetch('/api/get_turn');
            const data = await response.json();
            return data.turn;
        } catch (error) {
            console.error('Error getting turn:', error);
            return 'white';
        }
    }

    async selectSquare(square) {
        // Clear previous selection
        document.querySelectorAll('.square').forEach(sq => {
            sq.classList.remove('selected', 'legal-move', 'legal-capture');
        });

        this.selectedSquare = square;
        this.legalMoves = await this.getLegalMoves(square);

        // Highlight selected square
        const squareElement = document.querySelector(`[data-square="${square}"]`);
        if (squareElement) {
            squareElement.classList.add('selected');
        }

        // Highlight legal moves
        this.legalMoves.forEach(move => {
            const targetSquare = document.querySelector(`[data-square="${move}"]`);
            if (targetSquare) {
                const isCapture = this.getPieceAt(move) !== null;
                targetSquare.classList.add(isCapture ? 'legal-capture' : 'legal-move');
            }
        });
    }

    async getLegalMoves(square) {
        try {
            const response = await fetch('/api/legal_moves', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ square })
            });
            const data = await response.json();
            return data.legal_moves || [];
        } catch (error) {
            console.error('Error getting legal moves:', error);
            return [];
        }
    }

    async makeMove(from, to) {
        try {
            const response = await fetch('/api/make_move', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ from_square: from, to_square: to })
            });
            const data = await response.json();

            if (data.success) {
                this.board = data.board;
                this.lastMoveSquares = [from, to];

                // Track captured pieces
                if (data.captured) {
                    const capturedColor = data.captured === data.captured.toUpperCase() ? 'white' : 'black';
                    this.capturedPieces[capturedColor].push(data.captured);
                }

                this.selectedSquare = null;
                this.renderBoard();
                this.updateMoveList();
                this.updateCapturedPieces();
                this.updateAnalysis(data);

                // Check for game over
                if (data.game_over) {
                    this.showGameOver(data.result);
                } else {
                    // Bot's turn
                    await this.makeBotMove();
                }
            } else {
                this.updateStatus('Illegal move!');
                this.selectedSquare = null;
                this.renderBoard();
            }
        } catch (error) {
            console.error('Error making move:', error);
            this.updateStatus('Error making move');
        }
    }

    async makeBotMove() {
        this.isThinking = true;
        this.updateStatus('Fischer Bot is thinking...');

        try {
            const response = await fetch('/api/bot_move', { method: 'POST' });
            const data = await response.json();

            if (data.success) {
                this.board = data.board;
                this.lastMoveSquares = [data.move.from, data.move.to];

                // Track captured pieces
                if (data.captured) {
                    const capturedColor = data.captured === data.captured.toUpperCase() ? 'white' : 'black';
                    this.capturedPieces[capturedColor].push(data.captured);
                }

                this.renderBoard();
                this.updateMoveList();
                this.updateCapturedPieces();
                this.updateAnalysis(data);

                // Check for game over
                if (data.game_over) {
                    this.showGameOver(data.result);
                } else {
                    const turn = await this.getCurrentTurn();
                    this.updateStatus(`${turn.charAt(0).toUpperCase() + turn.slice(1)} to move`);
                }
            }
        } catch (error) {
            console.error('Error making bot move:', error);
            this.updateStatus('Error: Bot failed to move');
        } finally {
            this.isThinking = false;
        }
    }

    async updateBotDepth(depth) {
        try {
            await fetch('/api/set_depth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ depth })
            });
            this.updateStatus(`Bot strength set to depth ${depth}`);
        } catch (error) {
            console.error('Error setting depth:', error);
        }
    }

    flipBoard() {
        this.flipped = !this.flipped;
        this.renderBoard();
    }

    updateStatus(message) {
        document.getElementById('statusMessage').textContent = message;
    }

    updateMoveList() {
        const moveListElement = document.getElementById('moveList');
        moveListElement.innerHTML = '';

        // Fetch move history from server
        fetch('/api/get_moves')
            .then(res => res.json())
            .then(data => {
                const moves = data.moves || [];
                for (let i = 0; i < moves.length; i += 2) {
                    const moveNumber = Math.floor(i / 2) + 1;
                    const whiteMove = moves[i];
                    const blackMove = moves[i + 1];

                    const movePair = document.createElement('div');
                    movePair.classList.add('move-pair');

                    const numberSpan = document.createElement('span');
                    numberSpan.classList.add('move-number');
                    numberSpan.textContent = `${moveNumber}.`;
                    movePair.appendChild(numberSpan);

                    const whiteSpan = document.createElement('span');
                    whiteSpan.classList.add('move');
                    whiteSpan.textContent = whiteMove;
                    movePair.appendChild(whiteSpan);

                    if (blackMove) {
                        const blackSpan = document.createElement('span');
                        blackSpan.classList.add('move');
                        blackSpan.textContent = blackMove;
                        movePair.appendChild(blackSpan);
                    }

                    moveListElement.appendChild(movePair);
                }

                // Auto scroll to bottom
                moveListElement.scrollTop = moveListElement.scrollHeight;
            });
    }

    updateCapturedPieces() {
        const whiteContainer = document.getElementById('capturedWhite');
        const blackContainer = document.getElementById('capturedBlack');

        whiteContainer.innerHTML = '';
        blackContainer.innerHTML = '';

        this.capturedPieces.white.forEach(piece => {
            const span = document.createElement('span');
            span.classList.add('captured-piece');
            span.textContent = this.pieceSymbols[piece];
            whiteContainer.appendChild(span);
        });

        this.capturedPieces.black.forEach(piece => {
            const span = document.createElement('span');
            span.classList.add('captured-piece');
            span.textContent = this.pieceSymbols[piece];
            blackContainer.appendChild(span);
        });
    }

    updateAnalysis(data) {
        if (data.evaluation !== undefined) {
            document.getElementById('evaluation').textContent = `Eval: ${data.evaluation.toFixed(1)}`;
        }

        if (data.material_balance !== undefined) {
            document.getElementById('materialBalance').textContent = data.material_balance;
        }

        if (data.nodes_searched !== undefined) {
            document.getElementById('nodesSearched').textContent = data.nodes_searched.toLocaleString();
        }

        if (data.last_move) {
            document.getElementById('lastMove').textContent = data.last_move;
        }
    }

    showGameOver(result) {
        const modal = document.getElementById('gameOverModal');
        const title = document.getElementById('gameOverTitle');
        const message = document.getElementById('gameOverMessage');

        title.textContent = 'Game Over!';
        message.textContent = result;

        modal.classList.remove('hidden');
    }
}

// Initialize the game when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new ChessGame();
});
