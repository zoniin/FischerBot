"""
Flask web server for Fischer Bot chess game.
"""

from flask import Flask, render_template, jsonify, request
from flask_cors import CORS
import chess
from fischer_bot import FischerBot

app = Flask(__name__)
CORS(app)

# Game state
game_state = {
    'board': chess.Board(),
    'bot': FischerBot(max_depth=4),
    'player_color': chess.WHITE,
    'game_over': False
}


@app.route('/')
def index():
    """Serve the main page."""
    return render_template('index.html')


@app.route('/api/new_game', methods=['POST'])
def new_game():
    """Start a new game."""
    data = request.json
    player_color = data.get('color', 'white')
    difficulty = data.get('difficulty', 4)

    game_state['board'] = chess.Board()
    game_state['bot'] = FischerBot(max_depth=difficulty)
    game_state['player_color'] = chess.WHITE if player_color == 'white' else chess.BLACK
    game_state['game_over'] = False

    response = {
        'fen': game_state['board'].fen(),
        'legal_moves': [move.uci() for move in game_state['board'].legal_moves],
        'turn': 'white' if game_state['board'].turn == chess.WHITE else 'black',
        'player_color': player_color
    }

    # If player chose black, make bot's first move
    if game_state['player_color'] == chess.BLACK:
        bot_move = game_state['bot'].get_move(game_state['board'])
        game_state['board'].push(bot_move)
        response['bot_move'] = bot_move.uci()
        response['fen'] = game_state['board'].fen()
        response['legal_moves'] = [move.uci() for move in game_state['board'].legal_moves]
        response['turn'] = 'black'

    return jsonify(response)


@app.route('/api/get_state', methods=['GET'])
def get_state():
    """Get current game state."""
    board = game_state['board']

    game_result = None
    if board.is_checkmate():
        winner = 'black' if board.turn == chess.WHITE else 'white'
        game_result = f'Checkmate! {winner.capitalize()} wins!'
    elif board.is_stalemate():
        game_result = 'Stalemate! Draw.'
    elif board.is_insufficient_material():
        game_result = 'Draw due to insufficient material.'
    elif board.is_fifty_moves():
        game_result = 'Draw due to fifty-move rule.'
    elif board.is_repetition():
        game_result = 'Draw due to threefold repetition.'

    return jsonify({
        'fen': board.fen(),
        'legal_moves': [move.uci() for move in board.legal_moves],
        'turn': 'white' if board.turn == chess.WHITE else 'black',
        'is_check': board.is_check(),
        'is_game_over': board.is_game_over(),
        'game_result': game_result
    })


@app.route('/api/make_move', methods=['POST'])
def make_move():
    """Make a player move and get bot response."""
    data = request.json
    move_uci = data.get('move')

    board = game_state['board']

    try:
        move = chess.Move.from_uci(move_uci)

        if move not in board.legal_moves:
            return jsonify({'error': 'Illegal move'}), 400

        # Make player's move
        board.push(move)

        response = {
            'player_move': move_uci,
            'fen': board.fen(),
            'is_check': board.is_check(),
            'is_game_over': board.is_game_over()
        }

        # Check if game is over
        if board.is_game_over():
            game_state['game_over'] = True
            if board.is_checkmate():
                winner = 'black' if board.turn == chess.WHITE else 'white'
                response['game_result'] = f'Checkmate! {winner.capitalize()} wins!'
            elif board.is_stalemate():
                response['game_result'] = 'Stalemate! Draw.'
            else:
                response['game_result'] = 'Game Over - Draw.'
            return jsonify(response)

        # Get bot's move
        bot_move = game_state['bot'].get_move(board)
        board.push(bot_move)

        response['bot_move'] = bot_move.uci()
        response['fen'] = board.fen()
        response['legal_moves'] = [move.uci() for move in board.legal_moves]
        response['turn'] = 'white' if board.turn == chess.WHITE else 'black'
        response['is_check'] = board.is_check()
        response['is_game_over'] = board.is_game_over()

        # Check if game is over after bot's move
        if board.is_game_over():
            game_state['game_over'] = True
            if board.is_checkmate():
                winner = 'black' if board.turn == chess.WHITE else 'white'
                response['game_result'] = f'Checkmate! {winner.capitalize()} wins!'
            elif board.is_stalemate():
                response['game_result'] = 'Stalemate! Draw.'
            else:
                response['game_result'] = 'Game Over - Draw.'

        return jsonify(response)

    except ValueError as e:
        return jsonify({'error': f'Invalid move format: {str(e)}'}), 400


if __name__ == '__main__':
    print("Fischer Bot Web Server Starting...")
    print("Open your browser to: http://localhost:5000")
    app.run(debug=True, host='0.0.0.0', port=5000)
