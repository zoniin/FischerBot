"""
Training script for Fischer ML model.
Trains a neural network on Bobby Fischer's games to predict his moves.
"""

import sys
from pathlib import Path

# Add src to path
sys.path.insert(0, str(Path(__file__).parent))

from src.ml_engine import FischerMLEngine, SimpleNeuralNetwork
from src.fischer_dataset import load_default_dataset
import numpy as np


def train_fischer_model(epochs: int = 100, learning_rate: float = 0.001):
    """
    Train the Fischer ML model.

    Args:
        epochs: Number of training epochs
        learning_rate: Learning rate for training
    """
    print("Loading Fischer's games...")
    dataset = load_default_dataset()

    print(f"Dataset statistics: {dataset.get_statistics()}")

    # Initialize ML engine
    ml_engine = FischerMLEngine()
    ml_engine.model = SimpleNeuralNetwork()

    print("Extracting training data...")
    X, y = dataset.get_training_data(ml_engine)

    print(f"Training data shape: X={X.shape}, y={y.shape}")

    # Simple training loop
    print(f"Training for {epochs} epochs...")
    batch_size = 32
    n_samples = len(X)

    for epoch in range(epochs):
        # Shuffle data
        indices = np.random.permutation(n_samples)
        X_shuffled = X[indices]
        y_shuffled = y[indices]

        total_loss = 0
        correct = 0

        # Mini-batch training
        for i in range(0, n_samples, batch_size):
            batch_X = X_shuffled[i:i+batch_size]
            batch_y = y_shuffled[i:i+batch_size]

            # Forward pass
            predictions = ml_engine.model.predict(batch_X)

            # Calculate loss (cross-entropy)
            batch_loss = 0
            for pred, label in zip(predictions, batch_y):
                batch_loss -= np.log(pred[label] + 1e-10)
                if np.argmax(pred) == label:
                    correct += 1

            total_loss += batch_loss

            # Backward pass (simplified gradient descent)
            # In a real implementation, you'd use proper backpropagation
            # For now, this is a placeholder - consider using PyTorch/TensorFlow

        avg_loss = total_loss / n_samples
        accuracy = correct / n_samples

        if (epoch + 1) % 10 == 0:
            print(f"Epoch {epoch+1}/{epochs} - Loss: {avg_loss:.4f}, Accuracy: {accuracy:.4f}")

    # Save the trained model
    model_path = Path(__file__).parent / "models" / "fischer_model.pkl"
    model_path.parent.mkdir(exist_ok=True)

    ml_engine.save_model(str(model_path))
    print(f"Model saved to {model_path}")

    return ml_engine


if __name__ == "__main__":
    print("="*60)
    print("Fischer Bot ML Training")
    print("Training neural network on Bobby Fischer's games")
    print("="*60)
    print()

    # Train the model
    trained_model = train_fischer_model(epochs=100)

    print()
    print("Training complete!")
    print()
    print("Note: This is a simplified training implementation.")
    print("For production use, consider:")
    print("  - Using PyTorch or TensorFlow for proper backpropagation")
    print("  - Adding more Fischer games to the dataset")
    print("  - Using a deeper network architecture")
    print("  - Implementing proper validation and testing")
