// Global variables
let board = null;
let game = new Chess();
let gameId = null;
let playerColor = 'white';
let moveHistory = [];

// Initialize when document is ready
$(document).ready(function() {
    initBoard();
    setupEventListeners();
});

// Initialize chess board
function initBoard() {
    const config = {
        draggable: true,
        position: 'start',
        onDragStart: onDragStart,
        onDrop: onDrop,
        onSnapEnd: onSnapEnd,
        pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png'
    };
    board = Chessboard('board', config);
}

// Setup event listeners
function setupEventListeners() {
    $('#new-game-btn').click(startNewGame);
    $('#flip-board-btn').click(() => board.flip());
}

// Start a new game
function startNewGame() {
    const difficulty = $('#difficulty').val();

    $.ajax({
        url: '/api/new_game',
        method: 'POST',
        contentType: 'application/json',
        data: JSON.stringify({ difficulty: difficulty }),
        success: function(response) {
            gameId = response.game_id;
            game = new Chess();
            board.position('start');
            moveHistory = [];
            updateStatus('Game started! You are playing White. Make your move.');
            updateTurnIndicator();
            updateMoveHistory();
        },
        error: function(xhr) {
            updateStatus('Error starting game: ' + xhr.responseJSON.error);
        }
    });
}

// Check if user can drag piece
function onDragStart(source, piece, position, orientation) {
    // Don't allow moves if game is over
    if (game.game_over()) {
        updateStatus('Game is over!');
        return false;
    }

    // Only allow user to move their pieces
    if ((game.turn() === 'w' && piece.search(/^b/) !== -1) ||
        (game.turn() === 'b' && piece.search(/^w/) !== -1)) {
        return false;
    }

    // Don't allow moves if no game is active
    if (!gameId) {
        updateStatus('Please start a new game first!');
        return false;
    }
}

// Handle piece drop
function onDrop(source, target) {
    // Check if move is legal
    const move = game.move({
        from: source,
        to: target,
        promotion: 'q' // Always promote to queen for simplicity
    });

    // Illegal move
    if (move === null) {
        return 'snapback';
    }

    // Make move on server
    makeMove(move.from + move.to + (move.promotion || ''));

    return true;
}

// Update board position after move
function onSnapEnd() {
    board.position(game.fen());
}

// Make a move on the server
function makeMove(moveUci) {
    showThinking(true);

    $.ajax({
        url: '/api/move',
        method: 'POST',
        contentType: 'application/json',
        data: JSON.stringify({
            game_id: gameId,
            move: moveUci
        }),
        success: function(response) {
            showThinking(false);

            // Update game state
            game.load(response.fen);
            board.position(response.fen);

            // Update move history
            updateMoveHistory();

            // Check game status
            if (response.status !== 'playing') {
                handleGameOver(response.status);
            } else {
                updateStatus('Your turn!');
                updateTurnIndicator();
            }
        },
        error: function(xhr) {
            showThinking(false);
            game.undo(); // Undo the move
            board.position(game.fen());
            updateStatus('Error: ' + xhr.responseJSON.error);
        }
    });
}

// Update game status display
function updateStatus(message) {
    $('#status').text(message);
}

// Update turn indicator
function updateTurnIndicator() {
    const turnIndicator = $('#turn-indicator');
    if (game.turn() === 'w') {
        turnIndicator.text('White to move')
            .removeClass('black-turn')
            .addClass('white-turn');
    } else {
        turnIndicator.text('Black to move')
            .removeClass('white-turn')
            .addClass('black-turn');
    }
}

// Update move history display
function updateMoveHistory() {
    const history = game.history({ verbose: true });
    let html = '';

    for (let i = 0; i < history.length; i += 2) {
        const moveNum = Math.floor(i / 2) + 1;
        const whiteMove = history[i].san;
        const blackMove = history[i + 1] ? history[i + 1].san : '';

        html += `<div class="move-entry">
            <span class="move-number">${moveNum}.</span>
            <span class="white-move">${whiteMove}</span>
            ${blackMove ? ' <span class="black-move">' + blackMove + '</span>' : ''}
        </div>`;
    }

    $('#moves-list').html(html);

    // Scroll to bottom
    const movesList = document.getElementById('moves-list');
    movesList.scrollTop = movesList.scrollHeight;
}

// Show/hide thinking indicator
function showThinking(show) {
    if (show) {
        $('#thinking-indicator').show();
    } else {
        $('#thinking-indicator').hide();
    }
}

// Handle game over
function handleGameOver(status) {
    let message = '';

    switch(status) {
        case 'checkmate_white':
            message = '🎉 Checkmate! White wins!';
            break;
        case 'checkmate_black':
            message = '🎉 Checkmate! Black wins!';
            break;
        case 'stalemate':
            message = '🤝 Stalemate! Game is a draw.';
            break;
        case 'insufficient_material':
            message = '🤝 Draw by insufficient material.';
            break;
        case 'fifty_moves':
            message = '🤝 Draw by fifty-move rule.';
            break;
        case 'repetition':
            message = '🤝 Draw by threefold repetition.';
            break;
        default:
            message = 'Game over!';
    }

    updateStatus(message);
    $('#turn-indicator').text('Game Over').removeClass('white-turn black-turn');
}
