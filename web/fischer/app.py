"""
Flask web application for Fischer Bot.
Allows users to play chess against the bot through a web interface.
"""

import sys
from pathlib import Path

# Add project root to Python path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from flask import Flask, render_template, request, jsonify, session
import chess
import chess.svg
from src.fischer_bot import FischerBot
import secrets

app = Flask(__name__)
app.secret_key = secrets.token_hex(16)

# Store game sessions
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

    # Map difficulty to search depth
    depth_map = {
        'easy': 2,
        'medium': 4,
        'hard': 6
    }
    depth = depth_map.get(difficulty, 4)

    # Create new game
    game_id = secrets.token_hex(8)
    board = chess.Board()
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
        'status': 'playing'
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


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
