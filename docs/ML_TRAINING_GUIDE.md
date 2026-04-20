# Fischer Bot ML Training Guide

Complete guide to training the Fischer Bot ML model on Bobby Fischer's games.

## Overview

The Fischer Bot uses a deep neural network trained on Bobby Fischer's actual games to learn his playing style. This guide covers the complete training pipeline from data collection to model deployment.

## Architecture

### Neural Network Structure

```
Input Layer (773 features)
    ↓
Hidden Layer 1 (1024 neurons) + ReLU + Dropout(0.3)
    ↓
Hidden Layer 2 (512 neurons) + ReLU + Dropout(0.3)
    ↓
Hidden Layer 3 (256 neurons) + ReLU + Dropout(0.3)
    ↓
Output Layer (4096 neurons) + Softmax
```

### Input Features (773 total)

- **Piece Positions** (768 features):
  - 12 channels: 6 piece types × 2 colors
  - 64 squares per channel
  - Binary encoding: 1 if piece present, 0 otherwise

- **Castling Rights** (4 features):
  - White kingside, White queenside
  - Black kingside, Black queenside

- **Side to Move** (1 feature):
  - 1 for White, 0 for Black

### Output

- **4096 move probabilities**:
  - 64 source squares × 64 destination squares
  - Softmax probability distribution
  - Filtered to legal moves during inference

## Training Data

### Sources

1. **My 60 Memorable Games** (60 games)
   - Fischer's most famous games
   - Deep analysis and brilliant tactics
   - Spanning 1957-1967

2. **1972 World Championship** (21 games)
   - Fischer vs Spassky
   - World Championship level play
   - Fischer's peak performance

3. **Total Dataset**:
   - 81 games
   - ~2000-3000 positions
   - Only Fischer's moves included

### Data Preparation

```bash
# Fetch games from online sources
python fetch_fischer_games.py
```

This downloads:
- Fischer's 60 Memorable Games from GitHub
- Complete 1972 World Championship games
- Saves to `data/` directory

## Installation

### Requirements

```bash
# Install dependencies
pip install -r requirements.txt

# Or install manually
pip install chess>=1.9.0
pip install flask>=2.3.0
pip install torch>=2.0.0
pip install numpy>=1.24.0
pip install requests
```

### System Requirements

- **Python**: 3.8 or higher
- **RAM**: 4GB minimum, 8GB recommended
- **Disk Space**: 500MB for PyTorch + models
- **GPU**: Optional (CPU training works fine for this dataset)

## Training Pipeline

### Step 1: Download Data

```bash
python fetch_fischer_games.py
```

**Output**:
```
Fetching 'My 60 Memorable Games'...
[OK] Downloaded to: data/fischer_60_memorable_games.pgn
  Games found: 60

Creating 1972 World Championship PGN...
[OK] Created: data/fischer_1972_world_championship.pgn
  Games: 21
```

### Step 2: Train Model

#### Basic Training

```bash
python train_model_pytorch.py
```

Default parameters:
- Epochs: 100
- Batch size: 64
- Learning rate: 0.001
- Device: CPU

#### Advanced Training

```bash
# With custom parameters
python train_model_pytorch.py --epochs 200 --batch-size 128 --lr 0.0005

# With GPU (if available)
python train_model_pytorch.py --device cuda --epochs 200

# Quick test run
python train_model_pytorch.py --epochs 10 --batch-size 32
```

#### Training Output

```
================================================================================
Fischer Bot ML Training (PyTorch)
Training deep neural network on Bobby Fischer's games
================================================================================

Using device: cpu

Loading Fischer's games...
Loading from data/fischer_60_memorable_games.pgn
Loaded 60 Fischer games...
Loading from data/fischer_1972_world_championship.pgn
Loaded 21 Fischer games...
Dataset statistics: {'total_games': 81, 'total_positions': 2847, ...}

Initializing model...
Model architecture:
  Input size: 773
  Hidden layers: 1024 -> 512 -> 256
  Output size: 4096
  Parameters: 4,567,040

Extracting positions from games...
Total positions: 2847

Training samples: 2562
Validation samples: 285

Starting training for 100 epochs...

Epoch [1/100] Train Loss: 5.2341, Train Acc: 0.0234 | Val Loss: 4.9876, Val Acc: 0.0351
  -> Saved best model (val_loss: 4.9876)
Epoch [2/100] Train Loss: 4.8765, Train Acc: 0.0456 | Val Loss: 4.6543, Val Acc: 0.0632
  -> Saved best model (val_loss: 4.6543)
...
Epoch [100/100] Train Loss: 2.1234, Train Acc: 0.3891 | Val Loss: 2.4567, Val Acc: 0.3228

================================================================================
Training Complete!
================================================================================
Best validation loss: 2.3456
Final validation accuracy: 0.3228

Saved models:
  - Best model: models/fischer_model_pytorch_best.pth
  - Final model: models/fischer_model_pytorch.pth
```

### Step 3: Evaluate Model

```bash
# Evaluate on test positions
python evaluate_model.py

# Evaluate on more positions
python evaluate_model.py --positions 500

# Test on specific famous position
python evaluate_model.py --specific
```

**Expected Results**:
```
================================================================================
Fischer Bot ML Model Evaluation
================================================================================

Loading model from models/fischer_model_pytorch.pth...
Model loaded successfully

Loading Fischer's games...
Testing on 100 positions

Evaluating...
  Progress: 20/100
  Progress: 40/100
  ...

================================================================================
Evaluation Results
================================================================================
Positions tested: 100

Top-1 Accuracy: 32.00% (32/100)
Top-3 Accuracy: 54.00% (54/100)
Top-5 Accuracy: 68.00% (68/100)

Interpretation:
  Good! Model shows understanding of Fischer's preferences.
```

## Understanding the Results

### Accuracy Metrics

- **Top-1 Accuracy**: Model's first choice matches Fischer's move
  - 40%+ = Excellent
  - 25-40% = Good
  - 15-25% = Moderate
  - <15% = Needs improvement

- **Top-3 Accuracy**: Fischer's move in top 3 predictions
  - Should be 50-70% for good model

- **Top-5 Accuracy**: Fischer's move in top 5 predictions
  - Should be 65-80% for good model

### Interpretation

**Why not 100% accuracy?**

1. **Multiple Good Moves**: Many positions have several equally good moves
2. **Style vs Strength**: Model learns style, not always optimal play
3. **Limited Data**: Only ~3000 positions from 81 games
4. **Chess Complexity**: Chess has astronomical possibilities

**What's good performance?**

- Top-1 accuracy of 25-35% is good for this dataset size
- Top-3 accuracy of 50-60% shows the model understands Fischer's style
- The model should capture Fischer's preferences (e.g., aggressive play, active pieces)

## Using the Trained Model

### In Python Code

```python
from src.fischer_bot_ml import FischerBotML
import chess

# Create ML-enhanced bot
bot = FischerBotML(
    max_depth=4,           # Search depth
    use_opening_book=True, # Use Fischer's openings
    use_ml=True,           # Enable ML predictions
    ml_weight=0.4          # 40% ML, 60% search
)

# Play a game
board = chess.Board()
move = bot.get_move(board)
print(f"Fischer Bot plays: {board.san(move)}")
```

### Adjusting ML vs Search Balance

```python
# More Fischer's style (ML)
bot.set_ml_weight(0.7)  # 70% ML, 30% search

# More tactical accuracy (search)
bot.set_ml_weight(0.2)  # 20% ML, 80% search

# Pure ML (Fischer's intuition only)
bot.set_ml_weight(1.0)

# Pure search (no ML)
bot.set_ml_weight(0.0)
```

### Getting Analysis

```python
analysis = bot.get_fischer_analysis(board)

print("ML Top Moves:", analysis['ml_top_moves'])
print("Search Best:", analysis['search_best_move'])
print("Hybrid Best:", analysis['hybrid_best_move'])
```

## Improving the Model

### More Training Data

1. **Add More Fischer Games**:
   - Download additional games from ChessGames.com
   - Add to `data/` directory
   - Retrain model

2. **Quality Over Quantity**:
   - Focus on Fischer's best games
   - Include games where he played well
   - Exclude blunders and time pressure games

### Training Hyperparameters

```bash
# Longer training
python train_model_pytorch.py --epochs 300

# Larger batches (if you have RAM)
python train_model_pytorch.py --batch-size 256

# Lower learning rate (for fine-tuning)
python train_model_pytorch.py --lr 0.0001 --epochs 200

# Use GPU
python train_model_pytorch.py --device cuda --epochs 500
```

### Model Architecture

Edit `src/ml_engine_pytorch.py` to change architecture:

```python
# Deeper network
FischerNN(hidden_sizes=[1024, 1024, 512, 256])

# Wider network
FischerNN(hidden_sizes=[2048, 1024, 512])

# Less dropout (if overfitting isn't a problem)
nn.Dropout(0.2)  # Instead of 0.3
```

## Troubleshooting

### Out of Memory

```bash
# Reduce batch size
python train_model_pytorch.py --batch-size 32

# Use smaller model
# Edit src/ml_engine_pytorch.py, change hidden_sizes to [512, 256, 128]
```

### Poor Accuracy

1. **Train longer**: `--epochs 300`
2. **Check data**: Ensure PGN files loaded correctly
3. **Lower learning rate**: `--lr 0.0005`
4. **Add more data**: Download additional Fischer games

### Model Not Loading

```bash
# Check model file exists
ls -la models/fischer_model_pytorch.pth

# Retrain if corrupted
python train_model_pytorch.py --epochs 100
```

## Advanced Topics

### Data Augmentation

Add position mirroring for more training data:

```python
# In fischer_dataset.py, add mirrored positions
def mirror_position(board):
    return board.mirror()
```

### Transfer Learning

Start from a pre-trained model:

```python
# Load existing model
model = FischerNN()
model.load_state_dict(torch.load('models/existing_model.pth'))

# Continue training
optimizer = optim.Adam(model.parameters(), lr=0.0001)
```

### Ensemble Models

Train multiple models and combine predictions:

```python
# Train 3 models with different random seeds
# Combine their predictions
final_probs = (probs1 + probs2 + probs3) / 3
```

## Performance Benchmarks

Expected training times (CPU):

- 100 epochs, batch 64: ~10-15 minutes
- 200 epochs, batch 128: ~20-30 minutes
- 500 epochs, batch 64: ~45-60 minutes

With GPU (NVIDIA RTX 3060):

- 100 epochs, batch 64: ~2-3 minutes
- 500 epochs, batch 256: ~8-10 minutes

## References

- [PyTorch Documentation](https://pytorch.org/docs/)
- [Chess Programming Wiki](https://www.chessprogramming.org/)
- [AlphaZero Paper](https://arxiv.org/abs/1712.01815)
- [Leela Chess Zero](https://lczero.org/)

## Next Steps

1. **Deploy Model**: Use trained model in web interface
2. **Compare to Stockfish**: Benchmark against strong engines
3. **Play Test Games**: Test against human players
4. **Iterate**: Collect feedback and retrain

---

*Happy training! May your bot play like Bobby Fischer!*
