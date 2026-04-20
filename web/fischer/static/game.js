// Game state
let board = null;
let game = new Chess();
let playerColor = 'white';
let moveHistory = [];

// Initialize board
function initBoard() {
    const config = {
        draggable: true,
        position: 'start',
        onDragStart: onDragStart,
        onDrop: onDrop,
        onSnapEnd: onSnapEnd
    };
    board = Chessboard('board', config);
}

// Do not pick up pieces if the game is over or if it's not the player's turn
function onDragStart(source, piece, position, orientation) {
    if (game.game_over()) return false;

    // Only pick up pieces for the player's color
    if ((playerColor === 'white' && piece.search(/^b/) !== -1) ||
        (playerColor === 'black' && piece.search(/^w/) !== -1)) {
        return false;
    }

    // Only allow moves when it's the player's turn
    const currentTurn = game.turn() === 'w' ? 'white' : 'black';
    if (currentTurn !== playerColor) {
        return false;
    }
}

// Handle piece drop
function onDrop(source, target) {
    // Check if the move is legal
    const move = game.move({
        from: source,
        to: target,
        promotion: 'q' // Always promote to queen for simplicity
    });

    // Illegal move
    if (move === null) return 'snapback';

    // Make the move on the server
    makeMove(move.from + move.to + (move.promotion || ''));
}

// Update board position after the piece snap
function onSnapEnd() {
    board.position(game.fen());
}

// Update game status display
function updateStatus(message, isCheck = false, isGameOver = false) {
    const statusEl = document.getElementById('status');
    statusEl.textContent = message;
    statusEl.className = 'status';

    if (isCheck) {
        statusEl.classList.add('check');
    }
    if (isGameOver) {
        statusEl.classList.add('game-over');
    }
}

// Show/hide thinking indicator
function setThinking(thinking) {
    const thinkingEl = document.getElementById('thinking');
    thinkingEl.style.display = thinking ? 'block' : 'none';
}

// Add move to history
function addMoveToHistory(moveNumber, whiteMove, blackMove = '') {
    const historyEl = document.getElementById('moveHistory');

    // Clear "no moves" message
    if (moveHistory.length === 0) {
        historyEl.innerHTML = '';
    }

    const moveItem = document.createElement('div');
    moveItem.className = 'move-item';
    moveItem.textContent = `${moveNumber}. ${whiteMove}${blackMove ? ' ' + blackMove : ''}`;
    historyEl.appendChild(moveItem);

    // Scroll to bottom
    historyEl.scrollTop = historyEl.scrollHeight;

    moveHistory.push({ moveNumber, whiteMove, blackMove });
}

// Start a new game
async function newGame() {
    const color = document.getElementById('colorSelect').value;
    const difficulty = parseInt(document.getElementById('difficultySelect').value);

    playerColor = color;

    try {
        const response = await fetch('/api/new_game', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                color: color,
                difficulty: difficulty
            })
        });

        const data = await response.json();

        // Reset game
        game = new Chess(data.fen);
        board.position(data.fen);

        // Flip board if playing as black
        if (playerColor === 'black') {
            board.flip();
        } else {
            board.orientation('white');
        }

        // Clear move history
        moveHistory = [];
        document.getElementById('moveHistory').innerHTML = '<div style="text-align: center; color: #999;">No moves yet</div>';

        // Update status
        const turn = data.turn === 'white' ? 'White' : 'Black';
        updateStatus(`New game started! ${turn} to move`);

        // If bot made first move (player is black)
        if (data.bot_move) {
            addMoveToHistory(1, data.bot_move, '');
        }

    } catch (error) {
        console.error('Error starting new game:', error);
        updateStatus('Error starting game. Please try again.');
    }
}

// Make a move
async function makeMove(moveUci) {
    setThinking(true);

    try {
        const response = await fetch('/api/make_move', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                move: moveUci
            })
        });

        const data = await response.json();

        if (response.ok) {
            // Update game with new position
            game = new Chess(data.fen);
            board.position(data.fen);

            // Update move history
            const moveNumber = Math.floor(game.history().length / 2) + (game.history().length % 2);
            if (playerColor === 'white') {
                if (data.bot_move) {
                    addMoveToHistory(moveNumber, data.player_move, data.bot_move);
                } else {
                    addMoveToHistory(moveNumber, data.player_move, '');
                }
            } else {
                addMoveToHistory(moveNumber, data.bot_move, data.player_move);
            }

            // Check game status
            if (data.is_game_over) {
                updateStatus(data.game_result, false, true);
            } else if (data.is_check) {
                const turn = game.turn() === 'w' ? 'White' : 'Black';
                updateStatus(`Check! ${turn} to move`, true);
            } else {
                const turn = game.turn() === 'w' ? 'White' : 'Black';
                updateStatus(`${turn} to move`);
            }
        } else {
            // Illegal move, reset position
            game.undo();
            board.position(game.fen());
            updateStatus('Illegal move! Try again.');
        }

    } catch (error) {
        console.error('Error making move:', error);
        game.undo();
        board.position(game.fen());
        updateStatus('Error making move. Please try again.');
    } finally {
        setThinking(false);
    }
}

// Initialize on page load
window.onload = function() {
    initBoard();
};
