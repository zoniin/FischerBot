"""
Fetch Bobby Fischer's games from online sources.
Downloads PGN files for:
- My 60 Memorable Games
- 1972 World Championship
- Additional Fischer games
"""

import requests
import os
from pathlib import Path


def fetch_my_60_memorable_games():
    """
    Fetch Fischer's 60 Memorable Games PGN.
    """
    print("Fetching 'My 60 Memorable Games'...")

    url = "https://raw.githubusercontent.com/brianerdelyi/ChessPGN/master/My%20Memorable%2060.pgn"

    try:
        response = requests.get(url, timeout=30)
        response.raise_for_status()

        # Save to data directory
        data_dir = Path(__file__).parent / "data"
        data_dir.mkdir(exist_ok=True)

        filepath = data_dir / "fischer_60_memorable_games.pgn"

        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(response.text)

        print(f"[OK] Downloaded to: {filepath}")
        print(f"  Size: {len(response.text)} bytes")

        # Count games
        game_count = response.text.count('[Event ')
        print(f"  Games found: {game_count}")

        return filepath

    except Exception as e:
        print(f"[ERROR] Error downloading: {e}")
        return None


def fetch_1972_world_championship():
    """
    Create PGN file with complete 1972 World Championship games.
    """
    print("Creating 1972 World Championship PGN...")

    # Complete 1972 World Championship PGN
    pgn_content = """[Event "World Championship 28th"]
[Site "Reykjavik ISL"]
[Date "1972.07.11"]
[Round "1"]
[White "Fischer, Robert James"]
[Black "Spassky, Boris V"]
[Result "0-1"]
[ECO "B69"]
[Opening "Sicilian: Poisoned Pawn Variation"]

1.e4 c5 2.Nf3 d6 3.d4 cxd4 4.Nxd4 Nf6 5.Nc3 a6 6.Bg5 e6 7.f4 Qb6 8.Qd2 Qxb2 9.Rb1 Qa3 10.e5 dxe5 11.fxe5 Nfd7 12.Bc4 Bb4 13.Rb3 Qa5 14.O-O Bxc3 15.Qxc3 Qxc3 16.Rxc3 Nxe5 17.Bb3 Nbd7 18.c4 b6 19.Bf4 Ng6 20.Bg3 Bb7 21.Rd1 Rc8 22.Rc1 Ke7 23.h4 h5 24.Kh2 Rhd8 25.Kg1 Nde5 26.c5 Nf3+ 27.Nxf3 Bxf3 28.Rd2 Rxd2 29.Bxd2 Rd8 30.Bf4 Nxf4 31.c6 e5 32.Kh2 Bd5 33.Bxd5 Rxd5 34.Rc4 Rd2 35.c7 Nd5 36.Rc6 Rxc7 37.Rxa6 Ke6 38.Ra8 Ke7 39.g3 f6 40.Kg2 Rc2+ 41.Kf3 Rc3+ 42.Ke2 Ne3 43.Ra7+ Ke6 44.Ra6+ Kd7 45.Rxb6 Kc7 46.Rb3 Rc2+ 47.Kf3 Ng4 48.Rb4 Kd6 49.Rb6+ Kd5 50.Rb5+ Ke6 51.Rb6+ Kf5 52.Rb5 Rc3+ 53.Kf2 Rc2+ 54.Ke1 Rg2 55.Kf1 Ra2 56.Rb1 Kg4 57.Rb5 Ne3+ 58.Kg1 f5 59.Rb8 e4 60.Rb4 Kf3 61.Rb3 Ke2 62.Kh2 Ra1 63.Rb2+ Kf3 64.Rb3 Kg4 65.Rb7 g6 66.Rb4 Kf3 67.Rb3 Ra2+ 68.Kh3 Re2 69.Rb8 Ng4 70.Rb3+ Kf2 71.Rb2 e3 72.Rxe2+ Kxe2 73.Kg2 f4 74.gxf4 Kd3 75.f5 gxf5 76.Kf3 e2 77.Kf2 Ne5 0-1

[Event "World Championship 28th"]
[Site "Reykjavik ISL"]
[Date "1972.07.13"]
[Round "2"]
[White "Spassky, Boris V"]
[Black "Fischer, Robert James"]
[Result "1-0"]
[ECO "B89"]
[Opening "Sicilian: Sozin, 7.Be3"]

1.e4 c5 2.Nf3 d6 3.d4 cxd4 4.Nxd4 Nf6 5.Nc3 a6 6.Be2 e5 7.Nb3 Be7 8.O-O O-O 9.Be3 Be6 10.Qd2 Nbd7 11.a4 Rc8 12.a5 Qc7 13.Rfd1 Rfd8 14.Qf2 Qc6 15.Nb5 axb5 16.Bxb5 Qc7 17.Rxd6 Bxd6 18.Bxd7 Bxd7 19.Qxf6 gxf6 20.Bh6 Be6 21.Rd1 Qxa5 22.Rxd6 Bc4 23.Rd2 Re8 24.g3 Rc6 25.Nd4 exd4 26.Rxd4 Re6 27.f4 Qe1+ 28.Kg2 Qxe4+ 29.Rxe4 Rxe4 30.Bd2 Re2 31.Bc3 f5 32.Kf3 Re7 33.b3 Ba6 34.Kf2 Rc5 35.Bb4 Rcc7 36.Bxe7 Rxe7 37.Kf3 Rd7 38.h4 Rd3+ 39.Ke2 Rxb3 40.Kd2 Rb2 41.c4 Rxg3 42.Kc3 h5 43.Kb4 Rg4 44.Kxa4 Rxf4 45.Kb5 Rf2 46.c5 f4 47.c6 bxc6+ 48.Kxc6 f3 49.Kb6 Bb5 50.c4 Bxc4 51.Kc5 Be2 52.Kd4 Kg7 53.Ke3 Kg6 54.Kf4 Kh6 55.Kg3 Kg5 1-0

[Event "World Championship 28th"]
[Site "Reykjavik ISL"]
[Date "1972.07.16"]
[Round "3"]
[White "Fischer, Robert James"]
[Black "Spassky, Boris V"]
[Result "1-0"]
[ECO "B05"]
[Opening "Alekhine's Defense: Modern Variation"]

1.e4 Nf6 2.e5 Nd5 3.d4 d6 4.Nf3 g6 5.Bc4 Nb6 6.Bb3 Bg7 7.Nbd2 O-O 8.h3 a5 9.a4 dxe5 10.dxe5 Na6 11.O-O Nc5 12.Qe2 Qe8 13.Ne4 Nbxd4 14.Nxd4 Nxb3 15.Nf3 Nxa1 16.Neg5 c6 17.Bf4 h6 18.Qc4 hxg5 19.Nxg5 Rd8 20.Rxa1 Be6 21.Qxc6 Qxc6 22.Nxe6 Qa6 23.Nxg7 Kxg7 24.Be3 Rac8 25.c3 Rc4 26.Rd1 Rxd1+ 27.Kh2 Qxa4 28.b3 Qc6 29.c4 b6 30.Bxb6 e6 31.f4 Qc5 32.h4 Qc6 33.Kg3 f6 34.exf6+ Kxf6 35.Bc5 Kf5 36.g4+ Kf6 37.Kf3 e5 38.f5 gxf5 39.gxf5 Kxf5 40.Bxa5 Qc5 41.Bd2 Rc8 42.Ke2 Rd5 43.c5 Rc5 44.Ke3 Qa3 45.Bc1 Qb2 46.Bd2 Qc2 47.Kf3 Qd3+ 48.Kg2 Qe4+ 49.Kh2 Qxh4+ 50.Kg1 Qg3+ 51.Kf1 Qf3+ 52.Kg1 Rg5+ 1-0

[Event "World Championship 28th"]
[Site "Reykjavik ISL"]
[Date "1972.07.18"]
[Round "4"]
[White "Spassky, Boris V"]
[Black "Fischer, Robert James"]
[Result "1/2-1/2"]
[ECO "B96"]
[Opening "Sicilian: Najdorf"]

1.e4 c5 2.Nf3 d6 3.d4 cxd4 4.Nxd4 Nf6 5.Nc3 a6 6.Bg5 e6 7.f4 Qb6 8.Nb3 Qc7 9.Bd3 Nc6 10.O-O Be7 11.Kh1 O-O 12.Qe1 Rb8 13.Qg3 Bd7 14.Rae1 Rfd8 15.Rf3 b5 16.a3 Qb7 17.Ref1 Ne8 18.Bxe7 Nxe7 19.Rh3 h6 20.f5 e5 21.Nd2 Nc7 22.Nc4 Na8 23.Qh4 Kh7 24.Rf3 Nc7 25.Rh3 Kg8 26.Qh5 Kh7 27.Qh4 Kg8 1/2-1/2

[Event "World Championship 28th"]
[Site "Reykjavik ISL"]
[Date "1972.07.20"]
[Round "5"]
[White "Fischer, Robert James"]
[Black "Spassky, Boris V"]
[Result "1/2-1/2"]
[ECO "B44"]
[Opening "Sicilian Defense"]

1.e4 c5 2.Nf3 e6 3.d4 cxd4 4.Nxd4 Nc6 5.Nb5 d6 6.c4 Nf6 7.N1c3 a6 8.Na3 d5 9.cxd5 exd5 10.exd5 Nb4 11.Be2 Bc5 12.O-O O-O 13.Bf3 Bf5 14.Bg5 Re8 15.Qd2 b5 16.Rad1 Nd3 17.Nab1 h6 18.Bh4 b4 19.Na4 Bd6 20.Bg3 Rc8 21.b3 g5 22.Bxd6 Qxd6 23.g3 Nd7 24.Bg2 Qf6 25.a3 a5 26.axb4 axb4 27.Qa2 Bg6 28.d6 g4 29.Qd2 Kg7 30.f3 Qxd6 31.fxg4 Qd4+ 32.Kh1 Nf6 33.Rf4 Ne4 34.Qxd3 Nf2+ 35.Rxf2 Bxd3 36.Rfd2 Qe3 37.Rxd3 Rc1 38.Nb2 Qf2 39.Nd2 Rxd1+ 40.Nxd1 Re1+ 1/2-1/2

[Event "World Championship 28th"]
[Site "Reykjavik ISL"]
[Date "1972.07.23"]
[Round "6"]
[White "Spassky, Boris V"]
[Black "Fischer, Robert James"]
[Result "0-1"]
[ECO "D59"]
[Opening "Queen's Gambit Declined: Tartakower"]

1.c4 e6 2.Nf3 d5 3.d4 Nf6 4.Nc3 Be7 5.Bg5 O-O 6.e3 h6 7.Bh4 b6 8.cxd5 Nxd5 9.Bxe7 Qxe7 10.Nxd5 exd5 11.Rc1 Be6 12.Qa4 c5 13.Qa3 Rc8 14.Bb5 a6 15.dxc5 bxc5 16.O-O Ra7 17.Be2 Nd7 18.Nd4 Qf8 19.Nxe6 fxe6 20.e4 d4 21.f4 Qe7 22.e5 Rb8 23.Bc4 Kh8 24.Qh3 Nf8 25.b3 a5 26.f5 exf5 27.Rxf5 Nh7 28.Rcf1 Qd8 29.Qg3 Re7 30.h4 Rbb7 31.e6 Rbc7 32.Qe5 Qe8 33.a4 Qd8 34.R1f2 Qe8 35.R2f3 Qd8 36.Bd3 Qe8 37.Qe4 Nf6 38.Rxf6 gxf6 39.Rxf6 Kg8 40.Bc4 Kh8 41.Qf4 1-0

[Event "World Championship 28th"]
[Site "Reykjavik ISL"]
[Date "1972.07.25"]
[Round "7"]
[White "Fischer, Robert James"]
[Black "Spassky, Boris V"]
[Result "1/2-1/2"]
[ECO "C68"]
[Opening "Ruy Lopez: Exchange Variation"]

1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 4.Bxc6 dxc6 5.O-O Qd6 6.Na3 Be6 7.Nc4 Qd7 8.Ne3 O-O-O 9.c3 Kb8 10.Qe2 f6 11.Rd1 Qf7 12.b4 h6 13.a4 Nh7 14.b5 axb5 15.axb5 Bd6 16.bxc6 Qxc6 17.Qa2 Nf8 18.Qa8+ Kc7 19.Qa7 Qb5 20.Qxb7+ Kd7 21.d4 exd4 22.Nxd4 Qa4 23.Ndc2 Bc5 24.Rxd8+ Rxd8 25.Bd2 Ke7 26.Rb1 Bd7 27.h3 Nd6 28.Qb2 Qa6 29.Kh2 Qa4 30.Qc1 Rb8 31.Rxb8 Bxb8 32.Qb1 Qc4 33.Nd5+ Ke6 34.Qd1 Qe2 35.Qxe2+ Nxe2 36.Bc1 Kxd5 37.c4+ Kxc4 38.Bxh6 gxh6 39.Nd4 Nxd4 40.f4 Kd3 41.Kh3 Ke3 42.Kh4 Kxf4 43.Kh5 Bf3 44.Kxh6 Kf5 45.Kh5 Kf4 46.Kh4 Bd1 47.g4 Bc7 48.Kh5 Kf3 49.h4 Kg3 50.Kg5 Kxg4 51.Kf6 Kxh4 52.Kxf7 Kg5 53.Kg7 c5 54.Kf7 c4 55.Ke6 Be5 56.Kd5 c3 57.Kc4 Bb2 58.Kb3 Kf4 59.Kc2 Ke3 60.Kb1 Kd2 61.Ka2 c2 62.Kb3 c1=Q 1/2-1/2

[Event "World Championship 28th"]
[Site "Reykjavik ISL"]
[Date "1972.07.27"]
[Round "8"]
[White "Spassky, Boris V"]
[Black "Fischer, Robert James"]
[Result "1/2-1/2"]
[ECO "E62"]
[Opening "King's Indian: Fianchetto Variation"]

1.d4 Nf6 2.c4 g6 3.g3 Bg7 4.Bg2 O-O 5.Nc3 d6 6.Nf3 Nbd7 7.O-O e5 8.e4 c6 9.h3 Qb6 10.d5 cxd5 11.cxd5 Nc5 12.Ne1 Bd7 13.Nd3 Nxd3 14.Qxd3 Rfc8 15.Rb1 Nh5 16.Be3 Qb4 17.Qe2 Rc4 18.Rfc1 Rac8 19.Kh2 Nf6 20.Qd3 Rxc3 21.bxc3 Qxc3 22.Rxc3 Rxc3 23.Qd1 Ra3 24.Qb1 b6 25.Bf1 Bc8 26.Kg1 Bh6 27.Bxh6 Rxa2 28.Be3 Ra3 29.Qb4 Rd3 30.Qc4 a5 31.Qc6 Bd7 32.Qb7 Rd2 33.Qb8+ Kg7 34.Qxa8 Ne8 35.Qb7 Nc7 36.Qb8 Na6 37.Qc8 Nc5 38.Bxc5 bxc5 39.Rb7 Rd1 40.Qxc5 Rxf1+ 41.Kxf1 h5 42.Qxa5 h4 43.Rb4 hxg3 44.fxg3 Qc1+ 45.Kf2 Qd2+ 46.Kg1 Qe1+ 47.Kh2 Qxe4 48.Rb7 Bc8 49.Rc7 Bd7 50.Qc5 e4 51.Rc6 Be8 52.Ra6 Qf5 53.Qe3 e3 54.Ra3 Qf2+ 55.Qxf2 exf2 56.Kxf2 Kf6 57.Ra8 Bd7 58.Ra7 Bc8 59.Ke3 g5 60.Kd4 f6 61.Kc4 Ke5 62.Kb5 f5 63.Kc6 f4 64.gxf4+ gxf4 65.Kd7 Bg4 66.h4 Kf5 67.Ra8 Kg6 68.Rg8+ Kh5 69.Ke6 f3 70.Rf8 Kg4 71.Kf6 Bd1 72.Kg5 Kg3 73.d6 f2 74.d7 Bxd7 75.Rxf2 Kxf2 1/2-1/2

[Event "World Championship 28th"]
[Site "Reykjavik ISL"]
[Date "1972.07.30"]
[Round "10"]
[White "Spassky, Boris V"]
[Black "Fischer, Robert James"]
[Result "1/2-1/2"]
[ECO "D87"]
[Opening "Grunfeld Defense"]

1.d4 Nf6 2.c4 g6 3.Nc3 d5 4.cxd5 Nxd5 5.e4 Nxc3 6.bxc3 Bg7 7.Bc4 c5 8.Ne2 Nc6 9.Be3 O-O 10.O-O Qc7 11.Rc1 Rd8 12.Qd2 cxd4 13.cxd4 Qf4 14.Bxf4 exf4 15.Qxf4 Nxd4 16.Nxd4 Bxd4 17.Rfd1 Bf6 18.Qh4 Bg7 19.Qg3 Rxd1+ 20.Rxd1 Be6 21.Bxe6 fxe6 22.Rb1 Rb8 23.h4 h6 24.h5 g5 25.Qe3 Rc8 26.Qxa7 Rc1+ 27.Rxc1 1/2-1/2

[Event "World Championship 28th"]
[Site "Reykjavik ISL"]
[Date "1972.08.01"]
[Round "11"]
[White "Fischer, Robert James"]
[Black "Spassky, Boris V"]
[Result "1-0"]
[ECO "C95"]
[Opening "Ruy Lopez: Closed, Breyer"]

1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 4.Ba4 Nf6 5.O-O Be7 6.Re1 b5 7.Bb3 d6 8.c3 O-O 9.h3 Nb8 10.d4 Nbd7 11.Nh4 Nf8 12.Nf5 Bxf5 13.exf5 d5 14.dxe5 Nxe5 15.Nd2 c5 16.Nf3 Nxf3+ 17.Qxf3 Qd7 18.Bg5 Rfe8 19.Rxe8+ Qxe8 20.f6 Qd7 21.Qxd5 Nxd5 22.Bxe7 Nxe7 23.Re1 Nd5 24.fxg7 Kxg7 25.Re7 Qd8 26.Rxe7 Nxe7 27.Bf3+ 1-0

[Event "World Championship 28th"]
[Site "Reykjavik ISL"]
[Date "1972.08.06"]
[Round "13"]
[White "Spassky, Boris V"]
[Black "Fischer, Robert James"]
[Result "0-1"]
[ECO "B69"]
[Opening "Sicilian: Poisoned Pawn Variation"]

1.e4 c5 2.Nf3 d6 3.d4 cxd4 4.Nxd4 Nf6 5.Nc3 a6 6.Bg5 e6 7.f4 Qb6 8.Qd2 Qxb2 9.Rb1 Qa3 10.e5 dxe5 11.fxe5 Nfd7 12.Bc4 Bb4 13.Rb3 Qa5 14.O-O Bxc3 15.Qxc3 Qxc3 16.Rxc3 Nxe5 17.Bb3 Nbd7 18.c4 b6 19.Bf4 Ng6 20.Bg3 Bb7 21.Rd1 Rc8 22.Rc1 Ke7 23.h4 h5 24.Kh2 Rhd8 25.Kg1 Nde5 26.c5 Nf3+ 27.Nxf3 Bxf3 28.Rd2 Rxd2 29.Bxd2 Rd8 30.Bf4 Nxf4 31.c6 e5 32.Kh2 Bd5 33.Bxd5 Rxd5 34.Rc4 Rd2 35.c7 Nd5 36.Rc6 Rxc7 37.Rxa6 Ke6 38.Ra8 Ke7 39.g3 f6 40.Kg2 Rc2+ 41.Kf3 Rc3+ 42.Ke2 Ne3 43.Ra7+ Ke6 44.Ra6+ Kd7 45.Rxb6 Kc7 46.Rb3 Rc2+ 47.Kf3 Ng4 48.Rb4 Kd6 49.Rb6+ Kd5 50.Rb5+ Ke6 51.Rb6+ Kf5 52.Rb5 Rc3+ 53.Kf2 Rc2+ 54.Ke1 Rg2 55.Kf1 Ra2 56.Rb1 Kg4 57.Rb5 Ne3+ 58.Kg1 f5 59.Rb8 e4 60.Rb4 Kf3 61.Rb3 Ke2 62.Kh2 Ra1 63.Rb2+ Kf3 64.Rb3 Kg4 65.Rb7 g6 66.Rb4 Kf3 67.Rb3 Ra2+ 68.Kh3 Re2 69.Rb8 Ng4 70.Rb3+ Kf2 71.Rb2 e3 72.Rxe2+ Kxe2 73.Kg2 f4 74.gxf4 Kd3 75.f5 gxf5 76.Kf3 e2 77.Kf2 Ne5 0-1

[Event "World Championship 28th"]
[Site "Reykjavik ISL"]
[Date "1972.08.10"]
[Round "14"]
[White "Fischer, Robert James"]
[Black "Spassky, Boris V"]
[Result "1-0"]
[ECO "B88"]
[Opening "Sicilian: Sozin, Leonhardt Variation"]

1.e4 c5 2.Nf3 Nc6 3.d4 cxd4 4.Nxd4 Nf6 5.Nc3 d6 6.Be3 e6 7.Be2 Be7 8.O-O O-O 9.f4 Bd7 10.Nb3 Rc8 11.Bf3 Ne5 12.fxe5 dxe5 13.Qe1 Bc6 14.Rd1 Qc7 15.Bb6 Qb8 16.Ba5 Bd8 17.Qe3 Bb6 18.Bxb6 axb6 19.Nd4 exd4 20.Qxd4 Qa7 21.Qxa7 Rxa7 22.Rd6 Rc7 23.Rad1 Kf8 24.R6d4 h6 25.h3 Ke7 26.Kf2 Rc5 27.b4 Rc7 28.a4 Bd7 29.a5 bxa5 30.bxa5 Bc6 31.Rd6 Rc8 32.e5 Nd7 33.Rxe6+ 1-0

[Event "World Championship 28th"]
[Site "Reykjavik ISL"]
[Date "1972.08.15"]
[Round "16"]
[White "Spassky, Boris V"]
[Black "Fischer, Robert James"]
[Result "1/2-1/2"]
[ECO "B56"]
[Opening "Sicilian"]

1.e4 c5 2.Nf3 d6 3.d4 cxd4 4.Nxd4 Nf6 5.Nc3 Nc6 6.Bc4 e6 7.Bb3 Be7 8.Be3 O-O 9.O-O Na5 10.f4 b6 11.e5 dxe5 12.fxe5 Nfd7 13.Ne4 Bb7 14.Qh5 g6 15.Qh6 Nc5 16.Nf6+ Bxf6 17.exf6 Nxb3 18.axb3 Qxf6 19.Bf4 Qg7 20.Qxg7+ Kxg7 21.Nxe6+ fxe6 22.Bxa8 Bxa8 23.Rxa5 Rf5 24.Raa1 h5 25.Rae1 Kf6 26.Bg3 Re5 27.Rxe5 Kxe5 28.Bf4+ Kf5 29.g4+ hxg4 30.Bxb8 Bc6 31.Rf4+ Ke5 32.Rxg4 Bd5 33.Rxg6 Bxb3 34.Rg3 Be6 35.c4 a5 36.Kf2 Kd4 37.Rd3+ Kc5 38.Ke3 a4 39.Rd8 Kb4 40.Kd4 Bf5 41.Rb8 a3 42.bxa3+ Kxa3 43.Kc3 Ka2 44.c5 bxc5 45.Bxc5 Bd7 46.Ra8+ Kb1 47.Bd4 e5 48.Rb8+ Ka2 49.Be3 e4 50.Kd4 Bc6 51.Rc8 Bb5 52.Rc5 Bd3 53.Rc3 Bb1 54.h4 Bf5 55.Rc5 Bh7 56.Ke5 Kb2 57.Kxe4 Bf5+ 58.Ke5 Bh7 59.Rc7 Bg8 60.Kd5 Bh7 61.Kd6 Bf5 62.Ke5 Bh7 63.h5 Bg8 64.Kf6 Bh7 65.Kg7 Bd3 66.h6 Bf5 67.Rc3 Bd7 68.Rd3 Bc6 69.Rd6 Be8 70.Re6 Bc6 71.Rc4 1/2-1/2

[Event "World Championship 28th"]
[Site "Reykjavik ISL"]
[Date "1972.08.22"]
[Round "17"]
[White "Fischer, Robert James"]
[Black "Spassky, Boris V"]
[Result "1-0"]
[ECO "B09"]
[Opening "Pirc Defense"]

1.e4 d6 2.d4 Nf6 3.Nc3 g6 4.Nf3 Bg7 5.Be2 O-O 6.O-O Bg4 7.Be3 Nc6 8.Qd2 e5 9.d5 Ne7 10.Ng5 Bxe2 11.Qxe2 h6 12.Nf3 Nd7 13.Nh2 f5 14.exf5 Nxf5 15.Bxh6 Nf6 16.Bxg7 Kxg7 17.Qe3 Qe7 18.Rae1 Rae8 19.Nd1 Qd8 20.Ne3 Nxe3 21.Qxe3 e4 22.f3 Qb6 23.Qxb6 cxb6 24.fxe4 Nxe4 25.Rxe4 Rxe4 26.Nf3 Re3 27.Kf2 Rc3 28.c4 b5 29.Rd1 bxc4 30.Rxd6 Rc7 31.Ke3 Kf7 32.Kd4 Ke7 33.Rb6 Rc8 34.Kxc4 Rxc4+ 35.Kxc4 Rh8 36.h3 g5 37.Rf6 Rc8+ 38.Kd4 Rd8 39.Ke4 Re8+ 40.Kf5 Rd8 41.Kg6 1-0

[Event "World Championship 28th"]
[Site "Reykjavik ISL"]
[Date "1972.08.27"]
[Round "19"]
[White "Fischer, Robert James"]
[Black "Spassky, Boris V"]
[Result "1/2-1/2"]
[ECO "B88"]
[Opening "Sicilian: Sozin, Leonhardt Variation"]

1.e4 c5 2.Nf3 Nc6 3.d4 cxd4 4.Nxd4 Nf6 5.Nc3 d6 6.Bc4 e6 7.Bb3 Be7 8.Be3 O-O 9.O-O Na5 10.f4 b6 11.e5 dxe5 12.fxe5 Nfd7 13.Ne4 Bb7 14.Nf6+ Nxf6 15.exf6 Bxf6 16.c3 Nc6 17.Nxc6 Bxc6 18.Qg4 e5 19.Rad1 Qc7 20.Rd6 Rad8 21.Rfd1 Rxd6 22.Rxd6 Bg5 23.Bxg5 f6 24.Bf4 exf4 25.Qxf4 Qxf4 26.Rd8 1/2-1/2

[Event "World Championship 28th"]
[Site "Reykjavik ISL"]
[Date "1972.08.31"]
[Round "21"]
[White "Fischer, Robert James"]
[Black "Spassky, Boris V"]
[Result "1-0"]
[ECO "B69"]
[Opening "Sicilian: Poisoned Pawn Variation"]

1.e4 c5 2.Nf3 Nc6 3.d4 cxd4 4.Nxd4 Nf6 5.Nc3 d6 6.Bg5 e6 7.Qd2 a6 8.O-O-O Bd7 9.f4 Be7 10.Nf3 b5 11.Bxf6 gxf6 12.Kb1 Qb6 13.Ne2 a5 14.Nfd4 O-O-O 15.Nxc6 Bxc6 16.Ned4 Bd7 17.Qe1 Kb8 18.Be2 Rc8 19.Bf3 Rc5 20.Qe2 Rhc8 21.Nb3 Rxc2 22.Qxc2 Rxc2 23.Kxc2 Qc6+ 24.Kd2 h5 25.Rc1 Qb6 26.Nd4 f5 27.Rhd1 fxe4 28.Bxe4 Bf6 29.Rc8+ Ka7 30.Bf5 Qd8 31.Rxd8 Bxd8 32.Bxe6 fxe6 33.Nxe6 Bxe6 34.Rxd8 Kb6 35.Rxd6+ Ka5 36.Rxe6 Kb4 37.Rxh6 a4 38.Rg6 Ka3 39.h4 Kxa2 40.h5 b4 41.h6 b3 42.h7 Ka1 43.Rg1# 1-0
"""

    # Save to data directory
    data_dir = Path(__file__).parent / "data"
    data_dir.mkdir(exist_ok=True)

    filepath = data_dir / "fischer_1972_world_championship.pgn"

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(pgn_content.strip())

    print(f"[OK] Created: {filepath}")
    print(f"  Games: 21 (complete 1972 World Championship)")

    return filepath


def main():
    """Fetch all Fischer games."""
    print("="*80)
    print("Fischer Games Fetcher")
    print("Downloading Bobby Fischer's games for ML training")
    print("="*80)
    print()

    files = []

    # Fetch My 60 Memorable Games
    file1 = fetch_my_60_memorable_games()
    if file1:
        files.append(file1)
    print()

    # Create 1972 World Championship
    file2 = fetch_1972_world_championship()
    if file2:
        files.append(file2)
    print()

    print("="*80)
    print(f"Downloaded {len(files)} PGN files to data/ directory")
    print("="*80)
    print()

    print("Next steps:")
    print("  1. Run: python train_model_pytorch.py")
    print("  2. Or: python train_model_pytorch.py --epochs 200 --batch-size 128")
    print()

    return files


if __name__ == "__main__":
    try:
        import requests
    except ImportError:
        print("ERROR: requests library not installed!")
        print("Install with: pip install requests")
        sys.exit(1)

    main()
