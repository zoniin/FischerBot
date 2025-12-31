"""
Flask web server for Fischer Bot.
Provides a chess.com-inspired web interface to play against the bot.
"""

import sys
from pathlib import Path

# Add project root to Python path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from flask import Flask, render_template, jsonify, request
import chess
from src.stockfish_bot import StockfishBot

app = Flask(__name__,
           template_folder='templates',
           static_folder='static',
           static_url_path='/static')

# Game state
game_state = {
    'board': chess.Board(),
    'bot': StockfishBot(max_depth=15, skill_level=20),
    'player_color': chess.WHITE,
    'move_history': []
}


@app.route('/')
def index():
    """Serve the main game page."""
    return render_template('index.html')


@app.route('/api/new_game', methods=['POST'])
def new_game():
    """Start a new game."""
    data = request.json
    player_color = data.get('player_color', 'white')

    game_state['board'] = chess.Board()
    game_state['player_color'] = chess.WHITE if player_color == 'white' else chess.BLACK
    game_state['move_history'] = []
    game_state['bot'] = StockfishBot(max_depth=15, skill_level=20)

    return jsonify({
        'success': True,
        'board': board_to_string(game_state['board']),
        'turn': 'white' if game_state['board'].turn == chess.WHITE else 'black',
        'evaluation': 0.0,
        'material_balance': 'Even',
        'nodes_searched': 0,
        'last_move': None
    })


@app.route('/api/make_move', methods=['POST'])
def make_move():
    """Make a player move."""
    data = request.json
    from_square = data.get('from_square')
    to_square = data.get('to_square')

    board = game_state['board']

    try:
        # Parse squares
        from_sq = chess.parse_square(from_square)
        to_sq = chess.parse_square(to_square)

        # Create move
        move = chess.Move(from_sq, to_sq)

        # Check for promotion
        piece = board.piece_at(from_sq)
        if piece and piece.piece_type == chess.PAWN:
            if (piece.color == chess.WHITE and chess.square_rank(to_sq) == 7) or \
               (piece.color == chess.BLACK and chess.square_rank(to_sq) == 0):
                move = chess.Move(from_sq, to_sq, promotion=chess.QUEEN)

        # Check if move is legal
        if move not in board.legal_moves:
            return jsonify({'success': False, 'error': 'Illegal move'})

        # Track captured piece
        captured = None
        if board.is_capture(move):
            captured_piece = board.piece_at(to_sq)
            if captured_piece:
                captured = piece_to_char(captured_piece)

        # Make the move
        san = board.san(move)
        board.push(move)
        game_state['move_history'].append(san)

        # Check game over
        game_over = board.is_game_over()
        result = None
        if game_over:
            result = get_game_result(board)

        return jsonify({
            'success': True,
            'board': board_to_string(board),
            'turn': 'white' if board.turn == chess.WHITE else 'black',
            'evaluation': evaluate_board(board),
            'material_balance': get_material_balance(board),
            'last_move': san,
            'captured': captured,
            'game_over': game_over,
            'result': result
        })

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})


@app.route('/api/bot_move', methods=['POST'])
def bot_move():
    """Make a bot move."""
    board = game_state['board']
    bot = game_state['bot']

    try:
        # Get bot move
        move = bot.get_move(board)

        if move is None:
            return jsonify({'success': False, 'error': 'No legal moves'})

        # Track captured piece
        captured = None
        if board.is_capture(move):
            captured_piece = board.piece_at(move.to_square)
            if captured_piece:
                captured = piece_to_char(captured_piece)

        # Make the move
        san = board.san(move)
        board.push(move)
        game_state['move_history'].append(san)

        # Check game over
        game_over = board.is_game_over()
        result = None
        if game_over:
            result = get_game_result(board)

        return jsonify({
            'success': True,
            'board': board_to_string(board),
            'turn': 'white' if board.turn == chess.WHITE else 'black',
            'move': {
                'from': chess.square_name(move.from_square),
                'to': chess.square_name(move.to_square),
                'san': san
            },
            'evaluation': evaluate_board(board),
            'material_balance': get_material_balance(board),
            'nodes_searched': bot.nodes_searched,
            'last_move': san,
            'captured': captured,
            'game_over': game_over,
            'result': result
        })

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})


@app.route('/api/legal_moves', methods=['POST'])
def legal_moves():
    """Get legal moves for a square."""
    data = request.json
    square = data.get('square')

    board = game_state['board']

    try:
        sq = chess.parse_square(square)
        moves = []

        for move in board.legal_moves:
            if move.from_square == sq:
                moves.append(chess.square_name(move.to_square))

        return jsonify({'legal_moves': moves})

    except Exception as e:
        return jsonify({'legal_moves': []})


@app.route('/api/get_turn')
def get_turn():
    """Get whose turn it is."""
    board = game_state['board']
    return jsonify({
        'turn': 'white' if board.turn == chess.WHITE else 'black'
    })


@app.route('/api/get_moves')
def get_moves():
    """Get move history."""
    return jsonify({
        'moves': game_state['move_history']
    })


@app.route('/api/set_depth', methods=['POST'])
def set_depth():
    """Set bot search depth."""
    data = request.json
    depth = data.get('depth', 4)

    game_state['bot'].set_depth(depth)

    return jsonify({'success': True, 'depth': depth})


# Helper functions

def board_to_string(board):
    """Convert board to string representation."""
    result = []
    for rank in range(7, -1, -1):
        rank_str = []
        for file in range(8):
            square = chess.square(file, rank)
            piece = board.piece_at(square)
            if piece:
                rank_str.append(piece_to_char(piece))
            else:
                rank_str.append('.')
        result.append(' '.join(rank_str))
    return '\n'.join(result)


def piece_to_char(piece):
    """Convert piece to character."""
    symbols = {
        chess.PAWN: 'P',
        chess.KNIGHT: 'N',
        chess.BISHOP: 'B',
        chess.ROOK: 'R',
        chess.QUEEN: 'Q',
        chess.KING: 'K'
    }
    char = symbols[piece.piece_type]
    return char if piece.color == chess.WHITE else char.lower()


def evaluate_board(board):
    """Get board evaluation."""
    from src.evaluation import evaluate_position
    return evaluate_position(board) / 100.0  # Convert centipawns to pawns


def get_material_balance(board):
    """Get material balance string."""
    piece_values = {
        chess.PAWN: 1,
        chess.KNIGHT: 3,
        chess.BISHOP: 3,
        chess.ROOK: 5,
        chess.QUEEN: 9
    }

    white_material = 0
    black_material = 0

    for square in chess.SQUARES:
        piece = board.piece_at(square)
        if piece and piece.piece_type != chess.KING:
            value = piece_values.get(piece.piece_type, 0)
            if piece.color == chess.WHITE:
                white_material += value
            else:
                black_material += value

    diff = white_material - black_material
    if diff > 0:
        return f'+{diff} (White)'
    elif diff < 0:
        return f'{diff} (Black)'
    else:
        return 'Even'


def get_game_result(board):
    """Get game result string."""
    if board.is_checkmate():
        winner = 'Black' if board.turn == chess.WHITE else 'White'
        return f'Checkmate! {winner} wins!'
    elif board.is_stalemate():
        return 'Stalemate! Draw.'
    elif board.is_insufficient_material():
        return 'Draw by insufficient material.'
    elif board.can_claim_fifty_moves():
        return 'Draw by fifty-move rule.'
    elif board.can_claim_threefold_repetition():
        return 'Draw by repetition.'
    else:
        return 'Draw.'


if __name__ == '__main__':
    print("\n" + "=" * 50)
    print("Fischer Bot - Web Interface")
    print("=" * 50)
    print("\nStarting server...")
    print("Open your browser and go to: http://localhost:5000")
    print("\nPress Ctrl+C to stop the server")
    print("=" * 50 + "\n")

    app.run(debug=True, host='0.0.0.0', port=5000)
