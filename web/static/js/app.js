/* FischerBot web client.
 *
 * The client owns game state: `history` (UCI strings from the start position)
 * is the source of truth and is sent whole with every /api/move request.
 * The server is stateless and replays it.
 */
'use strict';

(function () {
  var STATUS_MESSAGES = {
    checkmate_white: 'Checkmate — White wins',
    checkmate_black: 'Checkmate — Black wins',
    stalemate: 'Stalemate — draw',
    insufficient_material: 'Draw — insufficient material',
    fifty_moves: 'Draw — fifty-move rule',
    repetition: 'Draw — threefold repetition'
  };
  var MATE_THRESHOLD_CP = 99000;
  var MATE_SCORE_CP = 100000;
  var ERROR_HIDE_MS = 7000;

  var game = new Chess();
  var board = null;
  var history = [];       // UCI move list, source of truth for the server
  var humanColor = 'w';
  var isThinking = false;
  var isGameOver = false;
  var gameSeq = 0;        // discards bot replies that arrive after a New Game
  var errorTimer = null;

  // ---------- rendering ----------

  function isHumansTurn() {
    return game.turn() === humanColor;
  }

  function setThinking(on) {
    isThinking = on;
    $('#thinking').toggleClass('is-visible', on);
  }

  function showError(message) {
    var $err = $('#error');
    $err.text(message).prop('hidden', false);
    if (errorTimer) { window.clearTimeout(errorTimer); }
    errorTimer = window.setTimeout(function () { $err.prop('hidden', true); }, ERROR_HIDE_MS);
  }

  function renderScoresheet() {
    var san = game.history();
    var rows = '';
    for (var i = 0; i < san.length; i += 2) {
      rows += '<li><span class="move-no">' + (i / 2 + 1) + '.</span>' +
        '<span class="ply">' + san[i] + '</span>' +
        '<span class="ply">' + (san[i + 1] || '') + '</span></li>';
    }
    var $sheet = $('#scoresheet');
    $sheet.html(rows || '<li class="scoresheet-empty">No moves recorded.</li>');
    $sheet.get(0).scrollTop = $sheet.get(0).scrollHeight;
  }

  function renderStatus(serverStatus) {
    var $banner = $('#banner');
    var message;
    if (serverStatus && serverStatus !== 'playing') {
      isGameOver = true;
      message = STATUS_MESSAGES[serverStatus] || 'Game over';
      $('#status').text(message);
      $banner.text(message).addClass('is-visible');
      $('#check').prop('hidden', true);
      return;
    }
    $banner.removeClass('is-visible');
    var side = game.turn() === 'w' ? 'White' : 'Black';
    $('#status').text(isHumansTurn()
      ? 'Your move — ' + side + ' to play'
      : 'FischerBot — ' + side + ' to play');
    $('#check').prop('hidden', !game.in_check());
  }

  function formatEval(botCp) {
    var humanCp = -botCp; // server reports from the bot's perspective
    if (Math.abs(botCp) > MATE_THRESHOLD_CP) {
      var mateIn = Math.ceil((MATE_SCORE_CP - Math.abs(botCp)) / 2);
      return humanCp > 0 ? 'mate in ' + mateIn + ' for you' : 'mate in ' + mateIn + ' against you';
    }
    var pawns = humanCp / 100;
    return (pawns >= 0 ? '+' : '') + pawns.toFixed(1);
  }

  function renderSourceNote(data) {
    var $panel = $('#book-panel');
    var $note = $('#book-note');
    $panel.removeClass('is-book');
    if (!data) {
      $note.text('Awaiting the first move.');
      return;
    }
    if (data.source === 'book') {
      $panel.addClass('is-book');
      $note.html($('<span>').text('From ' + (data.book_citation || "Fischer's opening repertoire") + '.').html() +
        '<span class="book-source">played from the book</span>');
    } else if (data.source === 'search+style') {
      $note.html('Out of the book — searching.' +
        '<span class="book-source">styled move</span>');
    } else {
      var parts = [];
      if (typeof data.depth === 'number') { parts.push('depth ' + data.depth); }
      if (typeof data.eval_cp === 'number') { parts.push(formatEval(data.eval_cp)); }
      $note.html('Out of the book — searching.' +
        (parts.length ? '<span class="book-source">' + parts.join(' · ') + '</span>' : ''));
    }
  }

  function highlightLastMove(uci) {
    $('#board .square-55d63').removeClass('last-move');
    if (!uci) { return; }
    $('#board .square-' + uci.slice(0, 2)).addClass('last-move');
    $('#board .square-' + uci.slice(2, 4)).addClass('last-move');
  }

  // ---------- server round-trip ----------

  function rollbackHumanMove(message) {
    game.undo();
    history.pop();
    board.position(game.fen());
    highlightLastMove(history.length ? history[history.length - 1] : null);
    renderScoresheet();
    renderStatus(null);
    showError(message);
  }

  function handleBotResponse(data) {
    if (!data.bot_move) {
      // The human's move ended the game; server confirms the final status.
      renderStatus(data.status);
      return;
    }
    var applied = game.move({
      from: data.bot_move.slice(0, 2),
      to: data.bot_move.slice(2, 4),
      promotion: data.bot_move.length > 4 ? data.bot_move.charAt(4) : 'q'
    });
    if (!applied) {
      showError('Client rejected server move ' + data.bot_move + '. Start a new game.');
      return;
    }
    history.push(data.bot_move);
    board.position(game.fen());
    highlightLastMove(data.bot_move);
    renderScoresheet();
    renderSourceNote(data);
    renderStatus(data.status);
  }

  function requestBotMove(hadHumanMove) {
    var seq = gameSeq;
    setThinking(true);
    $.ajax({
      url: '/api/move',
      method: 'POST',
      contentType: 'application/json',
      dataType: 'json',
      data: JSON.stringify({ history: history.slice(), difficulty: $('#difficulty').val() })
    }).done(function (data) {
      if (seq !== gameSeq) { return; }
      setThinking(false);
      if (data && data.error) {
        if (hadHumanMove) { rollbackHumanMove(data.error); } else { showError(data.error); }
        return;
      }
      handleBotResponse(data || {});
    }).fail(function (xhr) {
      if (seq !== gameSeq) { return; }
      setThinking(false);
      var message = (xhr && xhr.responseJSON && xhr.responseJSON.error)
        ? xhr.responseJSON.error
        : 'Could not reach FischerBot (HTTP ' + (xhr && xhr.status ? xhr.status : '?') + ').';
      if (hadHumanMove) { rollbackHumanMove(message); } else { showError(message); }
    });
  }

  // ---------- board events ----------

  function onDragStart(source, piece) {
    if (isThinking || isGameOver || game.game_over()) { return false; }
    if (!isHumansTurn()) { return false; }
    if (piece.charAt(0) !== humanColor) { return false; }
    return true;
  }

  function onDrop(source, target) {
    var move = game.move({ from: source, to: target, promotion: 'q' }); // always queen
    if (move === null) { return 'snapback'; }
    var uci = move.from + move.to + (move.promotion || '');
    history.push(uci);
    highlightLastMove(uci);
    renderScoresheet();
    renderStatus(null);
    requestBotMove(true);
  }

  function onSnapEnd() {
    board.position(game.fen());
  }

  // ---------- game lifecycle ----------

  function newGame() {
    gameSeq += 1;
    game = new Chess();
    history = [];
    isGameOver = false;
    setThinking(false);
    humanColor = $('.seg-btn.is-active').data('color') === 'black' ? 'b' : 'w';
    board.orientation(humanColor === 'w' ? 'white' : 'black');
    board.position('start', false);
    highlightLastMove(null);
    renderScoresheet();
    renderSourceNote(null);
    renderStatus(null);
    $('#error').prop('hidden', true);
    if (humanColor === 'b') { requestBotMove(false); } // bot opens as White
  }

  $(function () {
    board = Chessboard('board', {
      draggable: true,
      position: 'start',
      pieceTheme: '/static/img/pieces/{piece}.svg',
      onDragStart: onDragStart,
      onDrop: onDrop,
      onSnapEnd: onSnapEnd
    });
    $('#new-game').on('click', newGame);
    $('.seg-btn').on('click', function () {
      $('.seg-btn').removeClass('is-active').attr('aria-pressed', 'false');
      $(this).addClass('is-active').attr('aria-pressed', 'true');
    });
    $(window).on('resize', function () { board.resize(); });
    renderStatus(null);
  });
})();
