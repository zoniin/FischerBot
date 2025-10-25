# Fischer Bot - A Chess Engine Inspired by Bobby Fischer

A chess bot that emulates the legendary playing style of Bobby Fischer, World Chess Champion (1972-1975).

## Features

- **Aggressive, Tactical Play**: Prioritizes sharp, forcing variations
- **Fischer's Opening Repertoire**: Plays 1.e4 as White, fights for the initiative as Black
- **Strong Endgame Technique**: Emphasis on converting advantages
- **Pattern Recognition**: Recognizes tactical motifs Fischer frequently employed
- **Open Positions**: Prefers active piece play and open files

## Bobby Fischer's Playing Style

Bobby Fischer was known for:
- **Opening Preparation**: Deep preparation, especially in the Ruy Lopez, King's Indian Attack, and Najdorf Sicilian
- **Tactical Brilliance**: Exceptional calculation and pattern recognition
- **Endgame Mastery**: Clinical technique in converting winning positions
- **Aggressive Play**: Direct, forcing moves that put pressure on opponents
- **Positional Understanding**: Clear positional goals combined with tactical execution

## Installation

```bash
pip install -r requirements.txt
```

## Usage

### Play Against Fischer Bot

```bash
python main.py
```

### Use as a Library

```python
from fischer_bot import FischerBot
import chess

board = chess.Board()
bot = FischerBot()

# Get Fischer's move
move = bot.get_move(board)
board.push(move)
```

## How It Works

1. **Opening Book**: Uses Fischer's favorite openings and variations
2. **Position Evaluation**: Values piece activity, king safety, pawn structure (Fischer's priorities)
3. **Search Algorithm**: Alpha-beta pruning with move ordering
4. **Fischer Heuristics**: Bonus for:
   - Open files for rooks
   - Active piece placement
   - Pawn breaks and weaknesses
   - Tactical opportunities

## Requirements

- Python 3.8+
- python-chess library

## About Bobby Fischer

Robert James Fischer (1943-2008) was an American chess grandmaster and the eleventh World Chess Champion. He is considered one of the greatest chess players of all time, known for his incredible tactical ability, deep opening preparation, and dominance during his peak years.

## License

MIT License
