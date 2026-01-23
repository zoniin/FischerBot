"""
Vercel serverless function for Fischer Bot.
Simplified API-only version for Vercel compatibility.
"""

import sys
import os
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from flask import Flask, request, jsonify, render_template
import secrets

# Import chess library
try:
    import chess
except ImportError:
    raise ImportError("chess library not installed")

# Import bot modules
try:
    from src.fischer_bot import FischerBot
    BOT_AVAILABLE = True
except ImportError as e:
    print(f"Warning: Could not import FischerBot: {e}")
    BOT_AVAILABLE = False

# Try to import ML bot (optional)
try:
    from src.fischer_bot_ml import FischerBotML
    ML_BOT_AVAILABLE = True
except ImportError as e:
    print(f"Info: ML bot not available: {e}")
    ML_BOT_AVAILABLE = False

# Create Flask app with templates and static files
template_dir = str(Path(__file__).parent / "templates")
static_dir = str(Path(__file__).parent / "static")
app = Flask(__name__, template_folder=template_dir, static_folder=static_dir)
app.secret_key = os.environ.get('SECRET_KEY', secrets.token_hex(16))

# Store game sessions (in-memory, use Redis for production)
games = {}


@app.route('/')
def index():
    """Serve the chess interface."""
    try:
        return render_template('index.html')
    except Exception as e:
        # Fallback to JSON if template fails
        print(f"Template rendering failed: {e}")
        return jsonify({
            'name': 'Fischer Bot API',
            'version': '2.0',
            'description': 'Chess engine inspired by Bobby Fischer',
            'ml_available': ML_BOT_AVAILABLE,
            'endpoints': {
                'POST /api/new_game': 'Start a new game',
                'POST /api/move': 'Make a move',
                'GET /api/game_state/<game_id>': 'Get game state',
                'GET /api/health': 'Health check'
            },
            'template_error': str(e)
        })


@app.route('/api/health', methods=['GET'])
def health():
    """Health check endpoint."""
    return jsonify({
        'status': 'healthy',
        'bot_available': BOT_AVAILABLE,
        'ml_available': ML_BOT_AVAILABLE
    })


@app.route('/api/new_game', methods=['POST'])
def new_game():
    """Start a new game."""
    if not BOT_AVAILABLE:
        return jsonify({'error': 'Chess bot not available'}), 500

    try:
        data = request.get_json() or {}
        difficulty = data.get('difficulty', 'medium')
        use_ml = data.get('use_ml', False)  # Default to False for stability

        # Map difficulty to search depth
        depth_map = {
            'easy': 1,    # Instant moves
            'medium': 2,  # Fast moves
            'hard': 3     # Moderate speed
        }
        depth = depth_map.get(difficulty, 2)

        # Create new game
        game_id = secrets.token_hex(8)
        board = chess.Board()

        # Create bot (ML if available and requested)
        bot = None
        ml_enabled = False

        if use_ml and ML_BOT_AVAILABLE:
            try:
                bot = FischerBotML(max_depth=depth, use_opening_book=True, use_ml=False)  # Disable ML loading for now
                ml_enabled = False  # Model not trained yet
            except Exception as e:
                print(f"ML bot creation failed: {e}")

        if bot is None:
            bot = FischerBot(max_depth=depth, use_opening_book=True)

        games[game_id] = {
            'board': board,
            'bot': bot,
            'difficulty': difficulty
        }

        return jsonify({
            'game_id': game_id,
            'fen': board.fen(),
            'legal_moves': [move.uci() for move in board.legal_moves],
            'status': 'playing',
            'ml_enabled': ml_enabled,
            'depth': depth
        })

    except Exception as e:
        return jsonify({'error': f'Failed to create game: {str(e)}'}), 500


@app.route('/api/move', methods=['POST'])
def make_move():
    """Make a move and get bot's response."""
    if not BOT_AVAILABLE:
        return jsonify({'error': 'Chess bot not available'}), 500

    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400

        game_id = data.get('game_id')
        move_uci = data.get('move')

        if not game_id or not move_uci:
            return jsonify({'error': 'Missing game_id or move'}), 400

        if game_id not in games:
            return jsonify({'error': 'Game not found'}), 404

        game = games[game_id]
        board = game['board']
        bot = game['bot']

        # Make player's move
        try:
            move = chess.Move.from_uci(move_uci)
        except ValueError:
            return jsonify({'error': 'Invalid move format'}), 400

        if move not in board.legal_moves:
            return jsonify({'error': 'Illegal move'}), 400

        board.push(move)

        # Check if game is over
        if board.is_game_over():
            return jsonify({
                'fen': board.fen(),
                'legal_moves': [],
                'status': get_game_status(board),
                'bot_move': None
            })

        # Get bot's move with error handling
        try:
            bot_move = bot.get_move(board)
            if not bot_move:
                return jsonify({'error': 'Bot failed to find a move'}), 500
            board.push(bot_move)
        except Exception as bot_error:
            print(f"Bot move error: {bot_error}")
            return jsonify({'error': f'Bot calculation failed: {str(bot_error)}'}), 500

        # Check if game is over after bot's move
        status = get_game_status(board) if board.is_game_over() else 'playing'

        return jsonify({
            'fen': board.fen(),
            'bot_move': bot_move.uci(),
            'legal_moves': [move.uci() for move in board.legal_moves],
            'status': status
        })

    except Exception as e:
        import traceback
        print(f"Error in make_move: {str(e)}")
        print(traceback.format_exc())
        return jsonify({'error': f'Move failed: {str(e)}'}), 500


@app.route('/api/game_state/<game_id>', methods=['GET'])
def game_state(game_id):
    """Get current game state."""
    if game_id not in games:
        return jsonify({'error': 'Game not found'}), 404

    try:
        game = games[game_id]
        board = game['board']

        return jsonify({
            'fen': board.fen(),
            'legal_moves': [move.uci() for move in board.legal_moves],
            'status': get_game_status(board) if board.is_game_over() else 'playing',
            'move_count': len(board.move_stack)
        })
    except Exception as e:
        return jsonify({'error': f'Failed to get game state: {str(e)}'}), 500


def get_game_status(board):
    """Get the game status."""
    if board.is_checkmate():
        winner = 'black' if board.turn == chess.WHITE else 'white'
        return f'checkmate_{winner}'
    elif board.is_stalemate():
        return 'stalemate'
    elif board.is_insufficient_material():
        return 'insufficient_material'
    elif board.is_fifty_moves():
        return 'fifty_moves'
    elif board.is_repetition():
        return 'repetition'
    else:
        return 'playing'


# Error handlers
@app.errorhandler(404)
def not_found(e):
    return jsonify({'error': 'Not found'}), 404


@app.errorhandler(500)
def internal_error(e):
    return jsonify({'error': 'Internal server error'}), 500


# For local development
if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
