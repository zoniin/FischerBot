# Fischer Bot - Web Interface

A beautiful chess.com-inspired web interface to play against Fischer Bot!

## Features

- **Stunning wooden board design** - Classic chess aesthetic
- **Chess.com-inspired UI/UX** - Familiar and intuitive interface
- **Real-time move analysis** - See evaluation and material balance
- **Move history tracking** - Review all moves in the game
- **Captured pieces display** - Track what pieces have been captured
- **Adjustable difficulty** - Choose bot strength from Easy to Expert
- **Play as White or Black** - Select your preferred color
- **Flip board** - View the board from either perspective

## Quick Start

### 1. Install Requirements

Make sure you have Python 3.8+ installed, then install the dependencies:

```bash
pip install -r requirements.txt
```

### 2. Run the Web Server

```bash
python web_app.py
```

### 3. Open Your Browser

Navigate to:
```
http://localhost:5000
```

## How to Play

1. **Start a New Game**: Click "New Game" button
2. **Select Your Color**: Choose White or Black from the dropdown
3. **Adjust Difficulty**: Select bot strength (Depth 2-5)
4. **Make Your Move**: Click on a piece to select it, then click on the destination square
5. **Flip Board**: Use "Flip Board" button to change perspective

## Bot Strength Levels

- **Easy (Depth 2)**: Beginner level, thinks 2 moves ahead
- **Medium (Depth 3)**: Intermediate level, thinks 3 moves ahead
- **Hard (Depth 4)**: Advanced level, thinks 4 moves ahead (default)
- **Expert (Depth 5)**: Master level, thinks 5 moves ahead (slower but stronger)

## Interface Sections

### Left Sidebar
- **Move History**: Scrollable list of all moves in standard chess notation
- **Game Settings**: Configure color and bot difficulty

### Chess Board
- **Wooden Design**: Beautiful wooden board with clear piece symbols
- **Move Highlights**: Legal moves shown when piece is selected
- **Last Move Highlight**: Previous move highlighted for reference
- **Coordinate Labels**: Files (a-h) and ranks (1-8) labeled on board edges

### Right Sidebar
- **Position Analysis**:
  - Material balance (who has more pieces)
  - Nodes searched (how many positions evaluated)
  - Last move in algebraic notation
- **Captured Pieces**: Visual display of captured pieces for both sides

## Tips

- The bot uses Fischer's opening repertoire for the first ~10 moves
- Green highlights show legal moves, yellow highlights show the last move
- The evaluation score is in pawns (e.g., +2.0 means White is up by 2 pawns)
- Try different difficulty levels to find your perfect match!

## Troubleshooting

### Port Already in Use
If port 5000 is already in use, edit `web_app.py` and change the port number:
```python
app.run(debug=True, host='0.0.0.0', port=5001)  # Change 5000 to 5001
```

### Slow Response Times
If the bot is taking too long:
1. Reduce the search depth in Game Settings
2. Lower depths (2-3) are much faster than higher depths (4-5)

### Browser Compatibility
For best experience, use a modern browser:
- Chrome/Edge (recommended)
- Firefox
- Safari

## Keyboard Shortcuts

- **F5** or **Ctrl+R**: Refresh the page
- **Ctrl+Shift+R**: Hard refresh (clear cache)

## Enjoy Playing!

Fischer Bot combines Bobby Fischer's aggressive playing style with modern chess engine techniques. Have fun and may the best player win!
