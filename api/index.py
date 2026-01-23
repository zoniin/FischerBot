"""
Vercel serverless function for Fischer Bot.
This adapts the Flask app for Vercel's serverless environment.
"""

import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from flask import Flask, render_template, request, jsonify
import chess
from src.fischer_bot_ml import FischerBotML
from src.fischer_bot import FischerBot
import secrets
import os

# Create Flask app
app = Flask(__name__,
            template_folder=str(Path(__file__).parent.parent / 'web' / 'fischer' / 'templates'),
            static_folder=str(Path(__file__).parent.parent / 'web' / 'fischer' / 'static'))

app.secret_key = os.environ.get('SECRET_KEY', secrets.token_hex(16))

# Store game sessions (in production, use Redis or similar)
games = {}


@app.route('/')
def index():
    """Serve the main chess interface."""
    return render_template('index.html')


@app.route('/api/new_game', methods=['POST'])
def new_game():
    """Start a new game."""
    data = request.json
    difficulty = data.get('difficulty', 'medium')
    use_ml = data.get('use_ml', True)

    # Map difficulty to search depth
    depth_map = {
        'easy': 2,
        'medium': 4,
        'hard': 6
    }
    depth = depth_map.get(difficulty, 4)

    # Create new game with ML-enhanced bot
    game_id = secrets.token_hex(8)
    board = chess.Board()

    # Use ML bot if available, otherwise fallback to regular bot
    try:
        bot = FischerBotML(max_depth=depth, use_opening_book=True, use_ml=use_ml)
    except Exception as e:
        print(f"Failed to load ML bot: {e}, using standard bot")
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
        'ml_enabled': isinstance(bot, FischerBotML) and bot.use_ml
    })


@app.route('/api/move', methods=['POST'])
def make_move():
    """Make a move and get bot's response."""
    data = request.json
    game_id = data.get('game_id')
    move_uci = data.get('move')

    if game_id not in games:
        return jsonify({'error': 'Game not found'}), 404

    game = games[game_id]
    board = game['board']
    bot = game['bot']

    try:
        # Make player's move
        move = chess.Move.from_uci(move_uci)
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

        # Get bot's move
        bot_move = bot.get_move(board)
        board.push(bot_move)

        # Check if game is over after bot's move
        status = get_game_status(board) if board.is_game_over() else 'playing'

        return jsonify({
            'fen': board.fen(),
            'bot_move': bot_move.uci(),
            'legal_moves': [move.uci() for move in board.legal_moves],
            'status': status
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/game_state/<game_id>', methods=['GET'])
def game_state(game_id):
    """Get current game state."""
    if game_id not in games:
        return jsonify({'error': 'Game not found'}), 404

    game = games[game_id]
    board = game['board']

    return jsonify({
        'fen': board.fen(),
        'legal_moves': [move.uci() for move in board.legal_moves],
        'status': get_game_status(board) if board.is_game_over() else 'playing'
    })


@app.route('/api/analysis/<game_id>', methods=['GET'])
def get_analysis(game_id):
    """Get Fischer-style analysis of current position."""
    if game_id not in games:
        return jsonify({'error': 'Game not found'}), 404

    game = games[game_id]
    board = game['board']
    bot = game['bot']

    # Get analysis if using ML bot
    if isinstance(bot, FischerBotML):
        analysis = bot.get_fischer_analysis(board)
        return jsonify(analysis)
    else:
        return jsonify({'error': 'Analysis only available with ML bot'}), 400


def get_game_status(board):
    """Get the game status."""
    if board.is_checkmate():
        winner = 'Black' if board.turn == chess.WHITE else 'White'
        return f'checkmate_{winner.lower()}'
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


# Vercel serverless handler
def handler(request):
    """Handler for Vercel serverless function."""
    with app.request_context(request.environ):
        try:
            return app.full_dispatch_request()
        except Exception as e:
            return jsonify({'error': str(e)}), 500


# For local development
if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
