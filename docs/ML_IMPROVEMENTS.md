# Fischer Bot ML Improvements

## Overview

The Fischer Bot has been significantly enhanced with machine learning capabilities that learn directly from Bobby Fischer's games, particularly focusing on his 1960s career and the legendary 1972 World Championship match against Boris Spassky.

## New Features

### 1. ML-Based Move Prediction

The bot now includes a neural network that:
- Learns Fischer's move preferences from his actual games
- Predicts moves that Fischer would likely play in any position
- Combines ML predictions with traditional alpha-beta search for optimal play

### 2. Hybrid Chess Engine (`FischerBotML`)

The new `FischerBotML` class combines:
- **ML Model**: Trained on Fischer's games to suggest candidate moves
- **Alpha-Beta Search**: Deep tactical calculation
- **Weighted Combination**: Configurable balance between ML intuition and search depth

The hybrid approach provides:
- Fischer's strategic style (from ML learning)
- Tactical accuracy (from search)
- Adjustable playing strength

### 3. Fischer Game Dataset

A comprehensive dataset module (`fischer_dataset.py`) includes:
- Games from the 1972 World Championship
- Key games from Fischer's 1960s career
- Support for loading custom PGN files
- Automatic extraction of Fischer's positions and moves

## Architecture

```
src/
├── fischer_bot.py       # Original alpha-beta engine
├── fischer_bot_ml.py    # Enhanced ML + search hybrid
├── ml_engine.py         # Neural network for move prediction
├── fischer_dataset.py   # Game dataset and PGN parsing
└── evaluation.py        # Position evaluation (unchanged)
```

## How It Works

### Training Pipeline

1. **Data Collection**: Load Fischer's games from PGN format
2. **Feature Extraction**: Convert board positions to neural network features
   - 768 values for piece positions (12 piece types × 64 squares)
   - 5 values for game state (castling, side to move)
3. **Training**: Neural network learns to predict Fischer's moves
4. **Model Saving**: Trained model saved for inference

### Inference Pipeline

1. **Opening Book**: Check Fischer's opening repertoire (highest priority)
2. **ML Prediction**: Get top-k candidate moves from ML model
3. **Search Evaluation**: Evaluate each candidate with alpha-beta search
4. **Hybrid Decision**: Combine ML probability with search score
   - `combined_score = ml_weight × ml_score + (1 - ml_weight) × search_score`

### Feature Representation

Board positions are encoded as 773-dimensional vectors:
- **Piece Positions** (768 values): Binary encoding of all pieces
  - 6 piece types (pawn, knight, bishop, rook, queen, king)
  - 2 colors (white, black)
  - 64 squares
  - Example: `features[0:64]` = white pawns, `features[64:128]` = white knights, etc.
- **Castling Rights** (4 values): Binary flags for each castling option
- **Side to Move** (1 value): Who's turn it is

## Usage

### Training the Model

```bash
python train_model.py
```

This will:
- Load Fischer's games from the dataset
- Train the neural network (100 epochs by default)
- Save the model to `models/fischer_model.pkl`

### Using the ML Bot

```python
from src.fischer_bot_ml import FischerBotML
import chess

# Create ML-enhanced bot
bot = FischerBotML(
    max_depth=4,           # Search depth
    use_opening_book=True, # Use Fischer's opening repertoire
    use_ml=True,           # Enable ML
    ml_weight=0.4          # Balance: 40% ML, 60% search
)

# Play a game
board = chess.Board()
move = bot.get_move(board)
board.push(move)
```

### Adjusting ML Weight

```python
# More ML influence (Fischer's style)
bot.set_ml_weight(0.7)  # 70% ML, 30% search

# More search influence (tactical accuracy)
bot.set_ml_weight(0.2)  # 20% ML, 80% search

# Pure ML (Fischer's intuition)
bot.set_ml_weight(1.0)

# Pure search (traditional engine)
bot.set_ml_weight(0.0)
```

### Getting Fischer-Style Analysis

```python
analysis = bot.get_fischer_analysis(board)

print("ML Top Moves:", analysis['ml_top_moves'])
print("Search Best Move:", analysis['search_best_move'])
print("Hybrid Best Move:", analysis['hybrid_best_move'])
```

## Model Performance

The current implementation uses a simple 2-layer neural network:
- **Input Layer**: 773 features
- **Hidden Layer**: 512 neurons with ReLU activation
- **Output Layer**: 4096 neurons (64×64 possible moves) with softmax

### Strengths
- Captures Fischer's opening preferences
- Learns positional patterns from Fischer's games
- Fast inference (suitable for real-time play)

### Limitations
- Simple architecture (room for improvement with deeper networks)
- Limited training data (sample games included)
- Training uses simplified gradient descent

### Future Improvements
1. **More Training Data**: Add more Fischer games (500+ games available)
2. **Better Architecture**: Use convolutional neural networks (CNNs) for board representation
3. **Modern Frameworks**: Implement with PyTorch or TensorFlow for proper backpropagation
4. **Reinforcement Learning**: Fine-tune with self-play
5. **Positional Features**: Add more sophisticated board features

## Vercel Deployment

The repository is now configured for deployment on Vercel:

### Configuration Files
- `vercel.json`: Vercel configuration
- `api/index.py`: Serverless function handler
- `requirements.txt`: Python dependencies

### Deployment Steps

1. **Install Vercel CLI** (if not already installed):
   ```bash
   npm install -g vercel
   ```

2. **Login to Vercel**:
   ```bash
   vercel login
   ```

3. **Deploy**:
   ```bash
   cd FischerBot
   vercel
   ```

4. **For Production**:
   ```bash
   vercel --prod
   ```

### Environment Variables

The app uses these environment variables:
- `SECRET_KEY`: Flask secret key (auto-generated if not set)
- `PYTHON_VERSION`: Python version (set to 3.9 in vercel.json)

### Vercel Limitations

- **Serverless Function Timeout**: 10 seconds (Hobby), 60 seconds (Pro)
- **Memory Limit**: 1024 MB (Hobby), 3008 MB (Pro)
- **Stateless**: Game state stored in memory (use Redis for production)

For production deployment:
1. Use Redis or database for game state persistence
2. Consider caching the ML model in serverless function
3. Monitor cold start times
4. Optimize model size if needed

## Dataset Expansion

To add more Fischer games:

```python
from src.fischer_dataset import FischerGameDataset

dataset = FischerGameDataset()

# Load from PGN file
dataset.load_pgn_file('path/to/fischer_games.pgn')

# Extract positions
dataset.extract_positions()

# Get statistics
stats = dataset.get_statistics()
print(f"Loaded {stats['total_games']} games")
print(f"Extracted {stats['total_positions']} positions")
```

## Historical Context

### Bobby Fischer (1943-2008)

Bobby Fischer was the 11th World Chess Champion and is considered one of the greatest chess players of all time. Key characteristics:

- **Opening Preparation**: Deep opening knowledge, particularly in the Ruy Lopez and Najdorf Sicilian
- **Tactical Brilliance**: Exceptional pattern recognition and calculation
- **Endgame Technique**: Clinical conversion of advantages
- **Psychological Play**: Intense focus and will to win

### 1972 World Championship

The 1972 World Championship match between Fischer and Boris Spassky in Reykjavik, Iceland was:
- One of the most famous chess matches in history
- A symbol of Cold War tension (USA vs USSR)
- Fischer's greatest achievement, winning 12.5-8.5
- Notable for Fischer's preparation, fighting spirit, and novel opening ideas

## References

- [Fischer's Games on Chessgames.com](https://www.chessgames.com/perl/chessplayer?pid=10180)
- [1972 World Championship](https://en.wikipedia.org/wiki/World_Chess_Championship_1972)
- [My 60 Memorable Games by Bobby Fischer](https://www.amazon.com/My-60-Memorable-Games-Fischer/dp/0671648896)

## Contributing

To contribute more Fischer games or improve the ML model:
1. Add PGN files to `data/` directory
2. Update training script to include new games
3. Experiment with different model architectures
4. Submit pull requests with improvements
