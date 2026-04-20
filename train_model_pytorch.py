"""
PyTorch-based training script for Fischer ML model.
Trains a deep neural network on Bobby Fischer's games with proper backpropagation.
"""

import sys
from pathlib import Path
import numpy as np

# Add src to path
sys.path.insert(0, str(Path(__file__).parent))

try:
    import torch
    import torch.nn as nn
    import torch.optim as optim
    from torch.utils.data import Dataset, DataLoader, random_split
    TORCH_AVAILABLE = True
except ImportError:
    print("ERROR: PyTorch not installed!")
    print("Install with: pip install torch")
    sys.exit(1)

from src.ml_engine_pytorch import FischerMLEnginePyTorch, FischerNN
from src.fischer_dataset import load_default_dataset


class FischerChessDataset(Dataset):
    """PyTorch Dataset for Fischer's games."""

    def __init__(self, positions, ml_engine):
        """
        Initialize dataset.

        Args:
            positions: List of (board, move) tuples
            ml_engine: ML engine for feature extraction
        """
        self.positions = positions
        self.ml_engine = ml_engine

    def __len__(self):
        return len(self.positions)

    def __getitem__(self, idx):
        board, move = self.positions[idx]

        # Extract features
        features = self.ml_engine.board_to_features(board)

        # Convert move to label
        move_label = move.from_square * 64 + move.to_square

        return torch.FloatTensor(features), move_label


def train_fischer_model_pytorch(
    epochs: int = 100,
    batch_size: int = 64,
    learning_rate: float = 0.001,
    validation_split: float = 0.1,
    save_every: int = 10,
    device: str = 'cpu'
):
    """
    Train the Fischer ML model using PyTorch.

    Args:
        epochs: Number of training epochs
        batch_size: Batch size for training
        learning_rate: Learning rate
        validation_split: Fraction of data for validation
        save_every: Save checkpoint every N epochs
        device: 'cpu' or 'cuda'
    """
    print("="*80)
    print("Fischer Bot ML Training (PyTorch)")
    print("Training deep neural network on Bobby Fischer's games")
    print("="*80)
    print()

    # Set device
    device = torch.device(device if torch.cuda.is_available() else 'cpu')
    print(f"Using device: {device}")
    print()

    # Load dataset
    print("Loading Fischer's games...")
    dataset = load_default_dataset()
    print(f"Dataset statistics: {dataset.get_statistics()}")
    print()

    # Initialize ML engine
    print("Initializing model...")
    ml_engine = FischerMLEnginePyTorch(device=str(device))
    model = ml_engine.model

    print(f"Model architecture:")
    print(f"  Input size: 773")
    print(f"  Hidden layers: 1024 -> 512 -> 256")
    print(f"  Output size: 4096")
    print(f"  Parameters: {sum(p.numel() for p in model.parameters()):,}")
    print()

    # Extract positions
    print("Extracting positions from games...")
    dataset.extract_positions()

    # Create PyTorch dataset
    chess_dataset = FischerChessDataset(dataset.positions, ml_engine)
    print(f"Total positions: {len(chess_dataset)}")
    print()

    # Split into train and validation
    val_size = int(len(chess_dataset) * validation_split)
    train_size = len(chess_dataset) - val_size

    train_dataset, val_dataset = random_split(
        chess_dataset,
        [train_size, val_size],
        generator=torch.Generator().manual_seed(42)
    )

    print(f"Training samples: {len(train_dataset)}")
    print(f"Validation samples: {len(val_dataset)}")
    print()

    # Create data loaders
    train_loader = DataLoader(
        train_dataset,
        batch_size=batch_size,
        shuffle=True,
        num_workers=0
    )

    val_loader = DataLoader(
        val_dataset,
        batch_size=batch_size,
        shuffle=False,
        num_workers=0
    )

    # Loss and optimizer
    criterion = nn.CrossEntropyLoss()
    optimizer = optim.Adam(model.parameters(), lr=learning_rate)

    # Learning rate scheduler
    scheduler = optim.lr_scheduler.ReduceLROnPlateau(
        optimizer, mode='min', factor=0.5, patience=5
    )

    print(f"Starting training for {epochs} epochs...")
    print(f"Batch size: {batch_size}")
    print(f"Learning rate: {learning_rate}")
    print()

    # Training loop
    best_val_loss = float('inf')
    train_losses = []
    val_losses = []

    for epoch in range(epochs):
        # Training phase
        model.train()
        train_loss = 0.0
        train_correct = 0
        train_total = 0

        for batch_idx, (features, labels) in enumerate(train_loader):
            features = features.to(device)
            labels = labels.to(device)

            # Forward pass
            optimizer.zero_grad()
            outputs = model(features)
            loss = criterion(outputs, labels)

            # Backward pass
            loss.backward()
            optimizer.step()

            # Statistics
            train_loss += loss.item() * features.size(0)
            _, predicted = torch.max(outputs.data, 1)
            train_total += labels.size(0)
            train_correct += (predicted == labels).sum().item()

        # Calculate training metrics
        avg_train_loss = train_loss / len(train_dataset)
        train_accuracy = train_correct / train_total

        # Validation phase
        model.eval()
        val_loss = 0.0
        val_correct = 0
        val_total = 0

        with torch.no_grad():
            for features, labels in val_loader:
                features = features.to(device)
                labels = labels.to(device)

                outputs = model(features)
                loss = criterion(outputs, labels)

                val_loss += loss.item() * features.size(0)
                _, predicted = torch.max(outputs.data, 1)
                val_total += labels.size(0)
                val_correct += (predicted == labels).sum().item()

        # Calculate validation metrics
        avg_val_loss = val_loss / len(val_dataset)
        val_accuracy = val_correct / val_total

        train_losses.append(avg_train_loss)
        val_losses.append(avg_val_loss)

        # Update learning rate
        scheduler.step(avg_val_loss)

        # Print progress
        print(f"Epoch [{epoch+1}/{epochs}] "
              f"Train Loss: {avg_train_loss:.4f}, Train Acc: {train_accuracy:.4f} | "
              f"Val Loss: {avg_val_loss:.4f}, Val Acc: {val_accuracy:.4f}")

        # Save best model
        if avg_val_loss < best_val_loss:
            best_val_loss = avg_val_loss
            model_path = Path(__file__).parent / "models" / "fischer_model_pytorch_best.pth"
            model_path.parent.mkdir(exist_ok=True)
            ml_engine.save_model(str(model_path), epoch=epoch+1, loss=avg_val_loss)
            print(f"  -> Saved best model (val_loss: {avg_val_loss:.4f})")

        # Save checkpoint
        if (epoch + 1) % save_every == 0:
            checkpoint_path = Path(__file__).parent / "models" / f"fischer_model_pytorch_epoch{epoch+1}.pth"
            ml_engine.save_model(str(checkpoint_path), epoch=epoch+1, loss=avg_val_loss)

    # Save final model
    final_model_path = Path(__file__).parent / "models" / "fischer_model_pytorch.pth"
    ml_engine.save_model(str(final_model_path), epoch=epochs, loss=avg_val_loss)

    print()
    print("="*80)
    print("Training Complete!")
    print("="*80)
    print(f"Best validation loss: {best_val_loss:.4f}")
    print(f"Final validation accuracy: {val_accuracy:.4f}")
    print()
    print("Saved models:")
    print(f"  - Best model: models/fischer_model_pytorch_best.pth")
    print(f"  - Final model: models/fischer_model_pytorch.pth")
    print()

    return ml_engine, train_losses, val_losses


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description='Train Fischer Bot ML model')
    parser.add_argument('--epochs', type=int, default=100, help='Number of epochs')
    parser.add_argument('--batch-size', type=int, default=64, help='Batch size')
    parser.add_argument('--lr', type=float, default=0.001, help='Learning rate')
    parser.add_argument('--device', type=str, default='cpu', help='Device (cpu or cuda)')

    args = parser.parse_args()

    # Train the model
    ml_engine, train_losses, val_losses = train_fischer_model_pytorch(
        epochs=args.epochs,
        batch_size=args.batch_size,
        learning_rate=args.lr,
        device=args.device
    )

    print("\nTo use the trained model:")
    print("  from src.fischer_bot_ml import FischerBotML")
    print("  bot = FischerBotML(use_ml=True)")
    print()
