#!/usr/bin/env python3
"""Deal or No Deal 3D: the same game rules, with a Three.js stage.

The rules live in deal_or_no_deal.Game. This file serves the web front end
from the web/ folder and exposes a small JSON API that drives one Game.
The page opens in a desktop window through pywebview, or in your normal
browser with --browser.

Run with:  python deal_or_no_deal_3d.py            (desktop window)
           python deal_or_no_deal_3d.py --browser  (default browser)
Install:   python -m pip install pywebview
"""

from __future__ import annotations

import argparse
import json
import random
import threading
import webbrowser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from deal_or_no_deal import CASE_VALUES, ROUND_SCHEDULE, Game

WEB_DIR = Path(__file__).resolve().parent / "web"


class GameSession:
    """One game, made safe to call from the server's threads.

    Values of sealed cases never leave this object until the game is over.
    """

    def __init__(self, rng: random.Random | None = None) -> None:
        self.rng = rng
        self.lock = threading.Lock()
        self.game = Game(rng)

    def state(self) -> dict:
        game = self.game
        over = game.phase == "over"
        state = {
            "phase": game.phase,
            "values": sorted(CASE_VALUES),
            "cases": sorted(game.cases),
            "playerCase": game.player_case,
            "opened": {str(n): game.cases[n] for n in game.opened},
            "remaining": game.remaining_values,
            "round": game.round_number,
            "rounds": len(ROUND_SCHEDULE),
            "toOpen": game.to_open if game.phase == "open" else 0,
            "nextToOpen": (ROUND_SCHEDULE[game.round_index + 1]
                           if game.round_index + 1 < len(ROUND_SCHEDULE) else 0),
            "lastOffer": game.round_index == len(ROUND_SCHEDULE) - 1,
            "offers": list(game.offers),
            "otherCase": game.other_case if game.phase in ("final", "over") and game.outcome != "deal"
            else None,
            "winnings": game.winnings,
            "outcome": game.outcome,
            "verdict": game.verdict() if over else None,
            "playerValue": game.cases[game.player_case] if over else None,
            "otherValue": (game.cases[game.other_case]
                           if over and game.outcome != "deal" else None),
        }
        return state

    def act(self, action: str, case: int | None = None) -> dict:
        with self.lock:
            game = self.game
            if action == "new":
                self.game = Game(self.rng)
            elif action == "pick":
                game.pick(int(case))
            elif action == "open":
                game.open_case(int(case))
            elif action in ("deal", "no_deal", "keep", "swap"):
                getattr(game, action)()
            elif action != "state":
                raise ValueError(f"Unknown action: {action}")
            return self.state()


class Handler(SimpleHTTPRequestHandler):
    session: GameSession
    on_quit = None

    def log_message(self, *_args) -> None:
        pass  # Keep the console quiet.

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _send_json(self, status: int, data: dict) -> None:
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        if self.path == "/api/quit":
            self._send_json(200, {"ok": True})
            if self.on_quit:
                self.on_quit()
            return
        if self.path != "/api":
            self._send_json(404, {"error": "Not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            request = json.loads(self.rfile.read(length) or b"{}")
            self._send_json(200, self.session.act(request.get("action", "state"), request.get("case")))
        except (ValueError, TypeError, KeyError) as error:
            self._send_json(400, {"error": str(error)})


def start_server(session: GameSession, port: int = 0, on_quit=None) -> ThreadingHTTPServer:
    handler = type("GameHandler", (Handler,), {"session": session, "on_quit": staticmethod(on_quit)
                                               if on_quit else None})
    server = ThreadingHTTPServer(("127.0.0.1", port), partial(handler, directory=str(WEB_DIR)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--browser", action="store_true", help="open in your default browser instead")
    parser.add_argument("--no-open", action="store_true", help="only run the server, open nothing")
    parser.add_argument("--port", type=int, default=0, help="port to serve on (default: any free port)")
    args = parser.parse_args()

    session = GameSession()
    if args.browser or args.no_open:
        server = start_server(session, args.port)
        url = f"http://127.0.0.1:{server.server_address[1]}/"
        print(f"Deal or No Deal is running at {url}  (Ctrl+C to stop)", flush=True)
        if not args.no_open:
            webbrowser.open(url)
        try:
            threading.Event().wait()
        except KeyboardInterrupt:
            server.shutdown()
        return

    try:
        import webview
    except ImportError:
        raise SystemExit("pywebview is not installed. Run:  python -m pip install pywebview\n"
                         "Or play in your browser:  python deal_or_no_deal_3d.py --browser")

    holder: dict = {}
    server = start_server(session, args.port, on_quit=lambda: holder["window"].destroy())
    url = f"http://127.0.0.1:{server.server_address[1]}/"
    holder["window"] = webview.create_window("Deal or No Deal", url, width=1280, height=800,
                                             min_size=(960, 600), background_color="#07080c")
    webview.start()
    server.shutdown()


if __name__ == "__main__":
    main()
