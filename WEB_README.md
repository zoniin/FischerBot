# Fischer Bot Web Interface

Play chess against Fischer Bot through an interactive web interface!

## Setup

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Run the Flask application:
```bash
python app.py
```

3. Open your browser and navigate to:
```
http://localhost:5000
```

## Features

- **Interactive Chess Board**: Drag and drop pieces to make moves
- **Difficulty Levels**: Choose from Easy, Medium, or Hard
- **Move History**: Track all moves in the game
- **Real-time Updates**: See the bot's moves instantly
- **Responsive Design**: Works on desktop and mobile devices

## Difficulty Levels

- **Easy** (Depth 2): Good for beginners
- **Medium** (Depth 4): Balanced challenge
- **Hard** (Depth 6): Strong opponent

## How to Play

1. Click "New Game" to start
2. You play as White (bottom of the board)
3. Drag and drop pieces to make your move
4. Watch as Fischer Bot responds with its move
5. Continue until checkmate or draw!

## Deployment

To deploy this application to a production server, you can use services like:

- **Heroku**: Add a `Procfile` with `web: python app.py`
- **Railway**: Connect your GitHub repo and deploy
- **PythonAnywhere**: Upload files and configure WSGI
- **DigitalOcean App Platform**: Deploy directly from GitHub

## Technical Details

- **Backend**: Flask (Python)
- **Frontend**: HTML, CSS, JavaScript
- **Chess Logic**: python-chess library
- **Chess Board UI**: chessboard.js
- **Search Algorithm**: Alpha-beta pruning with transposition tables

Enjoy playing against Fischer Bot!
