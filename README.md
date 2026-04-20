# Fischer Bot - ML-Enhanced Chess Engine

A chess bot that emulates the legendary playing style of Bobby Fischer, World Chess Champion (1972-1975). Now enhanced with machine learning trained on Fischer's actual games!

## Features

### Core Engine
- **Aggressive, Tactical Play**: Prioritizes sharp, forcing variations
- **Fischer's Opening Repertoire**: Plays 1.e4 as White, fights for the initiative as Black
- **Strong Endgame Technique**: Emphasis on converting advantages
- **Pattern Recognition**: Recognizes tactical motifs Fischer frequently employed
- **Open Positions**: Prefers active piece play and open files

### NEW: Machine Learning Enhancements
- **ML-Trained Move Prediction**: Neural network trained on Fischer's 1960s games and 1972 World Championship
- **Hybrid Engine**: Combines ML intuition with traditional alpha-beta search
- **Fischer Game Dataset**: Curated collection of Fischer's most important games
- **Adjustable Playing Style**: Configure the balance between ML and search
- **Fischer-Style Analysis**: Get insights into Fischer's likely moves

## Installation

\`\`\`bash
# Clone the repository
git clone https://github.com/zoniin/FischerBot.git
cd FischerBot

# Install dependencies
pip install -r requirements.txt
\`\`\`

## Quick Start

### Play with Standard Bot
\`\`\`bash
python examples/main.py
\`\`\`

### Train and Use ML Bot
\`\`\`bash
# Train the model on Fischer's games
python train_model.py

# Run ML bot example
python examples/ml_bot_example.py
\`\`\`

### Web Interface
\`\`\`bash
cd web/fischer
python app.py
# Visit http://localhost:5000
\`\`\`

## Usage

### ML-Enhanced Bot

\`\`\`python
from src.fischer_bot_ml import FischerBotML
import chess

# Create ML-enhanced bot
bot = FischerBotML(
    max_depth=4,           # Search depth
    use_opening_book=True, # Use Fischer's opening repertoire
    use_ml=True,           # Enable ML
    ml_weight=0.4          # 40% ML, 60% search
)

# Play against Fischer!
board = chess.Board()
move = bot.get_move(board)
board.push(move)
\`\`\`

### Adjusting Playing Style

\`\`\`python
# More Fischer-style (intuitive)
bot.set_ml_weight(0.7)  # 70% ML, 30% search

# More tactical (calculating)
bot.set_ml_weight(0.2)  # 20% ML, 80% search
\`\`\`

## Deployment to Vercel

The repository is ready for deployment:

\`\`\`bash
npm install -g vercel
cd FischerBot
vercel
\`\`\`

See [docs/VERCEL_DEPLOYMENT.md](docs/VERCEL_DEPLOYMENT.md) for detailed instructions.

## Documentation

- **[ML Improvements](docs/ML_IMPROVEMENTS.md)**: Detailed ML architecture and training
- **[Vercel Deployment](docs/VERCEL_DEPLOYMENT.md)**: Complete deployment guide

## Project Structure

\`\`\`
FischerBot/
├── src/
│   ├── fischer_bot.py         # Original alpha-beta engine
│   ├── fischer_bot_ml.py      # ML-enhanced hybrid engine
│   ├── ml_engine.py           # Neural network
│   ├── fischer_dataset.py     # Game dataset
│   ├── evaluation.py          # Position evaluation
│   └── openings.py            # Opening repertoire
├── api/index.py               # Vercel serverless function
├── train_model.py             # Model training script
└── examples/                  # Usage examples
\`\`\`

## Requirements

- Python 3.8+
- python-chess >= 1.9.0
- flask >= 2.3.0
- numpy >= 1.24.0

## License

MIT License
